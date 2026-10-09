import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Skater, type SkateInput, type SkateWorld } from '../src/game/skater.ts';

const flat: SkateWorld = {
  groundAt: () => 0,
  move: (from, delta) => ({ x: from.x + delta.x, y: from.y + delta.y, z: from.z + delta.z, blocked: false }),
};
const neutral: SkateInput = { push: false, brake: false, steer: 0, crouch: false, pop: false, flip: false, shove: false };
function simulate(skater: Skater, seconds: number, input: Partial<SkateInput> = {}, fps = 60) {
  for (let i = 0; i < Math.round(seconds * fps); i++) skater.update(1 / fps, { ...neutral, ...input });
}
function create(world = flat) { return new Skater(world, { x: 0, y: 0, z: 0 }); }

test('push caps speed, braking stops, and simulation agrees at 30 and 120 fps', () => {
  const a = create(), b = create();
  simulate(a, 3, { push: true }, 30);
  simulate(b, 3, { push: true }, 120);
  assert.equal(a.speed, 9);
  assert.ok(Math.abs(a.position.z - b.position.z) < 0.001);
  simulate(a, 1, { brake: true });
  assert.equal(a.speed, 0);
});

test('charged ollie gains height and only banks a completed flip on landing', () => {
  const skater = create();
  simulate(skater, 0.7, { crouch: true });
  skater.update(1 / 60, { ...neutral, pop: true, flip: true });
  assert.equal(skater.grounded, false);
  assert.equal(skater.totalScore, 0);
  assert.equal(skater.comboCount, 2);
  simulate(skater, 0.3);
  assert.ok(skater.position.y > 1);
  simulate(skater, 1);
  assert.equal(skater.grounded, true);
  assert.equal(skater.totalScore, 800);
  assert.equal(skater.comboCount, 0);
});

test('late tricks lose the combo and stumble without a restart', () => {
  const skater = create();
  skater.update(1 / 60, { ...neutral, pop: true });
  simulate(skater, 0.4);
  skater.update(1 / 60, { ...neutral, flip: true });
  simulate(skater, 0.2);
  assert.equal(skater.bailTime, 0);
  assert.ok(skater.stumbleTime > 0);
  assert.equal(skater.totalScore, 0);
  assert.equal(skater.comboCount, 0);
  simulate(skater, 1.1);
  assert.equal(skater.bailTime, 0);
  assert.equal(skater.grounded, true);
});

test('repeated trick input cannot farm score and grounded input does nothing', () => {
  const skater = create();
  skater.update(1 / 60, { ...neutral, flip: true });
  assert.equal(skater.comboCount, 0);
  skater.update(1 / 60, { ...neutral, pop: true, flip: true });
  simulate(skater, 0.43, { flip: true });
  assert.equal(skater.comboCount, 2);
  simulate(skater, 0.5);
  assert.equal(skater.totalScore, 800);
});

test('large frame pauses are bounded and one-shot input survives sub-frame updates', () => {
  const skater = create();
  skater.update(0.001, { ...neutral, pop: true });
  assert.equal(skater.grounded, true);
  skater.update(0.01, neutral);
  assert.equal(skater.grounded, false);
  const before = skater.position.y;
  skater.update(20, neutral);
  assert.ok(skater.position.y - before < 0.7);
});

test('high speed obstacle collision bails; low speed collision stops safely', () => {
  const world: SkateWorld = { ...flat, move: (from) => ({ ...from, blocked: true }) };
  const skater = create(world);
  skater.speed = 8;
  skater.update(1 / 60, neutral);
  assert.ok(skater.bailTime > 0);
  const slow = create(world);
  slow.speed = 2;
  slow.update(1 / 60, neutral);
  assert.equal(slow.bailTime, 0);
  assert.ok(slow.speed < 2);
});

