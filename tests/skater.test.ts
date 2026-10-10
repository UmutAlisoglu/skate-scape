import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Skater, LANDING_WINDOW, type SkateInput, type SkateWorld } from '../src/game/skater.ts';

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
  simulate(skater, 0.3 + LANDING_WINDOW);
  assert.equal(skater.grounded, true);
  assert.ok(skater.totalScore > 100);
  assert.equal(skater.fakie, true);
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
  simulate(skater, 1.6); assert.equal(skater.bailTime, 0); assert.equal(skater.position.z, -2);
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

test('a revert right after landing links into the combo and switches stance', () => {
  const skater = create(); skater.speed = 5;
  skater.update(1 / 60, { ...neutral, pop: true });
  simulate(skater, 0.62); // airborne for about 0.6 s
  while (!skater.grounded) skater.update(1 / 60, neutral);
  assert.equal(skater.totalScore, 0, 'combo stays open just after landing');
  const travel = skater.travelHeading;
  skater.update(1 / 60, { ...neutral, revert: true });
  assert.equal(skater.fakie, true);
  assert.ok(Math.abs(Math.sin(skater.travelHeading - travel)) < 1e-9 && Math.cos(skater.travelHeading - travel) > 0, 'keeps rolling the same way');
  simulate(skater, LANDING_WINDOW + 0.05);
  assert.equal(skater.totalScore, 400, 'Ollie + Revert = (100 + 100) x 2');
  // later reverts only switch stance
  simulate(skater, 0.5); skater.update(1 / 60, { ...neutral, revert: true }); simulate(skater, 0.5);
  assert.equal(skater.fakie, false); assert.equal(skater.totalScore, 400);
});

test('crashing right after a landing still banks the landed combo', () => {
  let wall = false;
  const world: SkateWorld = { ...flat, move: (from, delta) => wall
    ? { x: from.x, y: from.y + delta.y, z: from.z, blocked: true, normal: { x: 0, y: 0, z: 1 } }
    : { x: from.x + delta.x, y: from.y + delta.y, z: from.z + delta.z, blocked: false } };
  const skater = create(world); skater.speed = 9;
  skater.update(1 / 60, { ...neutral, pop: true });
  while (skater.grounded) skater.update(1 / 60, neutral);
  while (!skater.grounded) skater.update(1 / 60, neutral);
  wall = true; skater.update(1 / 60, neutral);
  assert.equal(skater.bailTime > 0, true);
  assert.equal(skater.totalScore, 100);
});

// A wall along z at x = 1 (its face points toward -x); the skater's capsule radius is 0.22.
const walled: SkateWorld = {
  groundAt: () => 0,
  move: (from, delta) => {
    const x = from.x + delta.x;
    if (x > 0.78) return { x: 0.78, y: from.y + delta.y, z: from.z + delta.z, blocked: true, normal: { x: -1, y: 0, z: 0 } };
    return { x, y: from.y + delta.y, z: from.z + delta.z, blocked: false };
  },
};
function intoWall(speed = 6, angleDegrees = 25) {
  const s = new Skater(walled, { x: 0.6, y: 1, z: 0 });
  s.grounded = false; s.speed = speed; s.verticalSpeed = 0.5;
  // travel mostly along -z, angled into the wall (+x)
  const a = (angleDegrees * Math.PI) / 180;
  s.heading = -a; // travel = (-sin h, -cos h) = (sin a, -cos a)
  (s as unknown as { airHeading: number }).airHeading = s.heading;
  return s;
}
/** Rides until the board reaches the wall (or a quarter second passes). */
function reachWall(s: Skater, input: Partial<SkateInput> = {}) {
  for (let i = 0; i < 15 && !s.wallride && Math.abs(s.position.x - 0.78) > 1e-9; i++) s.update(1 / 60, { ...neutral, ...input });
  return s;
}

