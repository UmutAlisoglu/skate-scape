import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BASE_ABILITIES, LANDING, LANDING_WINDOW, Skater, type SkateInput, type SkateWorld } from '../src/game/skater.ts';
import { abilitiesFor, unlocksBetween, xpForLevel } from '../src/game/skill.ts';
import { Career } from '../src/game/career.ts';
import { ChallengeTracker, challengesFor } from '../src/game/challenges.ts';
import { HintCoach } from '../src/game/hints.ts';

const flat: SkateWorld = {
  groundAt: () => 0,
  move: (from, delta) => ({ x: from.x + delta.x, y: from.y + delta.y, z: from.z + delta.z, blocked: false }),
};
const neutral: SkateInput = { push: false, brake: false, steer: 0, crouch: false, pop: false, flip: false, shove: false };
function simulate(skater: Skater, seconds: number, input: Partial<SkateInput> = {}) {
  for (let i = 0; i < Math.round(seconds * 60); i++) skater.update(1 / 60, { ...neutral, ...input });
}
function untilLanded(skater: Skater) { for (let i = 0; i < 240 && !skater.grounded; i++) skater.update(1 / 60, neutral); }

test('popping again inside the landing window links the next air into the same combo; repeats score less', () => {
  const s = new Skater(flat, { x: 0, y: 0, z: 0 }); s.speed = 5;
  s.update(1 / 60, { ...neutral, pop: true }); s.update(1 / 60, neutral);
  untilLanded(s);
  assert.equal(s.comboCount, 1); assert.ok(s.linkWindow > 0, 'the window is open');
  s.update(1 / 60, { ...neutral, pop: true });
  assert.equal(s.grounded, false); assert.equal(s.comboCount, 2, 'linked'); assert.equal(s.totalScore, 0);
  s.update(1 / 60, neutral); untilLanded(s); simulate(s, LANDING_WINDOW + 0.05);
  assert.equal(s.totalScore, (100 + 75) * 2, 'the second ollie is a repeat: 75%');
  // too late: the window ran out, so the next ollie starts a fresh combo
  s.update(1 / 60, { ...neutral, pop: true });
  assert.equal(s.comboCount, 1);
});

// a wall along z at x = 1 (face toward -x)
const walled: SkateWorld = {
  groundAt: () => 0,
  move: (from, delta) => {
    const x = from.x + delta.x;
    if (x > 0.78) return { x: 0.78, y: from.y + delta.y, z: from.z + delta.z, blocked: true, normal: { x: -1, y: 0, z: 0 } };
    return { x, y: from.y + delta.y, z: from.z + delta.z, blocked: false };
  },
};
function flyingAtWall(wallplant: boolean) {
  const s = new Skater(walled, { x: 0.2, y: 1.5, z: 0 });
  s.abilities = { ...BASE_ABILITIES, wallplant };
  s.grounded = false; s.speed = 5; s.verticalSpeed = 0; s.heading = -Math.PI / 2; // travelling +x, at the wall
  (s as unknown as { airHeading: number }).airHeading = s.heading;
  for (let i = 0; i < 4; i++) s.update(1 / 60, neutral);
  return s;
}

test('wallplant (level 20): Space in the air at a wall kicks you up and back off it', () => {
  const s = flyingAtWall(true);
  s.update(1 / 60, { ...neutral, pop: true });
  assert.ok(s.verticalSpeed > 6, `kicked up (${s.verticalSpeed.toFixed(2)} m/s)`);
  assert.ok(-Math.sin(s.travelHeading) < 0, 'moving away from the wall');
  assert.ok(s.comboNames.includes('Wallplant'));
  const locked = flyingAtWall(false);
  locked.update(1 / 60, { ...neutral, pop: true });
  assert.ok(locked.verticalSpeed < 1, 'not unlocked yet: nothing happens');
});

