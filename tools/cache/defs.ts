// Config decoders for the parts of the 530 cache the world exporter needs.
import { Reader } from './reader.ts';
import type { CacheStore } from './store.ts';
import { rgbToHsl } from '../../src/shared/color.ts';

export const ARCHIVE = {
  CONFIG: 2,
  MAPS: 5,
  MODELS: 7,
  LOCS: 16,
  OBJS: 19,
  TEXTURE_CONFIG: 26,
} as const;

// ---- underlays (FluType) ----
export interface FluType {
  rgb: number;
  hue: number; // weighted by chroma, as in the client
  saturation: number;
  lightness: number;
  chroma: number;
  texture: number;
}

function decodeFlu(data: Uint8Array): FluType {
  const t: FluType = { rgb: 0, hue: 0, saturation: 0, lightness: 0, chroma: 1, texture: -1 };
  const r = new Reader(data);
  for (;;) {
    const op = r.g1();
    if (op === 0) break;
    if (op === 1) {
      t.rgb = r.g3();
      Object.assign(t, underlayHsl(t.rgb));
    } else if (op === 2) {
      t.texture = r.g2();
      if (t.texture === 65535) t.texture = -1;
    } else if (op === 3) r.g2();
  }
  return t;
}

function underlayHsl(rgb: number) {
  const red = ((rgb >> 16) & 0xff) / 256;
  const green = ((rgb >> 8) & 0xff) / 256;
  const blue = (rgb & 0xff) / 256;
  const min = Math.min(red, green, blue);
  const max = Math.max(red, green, blue);
  let hue = 0;
  let sat = 0;
  const lum = (max + min) / 2;
  if (min !== max) {
    sat = lum < 0.5 ? (max - min) / (max + min) : (max - min) / (2 - max - min);
    if (max === red) hue = (green - blue) / (max - min);
    else if (max === green) hue = (blue - red) / (max - min) + 2;
    else hue = (red - green) / (max - min) + 4;
  }
  let chroma = Math.trunc(lum > 0.5 ? sat * (1 - lum) * 512 : sat * lum * 512);
  if (chroma < 1) chroma = 1;
  const saturation = Math.min(255, Math.max(0, Math.trunc(sat * 256)));
  const lightness = Math.min(255, Math.max(0, Math.trunc(lum * 256)));
  return { hue: Math.trunc(chroma * (hue / 6)), saturation, lightness, chroma };
}

// ---- overlays (FloType) ----
export interface FloType {
  color: number; // packed HSL16, -1 = invisible
  secondaryColor: number;
  texture: number;
  occludeUnderlay: boolean;
}

function decodeFlo(data: Uint8Array): FloType {
  const t: FloType = { color: 0, secondaryColor: -1, texture: -1, occludeUnderlay: true };
  const r = new Reader(data);
  const color = (rgb: number) => (rgb === 0xff00ff ? -1 : rgbToHsl(rgb));
  for (;;) {
    const op = r.g1();
    if (op === 0) break;
    if (op === 1) t.color = color(r.g3());
    else if (op === 2) t.texture = r.g1();
    else if (op === 3) {
      t.texture = r.g2();
      if (t.texture === 65535) t.texture = -1;
    } else if (op === 5) t.occludeUnderlay = false;
    else if (op === 7) t.secondaryColor = color(r.g3());
    else if (op === 9) r.g2();
    else if (op === 11) r.g1();
    else if (op === 13) r.g3();
    else if (op === 14) r.g1();
    // 8, 10, 12 carry no payload
  }
  return t;
}

// ---- locs (LocType) ----
export interface LocType {
  id: number;
  name: string;
  models: number[] | null;
  shapes: number[] | null;
  width: number;
  length: number;
  blockwalk: number;
  hillskew: number;
  walloff: number;
  mirror: boolean;
  resizeX: number;
  resizeY: number;
  resizeZ: number;
  offX: number;
  offY: number;
  offZ: number;
  recolS: number[] | null;
  recolD: number[] | null;
  retexS: number[] | null;
  retexD: number[] | null;
  ops: (string | null)[];
  multiLocs: number[] | null;
}