test('hitting a wall at a glancing angle with speed starts a wallride that scores and lands', () => {
  const s = reachWall(intoWall());
  assert.ok(s.wallride, 'on the wall');
  assert.equal(s.phase, 'wallride');
  const startZ = s.position.z;
  simulate(s, 0.4);
  assert.ok(s.wallride, 'still riding'); assert.ok(s.position.z < startZ - 1.5, 'travels along the wall'); assert.ok(s.position.y > 0.6, 'reduced gravity');
  simulate(s, 3);
  assert.equal(s.wallride, null); assert.equal(s.grounded, true);
  assert.ok(s.drainEvents().some((e) => e.type === 'land' && e.names.includes('Wallride')));
});

test('faster entries ride longer; head-on hits, slow hits and a tuck (Space held) do not wallride', () => {
  const slow = reachWall(intoWall(3.5)), fast = reachWall(intoWall(9));
  assert.ok(fast.wallride!.duration > slow.wallride!.duration);
  assert.equal(reachWall(intoWall(6, 70)).wallride, null);
  assert.equal(reachWall(intoWall(2)).wallride, null);
  assert.equal(reachWall(intoWall(), { crouch: true }).wallride, null);
});

test('scraping the wall on the ground and ollieing a moment later still catches the wallride', () => {
  const s = new Skater(walled, { x: 0.6, y: 0, z: 0 });
  s.reset({ x: 0.6, y: 0, z: 0 }, -0.5); s.speed = 7;
  simulate(s, 0.2, { crouch: true });
  assert.equal(s.position.x, 0.78, 'touched the wall while rolling');
  assert.equal(s.wallride, null);
  s.update(1 / 60, { ...neutral, pop: true });
  for (let i = 0; i < 30 && !s.wallride; i++) s.update(1 / 60, neutral);
  assert.ok(s.wallride, 'caught once high enough');
  // rolling alongside without touching (or long after) does not
  const far = new Skater(walled, { x: 0.2, y: 0, z: 0 });
  far.reset({ x: 0.2, y: 0, z: 0 }, 0); far.speed = 7;
  simulate(far, 0.2, { crouch: true });
  far.update(1 / 60, { ...neutral, pop: true });
  simulate(far, 0.5);
  assert.equal(far.wallride, null);
});

test('a wallie pops off the wall, away from it', () => {
  const s = reachWall(intoWall());
  simulate(s, 0.2);
  s.update(1 / 60, { ...neutral, pop: true });
  assert.equal(s.wallride, null);
  assert.ok(s.verticalSpeed > 4);
  assert.ok(-Math.sin(s.travelHeading) < 0, 'moving away from the wall (toward -x)');
  simulate(s, 0.3);
  assert.equal(s.wallride, null, 'no immediate re-catch');
});

// Inclines rise toward -z (the direction of travel at heading 0) from z = 0.
const incline = (degrees: number, length = Infinity, after: 'flat' | 'drop' = 'flat'): SkateWorld => {
  const slope = Math.tan((degrees * Math.PI) / 180);
  return { ...flat, groundAt: (_x, z) => (-z <= 0 ? 0 : -z <= length ? -z * slope : after === 'flat' ? length * slope : 0) };
};

test('hills: rolling downhill speeds up, uphill slows down, and stalling on a bank rolls you back fakie', () => {
  const down = new Skater(incline(10), { x: 0, y: 2, z: -20 }); down.reset({ x: 0, y: 20 * Math.tan(Math.PI / 18), z: -20 }, Math.PI); down.speed = 3;
  simulate(down, 2);
  assert.ok(down.speed > 5, `gained speed downhill (${down.speed.toFixed(2)})`);
  const bank = new Skater(incline(20), { x: 0, y: 0, z: 0.5 }); bank.reset({ x: 0, y: 0, z: 0.5 }, 0); bank.speed = 6;
  let peak = 0;
  for (let i = 0; i < 240; i++) { bank.update(1 / 60, neutral); peak = Math.max(peak, bank.position.y); }
  assert.ok(peak > 1 && peak < 3, `rolled up the bank to ${peak.toFixed(2)} m`);
  assert.equal(bank.fakie, true, 'came back down tail-first');
  assert.ok(bank.position.z > 0 && bank.speed > 3, 'rolled back out onto the flat with speed');
});