test('falling out of an unloaded area recovers instead of repeatedly bailing', () => {
  let hasGround = false;
  const world: SkateWorld = { ...flat, groundAt: () => hasGround ? 0 : null };
  const skater = create(world);
  simulate(skater, 2.5);
  assert.ok(skater.bailTime > 0);
  hasGround = true;
  simulate(skater, 1.2);
  assert.equal(skater.bailTime, 0);
  assert.equal(skater.grounded, true);
  assert.equal(skater.position.y, 0);
});

test('landing a 180 preserves forward momentum in a fakie stance', () => {
  const skater = create();
  skater.speed = 4;
  simulate(skater, 0.7, { crouch: true });
  skater.update(1 / 60, { ...neutral, pop: true });
  simulate(skater, 2 / 3, { steer: 1 });
  simulate(skater, 0.3);
  assert.equal(skater.grounded, true);
  assert.ok(skater.totalScore > 100);
  const before = skater.position.z;
  simulate(skater, 0.2);
  assert.ok(skater.position.z < before);
});

test('fast glancing contact slides without a bail or restart', () => {
  const world: SkateWorld = { ...flat, move: (from, delta) => ({ x: from.x+delta.x, y: from.y+delta.y, z: from.z+delta.z, blocked: true, normal: { x: Math.sqrt(0.99), y: 0, z: 0.1 } }) };
  const skater = create(world); skater.speed = 9;
  simulate(skater, 0.3);
  assert.equal(skater.bailTime, 0);
  assert.ok(skater.speed > 8);
  assert.ok(skater.position.z < -2);
});

test('hard head-on impact recovers at the contact position', () => {
  const world: SkateWorld = { ...flat, move: (from, delta) => ({ x: from.x+delta.x, y: from.y+delta.y, z: Math.max(-2,from.z+delta.z), blocked: from.z+delta.z < -2, normal: { x: 0, y: 0, z: 1 } }) };
  const skater = create(world); skater.speed = 9;
  simulate(skater, 0.3); assert.ok(skater.bailTime > 0);
  simulate(skater, 1.2); assert.equal(skater.bailTime, 0); assert.equal(skater.position.z, -2);
});

test('manual links an ollie and banks only when released', () => {
  const skater = create(); skater.speed = 5;
  skater.update(1/60, { ...neutral, pop: true });
  simulate(skater, 0.7, { manual: true });
  assert.equal(skater.manual, true); assert.equal(skater.totalScore, 0);
  simulate(skater, 0.8, { manual: true });
  skater.update(1/60, neutral);
  assert.ok(skater.totalScore > 400);
  assert.ok(skater.drainEvents().some(e => e.type === 'land' && e.names.includes('Manual') && e.names.includes('Ollie')));
});

test('rail catch and ollie out keep the combo until a safe landing', () => {
  const world: SkateWorld = { ...flat, rails: [{ id: 'test', name: 'Test rail', a: { x: 0, y: 0.6, z: 2 }, b: { x: 0, y: 0.6, z: -8 } }] };
  const skater = create(world); skater.position.y = 0.65; skater.grounded = false; skater.speed = 4; skater.verticalSpeed = -1;
  skater.update(1/60, { ...neutral, grind: true }); assert.ok(skater.grinding);
  simulate(skater, 0.5, { grind: true });
  skater.update(1/60, { ...neutral, grind: true, pop: true }); assert.equal(skater.grinding, null);
  simulate(skater, 1.1); assert.ok(skater.totalScore > 700);
  assert.ok(skater.drainEvents().some(e => e.type === 'land' && e.names.includes('50-50 grind')));
});

test('water traversal stops a rolling skater on dry ground without a bail', () => {
  const world: SkateWorld = { ...flat, canRideAt: (_x,z) => z > -1 };
  const skater = create(world); skater.speed = 6;
  simulate(skater,0.5,{push:true});
  assert.equal(skater.bailTime,0); assert.ok(skater.position.z > -1); assert.equal(skater.speed,0);
});