test('Agility leap (level 30): a second jump in the air, once per air, reaching about 2 m', () => {
  const s = new Skater(flat, { x: 0, y: 0, z: 0 }); s.abilities = { ...BASE_ABILITIES, leaps: 1 };
  s.update(1 / 60, { ...neutral, pop: true }); simulate(s, 0.28);
  s.update(1 / 60, { ...neutral, pop: true });
  assert.equal(s.leapsUsed, 1); assert.ok(s.verticalSpeed > 5.5);
  let peak = 0;
  for (let i = 0; i < 20; i++) { s.update(1 / 60, i === 5 ? { ...neutral, pop: true } : neutral); peak = Math.max(peak, s.position.y); }
  assert.equal(s.leapsUsed, 1, 'only one per air');
  untilLanded(s); assert.ok(s.events.some((e) => e.type === 'leap'));
  for (let i = 0; i < 60; i++) { s.update(1 / 60, neutral); peak = Math.max(peak, s.position.y); }
  assert.ok(peak > 1.8, `peak ${peak.toFixed(2)} m (one ollie: 0.66 m)`);
});

test('just above the ground on the way down, Space is a buffered ollie for the landing, not a leap', () => {
  const s = new Skater(flat, { x: 0, y: 0, z: 0 }); s.abilities = { ...BASE_ABILITIES, leaps: 1 }; s.speed = 4;
  s.update(1 / 60, { ...neutral, pop: true });
  for (let i = 0; i < 120 && !(s.verticalSpeed < 0 && s.position.y < 0.25); i++) s.update(1 / 60, neutral);
  s.update(1 / 60, { ...neutral, pop: true });
  assert.equal(s.leapsUsed, 0);
  let popped = false;
  for (let i = 0; i < 20; i++) { s.update(1 / 60, neutral); popped ||= s.comboNames.filter((n) => n === 'Ollie').length === 2; }
  assert.ok(popped, 'ollied again as it landed, linking the combo');
});

test('riding straight at a wall turns you along it instead of pinning you there', () => {
  const wall: SkateWorld = { ...flat, move: (from, delta) => ({ x: from.x + delta.x, y: from.y + delta.y, z: Math.max(-2, from.z + delta.z), blocked: from.z + delta.z < -2, normal: { x: 0, y: 0, z: 1 } }) };
  for (const heading of [0, 0.1, -0.1]) {
    const s = new Skater(wall, { x: 0, y: 0, z: 0 }); s.reset({ x: 0, y: 0, z: 0 }, heading); s.speed = 6;
    simulate(s, 1.2, { push: true });
    assert.equal(s.bailTime, 0);
    assert.ok(s.speed > 3, `still rolling (${s.speed.toFixed(2)} m/s)`);
    assert.ok(Math.abs(s.position.x) > 1.5, `slid along the wall (x ${s.position.x.toFixed(2)})`);
    if (heading) assert.ok(Math.sign(s.position.x) === -Math.sign(heading), 'toward the side it was angled');
  }
});

test('splashing into water banks the combo you flew in with, then puts you back on dry ground', () => {
  const world: SkateWorld = { ...flat, canRideAt: (_x, z) => z > -1 };
  const s = new Skater(world, { x: 0, y: 0, z: 0 }); s.speed = 6;
  s.update(1 / 60, { ...neutral, pop: true }); s.update(1 / 60, { ...neutral, flip: true });
  untilLanded(s);
  assert.ok(s.bailTime > 0);
  assert.equal(s.totalScore, (100 + 300) * 2);
  assert.match(s.message, /Splash! · back to dry ground · combo banked \+800/);
  simulate(s, 1.3);
  assert.equal(s.bailTime, 0); assert.ok(s.position.z > -1, 'back on dry ground');
});

test('the edge of the map is an invisible wall, on the ground and in the air', () => {
  const world: SkateWorld = { ...flat, inBounds: (x) => x < 5 };
  const flying = new Skater(world, { x: 4, y: 2, z: 0 });
  flying.grounded = false; flying.speed = 8; flying.heading = -Math.PI / 2; (flying as unknown as { airHeading: number }).airHeading = flying.heading;
  simulate(flying, 0.5);
  assert.ok(flying.position.x <= 5, `stayed on the map (x ${flying.position.x.toFixed(2)})`);
  assert.match(flying.message, /Edge of the map/);
  const rolling = new Skater(world, { x: 3, y: 0, z: 0 }); rolling.reset({ x: 3, y: 0, z: 0 }, -Math.PI / 2 + 0.5); rolling.speed = 6;
  simulate(rolling, 1, { push: true });
  assert.ok(rolling.position.x < 5); assert.ok(rolling.speed > 3, 'glanced along it');
});

