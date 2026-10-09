// Poses expressed the way the RS client animates players: values for transforms of the player animation
// base (base 0). Cache frames, our authored skate poses and blends between them all share this form, so
// anything can tween into anything (the client's applyAnimationBlend does the same between frames).
import type { AnimData } from '../shared/player-data.ts';

/** transform index -> [x, y, z]; rotations are 0-2047 per turn, translations RS units, scales /128. */
export type Pose = Map<number, [number, number, number]>;

export interface AnimBase { types: number[]; labels: number[][] }

/** Nearest preceding origin (type 0) transform for each transform index. */
export function originIndices(base: AnimBase): Int32Array {
  const origins = new Int32Array(base.types.length).fill(-1);
  let last = -1;
  for (let i = 0; i < base.types.length; i++) {
    origins[i] = last;
    if (base.types[i] === 0) last = i;
  }
  return origins;
}

/** A cache frame as a pose (frame ops are [transformIndex, originIndex, x, y, z]). */
export function framePose(anims: AnimData, packed: number): Pose | null {
  const frame = anims.framesets[packed >>> 16]?.[packed & 0xffff];
  if (!frame) return null;
  const pose: Pose = new Map();
  for (const [index, , x, y, z] of frame.ops) pose.set(index, [x, y, z]);
  return pose;
}

const neutral = (type: number): [number, number, number] => (type === 3 ? [128, 128, 128] : [0, 0, 0]);
const angleLerp = (a: number, b: number, t: number) => {
  const d = ((((b - a) % 2048) + 3072) % 2048) - 1024;
  return a + d * t;
};

/** Blend two poses; transforms missing from one side count as neutral, angles take the short way round. */
export function blendPoses(a: Pose, b: Pose, t: number, base: AnimBase): Pose {
  if (t <= 0) return a;
  if (t >= 1) return b;
  const out: Pose = new Map();
  for (const index of new Set([...a.keys(), ...b.keys()])) {
    const type = base.types[index];
    const va = a.get(index) ?? neutral(type), vb = b.get(index) ?? neutral(type);
    out.set(index, type === 2
      ? [angleLerp(va[0], vb[0], t), angleLerp(va[1], vb[1], t), angleLerp(va[2], vb[2], t)]
      : [va[0] + (vb[0] - va[0]) * t, va[1] + (vb[1] - va[1]) * t, va[2] + (vb[2] - va[2]) * t]);
  }
  return out;
}

/** Radians -> RS angle units. */
export const rsAngle = (radians: number) => radians * (2048 / (Math.PI * 2));

/**
 * Applies a pose to vertices in place (RS axes: x right, y down, z forward = -facing), in floating point.
 * Port of Model.transformBone for types 0-3, with transforms applied in ascending index order and
 * origins resolved like AnimFrame's prevOriginIndex.
 */
export function applyPose(pose: Pose, base: AnimBase, origins: Int32Array, groups: number[][], vx: Float64Array, vy: Float64Array, vz: Float64Array) {
  let ox = 0, oy = 0, oz = 0;
  let lastOrigin = -1;
  const setOrigin = (index: number, dx: number, dy: number, dz: number) => {
    let n = 0, sx = 0, sy = 0, sz = 0;
    for (const label of base.labels[index]) {
      const g = groups[label];
      if (!g) continue;
      for (const v of g) { sx += vx[v]; sy += vy[v]; sz += vz[v]; n++; }
    }
    ox = (n ? sx / n : 0) + dx;
    oy = (n ? sy / n : 0) + dy;
    oz = (n ? sz / n : 0) + dz;
    lastOrigin = index;
  };
  for (const index of [...pose.keys()].sort((a, b) => a - b)) {
    const [x, y, z] = pose.get(index)!;
    const type = base.types[index];
    if (type === 0) { setOrigin(index, x, y, z); continue; }
    const origin = origins[index];
    if (origin !== -1 && origin !== lastOrigin) setOrigin(origin, 0, 0, 0);
    if (type === 1) {
      for (const label of base.labels[index]) for (const v of groups[label] ?? []) { vx[v] += x; vy[v] += y; vz[v] += z; }
    } else if (type === 2) {
      const rz = (z * Math.PI * 2) / 2048, rx = (x * Math.PI * 2) / 2048, ry = (y * Math.PI * 2) / 2048;
      const sz = Math.sin(rz), cz = Math.cos(rz), sx = Math.sin(rx), cx = Math.cos(rx), sy = Math.sin(ry), cy = Math.cos(ry);
      for (const label of base.labels[index]) for (const v of groups[label] ?? []) {
        let px = vx[v] - ox, py = vy[v] - oy, pz = vz[v] - oz, t: number;
        if (z) { t = py * sz + px * cz; py = py * cz - px * sz; px = t; }
        if (x) { t = py * cx - pz * sx; pz = py * sx + pz * cx; py = t; }
        if (y) { t = pz * sy + px * cy; pz = pz * cy - px * sy; px = t; }
        vx[v] = px + ox; vy[v] = py + oy; vz[v] = pz + oz;
      }
    } else if (type === 3) {
      for (const label of base.labels[index]) for (const v of groups[label] ?? []) {
        vx[v] = ((vx[v] - ox) * x) / 128 + ox;
        vy[v] = ((vy[v] - oy) * y) / 128 + oy;
        vz[v] = ((vz[v] - oz) * z) / 128 + oz;
      }
    }
  }
}
