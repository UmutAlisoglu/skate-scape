import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Career, readProfile } from '../src/game/career.ts';
import { Skater } from '../src/game/skater.ts';

test('career saves earned unlocks and best combo across reloads', () => {
  let value: string | null = null;
  const storage = { getItem: () => value, setItem: (_: string, next: string) => { value = next; } };
  const career = new Career(storage);
  career.event({ type: 'trick',score: 0,names: ['Ollie'],combo: 1 }); assert.equal(career.boardUnlocked(1),false);
  career.event({ type: 'land',score: 3000,names: ['Ollie','Kickflip'],combo: 3 });
  assert.equal(career.boardUnlocked(1),true); assert.equal(career.boardUnlocked(3),true);
  const reloaded = new Career(storage); assert.equal(reloaded.profile.bestCombo,3000); assert.equal(reloaded.profile.lifetime,3000);
});
test('run ends once at two minutes and stores its score', () => {
  const career = new Career(); career.start('run');
  career.event({ type: 'land',score: 12000,names: ['Ollie'],combo: 1 });
  const skater = new Skater({ groundAt: () => 0, move: (p) => ({...p,blocked:false}) },{x:0,y:0,z:0});
  career.tick(120,skater); assert.equal(career.ended,true); assert.equal(career.profile.bestRun,12000);
  career.event({ type: 'land',score: 100,names: ['Ollie'],combo: 1 }); assert.equal(career.runScore,12000);
  assert.ok(career.profile.completed.includes('run'));
});
test('invalid or unavailable save data still allows a fresh playable career', () => {
  assert.equal(readProfile('invalid').bestRun,0);
  assert.equal(readProfile('{"version":1,"bestRun":-10,"board":999}').bestRun,0);
  assert.equal(new Career({ getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } }).profile.version,1);
});

test('an active combo gets a bounded chance to finish after the run clock expires', () => {
  const career = new Career(); career.start('run');
  const skater = new Skater({ groundAt: () => 0, move: (p) => ({...p,blocked:false}) },{x:0,y:0,z:0}); skater.comboCount = 1;
  career.tick(119.9,skater); career.tick(0.1,skater);
  assert.equal(career.ended,false); assert.equal(career.overtime,true);
  career.event({ type: 'land',score: 800,names: ['Ollie','Kickflip'],combo: 2 }); skater.comboCount=0;
  career.tick(0.1,skater); assert.equal(career.ended,true); assert.equal(career.profile.bestRun,800);
});
