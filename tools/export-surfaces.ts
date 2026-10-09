import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { CacheStore } from './cache/store.ts';
import { Defs } from './cache/defs.ts';
import { decodeSprite } from './cache/sprite.ts';
import { hslToRgb } from '../src/shared/color.ts';

const cache = new CacheStore('vendor/2009scape-cache');
const defs = new Defs(cache);
const count = defs.textureColors.length, columns = 32, size = 64, padding = 2, cell = size + padding * 2;
const width = columns * cell, height = Math.ceil(count / columns) * cell;
const pixels = Buffer.alloc(width * height * 4);
const original: number[] = [];
for (let id = 0; id < count; id++) {
  const texture = cache.file(9, id);
  let sprite: ReturnType<typeof decodeSprite> | null = null;
  // Simple sprite -> color, monochrome fill -> alpha graphs. Procedural graphs use a detailed fallback.
  if (texture && texture[0] === 2 && [18, 39].includes(texture[2]) && texture[4] === 1 && texture[5] === 0 && texture[12] === 0) {
    const data = cache.file(8, texture[6] * 256 + texture[7]);
    if (data) try { sprite = decodeSprite(data); original.push(id); } catch { /* unsupported/corrupt sprite uses fallback */ }
  }
  const rgb = hslToRgb(defs.textureColors[id]);
  const r = rgb >> 16 & 255, g = rgb >> 8 & 255, b = rgb & 255;
  for (let cy = 0; cy < cell; cy++) for (let cx = 0; cx < cell; cx++) {
    const x = (cx - padding + size) % size, y = (cy - padding + size) % size;
    const dest = ((Math.floor(id / columns) * cell + cy) * width + (id % columns) * cell + cx) * 4;
    if (sprite) {
      const from = (Math.floor(y * sprite.height / size) * sprite.width + Math.floor(x * sprite.width / size)) * 4;
      pixels.set(sprite.pixels.subarray(from, from + 4), dest);
    } else {
      const noise = ((Math.imul(x + id * 31, 374761393) ^ Math.imul(y + 11, 668265263)) >>> 16 & 255) / 255;
      const row = Math.floor(y / 16), brick = (x + (row % 2) * 16) % 32;
      const mortar = y % 16 < 2 || brick < 2;
      let shade = 0.87 + noise * 0.22;
      if (Math.max(r, g, b) - Math.min(r, g, b) < 35) shade *= mortar ? 0.56 : 1;
      else if (r > g * 1.15 && g > b * 1.15) shade *= 0.88 + Math.sin(x * 0.65 + Math.sin(y / 9)) * 0.12;
      pixels[dest] = Math.min(255, r * shade); pixels[dest+1] = Math.min(255, g * shade); pixels[dest+2] = Math.min(255, b * shade); pixels[dest+3] = 255;
    }
  }
}
function chunk(type: string, body: Buffer) {
  const head = Buffer.from(type), data = Buffer.concat([head, body]);
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  const result = Buffer.alloc(body.length + 12);
  result.writeUInt32BE(body.length); data.copy(result, 4); result.writeUInt32BE((crc ^ 0xffffffff) >>> 0, result.length - 4);
  return result;
}
const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
const rows = Buffer.alloc(height * (width * 4 + 1));
for (let y = 0; y < height; y++) pixels.copy(rows, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
mkdirSync('public/surfaces', { recursive: true });
writeFileSync('public/surfaces/atlas.png', Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]));
writeFileSync('public/surfaces/manifest.json', JSON.stringify({ count, columns, size, cell, padding, width, height, original }));
console.log(`Surface atlas: ${count} textures, ${original.length} original cache bitmaps, remaining procedural graphs use detailed fallback surfaces`);
