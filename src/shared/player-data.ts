// JSON shapes written by tools/export-player.ts and read by the browser.

/** A raw RS model part: positions in RS fine units (x east, y down, z north). */
export interface PartModel {
  /** xyz interleaved */
  v: number[];
  /** per-vertex animation label */
  b: number[];
  /** triangle vertex indices, abc interleaved */
  t: number[];
  /** per-triangle HSL16 color (textured faces already resolved to their average color) */
  c: number[];
  /** per-triangle render type (0 smooth, 1 flat, 2 hidden, 3 black); omitted = all 0 */
  i?: number[];
  /** per-triangle alpha (0 opaque .. 255 invisible); omitted = all 0 */
  a?: number[];
}

/** The 12 appearance slots of the 530 client. */
export const SLOT = {
  HEAD: 0,
  CAPE: 1,
  AMULET: 2,
  WEAPON: 3,
  TORSO: 4,
  SHIELD: 5,
  ARMS: 6,
  LEGS: 7,
  HAIR: 8,
  HANDS: 9,
  FEET: 10,
  JAW: 11,
} as const;

export interface KitDef {
  id: number;
  /** body feature: 0-6 male (hair, jaw, torso, arms, hands, legs, feet), 7-13 female */
  feature: number;
  model: PartModel;
}

export interface ItemDef {
  id: number;
  name: string;
  slot: number;
  hidesHair: boolean;
  hidesJaw: boolean;
  hidesArms: boolean;
  male: PartModel | null;
  female: PartModel | null;
}

export interface Wardrobe {
  kits: KitDef[];
  items: ItemDef[];
  /** recolor tables for the 5 player color slots: hair, torso, legs, feet, skin */
  sourceBody: number[];
  destBody: number[][];
  sourceSkin: number[];
  destSkin: number[][];
}

export interface AnimData {
  seqs: { id: number; name: string; frames: number[]; delays: number[] }[];
  /** frameset id -> frame id -> [baseId, ops] where op = [transformIndex, originIndex, x, y, z] */
  framesets: Record<number, Record<number, { base: number; ops: number[][] }>>;
  bases: Record<number, { types: number[]; labels: number[][] }>;
}
