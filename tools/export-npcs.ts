// Exports the NPCs the game brings to life (random events, pets, transport crews, the Skateboarding Guild) with
// their models (recoloured and resized like the client does) and their stand / walk animations
// (see tools/player/build.ts).
// Usage: npm run export:npcs
import { mkdirSync, writeFileSync } from 'node:fs';
import { CacheStore } from './cache/store.ts';
import { buildNpcs } from './player/build.ts';

const CACHE_DIR = 'vendor/2009scape-cache';
const OUT_DIR = 'public/npcs';

const out = buildNpcs(new CacheStore(CACHE_DIR));
mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(`${OUT_DIR}/npcs.json`, JSON.stringify(out));
console.log(`Wrote ${OUT_DIR}/npcs.json: ${Object.keys(out.npcs).length} NPCs, ${out.anims.seqs.length} animations`);
