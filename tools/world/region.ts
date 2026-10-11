// Loads a rectangular block of 64x64 map regions into one tile grid (all 4 planes).
import { Reader } from '../cache/reader.ts';
import { ARCHIVE } from '../cache/defs.ts';
import type { Js5Store, Xtea } from '../cache/js5.ts';

export interface LocSpawn {
  id: number;
  type: number;
  rot: number;
  plane: number;
  /** tile coords relative to the grid origin */
  x: number;
  y: number;
}

export class TileGrid {
  readonly width: number; // in tiles
  readonly height: number;
  /** heights are stored at tile corners: (width + 1) x (height + 1) per plane */
  readonly heights: Int32Array[];
  readonly underlays: Uint8Array[];
  readonly overlays: Uint8Array[];
  readonly shapes: Uint8Array[];
  readonly rotations: Uint8Array[];
  readonly flags: Uint8Array[];
  readonly locs: LocSpawn[] = [];
  /** world tile coordinate of grid (0, 0) */
  readonly baseX: number;
  readonly baseY: number;

  constructor(
    readonly regionX0: number,
    readonly regionY0: number,
    readonly regionsW: number,
    readonly regionsH: number,
  ) {
    this.width = regionsW * 64;
    this.height = regionsH * 64;
    this.baseX = regionX0 * 64;
    this.baseY = regionY0 * 64;
    const n = this.width * this.height;
    const cn = (this.width + 1) * (this.height + 1);
    this.heights = [0, 1, 2, 3].map(() => new Int32Array(cn));
    this.underlays = [0, 1, 2, 3].map(() => new Uint8Array(n));
    this.overlays = [0, 1, 2, 3].map(() => new Uint8Array(n));
    this.shapes = [0, 1, 2, 3].map(() => new Uint8Array(n));
    this.rotations = [0, 1, 2, 3].map(() => new Uint8Array(n));
    this.flags = [0, 1, 2, 3].map(() => new Uint8Array(n));
  }

  ti(x: number, y: number) {
    return x + y * this.width;
  }
  /** height (RS units, negative = up) at a tile corner, clamped to the grid */
  h(plane: number, x: number, y: number) {
    x = Math.max(0, Math.min(this.width, x));
    y = Math.max(0, Math.min(this.height, y));
    return this.heights[plane][x + y * (this.width + 1)];
  }
  /** bilinear height at a fine (1/128 tile) position relative to the grid */
  heightAt(plane: number, fineX: number, fineY: number) {
    const tx = Math.floor(fineX / 128);
    const ty = Math.floor(fineY / 128);
    const fx = fineX / 128 - tx;
    const fy = fineY / 128 - ty;
    const a = this.h(plane, tx, ty) * (1 - fx) + this.h(plane, tx + 1, ty) * fx;
    const b = this.h(plane, tx, ty + 1) * (1 - fx) + this.h(plane, tx + 1, ty + 1) * fx;
    return a * (1 - fy) + b * fy;
  }

  /** Reads the regions' tiles and (unless `withLocs` is false) their object spawns. */
  load(cache: Js5Store, xteas: Map<number, Xtea>, warn: (message: string) => void = console.warn, withLocs = true) {
    for (let ry = 0; ry < this.regionsH; ry++) {
      for (let rx = 0; rx < this.regionsW; rx++) {
        const regionX = this.regionX0 + rx;
        const regionY = this.regionY0 + ry;
        const mGroup = cache.groupId(ARCHIVE.MAPS, `m${regionX}_${regionY}`);
        if (mGroup === undefined) continue;
        const mData = cache.file(ARCHIVE.MAPS, mGroup);
        if (mData) this.readTiles(mData, rx * 64, ry * 64);
      }
    }
    // fill the extra corner row/column
    for (let p = 0; p < 4; p++) {
      const H = this.heights[p];
      const W1 = this.width + 1;
      for (let y = 0; y <= this.height; y++) H[this.width + y * W1] = H[this.width - 1 + y * W1];
      for (let x = 0; x <= this.width; x++) H[x + this.height * W1] = H[x + (this.height - 1) * W1];
    }
    if (!withLocs) return;
    for (let ry = 0; ry < this.regionsH; ry++) {
      for (let rx = 0; rx < this.regionsW; rx++) {
        const regionX = this.regionX0 + rx;
        const regionY = this.regionY0 + ry;
        const lGroup = cache.groupId(ARCHIVE.MAPS, `l${regionX}_${regionY}`);
        if (lGroup === undefined) continue;
        const key = xteas.get((regionX << 8) | regionY);
        const lData = cache.file(ARCHIVE.MAPS, lGroup, 0, key);
        if (lData) this.readLocs(lData, rx * 64, ry * 64);
        else warn(`  locs for region ${regionX},${regionY} unavailable (missing/invalid XTEA key)`);
      }
    }
  }