test('a very high drop bails on landing, unless Iron knees (level 70) is unlocked', () => {
  for (const ironKnees of [false, true]) {
    const s = new Skater(flat, { x: 0, y: 12, z: 0 }); s.grounded = false; s.abilities = { ...BASE_ABILITIES, ironKnees };
    untilLanded(s);
    assert.equal(s.bailTime > 0, !ironKnees, ironKnees ? 'landed it' : 'heavy landing');
  }
  // a roof-height drop (4 m) is fine for anyone
  const roof = new Skater(flat, { x: 0, y: 4, z: 0 }); roof.grounded = false; untilLanded(roof);
  assert.equal(roof.bailTime, 0); assert.ok(Math.sqrt(2 * 14 * 4) < LANDING.heavy);
});

test('falling off a grind still banks the combo at half points', () => {
  const world: SkateWorld = { ...flat, rails: [{ id: 'r', name: 'Fence', a: { x: 0, y: 0.6, z: 2 }, b: { x: 0, y: 0.6, z: -30 } }] };
  const s = new Skater(world, { x: 0, y: 0.65, z: 0 }); s.grounded = false; s.speed = 4; s.verticalSpeed = -1;
  s.update(1 / 60, neutral); assert.ok(s.grinding);
  for (let i = 0; i < 900 && s.grinding; i++) s.update(1 / 60, { ...neutral, steer: -1 }); // lean hard one way
  assert.equal(s.grinding, null);
  assert.match(s.message, /Fell off the grind · leaned too far right · half points/);
  assert.ok(s.totalScore > 0);
});

test('Skateboarding levels unlock abilities, RS skill guide style', () => {
  assert.deepEqual(abilitiesFor(1), BASE_ABILITIES);
  const thirty = abilitiesFor(30);
  assert.equal(thirty.wallplant, true); assert.equal(thirty.leaps, 1); assert.equal(thirty.pop, 1.08); assert.equal(thirty.steady, 0.85);
  const max = abilitiesFor(99);
  assert.equal(max.leaps, 2); assert.equal(max.airSurge, true); assert.equal(max.ironKnees, true); assert.equal(max.surgeCooldown, 5);
  assert.deepEqual(unlocksBetween(25, 35).map((u) => u.name), ['Agility leap']);
  const career = new Career();
  career.award(xpForLevel(31));
  assert.deepEqual(career.unlocked.map((u) => u.name), ['Steady feet', 'Strong pop', 'Wallplant', 'Agility leap']);
});

test('a sketchy (half points) combo still counts for combo challenges, but not for trick challenges', () => {
  const tracker = new ChallengeTracker(), open = challengesFor('varrock');
  const event = { type: 'land' as const, score: 900, names: ['Ollie', '360 flip'], combo: 2, sketchy: true };
  assert.deepEqual(tracker.event(event, open).map((c) => c.tier), ['Easy']);
  assert.deepEqual(tracker.event({ ...event, sketchy: false }, open).map((c) => c.tier), ['Easy', 'Hard']);
});

test('live hints: a ledge ahead, the link window, and a leap once it is unlocked', () => {
  const world: SkateWorld = { ...flat, rails: [{ id: 'r', name: 'Stone ledge', a: { x: -3, y: 0.6, z: -4 }, b: { x: 3, y: 0.6, z: -4 } }] };
  const s = new Skater(world, { x: 0, y: 0, z: 0 }); s.speed = 5;
  const coach = new HintCoach(world);
  assert.equal(coach.update(0.2, s)?.id, 'ledge');
  const text = (coach.update(0.2, s)?.parts ?? []).map((part) => (typeof part === 'string' ? part : `[${part.key}]`)).join('');
  assert.match(text, /Hold \[Space\] and release to ollie onto the stone ledge/);
  s.update(1 / 60, { ...neutral, pop: true }); s.update(1 / 60, neutral); untilLanded(s);
  assert.equal(coach.update(0.2, s)?.id, 'link', 'keep the combo going');
  const air = new Skater(flat, { x: 0, y: 0, z: 0 }); air.abilities = { ...BASE_ABILITIES, leaps: 1 };
  air.update(1 / 60, { ...neutral, pop: true }); simulate(air, 0.15);
  assert.equal(new HintCoach(flat).update(0.2, air)?.id, 'leap');
  coach.enabled = false; assert.equal(coach.update(0.2, s), null);
});
