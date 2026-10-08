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

const terrain = buildTerrain(grid, defs);
const { soup: locs, placed } = new LocBuilder(cache, defs).build(grid);
console.log(`Terrain: ${terrain.triangleCount} triangles, locs: ${locs.triangleCount} triangles (${placed.length} placed)`);

const dir = join(OUT_DIR, name);
mkdirSync(dir, { recursive: true });
writeSoup(join(dir, 'terrain.bin'), terrain);
writeSoup(join(dir, 'locs.bin'), locs);
writeFileSync(
  join(dir, 'manifest.json'),
  JSON.stringify({
    name,
    baseTile: [grid.baseX, grid.baseY],
    sizeTiles: [grid.width, grid.height],
    spawn: [area.spawn[0] - grid.baseX, area.spawn[1] - grid.baseY],
    // per-loc metadata, used later for auto-generated rails / wallrides
    locs: placed.map((p) => ({ id: p.id, name: p.name, type: p.type, rot: p.rot, plane: p.plane, x: p.x, y: p.y, t: [p.firstTriangle, p.triangleCount] })),
  }),
);
console.log(`Wrote ${dir}`);

/**
 * Binary layout: u32 triangleCount, i16 xyz * 3 per triangle, u8 rgba per triangle.
 * Positions are RS fine units (128 = 1 tile = 1 meter) already in three.js axes: x east, y up, z south.
 */
function writeSoup(path: string, soup: Soup) {
  const n = soup.triangleCount;
  const posBytes = n * 9 * 2;
  const buf = Buffer.alloc(4 + posBytes + n * 4);
  buf.writeUInt32LE(n, 0);
  const pos = new Int16Array(buf.buffer, buf.byteOffset + 4, n * 9);
  for (let i = 0; i < n * 3; i++) {
    pos[i * 3] = Math.round(soup.pos[i * 3]);
    pos[i * 3 + 1] = Math.round(-soup.pos[i * 3 + 1]);
    pos[i * 3 + 2] = Math.round(-soup.pos[i * 3 + 2]);
  }
  Buffer.from(soup.col).copy(buf, 4 + posBytes);
  writeFileSync(path, buf);
}
