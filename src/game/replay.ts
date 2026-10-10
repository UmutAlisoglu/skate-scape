import * as THREE from 'three';
import type { SkatePose } from '../player/skate-pose.ts';

/** One recorded moment: rider and board transforms, the deck's own rotation, and what the avatar showed. */
export interface ReplayFrame {
  time: number;
  player: number[]; board: number[]; deck: [number, number, number]; boardVisible: boolean;
  pose: SkatePose | null; sequence: string | null; sequenceTime: number;
  tricks: string; combo: string;
}
const SPEEDS = [0.25, 0.5, 1, 2];
const transform = (o: THREE.Object3D) => [o.position.x, o.position.y, o.position.z, o.quaternion.x, o.quaternion.y, o.quaternion.z, o.quaternion.w];

/** skate.-style replay: a rolling buffer of the last `seconds` of skating, played back with a free camera. */
export class Replay {
  active = false; playing = true; cursor = 0;
  private frames: ReplayFrame[] = [];
  private clock = 0; private sinceSample = Infinity; private speedIndex = 2;
  private a = new THREE.Quaternion(); private b = new THREE.Quaternion();
  constructor(private seconds = 20, private rate = 30) {}
  get speed() { return SPEEDS[this.speedIndex]; }
  get start() { return this.frames[0]?.time ?? 0; }
  get end() { return this.frames[this.frames.length - 1]?.time ?? 0; }
  get length() { return this.end - this.start; }

  record(dt: number, frame: Omit<ReplayFrame, 'time' | 'player' | 'board'> & { player: THREE.Object3D; board: THREE.Object3D }) {
    this.clock += dt; this.sinceSample += dt;
    if (this.sinceSample < 1 / this.rate) return;
    this.sinceSample = 0;
    this.frames.push({ ...frame, time: this.clock, player: transform(frame.player), board: transform(frame.board), pose: frame.pose ? { ...frame.pose } : null });
    while (this.frames.length && this.frames[0].time < this.clock - this.seconds) this.frames.shift();
  }
  /** Starts watching from the beginning of the buffer; false when there is too little to show. */
  begin() {
    if (this.length < 1) return false;
    this.active = true; this.playing = true; this.cursor = this.start; this.speedIndex = 2;
    return true;
  }
  stop() { this.active = false; }
  faster() { this.speedIndex = Math.min(SPEEDS.length - 1, this.speedIndex + 1); }
  slower() { this.speedIndex = Math.max(0, this.speedIndex - 1); }
  /** Advances playback (looping), with an optional scrub in seconds. */
  advance(dt: number, scrub = 0) {
    if (this.playing) this.cursor += dt * this.speed;
    this.cursor += scrub;
    if (this.cursor > this.end) this.cursor = this.start;
    if (this.cursor < this.start) this.cursor = this.start;
  }
  /** The recorded frame at the cursor, with transforms interpolated toward the next one. */
  apply(player: THREE.Object3D, board: THREE.Object3D) {
    const frames = this.frames;
    let i = 0;
    while (i < frames.length - 2 && frames[i + 1].time <= this.cursor) i++;
    const f0 = frames[i], f1 = frames[Math.min(i + 1, frames.length - 1)];
    const t = f1.time > f0.time ? Math.max(0, Math.min(1, (this.cursor - f0.time) / (f1.time - f0.time))) : 0;
    const place = (o: THREE.Object3D, p: number[], q: number[]) => {
      o.position.set(p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, p[2] + (q[2] - p[2]) * t);
      o.quaternion.copy(this.a.set(p[3], p[4], p[5], p[6]).slerp(this.b.set(q[3], q[4], q[5], q[6]), t));
    };
    place(player, f0.player, f1.player); place(board, f0.board, f1.board);
    return t < 0.5 ? f0 : f1;
  }
}
