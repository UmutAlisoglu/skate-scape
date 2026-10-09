// Builds the 2009 player model from kits + worn items and animates it the way the client does: every pose
// (cache animation frames, the authored skate poses, and blends between them) is a set of values for the
// player animation base, applied to the composed model's labelled vertex groups. Frames tween, and switching
// between animations crossfades, so nothing pops.
import * as THREE from 'three';
import { hdFaceColor } from '../shared/color.ts';
import { SLOT, type AnimData, type ItemDef, type KitDef, type PartModel, type Wardrobe } from '../shared/player-data.ts';
import { rsMaterial, layerOf, type Surfaces } from '../world/rs-material.ts';
import { applyPose, blendPoses, framePose, originIndices, type AnimBase, type Pose } from './rs-pose.ts';
import { measureSkateRig, skatePose, type SkateRigInfo } from './skate-rig.ts';
import type { SkatePose } from './skate-pose.ts';
import { ease } from '../shared/motion.ts';

/** feature index (0-6) -> appearance slot, from the client's BASE_PART_MAP */
const FEATURE_SLOT = [SLOT.HAIR, SLOT.JAW, SLOT.TORSO, SLOT.ARMS, SLOT.HANDS, SLOT.LEGS, SLOT.FEET];
const FEATURE_NAMES = ['hair', 'jaw', 'torso', 'arms', 'hands', 'legs', 'feet'];
/** seconds to crossfade when the avatar switches between animations or into / out of skating */
const CROSSFADE = 0.18;

export interface Look {
  female: boolean;
  /** kit id per feature 0-6 (-1 = none, e.g. no beard) */
  kits: number[];
  /** indices into the client color tables: hair, torso, legs, feet, skin */
  colors: number[];
  /** item id per appearance slot */
  items: Partial<Record<number, number>>;
}

type Seq = AnimData['seqs'][number];

export class Avatar {
  readonly mesh: THREE.Mesh;
  private geometry = new THREE.BufferGeometry();
  // composed model in RS units (x right, y down, z behind)
  private baseX = new Float64Array(0);
  private baseY = new Float64Array(0);
  private baseZ = new Float64Array(0);
  private vx = new Float64Array(0);
  private vy = new Float64Array(0);
  private vz = new Float64Array(0);
  private tris = new Int32Array(0);
  /** per triangle: true = flat shaded (render type 1) */
  private flat: boolean[] = [];
  private groups: number[][] = [];
  private rig: SkateRigInfo | null = null;
  /** height (m) to raise the model so its soles sit on the deck */
  skateSoleOffset = 0.18;
  private readonly base: AnimBase | null;
  private readonly origins: Int32Array;
  // animation state
  private skate: SkatePose | null = null;
  private seq: Seq | null = null;
  private frame = 0;
  private frameTime = 0;
  private onDone: (() => void) | null = null;
  private loop = true;
  private finished = false;
  private elapsed = 0;
  private maxDuration = Infinity;
  private current: Pose = new Map();
  private fadeFrom: Pose | null = null;
  private fadeTime = 0;

  constructor(private wardrobe: Wardrobe, private anims: AnimData, private surfaces: Surfaces | null = null) {
    this.mesh = new THREE.Mesh(this.geometry, rsMaterial({ vertexColors: true, surfaces }));
    this.mesh.castShadow = true;
    this.base = anims.bases[0] ?? null;
    this.origins = this.base ? originIndices(this.base) : new Int32Array(0);
  }

  kitsFor(feature: number, female: boolean) {
    const f = female ? feature + 7 : feature;
    return this.wardrobe.kits.filter((k) => k.feature === f);
  }
  itemsFor(slot: number) {
    return this.wardrobe.items.filter((i) => i.slot === slot);
  }
  seqNames() {
    return this.anims.seqs.map((s) => s.name);
  }

  defaultLook(female = false): Look {
    return {
      female,
      kits: FEATURE_SLOT.map((_, f) => this.kitsFor(f, female)[0]?.id ?? -1),
      colors: [0, 0, 0, 0, 0],
      items: {},
    };
  }