function decodeLoc(id: number, data: Uint8Array): LocType {
  const t: LocType = {
    id, name: 'null', models: null, shapes: null, width: 1, length: 1, blockwalk: 2, hillskew: 0,
    walloff: 16, mirror: false, resizeX: 128, resizeY: 128, resizeZ: 128, offX: 0, offY: 0, offZ: 0,
    recolS: null, recolD: null, retexS: null, retexD: null, ops: [null, null, null, null, null], multiLocs: null,
  };
  const r = new Reader(data);
  for (;;) {
    const op = r.g1();
    if (op === 0) break;
    if (op === 1) {
      const n = r.g1();
      if (n > 0) {
        t.models = [];
        t.shapes = [];
        for (let i = 0; i < n; i++) {
          t.models.push(r.g2());
          t.shapes.push(r.g1());
        }
      }
    } else if (op === 2) t.name = r.gjstr();
    else if (op === 5) {
      const n = r.g1();
      if (n > 0) {
        t.models = [];
        t.shapes = null;
        for (let i = 0; i < n; i++) t.models.push(r.g2());
      }
    } else if (op === 14) t.width = r.g1();
    else if (op === 15) t.length = r.g1();
    else if (op === 17) t.blockwalk = 0;
    else if (op === 18) {
      // blockrange = false
    } else if (op === 19) r.g1();
    else if (op === 21) t.hillskew = 1;
    else if (op === 22 || op === 23) {
      // sharelight / occlude
    } else if (op === 24) r.g2();
    else if (op === 27) t.blockwalk = 1;
    else if (op === 28) t.walloff = r.g1();
    else if (op === 29) r.g1();
    else if (op === 39) r.g1();
    else if (op >= 30 && op < 35) {
      const s = r.gjstr();
      t.ops[op - 30] = s.toLowerCase() === 'hidden' ? null : s;
    } else if (op === 40) {
      const n = r.g1();
      t.recolS = [];
      t.recolD = [];
      for (let i = 0; i < n; i++) {
        t.recolS.push(r.g2());
        t.recolD.push(r.g2());
      }
    } else if (op === 41) {
      const n = r.g1();
      t.retexS = [];
      t.retexD = [];
      for (let i = 0; i < n; i++) {
        t.retexS.push(r.g2());
        t.retexD.push(r.g2());
      }
    } else if (op === 42) {
      const n = r.g1();
      r.pos += n;
    }
    else if (op === 60) r.g2();
    else if (op === 62) t.mirror = true;
    else if (op === 64) {
      // not active
    } else if (op === 65) t.resizeX = r.g2();
    else if (op === 66) t.resizeY = r.g2();
    else if (op === 67) t.resizeZ = r.g2();
    else if (op === 69) r.g1();
    else if (op === 70) t.offX = r.g2b();
    else if (op === 71) t.offY = r.g2b();
    else if (op === 72) t.offZ = r.g2b();
    else if (op === 73 || op === 74) {
      // forcedecor / breakroutefinding
    } else if (op === 75) r.g1();
    else if (op === 77 || op === 92) {
      r.g2();
      r.g2();
      let fallback = -1;
      if (op === 92) {
        fallback = r.g2();
        if (fallback === 65535) fallback = -1;
      }
      const n = r.g1();
      t.multiLocs = [];
      for (let i = 0; i <= n; i++) {
        const v = r.g2();
        t.multiLocs.push(v === 65535 ? -1 : v);
      }
      t.multiLocs.push(fallback);
    } else if (op === 78) {
      r.g2();
      r.g1();
    } else if (op === 79) {
      r.g2();
      r.g2();
      r.g1();
      const n = r.g1();
      r.pos += n * 2;
    } else if (op === 81) {
      t.hillskew = 2;
      r.g1();
    } else if (op === 82 || op === 88 || op === 89 || op === 90 || op === 91) {
      // flags
    } else if (op === 93) {
      t.hillskew = 3;
      r.g2();
    } else if (op === 94) t.hillskew = 4;
    else if (op === 95) t.hillskew = 5;
    else if (op === 96 || op === 97 || op === 98) {
      // flags
    } else if (op === 99 || op === 100) {
      r.g1();
      r.g2();
    } else if (op === 101) r.g1();
    else if (op === 102) r.g2();
    else if (op === 249) {
      const n = r.g1();
      for (let i = 0; i < n; i++) {
        const isString = r.g1() === 1;
        r.g3();
        if (isString) r.gjstr();
        else r.g4();
      }
    } else throw new Error(`loc ${id}: unknown opcode ${op}`);
  }
  return t;
}

export class Defs {
  private flu = new Map<number, FluType>();
  private flo = new Map<number, FloType>();
  private locs = new Map<number, LocType>();
  readonly textureColors: Uint16Array;

  constructor(private cache: CacheStore) {
    this.textureColors = decodeTextureColors(cache.file(ARCHIVE.TEXTURE_CONFIG, 0, 0)!);
  }

  underlay(id: number) {
    let t = this.flu.get(id);
    if (!t) this.flu.set(id, (t = decodeFlu(this.cache.file(ARCHIVE.CONFIG, 1, id)!)));
    return t;
  }

  overlay(id: number) {
    let t = this.flo.get(id);
    if (!t) this.flo.set(id, (t = decodeFlo(this.cache.file(ARCHIVE.CONFIG, 4, id)!)));
    return t;
  }

  loc(id: number) {
    let t = this.locs.get(id);
    if (!t) this.locs.set(id, (t = decodeLoc(id, this.cache.file(ARCHIVE.LOCS, id >>> 8, id & 0xff)!)));
    return t;
  }
}

/** Average HSL16 color per texture id (archive 26), used where we don't render real textures yet. */
function decodeTextureColors(data: Uint8Array): Uint16Array {
  const r = new Reader(data);
  const count = r.g2();
  const defined: boolean[] = [];
  for (let i = 0; i < count; i++) defined.push(r.g1() === 1);
  const definedCount = defined.filter(Boolean).length;
  // repeating, opaque, lowDetail, flipped, scroll, brightness, material, animation: one byte each per defined texture
  r.pos += definedCount * 8;
  const colors = new Uint16Array(count);
  for (let i = 0; i < count; i++) if (defined[i]) colors[i] = r.g2();
  return colors;
}
