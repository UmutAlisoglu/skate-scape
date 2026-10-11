// Exports a rectangle of 2009scape map regions as a streamed, browser-ready world into public/world/<area>/, block by
// block (see tools/world/area-export.ts for the formats). Finished blocks are remembered in work/world/<area>/blocks,
// so an interrupted export picks up where it stopped.
// Usage: npm run export:world -- <area> [--fresh] [--trees=full]      (then npm run export:surfaces)
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { CacheStore, type Xtea } from './cache/store.ts';
import { Defs } from './cache/defs.ts';
import { LocBuilder } from './world/mesh.ts';
import { AREAS, AreaExport, type BlockOutput, type BlockResult } from './world/area-export.ts';
import { encodePng } from './png.ts';

const CACHE_DIR = 'vendor/2009scape-cache';

const name = process.argv[2] ?? 'lumbridge';
const area = AREAS[name];
if (!area) throw new Error(`unknown area "${name}", choose one of: ${Object.keys(AREAS).join(', ')}`);
const fresh = process.argv.includes('--fresh');
const treeDensity = process.argv.includes('--trees=full') ? 1 : 0.35;
const base = `public/world/${name}`, work = `work/world/${name}`, blockDir = join(work, 'blocks');

if (fresh) for (const dir of [`${base}/render`, `${base}/collision`, `${base}/minimap`, blockDir]) rmSync(dir, { recursive: true, force: true });
// files from the old whole-area exporters
for (const file of [`${base}/terrain.bin`, `${base}/rails.json`, `${base}/minimap.png`, `${work}/locs.bin`, `${work}/locs.json`, `${work}/locs.materials.bin`, `${work}/locs.shade.bin`, `${work}/terrain.materials.bin`, `${work}/terrain.shade.bin`]) rmSync(file, { force: true });
for (const dir of [`${base}/render`, `${base}/collision`, `${base}/minimap`, blockDir]) mkdirSync(dir, { recursive: true });

console.log(`Reading cache from ${CACHE_DIR}`);
const cache = new CacheStore(CACHE_DIR);
const defs = new Defs(cache);
const xteas = new Map<number, Xtea>();
for (const x of JSON.parse(readFileSync(join(CACHE_DIR, 'xteas.json'), 'utf8')).xteas as { regionId: string; keys: string }[]) xteas.set(Number(x.regionId), x.keys.split(',').map(Number) as Xtea);
const warned = new Set<string>();
const warn = (message: string) => { if (!warned.has(message)) { warned.add(message); console.warn(message); } };
const exporter = new AreaExport({
  name, area, cache, defs, builder: new LocBuilder(cache, defs), xteas, treeDensity, encodePng, log: console.log, warn,
  files: {
    write: (path, data) => { const file = join(base, path); mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, data); },
    read: (path) => readFileSync(join(base, path)),
  },
});

const { blocksX, blocksY } = exporter;
const started = performance.now();
for (let by = 0; by < blocksY; by++) for (let bx = 0; bx < blocksX; bx++) {
  const key = `${bx}_${by}`;
  if (existsSync(join(blockDir, `${key}.json`))) continue;
  const t0 = performance.now();
  const { result, traversal, heights, overview } = exporter.exportBlock(bx, by);
  writeFileSync(join(blockDir, `${key}.traversal.bin`), traversal);
  writeFileSync(join(blockDir, `${key}.heights.bin`), Buffer.from(heights.buffer));
  writeFileSync(join(blockDir, `${key}.overview.bin`), overview);
  writeFileSync(join(blockDir, `${key}.json`), JSON.stringify(result));
  const done = by * blocksX + bx + 1, s = result.stats;
  console.log(`block ${key} (${done}/${blocksX * blocksY}): ${s.terrain.toLocaleString()} terrain + ${s.locs.toLocaleString()} object triangles, ${result.chunks.length} render chunks, ${result.cells.length} cells, ${s.rails} grind lines · ${((performance.now() - t0) / 1000).toFixed(1)} s`);
}
const { textures } = exporter.assemble((bx, by): BlockOutput => {
  const k = `${bx}_${by}`, h = readFileSync(join(blockDir, `${k}.heights.bin`));
  return {
    result: JSON.parse(readFileSync(join(blockDir, `${k}.json`), 'utf8')) as BlockResult,
    traversal: readFileSync(join(blockDir, `${k}.traversal.bin`)),
    heights: new Float32Array(h.buffer.slice(h.byteOffset, h.byteOffset + h.length)),
    overview: readFileSync(join(blockDir, `${k}.overview.bin`)),
  };
});
writeFileSync(`${work}/textures.json`, JSON.stringify(textures));
const chunkCount = (JSON.parse(readFileSync(`${base}/render/manifest.json`, 'utf8')) as { chunks: unknown[] }).chunks.length;
const leftovers = readdirSync(`${base}/render`).length - chunkCount - 1;
if (leftovers > 0) console.warn(`  ${leftovers} render files are not in the manifest (run with --fresh to clear them)`);
console.log(`Done in ${((performance.now() - started) / 60000).toFixed(1)} min`);