test('a kicker launches you off its lip but riding over a curb does not', () => {
  const kicker = new Skater(incline(25, 1.6, 'drop'), { x: 0, y: 0, z: 1 }); kicker.reset({ x: 0, y: 0, z: 1 }, 0); kicker.speed = 7;
  let launched = 0, top = 0;
  for (let i = 0; i < 90; i++) { kicker.update(1 / 60, neutral); if (!kicker.grounded && !launched) launched = kicker.verticalSpeed; top = Math.max(top, kicker.position.y); }
  assert.ok(launched > 2, `left the lip rising (${launched.toFixed(2)} m/s)`);
  const lip = 1.6 * Math.tan((25 * Math.PI) / 180);
  assert.ok(top > lip + 0.2, `flew ${(top - lip).toFixed(2)} m above the ${lip.toFixed(2)} m lip`);
  const curb = new Skater({ ...flat, groundAt: (_x, z) => (z < -1 ? 0.15 : 0) }, { x: 0, y: 0, z: 0 }); curb.speed = 7;
  let air = false;
  for (let i = 0; i < 60; i++) { curb.update(1 / 60, neutral); air ||= !curb.grounded; }
  assert.equal(air, false);
});

test('S + A/D at speed powerslides: sideways, slower than coasting, gentler than braking, ends on release', () => {
  const slide = create(); slide.speed = 7;
  simulate(slide, 0.5, { brake: true, steer: 1 });
  assert.equal(slide.powerslide, 1);
  const brake = create(); brake.speed = 7; simulate(brake, 0.5, { brake: true });
  assert.equal(brake.powerslide, 0);
  assert.ok(slide.speed < 6 && slide.speed > brake.speed, `slide ${slide.speed.toFixed(2)} vs brake ${brake.speed.toFixed(2)}`);
  simulate(slide, 0.1);
  assert.equal(slide.powerslide, 0);
});

test('landing on a downslope turns the fall into speed', () => {
  const ramp = new Skater(incline(25), { x: 0, y: 3, z: -4 });
  ramp.reset({ x: 0, y: 4, z: -4 }, Math.PI); ramp.grounded = false; ramp.speed = 4;
  (ramp as unknown as { airHeading: number }).airHeading = Math.PI;
  for (let i = 0; i < 120 && !ramp.grounded; i++) ramp.update(1 / 120, neutral);
  assert.equal(ramp.grounded, true);
  assert.ok(ramp.speed > 4.5, `kept and gained speed (${ramp.speed.toFixed(2)})`);
  assert.equal(ramp.bailTime, 0);
});

const airborne = () => { const s = create(); simulate(s, 0.3, { crouch: true }); s.update(1 / 60, { ...neutral, pop: true }); s.update(1 / 60, neutral); return s; };
test('flip variations come from the direction held with Q / E', () => {
  const cases: [Partial<SkateInput>, string][] = [
    [{ flip: true }, 'Kickflip'], [{ flip: true, steer: 1 }, 'Heelflip'], [{ flip: true, steer: -1 }, 'Double kickflip'],
    [{ flip: true, push: true }, 'Hardflip'], [{ flip: true, brake: true }, 'Impossible'],
    [{ shove: true }, 'Pop shove-it'], [{ shove: true, push: true }, '360 shove-it'], [{ shove: true, brake: true }, '360 flip'],
    [{ shove: true, steer: 1 }, 'Varial heelflip'], [{ shove: true, steer: -1 }, 'Varial kickflip'],
  ];
  for (const [input, name] of cases) { const s = airborne(); s.update(1 / 60, { ...neutral, ...input }); assert.equal(s.trick?.name, name); }
});

