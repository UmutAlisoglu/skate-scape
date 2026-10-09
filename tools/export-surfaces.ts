// Renders the cache's procedural textures with the 2009 client's own texture code (compiled from
// vendor/rt4-client with small stubs in tools/texgen) and packs the ones the exports use into one
// texture-array strip: public/surfaces/textures.png (128 x 128*layers) + manifest.json.
// Usage: npm run export:surfaces   (run after export:world / export:player)
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { CacheStore } from './cache/store.ts';
import { Defs } from './cache/defs.ts';
import type { SurfaceManifest } from '../src/shared/surfaces.ts';

const CACHE_DIR = 'vendor/2009scape-cache';
const CLIENT_SRC = 'vendor/rt4-client';
const WORK = 'work/texgen';
const SIZE = 128;

if (!existsSync(join(CLIENT_SRC, 'client/src/main/java/rt4/Texture.java'))) {
  throw new Error(`Missing ${CLIENT_SRC}. Clone it first: git clone --depth 1 https://gitlab.com/2009scape/rt4-client.git ${CLIENT_SRC}`);
}

const cache = new CacheStore(CACHE_DIR);
const defs = new Defs(cache);

// 1. Dump texture definitions (archive 9) and sprites (archive 8) for the Java generator.
for (const dir of ['dump/textures', 'dump/sprites', 'out', 'classes']) mkdirSync(join(WORK, dir), { recursive: true });
for (const id of cache.index(9).groupIds) {
  const data = cache.file(9, id);
  if (data) writeFileSync(join(WORK, 'dump/textures', `${id}.bin`), data);
}
for (const id of cache.index(8).groupIds) {
  const data = cache.file(8, id);
  if (data) writeFileSync(join(WORK, 'dump/sprites', `${id}.bin`), data);
}

// 2. Compile the client's texture graph (Texture + TextureOp*) against our stubs, then render every texture.
const sep = process.platform === 'win32' ? ';' : ':';
execFileSync('javac', [
  '-nowarn', '-encoding', 'UTF-8', '-d', join(WORK, 'classes'),
  '-sourcepath', ['tools/texgen/java', join(CLIENT_SRC, 'client/src/main/java'), join(CLIENT_SRC, 'deob-annotations/src/main/java')].join(sep),
  'tools/texgen/java/rt4/TexGen.java',
], { stdio: 'inherit' });
execFileSync('java', ['-cp', join(WORK, 'classes'), 'rt4.TexGen', join(WORK, 'dump'), join(WORK, 'out'), String(SIZE)], { stdio: 'inherit' });

const flags = new Map<number, { blend: number }>();
for (const line of readFileSync(join(WORK, 'out/flags.txt'), 'utf8').trim().split('\n')) {
  const [id, , , , , blend] = line.split(' ').map(Number);
  flags.set(id, { blend });
}

// 3. Collect the textures the exported world and wardrobe reference.
const used = new Set<number>();
if (existsSync('public/world')) {
  for (const area of readdirSync('public/world')) {
    for (const name of ['terrain', 'locs']) {
      const file = join('public/world', area, `${name}.materials.bin`);
      if (!existsSync(file)) continue;
      const refs = readFileSync(file);
      for (let i = 0; i < refs.length; i += 2) {
        const v = refs.readUInt16LE(i);
        if (v) used.add(v - 1);
      }
    }
  }
}
if (existsSync('public/player/wardrobe.json')) {
  const text = readFileSync('public/player/wardrobe.json', 'utf8');
  for (const match of text.matchAll(/"x":\[([0-9,-]*)\]/g)) for (const v of match[1].split(',')) if (Number(v) >= 0 && v !== '') used.add(Number(v));
}
const layers = [...used].filter((id) => existsSync(join(WORK, 'out', `${id}.rgba`))).sort((a, b) => a - b);
const missing = [...used].filter((id) => !layers.includes(id));
if (missing.length) console.warn(`  ${missing.length} referenced textures could not be rendered: ${missing.slice(0, 20).join(', ')}`);

// 4. Pack the strip.
const pixels = Buffer.alloc(SIZE * SIZE * 4 * layers.length);
layers.forEach((id, i) => readFileSync(join(WORK, 'out', `${id}.rgba`)).copy(pixels, i * SIZE * SIZE * 4));
const manifest: SurfaceManifest = {
  version: 2,
  size: SIZE,
  layers,
  blend: layers.map((id) => flags.get(id)?.blend ?? 0),
  opaque: layers.map((id) => defs.textures.opaque[id] ?? true),
  material: layers.map((id) => defs.textures.materialType[id] ?? 0),
};
mkdirSync('public/surfaces', { recursive: true });
writeFileSync('public/surfaces/textures.png', png(SIZE, SIZE * layers.length, pixels));
writeFileSync('public/surfaces/manifest.json', JSON.stringify(manifest));
console.log(`Surfaces: ${layers.length} client-rendered textures (${SIZE}px) packed for ${used.size} referenced ids`);

function png(width: number, height: number, rgba: Buffer) {
  const crcTable = new Int32Array(256).map((_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c;
  });
  const chunk = (type: string, body: Buffer) => {
    const data = Buffer.concat([Buffer.from(type), body]);
    let crc = -1;
    for (const byte of data) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    const out = Buffer.alloc(body.length + 12);
    out.writeUInt32BE(body.length);
    data.copy(out, 4);
    out.writeInt32BE(~crc, out.length - 4);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const rows = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) rgba.copy(rows, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(rows, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
