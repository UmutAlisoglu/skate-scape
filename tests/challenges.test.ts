import { test } from 'node:test';
import assert from 'node:assert/strict';
import { levelForXp, xpForLevel, levelProgress, comboXp } from '../src/game/skill.ts';
import { ALL_CHALLENGES, ChallengeTracker, challengesFor, TIERS } from '../src/game/challenges.ts';
import { Career, readProfile } from '../src/game/career.ts';
import { PLACES } from '../src/game/places.ts';
import type { Skater } from '../src/game/skater.ts';

test('the Skateboarding skill uses the RuneScape experience curve', () => {
  assert.equal(xpForLevel(2), 83);
  assert.equal(xpForLevel(50), 101333);
  assert.equal(xpForLevel(99), 13034431);
  assert.equal(levelForXp(0), 1); assert.equal(levelForXp(82), 1); assert.equal(levelForXp(83), 2);
  assert.equal(levelForXp(13034431), 99); assert.equal(levelForXp(200_000_000), 99);
  assert.ok(levelProgress(xpForLevel(10) + 1) > 0 && levelProgress(xpForLevel(10) + 1) < 0.01);
  assert.equal(comboXp(10000), 2500);
});

test('every teleport spot has five challenges, Easy to Grandmaster', () => {
  for (const place of PLACES) {
    const set = challengesFor(place.id);
    assert.equal(set.length, 5, place.id);
    assert.deepEqual(set.map((c) => c.tier), TIERS);
  }
  assert.equal(new Set(ALL_CHALLENGES.map((c) => c.id)).size, ALL_CHALLENGES.length);
});

type Fake = Partial<Skater> & { position: { x: number; y: number; z: number } };
const rider = (patch: Partial<Fake> = {}): Skater => ({ position: { x: 0, y: 0, z: 0 }, grounded: true, grinding: null, wallride: null, manual: false, grab: null, stumbleTime: 0, bailTime: 0, ...patch }) as unknown as Skater;

test('the tracker measures one grind line, clean airs and banked combos', () => {
  const lumbridge = challengesFor('lumbridge'), tracker = new ChallengeTracker();
  const rail = { rail: { id: 'r', name: 'Fence', a: { x: 0, y: 0, z: 0 }, b: { x: 0, y: 0, z: -50 } }, t: 0, direction: 1 };
  let met: string[] = [];
  for (let z = 0; z >= -11; z -= 0.5) met.push(...tracker.update(rider({ grinding: rail, grounded: false, position: { x: 0, y: 1, z } }), 1 / 60, lumbridge).map((c) => c.id));
  assert.ok(met.includes('lumbridge-1'), 'a 10 m grind line');
  assert.ok(!met.includes('lumbridge-4'), 'not the 40 m one');
  const varrock = challengesFor('varrock'), air = new ChallengeTracker();
  met = [];
  for (let i = 0; i < 70; i++) met.push(...air.update(rider({ grounded: false }), 1 / 60, varrock).map((c) => c.id));
  met.push(...air.update(rider({ grounded: true }), 1 / 60, varrock).map((c) => c.id));
  assert.ok(met.includes('varrock-1'), '1.1 s of air, landed clean');
  const bailed = new ChallengeTracker(); met = [];
  for (let i = 0; i < 70; i++) bailed.update(rider({ grounded: false }), 1 / 60, varrock);
  met.push(...bailed.update(rider({ grounded: true, bailTime: 1 }), 1 / 60, varrock).map((c) => c.id));
  assert.equal(met.length, 0, 'a bail does not count');
  const combos = tracker.event({ type: 'land', score: 12000, names: ['Ollie', '360 flip'], combo: 2 }, varrock).map((c) => c.id);
  assert.deepEqual(combos.sort(), ['varrock-0', 'varrock-2', 'varrock-3']);
});

test('completing a challenge awards its tier XP once; level-ups get the RS congratulations', () => {
  const store = new Map<string, string>(), storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); } };
  const career = new Career(storage, 'test');
  const [easy] = challengesFor('lumbridge');
  assert.equal(career.completeChallenge(easy, 'Lumbridge'), true);
  assert.equal(career.profile.xp, 2000);
  assert.match(career.toast, /Skateboarding level/);
  assert.equal(career.completeChallenge(easy, 'Lumbridge'), false);
  assert.equal(career.profile.xp, 2000);
  career.event({ type: 'land', score: 400, names: ['Ollie'], combo: 1 });
  assert.equal(career.profile.xp, 2100, 'combos give a quarter of their score');
  const saved = readProfile(store.get('test')!);
  assert.deepEqual(saved.challenges, ['lumbridge-0']); assert.equal(saved.xp, 2100);
  const old = readProfile(JSON.stringify({ version: 1, bestRun: 50, tricks: ['Ollie'] }));
  assert.equal(old.xp, 0); assert.deepEqual(old.challenges, []); assert.equal(old.bestRun, 50);
});

test('town runes: five spread-out spots above grind lines near the town, one of them up high', async () => {
  const { placeRunes } = await import('../src/game/runes.ts');
  const place = { id: 'testtown', name: 'Test town', spell: '', tile: [0, 0] as [number, number], blurb: '', region: '', x: 0, z: 0 };
  const rails = [];
  for (let i = 0; i < 40; i++) {
    const a = (i / 40) * Math.PI * 2, r = 10 + (i % 4) * 8, x = Math.cos(a) * r, z = Math.sin(a) * r, y = i % 7 === 0 ? 2.2 : 0.9;
    rails.push({ id: `r${i}`, name: 'Ledge', a: { x, y, z }, b: { x: x + 3, y, z } });
  }
  const runes = placeRunes(place, rails, () => 0);
  assert.equal(runes.length, 5);
  for (const a of runes) for (const b of runes) if (a !== b) assert.ok(Math.hypot(a.position.x - b.position.x, a.position.z - b.position.z) >= 9);
  assert.ok(runes.some((r) => r.position.y > 2.5), 'one high rune');
  assert.deepEqual(runes.map((r) => r.id), placeRunes(place, rails, () => 0).map((r) => r.id), 'the same spots every time');
});

test('finding town runes gives XP each and a bonus for the set of five', () => {
  const career = new Career(undefined, 'test');
  for (let i = 1; i <= 4; i++) career.collectTownRune(`t-rune-${i}`, 'Air rune', 'Test town', i, 5);
  assert.equal(career.profile.xp, 6000);
  career.collectTownRune('t-rune-5', 'Air rune', 'Test town', 5, 5);
  assert.equal(career.profile.xp, 6000 + 1500 + 15000);
  assert.match(career.toast, /All 5 Test town runes/);
  career.collectTownRune('t-rune-5', 'Air rune', 'Test town', 5, 5);
  assert.equal(career.profile.xp, 22500, 'no double rewards');
});
