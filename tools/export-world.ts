// Exports a block of 2009scape map regions as browser-ready meshes.
// Usage: npm run export:world [-- <area>]   (areas defined below)
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { CacheStore, type Xtea } from './cache/store.ts';
import { Defs } from './cache/defs.ts';
import { TileGrid } from './world/region.ts';
import { buildTerrain, LocBuilder, type Soup } from './world/mesh.ts';

const CACHE_DIR = 'vendor/2009scape-cache';
const OUT_DIR = 'public/world';

interface Area {
  regionX: number;
  regionY: number;
  w: number;
  h: number;
  /** spawn in world tile coords */
  spawn: [number, number];
}

const AREAS: Record<string, Area> = {
  // Lumbridge castle, town, river and surroundings
  lumbridge: { regionX: 49, regionY: 49, w: 3, h: 3, spawn: [3222, 3218] },
};

const name = process.argv[2] ?? 'lumbridge';
const area = AREAS[name];
if (!area) throw new Error(`unknown area "${name}", choose one of: ${Object.keys(AREAS).join(', ')}`);

console.log(`Reading cache from ${CACHE_DIR}`);
const cache = new CacheStore(CACHE_DIR);
const defs = new Defs(cache);
const xteas = new Map<number, Xtea>();
for (const x of JSON.parse(readFileSync(join(CACHE_DIR, 'xteas.json'), 'utf8')).xteas as { regionId: string; keys: string }[]) {
  xteas.set(Number(x.regionId), x.keys.split(',').map(Number) as Xtea);
}

const grid = new TileGrid(area.regionX, area.regionY, area.w, area.h);
grid.load(cache, xteas);
console.log(`Loaded ${area.w}x${area.h} regions, ${grid.locs.length} loc spawns`);

const treeDensity = process.argv.includes('--trees=full') ? 1 : 0.35;
// Objects first: they mark the ground shadow map the terrain colors use.
const { soup: locs, placed, shadows, removedTrees, keptTrees } = new LocBuilder(cache, defs).build(grid, treeDensity);
const terrain = buildTerrain(grid, defs, shadows);
console.log(`Terrain: ${terrain.triangleCount} triangles, locs: ${locs.triangleCount} triangles (${placed.length} placed)`);
console.log(`Tree cover: ${keptTrees} retained, ${removedTrees} removed (density ${treeDensity})`);

const dir = join(OUT_DIR, name);
mkdirSync(dir, { recursive: true });
writeSoup(join(dir, 'terrain.bin'), terrain);
writeSoup(join(dir, 'locs.bin'), locs);
const traversal = new Uint8Array(grid.width * grid.height);
for (let i = 0; i < traversal.length; i++) traversal[i] = (grid.flags[0][i] & 1) && !(grid.flags[1][i] & 2) ? 1 : 0;
writeFileSync(join(dir, 'traversal.bin'), traversal);
writeFileSync(
  join(dir, 'manifest.json'),
  JSON.stringify({
    name,
    baseTile: [grid.baseX, grid.baseY],
    sizeTiles: [grid.width, grid.height],
    spawn: [area.spawn[0] - grid.baseX, area.spawn[1] - grid.baseY],
    treeCover:{density:treeDensity,kept:keptTrees,removed:removedTrees},
    // per-loc metadata, used later for auto-generated rails / wallrides
    locs: placed.map((p) => ({ id: p.id, name: p.name, type: p.type, rot: p.rot, plane: p.plane, x: p.x, y: p.y, t: [p.firstTriangle, p.triangleCount] })),
  }),
);
console.log(`Wrote ${dir}`);

/**
 * Writes three files per soup:
 * - <name>.bin: u32 triangleCount, i16 xyz * 3 per triangle, u8 rgba per triangle (first corner's color + alpha).
 *   Positions are RS fine units (128 = 1 tile = 1 meter) already in three.js axes: x east, y up, z south.
 *   Collision and anything that only needs geometry reads this.
 * - <name>.materials.bin: u16 per triangle, cache texture id + 1 (0 = untextured).
 * - <name>.shade.bin: u32 triangleCount, f32 uv * 6, u8 rgb * 9 (per corner, before lighting), i8 normal * 9 (three axes).
 */
function writeSoup(path: string, soup: Soup) {
  const n = soup.triangleCount;
  const P = soup.pos.view(), RGB = soup.rgb.view(), N = soup.normal.view(), UV = soup.uv.view(), A = soup.alpha.view(), T = soup.textures.view();
  const posBytes = n * 9 * 2;
  const buf = Buffer.alloc(4 + posBytes + n * 4);
  buf.writeUInt32LE(n, 0);
  const pos = new Int16Array(buf.buffer, buf.byteOffset + 4, n * 9);
  for (let i = 0; i < n * 3; i++) {
    pos[i * 3] = Math.round(P[i * 3]);
    pos[i * 3 + 1] = Math.round(-P[i * 3 + 1]);
    pos[i * 3 + 2] = Math.round(-P[i * 3 + 2]);
  }
  for (let t = 0; t < n; t++) {
    const o = 4 + posBytes + t * 4, rgb = RGB[t * 3];
    buf[o] = (rgb >> 16) & 0xff; buf[o + 1] = (rgb >> 8) & 0xff; buf[o + 2] = rgb & 0xff; buf[o + 3] = A[t];
  }
  writeFileSync(path, buf);
  const surfaces = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) surfaces.writeUInt16LE(T[i] + 1, i * 2);
  writeFileSync(path.replace('.bin', '.materials.bin'), surfaces);
  const shade = Buffer.alloc(4 + n * 24 + n * 18);
  shade.writeUInt32LE(n, 0);
  new Float32Array(shade.buffer, shade.byteOffset + 4, n * 6).set(UV);
  const rgbOut = new Uint8Array(shade.buffer, shade.byteOffset + 4 + n * 24, n * 9);
  const normalOut = new Int8Array(shade.buffer, shade.byteOffset + 4 + n * 33, n * 9);
  for (let i = 0; i < n * 3; i++) {
    const rgb = RGB[i];
    rgbOut[i * 3] = (rgb >> 16) & 0xff; rgbOut[i * 3 + 1] = (rgb >> 8) & 0xff; rgbOut[i * 3 + 2] = rgb & 0xff;
    normalOut[i * 3] = Math.round(N[i * 3] * 127);
    normalOut[i * 3 + 1] = Math.round(-N[i * 3 + 1] * 127);
    normalOut[i * 3 + 2] = Math.round(-N[i * 3 + 2] * 127);
  }
  writeFileSync(path.replace('.bin', '.shade.bin'), shade);
}
