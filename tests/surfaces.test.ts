import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeSprite } from '../tools/cache/sprite.ts';
test('cache sprite decoder keeps palette transparency and column ordering', () => {
  const data = Buffer.alloc(23); data.set([0,1,0,1,1,255,0,0]);
  data.writeUInt16BE(2,8); data.writeUInt16BE(2,10); data[12]=1;
  data.writeUInt16BE(2,17); data.writeUInt16BE(2,19); data.writeUInt16BE(1,21);
  const row = decodeSprite(data); assert.equal(row.pixels[0],255); assert.equal(row.pixels[7],0);
  data[0]=1; const column = decodeSprite(data); assert.equal(column.pixels[7],255); assert.equal(column.pixels[11],0);
});
