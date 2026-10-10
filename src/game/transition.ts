import type { Point } from './skater.ts';

/**
 * A quarter pipe: a circular transition of `radius` rising `height` above `origin` (the middle of its bottom
 * edge, on the floor), `width` wide along its coping, with a flat deck `deck` metres deep behind the coping.
 * `yaw` is the heading you ride to go up it (travel direction (-sin yaw, -cos yaw), like the skater's heading).
 * The riding face is analytic (see Skater.stepTransition); the sides, back and deck are ordinary collision.
 */
export interface Ramp { id: string; origin: Point; yaw: number; width: number; radius: number; height: number; deck: number }

/** Horizontal unit vectors: w points up the ramp (toward the coping), u along the coping. */
export function rampAxes(ramp: Ramp) {
  const wx = -Math.sin(ramp.yaw), wz = -Math.cos(ramp.yaw);
  return { wx, wz, ux: -wz, uz: wx };
}
/** Horizontal distance from the bottom edge to the coping, and the face angle there. */
export function rampTop(ramp: Ramp) {
  const h = Math.min(ramp.height, ramp.radius), w = Math.sqrt(ramp.radius * ramp.radius - (ramp.radius - h) * (ramp.radius - h));
  const angle = Math.asin(Math.min(1, w / ramp.radius));
  return { w, angle, s: angle * ramp.radius };
}
export function rampLocal(ramp: Ramp, x: number, z: number) {
  const { wx, wz, ux, uz } = rampAxes(ramp), dx = x - ramp.origin.x, dz = z - ramp.origin.z;
  return { u: dx * ux + dz * uz, w: dx * wx + dz * wz };
}
/** Point on the face at arc length s (0 = bottom edge) and coping offset u. */
export function rampPoint(ramp: Ramp, u: number, s: number): Point {
  const { wx, wz, ux, uz } = rampAxes(ramp), angle = s / ramp.radius;
  const w = ramp.radius * Math.sin(angle), y = ramp.radius * (1 - Math.cos(angle));
  return { x: ramp.origin.x + wx * w + ux * u, y: ramp.origin.y + y, z: ramp.origin.z + wz * w + uz * u };
}
/** Face height above the floor at a distance w up the ramp. */
export function rampHeight(ramp: Ramp, w: number) {
  const r = ramp.radius, c = Math.max(0, Math.min(w, r));
  return r - Math.sqrt(r * r - c * c);
}
/** Inside the riding face's footprint (between the bottom edge and the coping, within the sides). */
export function onRampFace(ramp: Ramp, x: number, z: number) {
  const { u, w } = rampLocal(ramp, x, z);
  return Math.abs(u) <= ramp.width / 2 && w >= 0 && w <= rampTop(ramp).w ? { u, w } : null;
}
/** Unit vectors at arc length s: up the face (tangent) and out of it (normal). */
export function rampFrame(ramp: Ramp, s: number) {
  const { wx, wz } = rampAxes(ramp), angle = s / ramp.radius, c = Math.cos(angle), sn = Math.sin(angle);
  return { tangent: { x: wx * c, y: sn, z: wz * c }, normal: { x: -wx * sn, y: c, z: -wz * sn } };
}
