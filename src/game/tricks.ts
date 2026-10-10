/**
 * Trick tables (THPS 3+4 style): the direction held when a trick key is pressed picks the variation.
 * Directions are W (up), S (down), A (left) and D (right).
 */
export type Direction = 'none' | 'up' | 'down' | 'left' | 'right';
/** Board rotation over a trick, in full turns: flip about the long axis (kickflip +, heelflip -),
 *  shove about the vertical axis (shove-it = half a turn), pitch end over end (impossible). */
export interface Spin { flip: number; shove: number; pitch: number }
export interface FlipTrick { name: string; points: number; duration: number; spin: Spin }

const spin = (flip: number, shove = 0, pitch = 0): Spin => ({ flip, shove, pitch });

/** Q: flip tricks */
export const FLIP_TRICKS: Record<Direction, FlipTrick> = {
  none: { name: 'Kickflip', points: 300, duration: 0.42, spin: spin(1) },
  left: { name: 'Heelflip', points: 300, duration: 0.42, spin: spin(-1) },
  right: { name: 'Double kickflip', points: 500, duration: 0.56, spin: spin(2) },
  up: { name: 'Hardflip', points: 450, duration: 0.48, spin: spin(1, 0.5, 0.25) },
  down: { name: 'Impossible', points: 450, duration: 0.48, spin: spin(0, 0, 1) },
};
/** E: shove-it family */
export const SHOVE_TRICKS: Record<Direction, FlipTrick> = {
  none: { name: 'Pop shove-it', points: 200, duration: 0.35, spin: spin(0, 0.5) },
  left: { name: 'Varial heelflip', points: 450, duration: 0.48, spin: spin(-1, -0.5) },
  right: { name: 'Varial kickflip', points: 400, duration: 0.46, spin: spin(1, 0.5) },
  up: { name: '360 shove-it', points: 350, duration: 0.45, spin: spin(0, 1) },
  down: { name: '360 flip', points: 600, duration: 0.55, spin: spin(1, 1) },
};

/** RS special attacks: available while the special bar is full, with Shift held (RB on a pad). */
export type SpecialKind = 'rune' | 'teleport' | 'dragon' | 'godsword';
export const SPECIAL_FLIP: FlipTrick = { name: 'Rune flip', points: 1500, duration: 0.75, spin: spin(3, 1) };
export const SPECIAL_SHOVE: FlipTrick = { name: 'Teleport shove', points: 1800, duration: 0.8, spin: spin(0, 2) };
/** The special bar: trick points to fill it, and how fast it drains (per second) while no combo is open. */
export const SPECIAL = { fill: 2500, drain: 0.015 };

export type GrabKind = 'indy' | 'nosegrab' | 'tailgrab' | 'melon' | 'method';
export interface GrabTrick { name: string; kind: GrabKind; points: number; perSecond: number }
export const SPECIAL_GRAB: GrabTrick = { name: 'Dragonfire grab', kind: 'method', points: 300, perSecond: 700 };
/** C: grabs, held for more points; let go before you land */
export const GRAB_TRICKS: Record<Direction, GrabTrick> = {
  none: { name: 'Indy', kind: 'indy', points: 150, perSecond: 260 },
  up: { name: 'Nosegrab', kind: 'nosegrab', points: 150, perSecond: 260 },
  down: { name: 'Tailgrab', kind: 'tailgrab', points: 150, perSecond: 260 },
  left: { name: 'Melon', kind: 'melon', points: 175, perSecond: 280 },
  right: { name: 'Method', kind: 'method', points: 200, perSecond: 300 },
};

/** Board attitude on the rail (radians, relative to the rail direction) and how hard the balance gets. */
export interface GrindStyle { name: string; points: number; wobble: number; yaw: number; pitch: number; roll: number; special?: boolean }
/** a special grind: no wobble, gold sparks, big points per second */
export const SPECIAL_GRIND: GrindStyle = { name: 'Godsword grind', points: 1000, wobble: 0, yaw: 0, pitch: 0, roll: 0, special: true };
const grind = (name: string, points: number, wobble: number, yaw = 0, pitch = 0, roll = 0): GrindStyle => ({ name, points, wobble, yaw, pitch, roll });
/** Grind picked by the direction held at the catch (side = A or D). */
export function grindStyle(up: boolean, down: boolean, side: number): GrindStyle {
  if (up && side) return grind('Crooked grind', 400, 1.4, 0.42 * side, -0.24);
  if (down && side) return grind('Smith grind', 400, 1.4, -0.3 * side, 0.24, 0.22 * side);
  if (up) return grind('Nosegrind', 300, 1.15, 0, -0.28);
  if (down) return grind('5-0 grind', 300, 1.15, 0, 0.28);
  if (side) return grind('Boardslide', 350, 1.3, (Math.PI / 2) * side);
  return grind('50-50 grind', 250, 1);
}
export const GRIND_NAMES = new Set(['50-50 grind', 'Nosegrind', '5-0 grind', 'Boardslide', 'Crooked grind', 'Smith grind', 'Godsword grind']);

export function directionOf(input: { push: boolean; brake: boolean; steer: number }): Direction {
  if (input.push && !input.brake) return 'up';
  if (input.brake && !input.push) return 'down';
  if (input.steer > 0.3) return 'left';
  if (input.steer < -0.3) return 'right';
  return 'none';
}