  /** Random fashionscape: random body kits + colors, and a random item in most slots. */
  randomLook(female = Math.random() < 0.5): Look {
    const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)];
    const look: Look = {
      female,
      kits: FEATURE_SLOT.map((_, f) => {
        const options = this.kitsFor(f, female);
        if (f === 1 && !female && Math.random() < 0.3) return -1; // sometimes clean-shaven
        return options.length ? pick(options).id : -1;
      }),
      colors: [0, 1, 2, 3, 4].map((i) => Math.floor(Math.random() * (this.wardrobe.destBody[i]?.length ?? 1))),
      items: {},
    };
    const chance: Record<number, number> = { [SLOT.HEAD]: 0.8, [SLOT.CAPE]: 0.6, [SLOT.WEAPON]: 0.4, [SLOT.TORSO]: 0.7, [SLOT.SHIELD]: 0.25, [SLOT.LEGS]: 0.7, [SLOT.HANDS]: 0.2, [SLOT.FEET]: 0.5, [SLOT.AMULET]: 0.3 };
    for (const [slot, p] of Object.entries(chance)) {
      const options = this.itemsFor(Number(slot)).filter((i) => (female ? i.female : i.male));
      if (options.length && Math.random() < p) look.items[Number(slot)] = pick(options).id;
    }
    // a shield and a two-handed look rarely mix well; keep it simple
    if (look.items[SLOT.WEAPON] !== undefined && look.items[SLOT.SHIELD] !== undefined && Math.random() < 0.5) delete look.items[SLOT.SHIELD];
    return look;
  }

  describe(look: Look): string {
    const names = Object.values(look.items)
      .map((id) => this.wardrobe.items.find((i) => i.id === id)?.name)
      .filter(Boolean);
    return `${look.female ? 'Female' : 'Male'}${names.length ? ' · ' + names.join(', ') : ' · no gear'}`;
  }

  setLook(look: Look) {
    const parts: (PartModel | null)[] = new Array(12).fill(null);
    look.kits.forEach((kitId, feature) => {
      const kit: KitDef | undefined = this.wardrobe.kits.find((k) => k.id === kitId);
      if (kit) parts[FEATURE_SLOT[feature]] = kit.model;
    });
    for (const [slotStr, itemId] of Object.entries(look.items)) {
      const item: ItemDef | undefined = this.wardrobe.items.find((i) => i.id === itemId);
      const model = item && (look.female ? item.female : item.male);
      if (!item || !model) continue;
      parts[Number(slotStr)] = model;
      if (item.hidesHair) parts[SLOT.HAIR] = null;
      if (item.hidesJaw) parts[SLOT.JAW] = null;
      if (item.hidesArms) parts[SLOT.ARMS] = null;
    }
    this.compose(parts.filter((p): p is PartModel => !!p), look.colors);
  }

  private compose(parts: PartModel[], colors: number[]) {
    const X: number[] = [], Y: number[] = [], Z: number[] = [], labels: number[] = [];
    const tris: number[] = [], triColors: number[] = [], triTextures: number[] = [], triUvs: number[] = [];
    this.flat = [];
    for (const p of parts) {
      const offset = X.length;
      for (let i = 0; i < p.v.length; i += 3) {
        X.push(p.v[i]);
        Y.push(p.v[i + 1]);
        Z.push(p.v[i + 2]);
      }
      labels.push(...p.b);
      for (let t = 0; t < p.c.length; t++) {
        const type = p.i ? p.i[t] : 0;
        const alpha = p.a ? p.a[t] : 0;
        // the GL client never draws hidden (2) or black (3) faces
        if (type === 2 || type === 3 || alpha >= 254) continue;
        tris.push(p.t[t * 3] + offset, p.t[t * 3 + 1] + offset, p.t[t * 3 + 2] + offset);
        this.flat.push(type === 1);
        triColors.push(p.c[t]);
        const tex = p.x ? p.x[t] : -1;
        triTextures.push(tex);
        for (let k = 0; k < 6; k++) triUvs.push(tex >= 0 && p.u ? p.u[t * 6 + k] : 0);
      }
    }
    // player color slots (hair, torso, legs, feet, skin)
    const w = this.wardrobe;
    for (let s = 0; s < 5; s++) {
      const body = w.destBody[s] ?? [];
      const skin = w.destSkin[s] ?? [];
      for (let t = 0; t < triColors.length; t++) {
        if (body.length > colors[s] && triColors[t] === w.sourceBody[s]) triColors[t] = body[colors[s]] | 0x10000;
        else if (skin.length > colors[s] && triColors[t] === w.sourceSkin[s]) triColors[t] = skin[colors[s]] | 0x10000;
      }
    }

    this.baseX = Float64Array.from(X);
    this.baseY = Float64Array.from(Y);
    this.baseZ = Float64Array.from(Z);
    this.vx = new Float64Array(X.length);
    this.vy = new Float64Array(X.length);
    this.vz = new Float64Array(X.length);
    this.tris = Int32Array.from(tris);
    this.groups = [];
    labels.forEach((l, v) => (this.groups[l] ??= []).push(v));
    let sole = -Infinity;
    for (const y of Y) sole = Math.max(sole, y);
    // sole height in meters: the deck's grip tape is 0.132 m above the board origin
    this.skateSoleOffset = Number.isFinite(sole) ? 0.132 - (-sole / 128) : 0.18;
    this.rig = this.base ? measureSkateRig(this.base, this.groups, this.baseX, this.baseY, this.baseZ) : null;

    const triCount = tris.length / 3;
    const color = new Uint8Array(triCount * 9);
    const surface = new Float32Array(triCount * 3);
    for (let t = 0; t < triCount; t++) {
      const tex = triTextures[t];
      // Players are built with ambient 64 (PlayerAppearance.createModel); colors in client gamma space.
      const rgb = hdFaceColor(triColors[t] & 0xffff, 64, tex >= 0 ? (w.textureBrightness?.[tex] ?? 0) : 0);
      for (let k = 0; k < 3; k++) color.set([(rgb >> 16) & 0xff, (rgb >> 8) & 0xff, rgb & 0xff], t * 9 + k * 3);
      surface.fill(tex >= 0 ? layerOf(this.surfaces, tex) : 0, t * 3, t * 3 + 3);
    }
    this.geometry.dispose();
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(triCount * 9), 3));
    this.geometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(triCount * 9), 3));
    this.geometry.setAttribute('color', new THREE.BufferAttribute(color, 3, true));
    this.geometry.setAttribute('uv', new THREE.BufferAttribute(Float32Array.from(triUvs), 2));
    this.geometry.setAttribute('surface', new THREE.BufferAttribute(surface, 1));
    this.mesh.geometry = this.geometry;
    this.render(this.targetPose());
  }

  // ---------------------------------------------------------------------------------------------
  // Animation

  /** Starts a cache animation (ignored while it's already looping). Crossfades from the current pose. */
  play(name: string, opts: { loop?: boolean; maxDuration?: number; onDone?: () => void } = {}) {
    const seq = this.anims.seqs.find((s) => s.name === name) ?? null;
    if (seq === this.seq && opts.loop !== false && !this.finished && !this.skate) return;
    this.beginFade();
    this.seq = seq;
    this.frame = 0;
    this.frameTime = 0;
    this.elapsed = 0;
    this.maxDuration = Math.max(0, opts.maxDuration ?? Infinity);
    this.loop = opts.loop ?? true;
    this.finished = false;
    this.onDone = opts.onDone ?? null;
    if (!seq || seq.frames.length === 0) {
      this.finished = true;
      this.onDone = null;
      opts.onDone?.();
      return;
    }
    this.render(this.targetPose());
  }

  get playing() {
    return this.seq?.name ?? null;
  }

  /** Skate pose parameters for this frame, or null to go back to cache animations. */
  setSkatePose(pose: SkatePose | null) {
    if ((pose === null) !== (this.skate === null)) this.beginFade();
    this.skate = pose ? { ...pose } : null;
  }

  update(dt: number) {
    if (this.fadeFrom) {
      this.fadeTime += dt;
      if (this.fadeTime >= CROSSFADE) this.fadeFrom = null;
    }
    if (!this.skate && this.seq && !this.finished) {
      this.elapsed += dt;
      // Some RS actions hold their last pose until a server update interrupts them.
      if (this.elapsed >= this.maxDuration) { this.finish(); return; }
      this.frameTime += dt;
      // delays are client cycles of 20 ms
      while (this.frameTime >= this.delay(this.frame)) {
        this.frameTime -= this.delay(this.frame);
        this.frame++;
        if (this.frame >= this.seq.frames.length) {
          if (this.loop) this.frame = 0;
          else { this.finish(); return; }
        }
      }
    }
    this.render(this.targetPose());
  }

  private delay(frame: number) {
    return Math.max(1, this.seq!.delays[frame] ?? 1) * 0.02;
  }

  private finish() {
    this.frame = this.seq!.frames.length - 1;
    this.frameTime = 0;
    this.finished = true;
    this.render(this.targetPose());
    const done = this.onDone;
    this.onDone = null;
    done?.();
  }

  private beginFade() {
    if (this.current.size === 0) return;
    this.fadeFrom = this.current;
    this.fadeTime = 0;
  }

  /** The pose for this moment: skate pose, or the cache frame tweened toward the next one; then any crossfade. */
  private targetPose(): Pose {
    let pose: Pose = new Map();
    if (this.skate && this.rig && this.base) {
      pose = skatePose(this.skate, this.rig);
    } else if (this.seq && this.seq.frames.length) {
      const a = framePose(this.anims, this.seq.frames[this.frame]);
      if (a) {
        pose = a;
        const last = this.frame === this.seq.frames.length - 1;
        if (!this.finished && (!last || this.loop) && this.base) {
          const next = framePose(this.anims, this.seq.frames[last ? 0 : this.frame + 1]);
          if (next) pose = blendPoses(a, next, Math.min(1, this.frameTime / this.delay(this.frame)), this.base);
        }
      }
    }
    if (this.fadeFrom && this.base) pose = blendPoses(this.fadeFrom, pose, ease(this.fadeTime / CROSSFADE), this.base);
    return pose;
  }

  /** Poses the composed model and writes positions + RS-style normals (smooth unless the face is flat). */
  private render(pose: Pose) {
    this.current = pose;
    const { vx, vy, vz } = this;
    vx.set(this.baseX);
    vy.set(this.baseY);
    vz.set(this.baseZ);
    if (this.base && pose.size) applyPose(pose, this.base, this.origins, this.groups, vx, vy, vz);
    const tris = this.tris;
    const n = vx.length;
    const smooth = new Float64Array(n * 3);
    const faces = new Float64Array(tris.length);
    for (let t = 0; t < tris.length; t += 3) {
      const a = tris[t], b = tris[t + 1], c = tris[t + 2];
      // three axes: (x, -y, -z)
      const abx = vx[b] - vx[a], aby = -(vy[b] - vy[a]), abz = -(vz[b] - vz[a]);
      const acx = vx[c] - vx[a], acy = -(vy[c] - vy[a]), acz = -(vz[c] - vz[a]);
      let nx = aby * acz - abz * acy, ny = abz * acx - abx * acz, nz = abx * acy - aby * acx;
      const l = Math.hypot(nx, ny, nz) || 1;
      nx /= l; ny /= l; nz /= l;
      faces[t] = nx; faces[t + 1] = ny; faces[t + 2] = nz;
      if (this.flat[t / 3]) continue;
      for (const v of [a, b, c]) { smooth[v * 3] += nx; smooth[v * 3 + 1] += ny; smooth[v * 3 + 2] += nz; }
    }
    const pos = this.geometry.attributes.position.array as Float32Array;
    const nor = this.geometry.attributes.normal.array as Float32Array;
    for (let i = 0; i < tris.length; i++) {
      const v = tris[i];
      pos[i * 3] = vx[v] / 128;
      pos[i * 3 + 1] = -vy[v] / 128;
      pos[i * 3 + 2] = -vz[v] / 128;
      const t = i - (i % 3);
      let x = smooth[v * 3], y = smooth[v * 3 + 1], z = smooth[v * 3 + 2];
      const l = Math.hypot(x, y, z);
      if (this.flat[t / 3] || l === 0) { x = faces[t]; y = faces[t + 1]; z = faces[t + 2]; }
      else { x /= l; y /= l; z /= l; }
      nor[i * 3] = x; nor[i * 3 + 1] = y; nor[i * 3 + 2] = z;
    }
    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.normal.needsUpdate = true;
    this.geometry.computeBoundingSphere();
  }
}

export { FEATURE_NAMES };
