// Skate poses authored on the RS player animation base (the same joints idle/walk/emotes move), so every
// kit and worn item deforms exactly as it does in the client's own animations. Legs use two-bone IK on the
// measured hip/knee/ankle pivots so the feet stay planted on the deck.
//
// Model space is RS axes: x across the body (+x = the front-foot side, which faces the direction of travel
// once the avatar is turned sideways on the board), y down, z = behind the body (the model faces -z).
import { rsAngle, type AnimBase, type Pose } from './rs-pose.ts';
import type { SkatePose } from './skate-pose.ts';
import type { GrabKind } from '../game/tricks.ts';

/** Player base (base 0) transforms used for skating. Indices from the cache's player animation base. */
export const JOINT = {
  root: { move: 209, origin: 207 },
  body: { turn: 205, move: 206, origin: 204 },
  torso: { turn: 197, origin: 196 },
  head: { turn: 194, origin: 193 },
  // arm A is on +x (front), arm B on -x (back)
  armA: { upper: 138, upperOrigin: 137, fore: 136, foreOrigin: 135, hand: 134, handOrigin: 133 },
  armB: { upper: 163, upperOrigin: 162, fore: 161, foreOrigin: 160, hand: 159, handOrigin: 158 },
  // leg A (+x) is the front foot, leg B (-x) the back / pushing foot
  legA: { thigh: 171, hip: 170, shin: 169, knee: 168, foot: 167, ankle: 166 },
  legB: { thigh: 179, hip: 178, shin: 177, knee: 176, foot: 175, ankle: 174 },
} as const;

type Vec = [number, number, number];
export interface LegRig { hip: Vec; knee: Vec; ankle: Vec; upper: number; lower: number }
export interface SkateRigInfo { legA: LegRig; legB: LegRig; /** lowest point of the feet (largest y) */ sole: number; valid: boolean }

const sub = (a: Vec, b: Vec): Vec => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = (a: Vec) => Math.hypot(a[0], a[1], a[2]);

/** Measures the leg pivots on the composed (rest) model, the way the client computes origins: label centroids. */
export function measureSkateRig(base: AnimBase, groups: number[][], vx: ArrayLike<number>, vy: ArrayLike<number>, vz: ArrayLike<number>): SkateRigInfo {
  const centroid = (index: number): Vec | null => {
    let n = 0, x = 0, y = 0, z = 0;
    for (const label of base.labels[index] ?? []) for (const v of groups[label] ?? []) { x += vx[v]; y += vy[v]; z += vz[v]; n++; }
    return n ? [x / n, y / n, z / n] : null;
  };
  const leg = (j: typeof JOINT.legA | typeof JOINT.legB): LegRig | null => {
    const hip = centroid(j.hip), knee = centroid(j.knee), ankle = centroid(j.ankle);
    if (!hip || !knee || !ankle) return null;
    return { hip, knee, ankle, upper: len(sub(knee, hip)), lower: len(sub(ankle, knee)) };
  };
  let sole = -Infinity;
  for (let v = 0; v < vy.length; v++) sole = Math.max(sole, vy[v]);
  const a = leg(JOINT.legA), b = leg(JOINT.legB);
  const fallback = (x: number): LegRig => ({ hip: [x, -91, 0], knee: [x, -51, -2], ankle: [x, 2, 0], upper: 40, lower: 53 });
  return { legA: a ?? fallback(10), legB: b ?? fallback(-10), sole: Number.isFinite(sole) ? sole : 6, valid: !!(a && b) };
}

// RS rotation helpers (same conventions as Model.transformBone)
function rotX(v: Vec, a: number): Vec { const s = Math.sin(a), c = Math.cos(a); return [v[0], v[1] * c - v[2] * s, v[1] * s + v[2] * c]; }
function rotZ(v: Vec, a: number): Vec { const s = Math.sin(a), c = Math.cos(a); return [v[1] * s + v[0] * c, v[1] * c - v[0] * s, v[2]]; }

/**
 * Two-bone IK in the client's joint order (foot, then shin about the knee, then thigh about the hip, child first).
 * Returns radians: knee flex (shin X), thigh Z then X, so the ankle lands on `target` (model space).
 */
