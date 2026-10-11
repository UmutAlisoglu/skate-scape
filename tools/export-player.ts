// Exports player body kits, a fashionscape item set and emote animations for the browser (see tools/player/build.ts).
// Usage: npm run export:player
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { CacheStore } from './cache/store.ts';
import { buildPlayer, type ItemConfig } from './player/build.ts';

const CACHE_DIR = 'vendor/2009scape-cache';
const OUT_DIR = 'public/player';

const cache = new CacheStore(CACHE_DIR);
const configs = JSON.parse(readFileSync(`${CACHE_DIR}/item_configs.json`, 'utf8')) as ItemConfig[];
const { wardrobe, anims } = buildPlayer(cache, configs);

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(`${OUT_DIR}/wardrobe.json`, JSON.stringify(wardrobe));
writeFileSync(`${OUT_DIR}/anims.json`, JSON.stringify(anims));
console.log(`Wrote ${OUT_DIR}`);
