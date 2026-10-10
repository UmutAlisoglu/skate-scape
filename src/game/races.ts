import * as THREE from 'three';
import type { SkatePose } from '../player/skate-pose.ts';
import type { Skater } from './skater.ts';

/**
 * Timed races: RS agility courses ridden on a board, and downhill bombs off the mountains. Checkpoints are world
 * tiles; the last one is the finish. Medal times are seconds (gold, silver, bronze).
 */
export interface Race { id: string; name: string; kind: 'agility' | 'downhill'; blurb: string; checkpoints: [number, number][]; medals: [number, number, number] }
export const RACES: Race[] = [
  { id: 'gnomecourse', name: 'Gnome Stronghold agility course', kind: 'agility', blurb: 'A lap round the log balance, the nets and the pipes', checkpoints: [[2474,  3438],  [2471,  3435],  [2470,  3434],  [2470,  3430],  [2474,  3427],  [2480,  3427],  [2482,  3425],  [2488,  3425],  [2489,  3426],  [2488,  3427],  [2483,  3431],  [2477,  3436],  [2473,  3436]], medals: [9, 12, 16] },
  { id: 'barbariancourse', name: 'Barbarian Outpost agility course', kind: 'agility', blurb: 'Past the rope swing pit, the log and the crumbling walls', checkpoints: [[2552, 3559], [2547, 3550], [2541, 3545], [2535, 3548], [2537, 3554], [2544, 3555], [2552, 3554]], medals: [14, 18, 24] },
  { id: 'wildernesscourse', name: 'Wilderness agility course', kind: 'agility', blurb: 'Round the lava pits deep in the Wilderness', checkpoints: [[3004,  3934],  [3006,  3939],  [3006,  3946],  [3007,  3955],  [3007,  3957],  [3006,  3958],  [3003,  3961],  [3000,  3964],  [2998,  3964],  [2996,  3962],  [2996,  3953],  [2999,  3950],  [3000,  3949],  [3001,  3948],  [3001,  3947]], medals: [8, 10, 14] },
  { id: 'whitewolf', name: 'White Wolf Mountain bomb', kind: 'downhill', blurb: 'Off the summit and down to Catherby beach', checkpoints: [[2848,  3497],  [2839,  3488],  [2836,  3482],  [2836,  3474],  [2826,  3462],  [2821,  3452],  [2821,  3448],  [2817,  3447],  [2813,  3444],  [2810,  3437]], medals: [16, 20, 26] },
  { id: 'icemountain', name: 'Ice Mountain run', kind: 'downhill', blurb: 'From the mountain top to Falador’s north gate', checkpoints: [[2999, 3470], [3004, 3462], [3005, 3453], [3001, 3444], [2994, 3437], [2989, 3428], [2983, 3420], [2976, 3414], [2969, 3407], [2965, 3402]], medals: [15, 19, 25] },
];
export const MEDALS = ['Bronze', 'Silver', 'Gold'] as const;
export const RACE_XP = [4000, 8000, 15000] as const;
/** Medal earned for a time: 3 gold, 2 silver, 1 bronze, 0 none. */
export function medalFor(race: Race, seconds: number) { return seconds <= race.medals[0] ? 3 : seconds <= race.medals[1] ? 2 : seconds <= race.medals[2] ? 1 : 0; }
const CHECKPOINT_RADIUS = 3.4;

/** One ghost sample: rider and board transforms, the deck's own rotation and the skate pose (as numbers). */
type GhostFrame = number[];
const POSE_KEYS = ['crouch', 'push', 'pushPhase', 'pushLift', 'air', 'kick', 'balance', 'manual', 'grind', 'fakie', 'grab', 'nose'] as const;
const GHOST_RATE = 12;
export interface GhostRun { race: string; time: number; frames: GhostFrame[] }
/** What the race records each frame (the rider as drawn). */
export interface RideFrame { player: THREE.Object3D; board: THREE.Object3D; deck: [number, number, number]; pose: SkatePose | null }

export function encodeGhost(frame: RideFrame): GhostFrame {
  const r = (v: number) => Math.round(v * 1000) / 1000;
  const p = frame.player, b = frame.board, pose = frame.pose;
  return [p.position.x, p.position.y, p.position.z, p.quaternion.x, p.quaternion.y, p.quaternion.z, p.quaternion.w,
    b.position.x, b.position.y, b.position.z, b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w, ...frame.deck,
    ...POSE_KEYS.map((key) => (pose?.[key] as number | undefined) ?? 0)].map(r);
}
/** A ghost frame between two samples (positions lerp, rotations slerp, pose values blend). */
export function ghostAt(run: GhostRun, time: number) {
  const index = Math.max(0, Math.min(run.frames.length - 2, Math.floor(time * GHOST_RATE)));
  const a = run.frames[index], b = run.frames[Math.min(run.frames.length - 1, index + 1)], t = Math.max(0, Math.min(1, time * GHOST_RATE - index));
  const lerp = (i: number) => a[i] + (b[i] - a[i]) * t;
  const quat = (i: number) => new THREE.Quaternion(a[i], a[i + 1], a[i + 2], a[i + 3]).slerp(new THREE.Quaternion(b[i], b[i + 1], b[i + 2], b[i + 3]), t);
  const pose: SkatePose = { crouch: 0, push: 0, air: 0, kick: 0, balance: 0, time, phase: 'ride' };
  POSE_KEYS.forEach((key, k) => { (pose as unknown as Record<string, number>)[key] = lerp(17 + k); });
  return {
    player: new THREE.Vector3(lerp(0), lerp(1), lerp(2)), playerRotation: quat(3),
    board: new THREE.Vector3(lerp(7), lerp(8), lerp(9)), boardRotation: quat(10),
    deck: [lerp(14), lerp(15), lerp(16)] as [number, number, number], pose, done: time >= run.frames.length / GHOST_RATE,
  };
}