export function solveLeg(leg: LegRig, target: Vec) {
  const upper = sub(leg.knee, leg.hip), lower = sub(leg.ankle, leg.knee);
  const want = sub(target, leg.hip);
  const reach = Math.min(Math.max(len(want), Math.abs(leg.upper - leg.lower) + 0.5), leg.upper + leg.lower - 0.5);
  // knee flex: distance hip->ankle shrinks monotonically as the shin rotates back
  let lo = 0, hi = Math.PI * 0.85;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2, s = rotX(lower, mid);
    if (len([upper[0] + s[0], upper[1] + s[1], upper[2] + s[2]]) > reach) lo = mid; else hi = mid;
  }
  const knee = (lo + hi) / 2;
  const bent = rotX(lower, knee);
  const v: Vec = [upper[0] + bent[0], upper[1] + bent[1], upper[2] + bent[2]];
  const scale = reach / (len(want) || 1);
  const t: Vec = [want[0] * scale, want[1] * scale, want[2] * scale];
  // Z (in the x-y plane) sets the sideways component, then X (y-z plane) the forward/back one.
  const r = Math.hypot(v[0], v[1]) || 1;
  const psi = Math.atan2(v[1], v[0]);
  const thighZ = psi - Math.acos(Math.max(-1, Math.min(1, t[0] / r)));
  const afterZ = rotZ(v, thighZ);
  const thighX = Math.atan2(t[2], t[1]) - Math.atan2(afterZ[2], afterZ[1]);
  return { knee, thighZ, thighX };
}

/** RS units the feet (and board) come up toward the body during a grab; the board is raised to match (0.24 m). */
export const GRAB_LIFT = 30;
const DECK_TO_GROUND = 17; // RS units from the deck's top to the ground (board height ~0.13 m)
const DECK_HALF_WIDTH = 18; // RS units (0.14 m)
/** Ankle z for a foot planted beside the deck: the edge, plus a heel that can reach 10 units behind the ankle. */
const PUSH_SIDE = -(DECK_HALF_WIDTH + 14);

/**
 * Back-foot path while pushing, as [x along the board, lift above the deck (negative = below), z across].
 * Getting off the deck: lift and step sideways first, then down, so the shoe never cuts through the deck.
 * Pushing: slide back along the ground (contact), then swing forward lifted beside the board (recovery).
 */
function pushFoot(p: SkatePose, stance: number): [number, number, number] {
  const engage = Math.max(0, Math.min(1, p.push));
  const side = smooth(engage * 2), down = smooth(engage * 2 - 1);
  const cycle = p.pushPhase ?? 0;
  const contact = cycle < 0.6;
  const along = contact ? 8 - (cycle / 0.6) * 46 : -38 + smooth((cycle - 0.6) / 0.4) * 46;
  // recovery arc: off the ground up to just below deck height (it's beside the board, so no clipping)
  const arc = contact ? 0 : Math.sin(((cycle - 0.6) / 0.4) * Math.PI) * 12;
  const x = -stance + (along + stance) * side;
  // while stepping off: a small hop over the deck lip, then down to the ground
  const lift = Math.sin(side * Math.PI) * 6 * (1 - down) - DECK_TO_GROUND * down + arc * down;
  const z = PUSH_SIDE * side;
  return [x, lift, z];
}
/** Which hand reaches for each grab, as upper-arm [forward(-)/back(+), 0, out(+A / -B)] and elbow, in degrees. */
const GRAB_REACH: Record<GrabKind, { arm: 'A' | 'B'; upper: Vec; fore: number }> = {
  indy: { arm: 'B', upper: [-34, 0, 10], fore: -4 },       // back hand, toe side between the feet
  tailgrab: { arm: 'B', upper: [-16, 0, -30], fore: -4 },  // back hand down to the tail
  melon: { arm: 'A', upper: [22, 0, -14], fore: -6 },      // front hand, heel side between the feet
  method: { arm: 'A', upper: [34, 0, -8], fore: -14 },     // front hand heel side, board tweaked up behind
  nosegrab: { arm: 'A', upper: [-16, 0, 30], fore: -4 },   // front hand down to the nose
};
const smooth = (t: number) => { const c = Math.max(0, Math.min(1, t)); return c * c * (3 - 2 * c); };

/**
 * The skate pose for this frame as RS transform values. `p` comes from SkateAnimator (already smoothed).
 */
