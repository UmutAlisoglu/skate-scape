// Exports player body kits, a fashionscape item set and emote animations for the browser.
// Usage: npm run export:player
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { CacheStore } from './cache/store.ts';
import { Defs } from './cache/defs.ts';
import { PartBuilder } from './cache/part-model.ts';
import { PlayerDefs, decodeFrame } from './cache/player-defs.ts';
import { SOURCE_BODY_COLORS, DESTINATION_BODY_COLORS, SOURCE_SKIN_COLORS, DESTINATION_SKIN_COLORS } from './cache/player-colors.ts';
import type { KitDef, ItemDef, Wardrobe, AnimData } from '../src/shared/player-data.ts';

const CACHE_DIR = 'vendor/2009scape-cache';
const OUT_DIR = 'public/player';

// Items players love to show off. Patterns match 2009scape item names (case-insensitive).
const FASHION = [
  /^(red|yellow|blue|green|purple|white) partyhat$/, /^santa hat$/, /h'ween mask$/, /^bunny ears$/, /^scythe$/,
  /^(saradomin|guthix|zamorak) cape$/, /^fire cape$/, /^team-\d+ cape$/,
  /^rune (full helm|platebody|platelegs|kiteshield)( \((g|t)\))?$/, /^dragon (med helm|chainbody|platelegs|sq shield|boots|scimitar)$/,
  /^abyssal whip$/, /^granite maul$/, /^3rd age /, /^(bandos|armadyl) /,
  /^mime /, /^zombie (mask|shirt|trousers)$/, /^lederhosen /, /^camo /, /^skeleton (mask|shirt|leggings)$/,
  /^chicken (head|wings|legs|feet)$/, /^frog mask$/, /^ghostly /, /^ham (hood|shirt|robe)$/, /^highwayman mask$/,
  /cavalier$/, /^pirate (hat|bandana)/, /^eye ?patch$/, /^wizard hat \(g\)$/, /^gnome scarf$/, /^bobble hat$/,
  /^(tri-)?jester hat$/, /^woolly hat$/, /^rainbow scarf$/, /^flared trousers$/, /^(prince tunic|princess blouse)$/,
  /^reindeer hat$/, /^rubber chicken$/, /^easter ring$/, /^yo-yo$/, /^black beret$/, /^boots of lightness$/,
  /^climbing boots$/, /^rock-shell helm$/, /^tan cavalier$/, /^(black|blue|white|red) wizard (hat|robe)/,
];

// Emotes and moves we want on the skater for now (ids from the 530 seq archive).
const ANIMS: [number, string][] = [
  [808, 'Idle'], [819, 'Walk'], [824, 'Run'], [714, 'Teleport'], [2106, 'Jig'], [2107, 'Spin'], [2108, 'Headbang'],
  [2109, 'Jump for joy'], [862, 'Cheer'], [866, 'Dance'], [3543, 'Zombie dance'], [6111, 'Rabbit hop'],
  [863, 'Wave'], [858, 'Bow'], [2110, 'Raspberry'], [1131, 'Glass box'], [4278, 'Air guitar'],
  // bails use the player death animation; the rest are extra emotes
  [836, 'Death'], [2111, 'Yawn'], [865, 'Clap'], [861, 'Laugh'], [2113, 'Shrug'], [2105, 'Panic'],
];

const cache = new CacheStore(CACHE_DIR);
const defs = new Defs(cache);
const pdefs = new PlayerDefs(cache);

const parts = new PartBuilder(cache, defs);
const textureBrightness = parts.textureBrightness;
const part = parts.part.bind(parts);

// ---- body kits ----
const kits: KitDef[] = [];
for (const id of pdefs.idkIds()) {
  const k = pdefs.idk(id);
  if (k.disabled || k.feature < 0 || k.models.length === 0) continue;
  const m = part(k.models, k.recolS, k.recolD, k.retexS, k.retexD);
  if (m) kits.push({ id, feature: k.feature, model: m });
}
console.log(`kits: ${kits.length}`);

// ---- fashion items ----
interface ItemConfig {
  id: string;
  name?: string;
  equipment_slot?: string;
  remove_head?: string;
  remove_beard?: string;
  remove_sleeves?: string;
}
const configs = JSON.parse(readFileSync(`${CACHE_DIR}/item_configs.json`, 'utf8')) as ItemConfig[];
const items: ItemDef[] = [];
const seenNames = new Set<string>();
for (const cfg of configs) {
  if (cfg.equipment_slot === undefined || !cfg.name) continue;
  const name = cfg.name.toLowerCase();
  if (seenNames.has(name) || !FASHION.some((re) => re.test(name))) continue;
  const slot = Number(cfg.equipment_slot);
  if (slot > 11) continue; // rings / ammo aren't visible
  const id = Number(cfg.id);
  let obj;
  try {
    obj = pdefs.obj(id);
  } catch (e) {
    console.warn(`  skip ${cfg.name}: ${(e as Error).message}`);
    continue;
  }
  const male = obj.manwear.length ? part(obj.manwear, obj.recolS, obj.recolD, obj.retexS, obj.retexD, obj.manOff) : null;
  const female = obj.womanwear.length ? part(obj.womanwear, obj.recolS, obj.recolD, obj.retexS, obj.retexD, obj.womanOff) : null;
  if (!male && !female) continue;
  seenNames.add(name);
  items.push({
    id, name: cfg.name, slot,
    hidesHair: cfg.remove_head === 'true',
    hidesJaw: cfg.remove_beard === 'true',
    hidesArms: cfg.remove_sleeves === 'true',
    male, female,
  });
}
console.log(`items: ${items.length}`);

const wardrobe: Wardrobe = {
  kits, items,
  sourceBody: SOURCE_BODY_COLORS, destBody: DESTINATION_BODY_COLORS,
  sourceSkin: SOURCE_SKIN_COLORS, destSkin: DESTINATION_SKIN_COLORS,
  textureBrightness,
};

// ---- animations ----
const anims: AnimData = { seqs: [], framesets: {}, bases: {} };
for (const [id, name] of ANIMS) {
  let seq;
  try {
    seq = pdefs.seq(id);
  } catch (e) {
    console.warn(`  skip anim ${name}: ${(e as Error).message}`);
    continue;
  }
  if (seq.frames.length === 0) continue;
  let ok = true;
  for (const packed of seq.frames) {
    const fsId = packed >>> 16;
    const frameId = packed & 0xffff;
    const fs = (anims.framesets[fsId] ??= {});
    if (fs[frameId]) continue;
    const files = pdefs.frameset(fsId);
    const data = files?.get(frameId);
    if (!data) {
      ok = false;
      break;
    }
    const baseId = (data[0] << 8) | data[1];
    const base = (anims.bases[baseId] ??= (() => {
      const b = pdefs.base(baseId);
      return { types: b.types, labels: b.labels };
    })());
    fs[frameId] = decodeFrame(data, base, baseId);
  }
  if (ok) anims.seqs.push({ id, name, frames: seq.frames, delays: seq.delays });
  else console.warn(`  anim ${name} has missing frames`);
}
console.log(`anims: ${anims.seqs.map((s) => s.name).join(', ')}`);

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(`${OUT_DIR}/wardrobe.json`, JSON.stringify(wardrobe));
writeFileSync(`${OUT_DIR}/anims.json`, JSON.stringify(anims));
console.log(`Wrote ${OUT_DIR}`);