interface Running { race: Race; next: number; time: number; countdown: number; ghost: GhostFrame[]; sinceSample: number }

/**
 * Runs one race at a time: a start ring at every race's first checkpoint (Enter inside it starts), a 3-2-1
 * countdown, checkpoint rings with the next one lit, the clock, medals and XP, and a ghost of the best run.
 */
export class RaceManager {
  running: Running | null = null;
  private rings: THREE.Mesh[] = [];
  private starts = new Map<string, THREE.Mesh>();
  private ringGeometry = new THREE.TorusGeometry(2.6, 0.13, 8, 36);
  private startGeometry = new THREE.TorusGeometry(2.2, 0.1, 6, 32).rotateX(Math.PI / 2);
  private lit = new THREE.MeshBasicMaterial({ color: 0xffd34a });
  private dim = new THREE.MeshBasicMaterial({ color: 0x7fd4ff, transparent: true, opacity: 0.35, depthWrite: false });
  private startMaterial = new THREE.MeshBasicMaterial({ color: 0x6be36b, transparent: true, opacity: 0.8 });
  /** the last result, for the HUD */
  result: { race: Race; time: number; medal: number; best: boolean } | null = null;
  /** `ground` is null where the map hasn't streamed in yet: rings settle onto the ground once it has */
  constructor(private scene: THREE.Scene, private local: (tile: [number, number]) => THREE.Vector3 | null, private ground: (x: number, z: number) => number | null) {
    for (const race of RACES) {
      const at = this.local(race.checkpoints[0]);
      if (!at) continue;
      const ring = new THREE.Mesh(this.startGeometry, this.startMaterial);
      ring.position.set(at.x, 0, at.z); ring.name = `race-start-${race.id}`; ring.userData.lift = 0.08; ring.userData.placed = false;
      this.scene.add(ring); this.starts.set(race.id, ring);
    }
  }
  /** Races on this map (their checkpoints are inside it). */
  get available() { return RACES.filter((race) => this.starts.has(race.id)); }
  /** The race whose start ring the rider stands in, if any. */
  startAt(position: THREE.Vector3) {
    if (this.running) return null;
    return this.available.find((race) => { const ring = this.starts.get(race.id)!; return ring.userData.placed && Math.hypot(ring.position.x - position.x, ring.position.z - position.z) < 2.6 && Math.abs(ring.position.y - position.y) < 2; }) ?? null;
  }
  /** Where a race starts and which way to face. */
  startOf(race: Race) {
    const a = this.local(race.checkpoints[0])!, b = this.local(race.checkpoints[1])!;
    return { position: new THREE.Vector3(a.x, this.ground(a.x, a.z) ?? 0, a.z), heading: Math.atan2(-(b.x - a.x), -(b.z - a.z)) };
  }
  begin(race: Race) {
    this.cancel(); this.result = null;
    this.running = { race, next: 1, time: 0, countdown: 3, ghost: [], sinceSample: Infinity };
    // a ring at every checkpoint after the start, facing along the route
    race.checkpoints.slice(1).forEach((tile, i) => {
      const at = this.local(tile)!, before = this.local(race.checkpoints[i])!;
      const ring = new THREE.Mesh(this.ringGeometry, i === 0 ? this.lit : this.dim);
      ring.position.set(at.x, 2.4, at.z); ring.rotation.y = Math.atan2(at.x - before.x, at.z - before.z); ring.userData.lift = 2.4; ring.userData.placed = false;
      this.scene.add(ring); this.rings.push(ring);
    });
  }
  cancel() { for (const ring of this.rings) this.scene.remove(ring); this.rings = []; this.running = null; }
  /** Advances the race; returns 'finished' on the frame the rider crosses the finish. */
  update(dt: number, rider: Skater, frame: RideFrame): 'countdown' | 'running' | 'finished' | null {
    const r = this.running;
    for (const ring of this.starts.values()) ring.rotation.y += dt;
    // rings settle onto the ground once the cells under them have streamed in
    for (const ring of [...this.starts.values(), ...this.rings]) if (!ring.userData.placed && Math.hypot(ring.position.x - rider.position.x, ring.position.z - rider.position.z) < 70) {
      const y = this.ground(ring.position.x, ring.position.z);
      if (y !== null) { ring.position.y = y + ring.userData.lift; ring.userData.placed = true; }
    }
    if (!r) return null;
    if (r.countdown > 0) { r.countdown = Math.max(0, r.countdown - dt); return 'countdown'; }
    r.time += dt; r.sinceSample += dt;
    if (r.sinceSample >= 1 / GHOST_RATE) { r.sinceSample = 0; r.ghost.push(encodeGhost(frame)); }
    const target = this.rings[r.next - 1], p = rider.position;
    if (Math.hypot(target.position.x - p.x, target.position.z - p.z) < CHECKPOINT_RADIUS && (!target.userData.placed || Math.abs(target.position.y - 2.4 - p.y) < 6)) {
      target.visible = false; r.next++;
      if (r.next > this.rings.length) return 'finished';
      this.rings[r.next - 1].material = this.lit;
    }
    return 'running';
  }
  /** The finished run: time, medal and its ghost frames (call once after 'finished'). */
  finish() {
    const r = this.running!;
    const run: GhostRun = { race: r.race.id, time: r.time, frames: r.ghost };
    this.cancel();
    return { race: r.race, time: r.time, medal: medalFor(r.race, r.time), run };
  }
  /** The next checkpoint's position (for the hint arrow). */
  get nextCheckpoint() { const r = this.running; return r ? this.rings[r.next - 1]?.position ?? null : null; }
}