test('grabs score while held, and landing while still grabbing loses the combo', () => {
  const held = airborne();
  for (let i = 0; i < 12; i++) held.update(1 / 60, { ...neutral, grab: true });
  assert.equal(held.grab?.name, 'Indy'); assert.equal(held.phase, 'grab');
  const points = held.comboPoints;
  for (let i = 0; i < 12; i++) held.update(1 / 60, { ...neutral, grab: true });
  assert.ok(held.comboPoints > points + 40, 'holding adds points');
  for (let i = 0; i < 120 && !held.grounded; i++) held.update(1 / 60, { ...neutral, grab: true });
  assert.ok(held.stumbleTime > 0 && held.comboCount === 0, 'still grabbing on landing');
  const released = airborne();
  for (let i = 0; i < 10; i++) released.update(1 / 60, { ...neutral, grab: true, push: true });
  assert.equal(released.grab?.name, 'Nosegrab');
  for (let i = 0; i < 120 && !released.grounded; i++) released.update(1 / 60, neutral);
  released.update(1 / 60, neutral); simulate(released, 0.5);
  assert.ok(released.totalScore > 0 && released.stumbleTime === 0, 'let go in time and it banks');
});

test('holding W when a manual starts makes it a nose manual', () => {
  const s = create(); s.speed = 5;
  s.update(1 / 60, { ...neutral, manual: true, push: true });
  assert.equal(s.noseManual, true);
  assert.ok(s.events.some((e) => e.names.includes('Nose manual')));
});

// A vert quarter pipe: bottom edge at z = -2, rising toward -z (the travel direction at heading 0).
const quarterPipe = { id: 'qp', origin: { x: 0, y: 0, z: -2 }, yaw: 0, width: 3, radius: 2.2, height: 1.9, deck: 1.4 };
const coping = { id: 'qp-coping', name: 'Coping', width: 0.06, a: { x: -1.5, y: 1.93, z: -4.18 }, b: { x: 1.5, y: 1.93, z: -4.18 } };
const vertWorld: SkateWorld = { ...flat, ramps: [quarterPipe], rails: [coping] };
function rideVert(speed: number, input: Partial<SkateInput> = {}, seconds = 4) {
  const s = new Skater(vertWorld, { x: 0, y: 0, z: 0 }); s.speed = speed;
  let peak = 0, onRamp = false, flew = false;
  for (let i = 0; i < seconds * 120; i++) {
    s.update(1 / 120, { ...neutral, ...(s.grounded ? {} : input) });
    peak = Math.max(peak, s.position.y); onRamp ||= !!s.transition; flew ||= !s.grounded && onRamp;
    if (onRamp && s.grounded && !s.transition && s.position.z > 0) break;
  }
  return { s, peak, onRamp, flew };
}

test('a quarter pipe: ride up, vert air straight up, back down into it fakie and out with speed', () => {
  const { s, peak, onRamp, flew } = rideVert(7);
  assert.ok(onRamp && flew, 'rode the face and launched off the lip');
  assert.ok(peak > 2.4, `air above the coping (${peak.toFixed(2)} m)`);
  assert.equal(s.transition, null); assert.ok(s.position.z > 0, 'rolled back out onto the flat');
  assert.equal(s.fakie, true, 'no spin: you come back down tail-first');
  assert.ok(s.speed > 4, `kept the speed (${s.speed.toFixed(2)})`);
  assert.equal(s.grinding, null, 'did not auto-grind its own coping');
});

test('spinning 180 in a vert air lands regular, and too little speed just rolls back down', () => {
  const s = new Skater(vertWorld, { x: 0, y: 0, z: 0 }); s.speed = 7;
  let airFrames = 0, landed = false;
  for (let i = 0; i < 600 && !landed; i++) {
    const flying = !s.grounded && !s.transition;
    if (flying) airFrames++;
    // steer in the air until the board has turned half a turn from facing up the ramp (heading 0)
    s.update(1 / 120, { ...neutral, steer: flying && s.heading < Math.PI - 0.02 ? 1 : 0 });
    landed = airFrames > 0 && !!s.transition;
  }
  assert.ok(landed, 'came back down onto the face');
  assert.equal(s.fakie, false, 'the 180 lands you riding forward');
  assert.ok(s.events.some((e) => e.type === 'trick' && e.names.includes('180°')), 'scored the spin');
  const slow = rideVert(3.5);
  assert.ok(slow.onRamp && !slow.flew, 'stayed on the face');
  assert.equal(slow.s.fakie, true);
  assert.ok(slow.s.position.z > 0);
});