export function skatePose(p: SkatePose, rig: SkateRigInfo): Pose {
  const pose: Pose = new Map();
  const set = (index: number, x: number, y = 0, z = 0) => pose.set(index, [x, y, z]);
  const deg = (d: number) => rsAngle((d * Math.PI) / 180);
  const manual = p.manual ?? 0, grind = p.grind ?? 0, bail = p.bail ?? 0, grab = p.grab ?? 0, nose = (p.nose ?? 0) * manual;
  const tail = manual - nose;

  // --- hips: crouch lowers the body; pushing sinks onto the front leg ---
  // a grab tucks: the knees come up and the hand pulls the board up to meet it (GRAB_LIFT, also applied to the board)
  const drop = 7 + p.crouch * 24 + p.push * 10 + p.air * 6 + bail * 8 + grab * 6;
  set(JOINT.root.move, 0, drop, 0);

  // --- feet on the deck (rest ankle height), spread over the bolts ---
  const stance = 24;
  // targets are where the ankle must end up once the root has dropped, so solve against the undropped body
  const legTarget = (leg: LegRig, x: number, lift: number, z: number): Vec => [x, leg.ankle[1] - lift - grab * GRAB_LIFT - drop, leg.ankle[2] + z];

  // front foot: stays planted; the kick flicks it toward the toe side and up during a flip
  const frontLift = p.air * 9 + p.kick * 10;
  const front = legTarget(rig.legA, stance - p.push * 6 + p.kick * 6, frontLift - nose * 3, -p.kick * 16 - manual * 2);
  // back foot: on the tail, or pushing along the ground beside the board (toe side, clear of the deck edge)
  const back = legTarget(rig.legB, ...pushFoot(p, stance));
  back[1] += p.air * -9 + tail * 2 + nose * 4; // tuck in the air / weight on the tail (or nose) in a manual
  for (const [leg, joint, target] of [[rig.legA, JOINT.legA, front], [rig.legB, JOINT.legB, back]] as const) {
    const ik = solveLeg(leg, target);
    set(joint.shin, rsAngle(ik.knee));
    set(joint.thigh, rsAngle(ik.thighX), 0, rsAngle(ik.thighZ));
    // keep the foot flat: undo the leg's pitch and roll
    set(joint.foot, rsAngle(-(ik.thighX + ik.knee)), 0, rsAngle(-ik.thighZ));
  }

  // --- upper body: turned toward the direction of travel, leaning with crouch / manuals ---
  // a slow sway keeps a cruising rider alive; it fades out when anything else is going on
  const calm = Math.max(0, 1 - p.push - p.air - grind - manual - grab - p.crouch * 0.5);
  const sway = Math.sin(p.time * 1.6) * calm;
  const lean = 6 + p.crouch * 22 + p.push * 10 - tail * 14 + nose * 16 + bail * 25 + grab * 18 + sway * 1.5;
  // the shoulders and head turn toward the direction of travel: the nose normally, the tail when fakie
  const facing = 1 - 2 * (p.fakie ?? 0);
  const twist = facing * (-18 - p.push * 22 - grind * 6) + sway * 3;
  set(JOINT.torso.turn, deg(lean), deg(twist), deg(-p.balance * 10 + sway * 1.5));
  // head looks down the board (90 degrees from the body's facing in total)
  set(JOINT.head.turn, deg(-lean * 0.5 + p.crouch * 6), deg(-90 * facing - twist), deg(p.balance * 6));

  // --- arms: relaxed while rolling, out for balance on grinds / manuals / in the air ---
  const balanceArms = Math.max(grind, manual * 0.8, p.air * 0.7, bail);
  const swing = p.push * Math.sin((p.pushPhase ?? 0) * Math.PI * 2);
  const raise = 14 + balanceArms * 50 + p.crouch * 6;
  const elbow = 22 + p.crouch * 25 + balanceArms * 5;
  // arm A (front side) leads; arm B trails, swinging opposite the push
  let armA: Vec = [-10 - p.crouch * 20 + swing * 18, 0, raise + p.balance * 12], armB: Vec = [-6 - p.crouch * 25 - swing * 22, 0, -(raise - 2) + p.balance * 12];
  let foreA = -elbow, foreB = -elbow - 4;
  if (grab > 0) {
    // one hand reaches down to the deck (x: forward/back swing, z: out to the side); the other balances
    const reach = GRAB_REACH[p.grabKind ?? 'indy'], blend = (from: Vec, to: Vec): Vec => [from[0] + (to[0] - from[0]) * grab, 0, from[2] + (to[2] - from[2]) * grab];
    if (reach.arm === 'A') { armA = blend(armA, reach.upper); foreA += (reach.fore - foreA) * grab; armB = blend(armB, [-10, 0, -70]); }
    else { armB = blend(armB, reach.upper); foreB += (reach.fore - foreB) * grab; armA = blend(armA, [-10, 0, 70]); }
  }
  set(JOINT.armA.upper, deg(armA[0]), 0, deg(armA[2]));
  set(JOINT.armA.fore, deg(foreA));
  set(JOINT.armB.upper, deg(armB[0]), 0, deg(armB[2]));
  set(JOINT.armB.fore, deg(foreB));
  return pose;
}
