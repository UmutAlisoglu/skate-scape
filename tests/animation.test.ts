import { test } from 'node:test';
import assert from 'node:assert/strict';
import { solveLeg, type LegRig } from '../src/player/skate-rig.ts';
import { applyPose, blendPoses, originIndices, type AnimBase, type Pose } from '../src/player/rs-pose.ts';
import { Avatar } from '../src/player/avatar.ts';
import type { AnimData, Wardrobe } from '../src/shared/player-data.ts';

type Vec = [number, number, number];
const rotX = (v: Vec, a: number): Vec => [v[0], v[1] * Math.cos(a) - v[2] * Math.sin(a), v[1] * Math.sin(a) + v[2] * Math.cos(a)];
const rotZ = (v: Vec, a: number): Vec => [v[1] * Math.sin(a) + v[0] * Math.cos(a), v[1] * Math.cos(a) - v[0] * Math.sin(a), v[2]];

test('leg IK puts the ankle on the target using the client joint order', () => {
  const leg: LegRig = { hip: [9, -90, -2], knee: [9, -51, -2], ankle: [10, 2, 0], upper: 39, lower: 53 };
  const reach = (target: Vec) => {
    const { knee, thighZ, thighX } = solveLeg(leg, target);
    // foot first (no-op here), then the shin about the knee, then the thigh about the hip (Z, then X)
    const upper: Vec = [leg.knee[0] - leg.hip[0], leg.knee[1] - leg.hip[1], leg.knee[2] - leg.hip[2]];
    const shin = rotX([leg.ankle[0] - leg.knee[0], leg.ankle[1] - leg.knee[1], leg.ankle[2] - leg.knee[2]], knee);
    const ankle = rotX(rotZ([upper[0] + shin[0], upper[1] + shin[1], upper[2] + shin[2]], thighZ), thighX);
    assert.ok(knee >= 0, 'knees only bend forward');
    return [leg.hip[0] + ankle[0], leg.hip[1] + ankle[1], leg.hip[2] + ankle[2]] as Vec;
  };
  for (const target of [[27, -28, 0], [27, -10, 0], [-20, -10, -15], [30, -12, -16]] as Vec[]) {
    const reached = reach(target);
    assert.ok(Math.hypot(reached[0] - target[0], reached[1] - target[1], reached[2] - target[2]) < 0.5, `missed ${target}: ${reached}`);
  }
  // out of reach: the leg straightens and points at the target instead of flailing
  const far: Vec = [27, 20, 0], got = reach(far);
  const dir = (v: Vec) => { const d: Vec = [v[0] - leg.hip[0], v[1] - leg.hip[1], v[2] - leg.hip[2]], l = Math.hypot(...d); return d.map((c) => c / l); };
  const a = dir(far), b = dir(got);
  assert.ok(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] > 0.999);
});

const base: AnimBase = { types: [0, 2, 0, 1], labels: [[1], [2], [1], [1, 2]] };

test('pose blending takes the short way round for angles and treats missing transforms as neutral', () => {
  const a: Pose = new Map([[1, [2040, 0, 0]], [3, [10, 0, 0]]]);
  const b: Pose = new Map([[1, [8, 0, 0]]]);
  const mid = blendPoses(a, b, 0.5, base);
  assert.ok(Math.abs((((mid.get(1)![0] % 2048) + 2048) % 2048)) < 1e-9 || Math.abs(mid.get(1)![0] - 2048) < 1e-9);
  assert.equal(mid.get(3)![0], 5);
});

test('poses rotate about the label centroid of their origin, in floating point', () => {
  // label 1: pivot vertex at the origin; label 2: a vertex 10 units down (+y)
  const vx = new Float64Array([0, 0]), vy = new Float64Array([0, 10]), vz = new Float64Array([0, 0]);
  const pose: Pose = new Map([[1, [512, 0, 0]]]); // 90 degrees about x
  applyPose(pose, base, originIndices(base), [[], [0], [1]], vx, vy, vz);
  assert.ok(Math.abs(vy[1]) < 1e-9 && Math.abs(vz[1] - 10) < 1e-9);
  const tiny: Pose = new Map([[3, [0.25, 0, 0]]]); // sub-unit translations survive
  applyPose(tiny, base, originIndices(base), [[], [0], [1]], vx, vy, vz);
  assert.ok(Math.abs(vx[0] - 0.25) < 1e-9);
});

const wardrobe: Wardrobe = {
  kits: [{ id: 0, feature: 2, model: { v: [0, 0, 0, 128, 0, 0, 0, -128, 0], b: [0, 0, 0], t: [0, 1, 2], c: [100] } }],
  items: [], sourceBody: [0, 0, 0, 0, 0], destBody: [[], [], [], [], []], sourceSkin: [0, 0, 0, 0, 0], destSkin: [[], [], [], [], []],
};
const slide: AnimData = {
  seqs: [{ id: 0, name: 'Slide', frames: [0, 1], delays: [1, 1] }, { id: 1, name: 'Hold', frames: [0], delays: [50] }],
  framesets: { 0: { 0: { base: 0, ops: [[0, -1, 0, 0, 0]] }, 1: { base: 0, ops: [[0, -1, 128, 0, 0]] } } },
  bases: { 0: { types: [1], labels: [[0]] } },
};
const x0 = (avatar: Avatar) => avatar.mesh.geometry.getAttribute('position').getX(0);

test('cache animations tween between frames instead of stepping', () => {
  const avatar = new Avatar(wardrobe, slide);
  avatar.setLook(avatar.defaultLook());
  avatar.play('Slide');
  avatar.update(0.01); // half of the first 20 ms frame
  assert.ok(Math.abs(x0(avatar) - 0.5) < 1e-6, `expected halfway, got ${x0(avatar)}`);
});

test('switching animations crossfades from the current pose', () => {
  const avatar = new Avatar(wardrobe, slide);
  avatar.setLook(avatar.defaultLook());
  avatar.play('Slide', { loop: false });
  avatar.update(0.03); // past the first frame: fully slid (x = 1 m) and finished
  assert.ok(Math.abs(x0(avatar) - 1) < 1e-6);
  avatar.play('Hold'); // Hold's only frame is x = 0
  avatar.update(0.05);
  const during = x0(avatar);
  assert.ok(during > 0.05 && during < 0.95, `expected a blend, got ${during}`);
  avatar.update(0.5);
  assert.ok(Math.abs(x0(avatar)) < 1e-6);
});
