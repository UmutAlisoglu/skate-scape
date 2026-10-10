// An RS NPC (random events, pets, transport crews) drawn from its cache model and animated with its own
// stand / walk sequences, tweened between frames like the client.
import type * as THREE from 'three';
import type { NpcData, NpcSet } from '../shared/npc-data.ts';
import type { Surfaces } from '../world/rs-material.ts';
import { blendPoses, framePose, originIndices, type AnimBase, type Pose } from './rs-pose.ts';
import { composeParts, PosedMesh } from './posed-mesh.ts';

type Seq = NpcSet['anims']['seqs'][number];

/** Loads the exported NPC set (null when it hasn't been exported). */
export async function loadNpcs(url: string): Promise<NpcSet | null> {
  try { const response = await fetch(url); return response.ok ? await response.json() as NpcSet : null; } catch { return null; }
}

export class NpcActor {
  readonly mesh: THREE.Mesh;
  /** model height in metres (for chat lines and riding on a board) */
  readonly height: number;
  private posed: PosedMesh;
  private base: AnimBase | null = null;
  private origins: Int32Array = new Int32Array(0);
  private seq: Seq | null = null;
  private frame = 0; private frameTime = 0;
  private current: 'idle' | 'walk' | null = null;

  constructor(readonly data: NpcData, private set: NpcSet, surfaces: Surfaces | null) {
    this.posed = new PosedMesh(surfaces);
    this.mesh = this.posed.mesh;
    const model = composeParts([data.model]);
    this.posed.setModel(model, 64 + data.ambient, set.textureBrightness);
    let top = Infinity;
    for (const y of model.y) top = Math.min(top, y);
    this.height = Number.isFinite(top) ? -top / 128 : 1;
    // the animation base comes from the NPC's own frames
    const first = this.seqFor('idle') ?? this.seqFor('walk');
    const packed = first?.frames[0];
    const frame = packed === undefined ? undefined : set.anims.framesets[packed >>> 16]?.[packed & 0xffff];
    if (frame) { this.base = set.anims.bases[frame.base] ?? null; this.origins = this.base ? originIndices(this.base) : this.origins; }
    this.play('idle');
  }

  private seqFor(kind: 'idle' | 'walk') {
    const id = kind === 'idle' ? this.data.idle : this.data.walk;
    return id === undefined ? null : this.set.anims.seqs.find((s) => s.id === id) ?? null;
  }
  /** Loops the stand or walk animation (walk falls back to stand). */
  play(kind: 'idle' | 'walk') {
    if (kind === this.current) return;
    this.current = kind;
    const seq = this.seqFor(kind) ?? this.seqFor('idle');
    if (seq === this.seq) return;
    this.seq = seq; this.frame = 0; this.frameTime = 0;
  }
  update(dt: number) {
    const seq = this.seq;
    if (!seq || !seq.frames.length) { this.posed.render(new Map(), null, this.origins); return; }
    const delay = (frame: number) => Math.max(1, seq.delays[frame] ?? 1) * 0.02;
    this.frameTime += dt;
    while (this.frameTime >= delay(this.frame)) { this.frameTime -= delay(this.frame); this.frame = (this.frame + 1) % seq.frames.length; }
    let pose: Pose = framePose(this.set.anims, seq.frames[this.frame]) ?? new Map();
    const next = framePose(this.set.anims, seq.frames[(this.frame + 1) % seq.frames.length]);
    if (next && this.base) pose = blendPoses(pose, next, Math.min(1, this.frameTime / delay(this.frame)), this.base);
    this.posed.render(pose, this.base, this.origins);
  }
}
