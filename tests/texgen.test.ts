import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JavaRandom, randomInt } from '../tools/texgen/core.ts';
import { TextureGenerator, decodeSprite } from '../tools/texgen/texture.ts';

test('the texture port reproduces java.util.Random', () => {
  const a = new JavaRandom(42);
  assert.deepEqual([a.nextInt(), a.nextInt()], [-1170105035, 234785527]);
  const b = new JavaRandom(42);
  assert.deepEqual([b.nextInt(10), b.nextInt(10), b.nextInt(10)], [0, 3, 8]);
  assert.equal(new JavaRandom(0).nextInt(), -1155484576);
  // the client's own bounded draw stays in range for powers of two and other bounds
  const c = new JavaRandom(7);
  for (let i = 0; i < 1000; i++) { const v = randomInt(i % 2 ? 4096 : 1000, c); assert.ok(v >= 0 && v < (i % 2 ? 4096 : 1000)); }
});

/** A texture definition: one op of `type` with `opcodes`, used for both colour and alpha, then the 7 flag bytes. */
function definition(type: number, opcodes: number[][], mirror = false) {
  const op = [0, type, 255, opcodes.length, ...opcodes.flat()];
  return Uint8Array.from([1, ...op, 0, 0, 0, mirror ? 1 : 0, 1, 1, 2, 0, 0]);
}

test('a colour fill renders through the brightness curve, with alpha from the alpha op', () => {
  const generator = new TextureGenerator(8, () => definition(1, [[0, 0x33, 0x66, 0x99]]), () => null);
  const rendered = generator.render(1)!;
  const curve = (v: number) => Math.min(255, Math.trunc(Math.pow(v / 255, 0.7) * 255));
  assert.equal(rendered.flags.blend, 2);
  assert.deepEqual([...rendered.rgba.subarray(0, 4)], [curve(0x33), curve(0x66), curve(0x99), 0x33]);
  assert.equal(rendered.rgba.length, 8 * 8 * 4);
});

test('sprites expand onto their canvas with palette index 0 left black', () => {
  // one 1x2 frame on a 2x2 canvas at x=1: palette [black, red]
  const data = Uint8Array.from([
    0, // flags: row-major
    1, 0, // pixels: red, transparent
    0xff, 0x00, 0x00, // palette entry 1
    0, 2, 0, 2, 1, // canvas 2x2, palette size 2
    0, 1, 0, 0, 0, 1, 0, 2, // x offset 1, y offset 0, width 1, height 2
    0, 1, // one frame
  ]);
  const sprite = decodeSprite(data);
  assert.deepEqual([sprite.width, sprite.height], [2, 2]);
  assert.deepEqual([...sprite.pixels], [0, 0xff0000, 0, 0]);
});
