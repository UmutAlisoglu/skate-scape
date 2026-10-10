// Exports the NPCs the game brings to life (random events, pets, transport crews, the Skateboarding Guild) with
// their models (recoloured and resized like the client does) and their stand / walk animations.
// Usage: npm run export:npcs
import { mkdirSync, writeFileSync } from 'node:fs';
import { CacheStore } from './cache/store.ts';
import { Defs } from './cache/defs.ts';
import { NpcDefs } from './cache/npc-defs.ts';
import { PartBuilder } from './cache/part-model.ts';
import { PlayerDefs, decodeFrame } from './cache/player-defs.ts';
import type { AnimData } from '../src/shared/player-data.ts';
import type { NpcData, NpcSet } from '../src/shared/npc-data.ts';

const CACHE_DIR = 'vendor/2009scape-cache';
const OUT_DIR = 'public/npcs';

/** key -> cache NPC name (the first config with that name and a model) */
const NPCS: Record<string, string> = {
  // random events
  evilchicken: 'Evil Chicken', genie: 'Genie', sandwichlady: 'Sandwich lady', drunkendwarf: 'Drunken Dwarf',
  rickturpentine: 'Rick Turpentine', oldman: 'Mysterious Old Man',
  // pets
  kitten: 'Kitten', cat: 'Cat', babyreddragon: 'Baby red dragon', babybluedragon: 'Baby blue dragon', penguin: 'Penguin',
  monkey: 'Monkey', squirrel: 'Squirrel', raccoon: 'Raccoon', imp: 'Imp', duck: 'Duck', chicken: 'Chicken',
  // transport crews and the guild
  gnome: 'Gnome', auguste: 'Auguste', dwarf: 'Dwarf', doomsayer: 'Doomsayer',
};

const cache = new CacheStore(CACHE_DIR);
const defs = new Defs(cache), npcDefs = new NpcDefs(cache), playerDefs = new PlayerDefs(cache);
const parts = new PartBuilder(cache, defs);
const anims: AnimData = { seqs: [], framesets: {}, bases: {} };

/** Adds a sequence's frames (and their bases) to the shared animation data; false when frames are missing. */
function addSeq(id: number, name: string) {
  if (id < 0) return false;
  if (anims.seqs.some((s) => s.id === id)) return true;
  let seq;
  try { seq = playerDefs.seq(id); } catch { return false; }
  if (!seq.frames.length) return false;
  for (const packed of seq.frames) {
    const fsId = packed >>> 16, frameId = packed & 0xffff, fs = (anims.framesets[fsId] ??= {});
    if (fs[frameId]) continue;
    const data = playerDefs.frameset(fsId)?.get(frameId);
    if (!data) return false;
    const baseId = (data[0] << 8) | data[1];
    const base = (anims.bases[baseId] ??= (() => { const b = playerDefs.base(baseId); return { types: b.types, labels: b.labels }; })());
    fs[frameId] = decodeFrame(data, base, baseId);
  }
  anims.seqs.push({ id, name, frames: seq.frames, delays: seq.delays });
  return true;
}

const npcs: Record<string, NpcData> = {};
for (const [key, name] of Object.entries(NPCS)) {
  const id = npcDefs.find(name)[0];
  if (id === undefined) { console.warn(`  no NPC named ${name}`); continue; }
  const npc = npcDefs.npc(id);
  const model = parts.part(npc.models.filter((m) => m >= 0), npc.recolS, npc.recolD, npc.retexS, npc.retexD, undefined, [npc.resizeX, npc.resizeY, npc.resizeX]);
  if (!model) { console.warn(`  ${name}: model missing`); continue; }
  const bas = npc.bas >= 0 ? npcDefs.bas(npc.bas) : null;
  const idle = bas && addSeq(bas.idle, `${key} idle`) ? bas.idle : undefined;
  const walk = bas && bas.walk !== bas.idle && addSeq(bas.walk, `${key} walk`) ? bas.walk : undefined;
  npcs[key] = { name: npc.name, id, size: npc.size, ambient: npc.ambient, model, idle, walk };
  console.log(`${key}: ${npc.name} (npc ${id}) · ${model.t.length / 3} triangles${idle !== undefined ? ' · idle' : ''}${walk !== undefined ? ' · walk' : ''}`);
}

const out: NpcSet = { npcs, anims, textureBrightness: parts.textureBrightness };
mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(`${OUT_DIR}/npcs.json`, JSON.stringify(out));
console.log(`Wrote ${OUT_DIR}/npcs.json: ${Object.keys(npcs).length} NPCs, ${anims.seqs.length} animations`);
