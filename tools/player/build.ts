// Builds the player (body kits, a fashionscape item set, emote animations) and the NPCs the game brings to life,
// from any JS5 store. Platform-free: tools/export-player.ts and export-npcs.ts write the results to public/, the
// browser builds them in its cache worker (src/world/remote/cache-worker.ts).
import { Defs } from '../cache/defs.ts';
import type { Js5Store } from '../cache/js5.ts';
import { NpcDefs } from '../cache/npc-defs.ts';
import { PartBuilder } from '../cache/part-model.ts';
import { PlayerDefs, decodeFrame } from '../cache/player-defs.ts';
import { SOURCE_BODY_COLORS, DESTINATION_BODY_COLORS, SOURCE_SKIN_COLORS, DESTINATION_SKIN_COLORS } from '../cache/player-colors.ts';
import type { KitDef, ItemDef, Wardrobe, AnimData } from '../../src/shared/player-data.ts';
import type { NpcData, NpcSet } from '../../src/shared/npc-data.ts';

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

/** The server's item data (item_configs.json): the fields the wardrobe needs. */
export interface ItemConfig { id: string; name?: string; equipment_slot?: string; remove_head?: string; remove_beard?: string; remove_sleeves?: string }

export interface Log { log(message: string): void; warn(message: string): void }

/** Adds a sequence's frames (and their bases) to `anims`; false when frames are missing. */
function addSeq(anims: AnimData, pdefs: PlayerDefs, id: number, name: string) {
  if (id < 0) return false;
  if (anims.seqs.some((s) => s.id === id)) return true;
  let seq;
  try { seq = pdefs.seq(id); } catch { return false; }
  if (!seq.frames.length) return false;
  for (const packed of seq.frames) {
    const fsId = packed >>> 16, frameId = packed & 0xffff, fs = (anims.framesets[fsId] ??= {});
    if (fs[frameId]) continue;
    const data = pdefs.frameset(fsId)?.get(frameId);
    if (!data) return false;
    const baseId = (data[0] << 8) | data[1];
    const base = (anims.bases[baseId] ??= (() => { const b = pdefs.base(baseId); return { types: b.types, labels: b.labels }; })());
    fs[frameId] = decodeFrame(data, base, baseId);
  }
  anims.seqs.push({ id, name, frames: seq.frames, delays: seq.delays });
  return true;
}

export function buildPlayer(cache: Js5Store, configs: ItemConfig[], out: Log = console): { wardrobe: Wardrobe; anims: AnimData } {
  const defs = new Defs(cache), pdefs = new PlayerDefs(cache), parts = new PartBuilder(cache, defs);
  const part = parts.part.bind(parts);

  // ---- body kits ----
  const kits: KitDef[] = [];
  for (const id of pdefs.idkIds()) {
    const k = pdefs.idk(id);
    if (k.disabled || k.feature < 0 || k.models.length === 0) continue;
    const m = part(k.models, k.recolS, k.recolD, k.retexS, k.retexD);
    if (m) kits.push({ id, feature: k.feature, model: m });
  }
  out.log(`kits: ${kits.length}`);

  // ---- fashion items ----
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
      out.warn(`  skip ${cfg.name}: ${(e as Error).message}`);
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
  out.log(`items: ${items.length}`);

  const wardrobe: Wardrobe = {
    kits, items,
    sourceBody: SOURCE_BODY_COLORS, destBody: DESTINATION_BODY_COLORS,
    sourceSkin: SOURCE_SKIN_COLORS, destSkin: DESTINATION_SKIN_COLORS,
    textureBrightness: parts.textureBrightness,
  };

  // ---- animations ----
  const anims: AnimData = { seqs: [], framesets: {}, bases: {} };
  for (const [id, name] of ANIMS) {
    let seq;
    try {
      seq = pdefs.seq(id);
    } catch (e) {
      out.warn(`  skip anim ${name}: ${(e as Error).message}`);
      continue;
    }
    if (seq.frames.length === 0) continue;
    if (!addSeq(anims, pdefs, id, name)) out.warn(`  anim ${name} has missing frames`);
  }
  out.log(`anims: ${anims.seqs.map((s) => s.name).join(', ')}`);
  return { wardrobe, anims };
}

export function buildNpcs(cache: Js5Store, out: Log = console): NpcSet {
  const defs = new Defs(cache), npcDefs = new NpcDefs(cache), playerDefs = new PlayerDefs(cache), parts = new PartBuilder(cache, defs);
  const anims: AnimData = { seqs: [], framesets: {}, bases: {} };
  const npcs: Record<string, NpcData> = {};
  for (const [key, name] of Object.entries(NPCS)) {
    const id = npcDefs.find(name)[0];
    if (id === undefined) { out.warn(`  no NPC named ${name}`); continue; }
    const npc = npcDefs.npc(id);
    const model = parts.part(npc.models.filter((m) => m >= 0), npc.recolS, npc.recolD, npc.retexS, npc.retexD, undefined, [npc.resizeX, npc.resizeY, npc.resizeX]);
    if (!model) { out.warn(`  ${name}: model missing`); continue; }
    const bas = npc.bas >= 0 ? npcDefs.bas(npc.bas) : null;
    const idle = bas && addSeq(anims, playerDefs, bas.idle, `${key} idle`) ? bas.idle : undefined;
    const walk = bas && bas.walk !== bas.idle && addSeq(anims, playerDefs, bas.walk, `${key} walk`) ? bas.walk : undefined;
    npcs[key] = { name: npc.name, id, size: npc.size, ambient: npc.ambient, model, idle, walk };
    out.log(`${key}: ${npc.name} (npc ${id}) · ${model.t.length / 3} triangles${idle !== undefined ? ' · idle' : ''}${walk !== undefined ? ' · walk' : ''}`);
  }
  return { npcs, anims, textureBrightness: parts.textureBrightness };
}

/** The cache textures a wardrobe or NPC set draws with (export:surfaces collects the same ones). */
export function partTextures(json: string): number[] {
  const used = new Set<number>();
  for (const match of json.matchAll(/"x":\[([0-9,-]*)\]/g)) for (const v of match[1].split(',')) if (v !== '' && Number(v) >= 0) used.add(Number(v));
  return [...used].sort((a, b) => a - b);
}
