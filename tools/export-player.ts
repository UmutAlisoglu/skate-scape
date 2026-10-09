// Exports player body kits, a fashionscape item set and emote animations for the browser.
// Usage: npm run export:player
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { CacheStore } from './cache/store.ts';
import { Defs, ARCHIVE } from './cache/defs.ts';
import { Model } from './cache/model.ts';
import { PlayerDefs, decodeFrame } from './cache/player-defs.ts';
import { SOURCE_BODY_COLORS, DESTINATION_BODY_COLORS, SOURCE_SKIN_COLORS, DESTINATION_SKIN_COLORS } from './cache/player-colors.ts';
import type { PartModel, KitDef, ItemDef, Wardrobe, AnimData } from '../src/shared/player-data.ts';

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
];

const cache = new CacheStore(CACHE_DIR);
const defs = new Defs(cache);
const pdefs = new PlayerDefs(cache);

const models = new Map<number, Model | null>();
const textureBrightness: Record<number, number> = {};
function model(id: number): Model | null {
  if (!models.has(id)) {
    const data = cache.file(ARCHIVE.MODELS, id);
    models.set(id, data ? Model.decode(data) : null);
  }
  const m = models.get(id);
  return m ? m.clone() : null;
}

function part(ids: number[], recolS: number[], recolD: number[], retexS: number[], retexD: number[], off?: [number, number, number]): PartModel | null {
  const parts = ids.map(model);
  if (parts.length === 0 || parts.some((p) => !p)) return null;
  const m = parts.length === 1 ? parts[0]! : Model.merge(parts as Model[]);
  if (off && (off[0] || off[1] || off[2])) m.translate(off[0], off[1], off[2]);
  for (let i = 0; i < recolS.length; i++) m.recolor(recolS[i], recolD[i]);
  for (let i = 0; i < retexS.length; i++) m.retexture(retexS[i], retexD[i]);
  return toPart(m);
}

function toPart(m: Model): PartModel {
  const v: number[] = [];
  for (let i = 0; i < m.vertexCount; i++) v.push(m.vx[i], m.vy[i], m.vz[i]);
  const t: number[] = [];
  for (let i = 0; i < m.triangleCount; i++) t.push(m.ta[i], m.tb[i], m.tc[i]);
  const c = Array.from(m.colors);
  const p: PartModel = { v, b: m.vertexBones ? Array.from(m.vertexBones) : new Array(m.vertexCount).fill(0), t, c };
  if (m.info) p.i = Array.from(m.info, (x) => x & 3);
  if (m.alpha) p.a = Array.from(m.alpha);
  if (m.textures) {
    // Keep real textures (drawn by the RS shader) with the client's per-face texture coordinates.
    const cfg = defs.textures;
    const x = Array.from(m.textures, (tex) => (tex >= 0 && tex < cfg.count && cfg.defined[tex] ? tex : -1));
    if (x.some((tex) => tex >= 0)) {
      const uvs = m.uvs();
      p.x = x;
      p.u = Array.from(uvs, (value) => Math.round(value * 1000) / 1000);
      for (const tex of x) if (tex >= 0) textureBrightness[tex] = cfg.brightness[tex];
    }
  }
  return p;
}

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
