// Renders every cache texture with the TypeScript port of the client's texture generator (tools/texgen/*.ts) and
// compares it pixel by pixel with the Java renders export:surfaces leaves in work/texgen/out.
// Usage: npx tsx tools/check-textures.ts [ids...]
import { existsSync, readFileSync } from 'node:fs';
import { CacheStore } from './cache/store.ts';
import { TextureGenerator } from './texgen/texture.ts';

const cache = new CacheStore('vendor/2009scape-cache');
const OUT = 'work/texgen/out';
if (!existsSync(OUT)) throw new Error(`Run npm run export:surfaces first: ${OUT} holds the Java renders to compare with.`);
const generator = new TextureGenerator(128, (id) => cache.file(9, id), (id) => cache.file(8, id));
const ids = process.argv.slice(2).map(Number);
const list = ids.length ? ids : cache.index(9).groupIds;
let same = 0, failed = 0, worst = 0;
const differing: string[] = [];
const t0 = performance.now();
for (const id of list) {
  const file = `${OUT}/${id}.rgba`;
  let rendered;
  try { rendered = generator.render(id); } catch (e) { failed++; differing.push(`${id} (threw: ${(e as Error).message})`); continue; }
  if (!rendered || !existsSync(file)) { if (rendered || existsSync(file)) differing.push(`${id} (only one side rendered)`); continue; }
  const expected = readFileSync(file), got = rendered.rgba;
  let diff = 0, max = 0;
  for (let i = 0; i < got.length; i++) { const d = Math.abs(got[i] - expected[i]); if (d) { diff++; max = Math.max(max, d); } }
  if (diff === 0) same++;
  else { differing.push(`${id} (${(diff / got.length * 100).toFixed(2)}% of channels, max ${max})`); worst = Math.max(worst, max); }
}
console.log(`${list.length} textures in ${((performance.now() - t0) / 1000).toFixed(1)} s: ${same} identical, ${differing.length - failed} differ, ${failed} threw`);
for (const line of differing.slice(0, 40)) console.log(`  ${line}`);
if (differing.length) process.exit(1);
