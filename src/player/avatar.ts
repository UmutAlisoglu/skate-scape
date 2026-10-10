// Builds the 2009 player model from kits + worn items and animates it the way the client does: every pose
// (cache animation frames, the authored skate poses, and blends between them) is a set of values for the
// player animation base, applied to the composed model's labelled vertex groups. Frames tween, and switching
// between animations crossfades, so nothing pops.
import * as THREE from 'three';
import { SLOT, type AnimData, type ItemDef, type KitDef, type PartModel, type Wardrobe } from '../shared/player-data.ts';
import type { Surfaces } from '../world/rs-material.ts';
import { blendPoses, framePose, originIndices, type AnimBase, type Pose } from './rs-pose.ts';
import { composeParts, PosedMesh } from './posed-mesh.ts';
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
  /** the composed model (RS units: x right, y down, z behind), posed every frame */
  private posed: PosedMesh;
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
  private rate = 1;
  private current: Pose = new Map();
  private fadeFrom: Pose | null = null;
  private fadeTime = 0;

  constructor(private wardrobe: Wardrobe, private anims: AnimData, surfaces: Surfaces | null = null, material?: THREE.Material) {
    this.posed = new PosedMesh(surfaces, material);
    this.mesh = this.posed.mesh;
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
    const model = composeParts(parts);
    // player color slots (hair, torso, legs, feet, skin)
    const w = this.wardrobe;
    for (let s = 0; s < 5; s++) {
      const body = w.destBody[s] ?? [];
      const skin = w.destSkin[s] ?? [];
      for (let t = 0; t < model.colors.length; t++) {
        if (body.length > colors[s] && model.colors[t] === w.sourceBody[s]) model.colors[t] = body[colors[s]] | 0x10000;
        else if (skin.length > colors[s] && model.colors[t] === w.sourceSkin[s]) model.colors[t] = skin[colors[s]] | 0x10000;
      }
    }
    // Players are built with ambient 64 (PlayerAppearance.createModel); colors in client gamma space.
    this.posed.setModel(model, 64, w.textureBrightness);
    let sole = -Infinity;
    for (const y of model.y) sole = Math.max(sole, y);
    // sole height in meters: the deck's grip tape is 0.132 m above the board origin
    this.skateSoleOffset = Number.isFinite(sole) ? 0.132 - (-sole / 128) : 0.18;
    const p = this.posed;
    this.rig = this.base ? measureSkateRig(this.base, p.groups, p.baseX, p.baseY, p.baseZ) : null;
    this.render(this.targetPose());
  }

  // ---------------------------------------------------------------------------------------------
  // Animation

  /** Starts a cache animation (ignored while it's already looping). Crossfades from the current pose. */
  /** `speed` plays the sequence faster (2 = double speed); maxDuration counts animation time. */
  play(name: string, opts: { loop?: boolean; maxDuration?: number; onDone?: () => void; speed?: number } = {}) {
    const seq = this.anims.seqs.find((s) => s.name === name) ?? null;
    if (seq === this.seq && opts.loop !== false && !this.finished && !this.skate) return;
    this.beginFade();
    this.seq = seq;
    this.frame = 0;
    this.frameTime = 0;
    this.elapsed = 0;
    this.maxDuration = Math.max(0, opts.maxDuration ?? Infinity);
    this.rate = opts.speed ?? 1;
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
  /** what a replay needs: the skate pose shown, or the sequence and how far into it (animation time) */
  get skatePose() { return this.skate; }
  get sequenceTime() { return this.elapsed; }
  /** Shows a sequence at a time without running it (replays); no callbacks fire. */
  showSequence(name: string, time: number) {
    const seq = this.anims.seqs.find((s) => s.name === name);
    if (!seq || !seq.frames.length) return;
    this.skate = null; this.seq = seq; this.loop = false; this.finished = true; this.onDone = null; this.fadeFrom = null;
    let rest = time, frame = 0;
    while (frame < seq.frames.length - 1 && rest >= this.delay(frame)) { rest -= this.delay(frame); frame++; }
    this.frame = frame; this.frameTime = rest; this.elapsed = time;
    this.render(this.targetPose());
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
      dt *= this.rate;
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

  /** Poses the composed model (positions and RS-style normals). */
  private render(pose: Pose) {
    this.current = pose;
    this.posed.render(pose, this.base, this.origins);
  }
}

export { FEATURE_NAMES };