test('Surge: a burst of speed along your line, then an 8 second cooldown', () => {
  const s = create(); s.speed = 4;
  s.update(1 / 60, { ...neutral, surge: true });
  assert.ok(s.speed >= 10.9, `surged to ${s.speed.toFixed(1)} m/s`);
  const after = s.speed;
  simulate(s, 1);
  s.update(1 / 60, { ...neutral, surge: true });
  assert.ok(s.speed < after, 'a second cast during the cooldown does nothing');
  assert.match(s.message, /recharging/);
  simulate(s, 7.2);
  s.speed = 3; s.update(1 / 60, { ...neutral, surge: true });
  assert.ok(s.speed > 10, 'ready again after the cooldown');
});

test('after a bail the body slides on along the line of travel and gets up where it stopped', () => {
  const s = create(); s.speed = 8;
  (s as unknown as { bail(reason: string): void }).bail('test');
  const start = s.position.z;
  simulate(s, 0.5);
  assert.ok(s.position.z < start - 0.5, `slid ${(start - s.position.z).toFixed(2)} m`);
  simulate(s, 1.5);
  assert.equal(s.bailTime, 0);
  const stopped = s.position.z;
  simulate(s, 0.2);
  assert.ok(Math.abs(s.position.z - stopped) < 0.01, 'back on the board where the slide ended');
});

test('the special bar fills from trick points, drains when idle, empties on a bail', () => {
  const s = airborne();
  s.update(1 / 60, { ...neutral, flip: true }); simulate(s, 0.1);
  assert.ok(s.special > 0.1, `a kickflip fills ${(s.special * 100).toFixed(0)}%`);
  const filled = s.special;
  const idle = create(); idle.special = 0.5; simulate(idle, 2);
  assert.ok(idle.special < 0.5 && idle.special > 0.4, 'drains slowly with no combo');
  (s as unknown as { bail(reason: string): void }).bail('test');
  assert.equal(s.special, 0); assert.ok(filled > 0);
});

test('with the bar full, Shift turns flips, shoves and grabs into RS specials', () => {
  const cases: [Partial<SkateInput>, string][] = [[{ flip: true, grind: true }, 'Rune flip'], [{ shove: true, grind: true }, 'Teleport shove']];
  for (const [input, name] of cases) { const s = airborne(); s.special = 1; s.update(1 / 60, { ...neutral, ...input }); assert.equal(s.trick?.name, name); }
  const notFull = airborne(); notFull.special = 0.9; notFull.update(1 / 60, { ...neutral, flip: true, grind: true });
  assert.equal(notFull.trick?.name, 'Kickflip', 'needs a full bar');
  const grab = airborne(); grab.special = 1;
  for (let i = 0; i < 10; i++) grab.update(1 / 60, { ...neutral, grab: true, grind: true });
  assert.equal(grab.grab?.name, 'Dragonfire grab');
});

test('automatic gaps: clearing water, a big drop and long hang time', () => {
  // water between z = -1 and z = -4; a ledge 3 m up launches the rider over it
  const world: SkateWorld = { ...flat, groundAt: (_x, z) => (z > 0 ? 3 : 0), canRideAt: (_x, z) => !(z < -1 && z > -4) };
  const s = new Skater(world, { x: 0, y: 3, z: 1 }); s.reset({ x: 0, y: 3, z: 1 }, 0); s.speed = 7;
  simulate(s, 0.1, { crouch: true }); s.update(1 / 60, { ...neutral, pop: true });
  for (let i = 0; i < 200 && (s.grounded === false || i < 5); i++) s.update(1 / 60, neutral);
  simulate(s, 0.5);
  const names = s.events.filter((e) => e.type === 'land').flatMap((e) => e.names);
  assert.ok(names.includes('Water gap'), names.join(', '));
  assert.ok(names.includes('Big drop'), names.join(', '));
});
