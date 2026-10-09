// Builds the 2009 player model from kits + worn items and plays RS animations on it (port of the client's
// PlayerAppearance + Model.transformBone, done on the CPU each frame).
import * as THREE from 'three';
import { hslToRgb } from '../shared/color.ts';
import { SLOT, type AnimData, type ItemDef, type KitDef, type PartModel, type Wardrobe } from '../shared/player-data.ts';
import { deformSkater, type SkatePose } from './skate-pose.ts';
import { prepareSkateRig } from './skate-rig.ts';

/** feature index (0-6) -> appearance slot, from the client's BASE_PART_MAP */
const FEATURE_SLOT = [SLOT.HAIR, SLOT.JAW, SLOT.TORSO, SLOT.ARMS, SLOT.HANDS, SLOT.LEGS, SLOT.FEET];
const FEATURE_NAMES = ['hair', 'jaw', 'torso', 'arms', 'hands', 'legs', 'feet'];

export interface Look {
  female: boolean;
  /** kit id per feature 0-6 (-1 = none, e.g. no beard) */
  kits: number[];
  /** indices into the client color tables: hair, torso, legs, feet, skin */
  colors: number[];
  /** item id per appearance slot */
  items: Partial<Record<number, number>>;
}

const SIN = new Int32Array(2048);
const COS = new Int32Array(2048);
for (let i = 0; i < 2048; i++) {
  SIN[i] = Math.trunc(65536 * Math.sin((i * 2 * Math.PI) / 2048));
  COS[i] = Math.trunc(65536 * Math.cos((i * 2 * Math.PI) / 2048));
}

const SRGB_TO_LINEAR = (c: number) => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
};

export class Avatar {
  readonly mesh: THREE.Mesh;
  private geometry = new THREE.BufferGeometry();
  // composed model (RS units)
  private baseX = new Int32Array(0);
  private baseY = new Int32Array(0);
  private baseZ = new Int32Array(0);
  private vx = new Int32Array(0);
  private vy = new Int32Array(0);
  private vz = new Int32Array(0);
  private tris: number[] = [];
  private labelVertices: number[][] = [];
  private vertexSlots: number[] = [];
  private vertexBones: number[] = [];
  private posedVertices = new Float32Array(0);
  skateSoleOffset = 0.18;
  private skatePose: SkatePose | null = null;
  // animation state
  private seq: AnimData['seqs'][number] | null = null;
  private frame = 0;
  private frameTime = 0;
  private onDone: (() => void) | null = null;
  private loop = true;
  private finished = false;
  private elapsed = 0;
  private maxDuration = Infinity;
  private originX = 0;
  private originY = 0;
  private originZ = 0;

  constructor(private wardrobe: Wardrobe, private anims: AnimData) {
    const material = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.mesh = new THREE.Mesh(this.geometry, material);
    this.mesh.castShadow = true;
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
      colors: [0, 1, 2, 3, 4].map((i) => Math.floor(Math.random() * this.wardrobe.destBody[i].length)),
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
    const composed: { model: PartModel; slot: number }[] = [];
    parts.forEach((model, slot) => { if (model) composed.push({ model, slot }); });
    this.compose(composed, look.colors);
  }