  private readTiles(data: Uint8Array, ox: number, oy: number) {
    const r = new Reader(data);
    const W1 = this.width + 1;
    for (let plane = 0; plane < 4; plane++) {
      for (let x = 0; x < 64; x++) {
        for (let y = 0; y < 64; y++) {
          const gx = ox + x;
          const gy = oy + y;
          const t = this.ti(gx, gy);
          const hi = gx + gy * W1;
          for (;;) {
            const op = r.g1();
            if (op === 0) {
              if (plane === 0) {
                this.heights[0][hi] = -perlinHeight(this.baseX + gx + 932731, this.baseY + gy + 556238) * 8;
              } else {
                this.heights[plane][hi] = this.heights[plane - 1][hi] - 240;
              }
              break;
            }
            if (op === 1) {
              let height = r.g1();
              if (height === 1) height = 0;
              if (plane === 0) this.heights[0][hi] = -height * 8;
              else this.heights[plane][hi] = this.heights[plane - 1][hi] - height * 8;
              break;
            }
            if (op <= 49) {
              this.overlays[plane][t] = r.g1();
              this.shapes[plane][t] = (op - 2) >> 2;
              this.rotations[plane][t] = (op - 2) & 3;
            } else if (op <= 81) {
              this.flags[plane][t] = op - 49;
            } else {
              this.underlays[plane][t] = op - 81;
            }
          }
        }
      }
    }
  }

  private readLocs(data: Uint8Array, ox: number, oy: number) {
    const r = new Reader(data);
    let id = -1;
    for (;;) {
      const idOffset = r.gVarSmart();
      if (idOffset === 0) break;
      id += idOffset;
      let pos = 0;
      for (;;) {
        const posOffset = r.gsmarts();
        if (posOffset === 0) break;
        pos += posOffset - 1;
        const y = pos & 0x3f;
        const x = (pos >> 6) & 0x3f;
        const plane = pos >> 12;
        const attrs = r.g1();
        this.locs.push({ id, type: attrs >> 2, rot: attrs & 3, plane, x: ox + x, y: oy + y });
      }
    }
  }
}

// ---- procedural ground height used where the map doesn't store one (client PerlinNoise) ----
const COS = new Int32Array(2048);
for (let i = 0; i < 2048; i++) COS[i] = Math.trunc(65536 * Math.cos((i * 2 * Math.PI) / 2048));

function noise(x: number, y: number) {
  const n = (y * 57 + x) | 0;
  const h = (n ^ (n << 13)) | 0;
  const v = ((Math.imul(Math.imul(Math.imul(h, h), 15731) + 789221, h) + 1376312589) | 0) & 0x7fffffff;
  return (v >> 19) & 0xff;
}
function smoothNoise(x: number, y: number) {
  const corners = noise(x - 1, y - 1) + noise(x + 1, y - 1) + noise(x - 1, y + 1) + noise(x + 1, y + 1);
  const sides = noise(x - 1, y) + noise(x + 1, y) + noise(x, y - 1) + noise(x, y + 1);
  return ((sides / 8) | 0) + ((corners / 16) | 0) + ((noise(x, y) / 4) | 0);
}
function interpolate(a: number, b: number, t: number, scale: number) {
  const w = (65536 - COS[((t * 1024) / scale) | 0]) >> 1;
  return ((a * (65536 - w)) >> 16) + ((b * w) >> 16);
}
function interpolatedNoise(x: number, y: number, freq: number) {
  const gx = (x / freq) | 0;
  const gy = (y / freq) | 0;
  const fx = x & (freq - 1);
  const fy = y & (freq - 1);
  const a = interpolate(smoothNoise(gx, gy), smoothNoise(gx + 1, gy), fx, freq);
  const b = interpolate(smoothNoise(gx, gy + 1), smoothNoise(gx + 1, gy + 1), fx, freq);
  return interpolate(a, b, fy, freq);
}
function perlinHeight(x: number, y: number) {
  let h =
    interpolatedNoise(x + 45365, y + 91923, 4) +
    ((interpolatedNoise(x + 10294, y + 37821, 2) - 128) >> 1) +
    ((interpolatedNoise(x, y, 1) - 128) >> 2) -
    128;
  h = Math.trunc(h * 0.3) + 35;
  return Math.max(10, Math.min(60, h));
}
