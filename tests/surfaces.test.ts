import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeSprite } from '../tools/cache/sprite.ts';
import { deformSkater, type SkatePose } from '../src/player/skate-pose.ts';
import { SLOT } from '../src/shared/player-data.ts';
test('cache sprite decoder keeps palette transparency and column ordering', () => {
  const data = Buffer.alloc(23); data.set([0,1,0,1,1,255,0,0]);
  data.writeUInt16BE(2,8); data.writeUInt16BE(2,10); data[12]=1;
  data.writeUInt16BE(2,17); data.writeUInt16BE(2,19); data.writeUInt16BE(1,21);
  const row = decodeSprite(data); assert.equal(row.pixels[0],255); assert.equal(row.pixels[7],0);
  data[0]=1; const column = decodeSprite(data); assert.equal(column.pixels[7],255); assert.equal(column.pixels[11],0);
});
test('crouch plants the feet while push deforms the rear leg', () => {
  const pose: SkatePose = { crouch: 1,push: 0,air: 0,kick: 0,balance: 0,time: 0,phase: 'crouch' };
  assert.ok(Math.abs(deformSkater(-0.15,0,0,SLOT.FEET,pose).y)<0.000001);
  assert.ok(deformSkater(0,1.2,0,SLOT.TORSO,pose).y < 1);
  const rear = deformSkater(-0.15,0,0,SLOT.FEET,{...pose,push:1}); assert.ok(rear.x < -0.4); assert.ok(rear.y < 0);
});