  private compose(parts: { model: PartModel; slot: number }[], colors: number[]) {
    const X: number[] = [];
    const Y: number[] = [];
    const Z: number[] = [];
    const labels: number[] = [];
    const tris: number[] = [];
    const triColors: number[] = [];
    this.vertexSlots = [];
    for (const { model: p, slot } of parts) {
      const offset = X.length;
      for (let i = 0; i < p.v.length; i += 3) {
        X.push(p.v[i]);
        Y.push(p.v[i + 1]);
        Z.push(p.v[i + 2]);
        this.vertexSlots.push(slot);
      }
      labels.push(...p.b);
      for (let t = 0; t < p.c.length; t++) {
        const type = p.i ? p.i[t] : 0;
        const alpha = p.a ? p.a[t] : 0;
        if (type === 2 || alpha >= 254) continue;
        tris.push(p.t[t * 3] + offset, p.t[t * 3 + 1] + offset, p.t[t * 3 + 2] + offset);
        triColors.push(type === 3 ? 0 : p.c[t]);
      }
    }
    // player color slots (hair, torso, legs, feet, skin)
    const w = this.wardrobe;
    for (let s = 0; s < 5; s++) {
      const body = w.destBody[s];
      const skin = w.destSkin[s];
      for (let t = 0; t < triColors.length; t++) {
        if (body.length > colors[s] && triColors[t] === w.sourceBody[s]) triColors[t] = body[colors[s]] | 0x10000;
        else if (skin.length > colors[s] && triColors[t] === w.sourceSkin[s]) triColors[t] = skin[colors[s]] | 0x10000;
      }
    }

    this.baseX = Int32Array.from(X);
    this.baseY = Int32Array.from(Y);
    this.baseZ = Int32Array.from(Z);
    this.vx = new Int32Array(X.length);
    this.vy = new Int32Array(X.length);
    this.vz = new Int32Array(X.length);
    this.tris = tris;
    this.vertexBones = labels;
    this.posedVertices = new Float32Array(X.length*3);
    let sole=Infinity;
    for(let v=0;v<Y.length;v++)if(this.vertexSlots[v]===SLOT.FEET)sole=Math.min(sole,-Y[v]/128);
    this.skateSoleOffset=Number.isFinite(sole)?0.132-sole:0.18;
    this.labelVertices = [];
    labels.forEach((l, v) => (this.labelVertices[l] ??= []).push(v));

    const triCount = tris.length / 3;
    const color = new Float32Array(triCount * 9);
    for (let t = 0; t < triCount; t++) {
      const rgb = hslToRgb(triColors[t] & 0xffff);
      const r = SRGB_TO_LINEAR((rgb >> 16) & 0xff);
      const g = SRGB_TO_LINEAR((rgb >> 8) & 0xff);
      const b = SRGB_TO_LINEAR(rgb & 0xff);
      for (let k = 0; k < 3; k++) color.set([r, g, b], t * 9 + k * 3);
    }
    this.geometry.dispose();
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(triCount * 9), 3));
    this.geometry.setAttribute('color', new THREE.BufferAttribute(color, 3));
    this.mesh.geometry = this.geometry;
    this.applyFrame();
  }

  play(name: string, opts: { loop?: boolean; maxDuration?: number; onDone?: () => void } = {}) {
    const seq = this.anims.seqs.find((s) => s.name === name) ?? null;
    if (seq === this.seq && opts.loop !== false) return;
    this.seq = seq;
    this.frame = 0;
    this.frameTime = 0;
    this.elapsed = 0;
    this.maxDuration = Math.max(0, opts.maxDuration ?? Infinity);
    this.loop = opts.loop ?? true;
    this.finished = false;
    this.onDone = opts.onDone ?? null;
    this.applyFrame();
    if (!seq || seq.frames.length === 0) {
      this.finished = true;
      this.onDone = null;
      opts.onDone?.();
    }
  }

  get playing() {
    return this.seq?.name ?? null;
  }

  setSkatePose(pose: SkatePose | null) {
    if (pose === null && this.skatePose === null) return;
    this.skatePose = pose;
    this.applyFrame();
  }

  update(dt: number) {
    if (this.skatePose || !this.seq || this.finished) return;
    this.elapsed += dt;
    // Some RS actions hold their last pose until a server update interrupts them.
    if (this.elapsed >= this.maxDuration) { this.finish(); return; }
    this.frameTime += dt;
    let changed = false;
    // delays are client cycles of 20 ms
    while (this.frameTime >= Math.max(1, this.seq.delays[this.frame]) * 0.02) {
      this.frameTime -= Math.max(1, this.seq.delays[this.frame]) * 0.02;
      this.frame++;
      changed = true;
      if (this.frame >= this.seq.frames.length) {
        if (this.loop) this.frame = 0;
        else {
          this.finish();
          return;
        }
      }
    }
    if (changed) this.applyFrame();
  }

  private finish() {
    this.frame = this.seq!.frames.length - 1;
    this.finished = true;
    this.applyFrame();
    const done = this.onDone;
    this.onDone = null;
    this.frameTime = 0;
    done?.();
  }

  private applyFrame() {
    this.vx.set(this.baseX);
    this.vy.set(this.baseY);
    this.vz.set(this.baseZ);
    if (this.seq && !this.skatePose) {
      const packed = this.seq.frames[this.frame];
      const frame = this.anims.framesets[packed >>> 16]?.[packed & 0xffff];
      const base = frame && this.anims.bases[frame.base];
      if (frame && base) {
        for (const [index, origin, x, y, z] of frame.ops) {
          if (origin !== -1) this.transform(0, base.labels[origin], 0, 0, 0);
          this.transform(base.types[index], base.labels[index], x, y, z);
        }
      }
    }
    if (this.skatePose) {
      const rig=prepareSkateRig(this.skatePose);
      for (let v = 0; v < this.vx.length; v++) {
        const p = deformSkater(this.vx[v] / 128, -this.vy[v] / 128, -this.vz[v] / 128, this.vertexSlots[v], this.skatePose,this.vertexBones[v],rig);
        this.posedVertices[v*3]=p.x;this.posedVertices[v*3+1]=p.y;this.posedVertices[v*3+2]=p.z;
      }
    }
    // write non-indexed positions in meters, three.js axes (x east, y up, z south)
    const pos = this.geometry.attributes.position.array as Float32Array;
    const tris = this.tris;
    for (let i = 0; i < tris.length; i++) {
      const v = tris[i];
      pos[i * 3] = this.skatePose?this.posedVertices[v*3]:this.vx[v]/128;
      pos[i * 3 + 1] = this.skatePose?this.posedVertices[v*3+1]:-this.vy[v]/128;
      pos[i * 3 + 2] = this.skatePose?this.posedVertices[v*3+2]:-this.vz[v]/128;
    }
    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.computeVertexNormals();
    this.geometry.computeBoundingSphere();
  }

  /** Port of SoftwareModel.transformBone for types 0 (origin), 1 (translate), 2 (rotate), 3 (scale). */
  private transform(type: number, labels: number[], tx: number, ty: number, tz: number) {
    const groups = this.labelVertices;
    const { vx, vy, vz } = this;
    if (type === 0) {
      let count = 0;
      let ox = 0;
      let oy = 0;
      let oz = 0;
      for (const l of labels) {
        const g = groups[l];
        if (!g) continue;
        for (const v of g) {
          ox += vx[v];
          oy += vy[v];
          oz += vz[v];
          count++;
        }
      }
      if (count > 0) {
        this.originX = Math.trunc(ox / count) + tx;
        this.originY = Math.trunc(oy / count) + ty;
        this.originZ = Math.trunc(oz / count) + tz;
      } else {
        this.originX = tx;
        this.originY = ty;
        this.originZ = tz;
      }
      return;
    }
    for (const l of labels) {
      const g = groups[l];
      if (!g) continue;
      for (const v of g) {
        if (type === 1) {
          vx[v] += tx;
          vy[v] += ty;
          vz[v] += tz;
        } else if (type === 2) {
          let x = vx[v] - this.originX;
          let y = vy[v] - this.originY;
          let z = vz[v] - this.originZ;
          if (tz !== 0) {
            const s = SIN[tz], c = COS[tz];
            const t = (y * s + x * c + 32767) >> 16;
            y = (y * c + 32767 - x * s) >> 16;
            x = t;
          }
          if (tx !== 0) {
            const s = SIN[tx], c = COS[tx];
            const t = (y * c + 32767 - z * s) >> 16;
            z = (y * s + z * c + 32767) >> 16;
            y = t;
          }
          if (ty !== 0) {
            const s = SIN[ty], c = COS[ty];
            const t = (z * s + x * c + 32767) >> 16;
            z = (z * c + 32767 - x * s) >> 16;
            x = t;
          }
          vx[v] = x + this.originX;
          vy[v] = y + this.originY;
          vz[v] = z + this.originZ;
        } else if (type === 3) {
          vx[v] = Math.trunc(((vx[v] - this.originX) * tx) / 128) + this.originX;
          vy[v] = Math.trunc(((vy[v] - this.originY) * ty) / 128) + this.originY;
          vz[v] = Math.trunc(((vz[v] - this.originZ) * tz) / 128) + this.originZ;
        }
      }
    }
  }
}

export { FEATURE_NAMES };
