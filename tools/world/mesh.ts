// Turns a TileGrid into flat-colored triangle soups (terrain + locs), following the client's scene build.
import { packHsl, hslToRgb } from '../../src/shared/color.ts';
import type { Defs, LocType } from '../cache/defs.ts';
import { ARCHIVE } from '../cache/defs.ts';
import type { CacheStore } from '../cache/store.ts';
import { Model } from '../cache/model.ts';
import type { TileGrid, LocSpawn } from './region.ts';

/** Growable triangle soup: positions in RS fine units (x east, y down, z north) + one RGBA per triangle. */
export class Soup {
  pos: number[] = [];
  col: number[] = [];
  get triangleCount() {
    return this.col.length / 4;
  }
  tri(ax: number, ay: number, az: number, bx: number, by: number, bz: number, cx: number, cy: number, cz: number, rgb: number, a = 255) {
    this.pos.push(ax, ay, az, bx, by, bz, cx, cy, cz);
    this.col.push((rgb >> 16) & 0xff, (rgb >> 8) & 0xff, rgb & 0xff, a);
  }
}

// ShapedTile tables from the client
const VERTEX_INDICES = [[1, 3, 5, 7], [1, 3, 5, 7], [1, 3, 5, 7], [1, 3, 5, 7, 6], [1, 3, 5, 7, 6], [1, 3, 5, 7, 6], [1, 3, 5, 7, 6], [1, 3, 5, 7, 2, 6], [1, 3, 5, 7, 2, 8], [1, 3, 5, 7, 2, 8], [1, 3, 5, 7, 11, 12], [1, 3, 5, 7, 11, 12], [1, 3, 5, 7, 13, 14]];
const TRIANGLE_INDICES = [[0, 1, 2, 3, 0, 0, 1, 3], [1, 1, 2, 3, 1, 0, 1, 3], [0, 1, 2, 3, 1, 0, 1, 3], [0, 0, 1, 2, 0, 0, 2, 4, 1, 0, 4, 3], [0, 0, 1, 4, 0, 0, 4, 3, 1, 1, 2, 4], [0, 0, 4, 3, 1, 0, 1, 2, 1, 0, 2, 4], [0, 1, 2, 4, 1, 0, 1, 4, 1, 0, 4, 3], [0, 4, 1, 2, 0, 4, 2, 5, 1, 0, 4, 5, 1, 0, 5, 3], [0, 4, 1, 2, 0, 4, 2, 3, 0, 4, 3, 5, 1, 0, 4, 5], [0, 0, 4, 5, 1, 4, 1, 2, 1, 4, 2, 3, 1, 4, 3, 5], [0, 0, 1, 5, 0, 1, 4, 5, 0, 1, 2, 4, 1, 0, 5, 3, 1, 5, 4, 3, 1, 4, 2, 3], [1, 0, 1, 5, 1, 1, 4, 5, 1, 1, 2, 4, 0, 0, 5, 3, 0, 5, 4, 3, 0, 4, 2, 3], [1, 0, 5, 4, 1, 0, 1, 5, 0, 0, 4, 3, 0, 4, 5, 3, 0, 5, 2, 3, 0, 1, 2, 5]];

const BLEND = 5;

export function buildTerrain(grid: TileGrid, defs: Defs): Soup {
  const soup = new Soup();
  const W = grid.width;
  const H = grid.height;
  for (let plane = 0; plane < 4; plane++) {
    const underlays = grid.underlays[plane];
    const overlays = grid.overlays[plane];
    const blended = blendUnderlays(grid, plane, defs);
    for (let x = 0; x < W; x++) {
      for (let y = 0; y < H; y++) {
        const t = grid.ti(x, y);
        const u = underlays[t];
        const o = overlays[t];
        if (u === 0 && o === 0) continue;
        const hSW = grid.h(plane, x, y);
        const hSE = grid.h(plane, x + 1, y);
        const hNE = grid.h(plane, x + 1, y + 1);
        const hNW = grid.h(plane, x, y + 1);
        const underRgb = u > 0 && blended[t] >= 0 ? hslToRgb(blended[t]) : -1;

        let overRgb = -1;
        if (o > 0) {
          const flo = defs.overlay(o - 1);
          if (flo.texture >= 0) overRgb = hslToRgb(defs.textureColors[flo.texture]);
          else if (flo.color >= 0) overRgb = hslToRgb(flo.color);
        }

        const x0 = x * 128;
        const z0 = y * 128;
        if (o === 0) {
          if (underRgb < 0) continue;
          quad(soup, x0, z0, hSW, hSE, hNE, hNW, underRgb);
          continue;
        }
        const shape = grid.shapes[plane][t] + 1;
        const rot = grid.rotations[plane][t];
        if (shape === 1) {
          if (overRgb >= 0) quad(soup, x0, z0, hSW, hSE, hNE, hNW, overRgb);
          continue;
        }
        // shaped tile: part underlay, part overlay
        const verts = VERTEX_INDICES[shape].map((code) => shapedVertex(code, rot, x0, z0, hSW, hSE, hNE, hNW));
        const tris = TRIANGLE_INDICES[shape];
        for (let i = 0; i < tris.length; i += 4) {
          const isOverlay = tris[i] === 1;
          const rgb = isOverlay ? overRgb : underRgb;
          if (rgb < 0) continue;
          const [a, b, c] = [tris[i + 1], tris[i + 2], tris[i + 3]].map((v) => (v < 4 ? (v - rot) & 3 : v));
          const A = verts[a];
          const B = verts[b];
          const C = verts[c];
          soup.tri(A[0], A[1], A[2], B[0], B[1], B[2], C[0], C[1], C[2], rgb);
        }
      }
    }
  }
  return soup;
}

function quad(soup: Soup, x0: number, z0: number, sw: number, se: number, ne: number, nw: number, rgb: number) {
  soup.tri(x0, sw, z0, x0 + 128, se, z0, x0 + 128, ne, z0 + 128, rgb);
  soup.tri(x0, sw, z0, x0 + 128, ne, z0 + 128, x0, nw, z0 + 128, rgb);
}

function shapedVertex(code: number, rot: number, x0: number, z0: number, sw: number, se: number, ne: number, nw: number): [number, number, number] {
  if ((code & 1) === 0 && code <= 8) code = ((code - rot - rot - 1) & 7) + 1;
  else if (code > 8 && code <= 12) code = ((code - rot - 9) & 3) + 9;
  else if (code > 12 && code <= 16) code = ((code - rot - 13) & 3) + 13;
  switch (code) {
    case 1: return [x0, sw, z0];
    case 2: return [x0 + 64, (sw + se) >> 1, z0];
    case 3: return [x0 + 128, se, z0];
    case 4: return [x0 + 128, (se + ne) >> 1, z0 + 64];
    case 5: return [x0 + 128, ne, z0 + 128];
    case 6: return [x0 + 64, (ne + nw) >> 1, z0 + 128];
    case 7: return [x0, nw, z0 + 128];
    case 8: return [x0, (nw + sw) >> 1, z0 + 64];
    case 9: return [x0 + 64, (sw + se) >> 1, z0 + 32];
    case 10: return [x0 + 96, (se + ne) >> 1, z0 + 64];
    case 11: return [x0 + 64, (ne + nw) >> 1, z0 + 96];
    case 12: return [x0 + 32, (nw + sw) >> 1, z0 + 64];
    case 13: return [x0 + 32, sw, z0 + 32];
    case 14: return [x0 + 96, se, z0 + 32];
    case 15: return [x0 + 96, ne, z0 + 96];
    default: return [x0 + 32, nw, z0 + 96];
  }
}

/** Client underlay blending: average H/S/L over an 11x11 window, hue weighted by chroma. Returns HSL16 or -1. */
function blendUnderlays(grid: TileGrid, plane: number, defs: Defs): Int32Array {
  const W = grid.width;
  const H = grid.height;
  const out = new Int32Array(W * H).fill(-1);
  const und = grid.underlays[plane];
  for (let x = 0; x < W; x++) {
    for (let y = 0; y < H; y++) {
      if (und[grid.ti(x, y)] === 0) continue;
      let hue = 0, sat = 0, light = 0, chroma = 0, count = 0;
      for (let dx = -BLEND; dx <= BLEND; dx++) {
        const xx = x + dx;
        if (xx < 0 || xx >= W) continue;
        for (let dy = -BLEND; dy <= BLEND; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= H) continue;
          const u = und[grid.ti(xx, yy)];
          if (u === 0) continue;
          const f = defs.underlay(u - 1);
          hue += f.hue;
          sat += f.saturation;
          light += f.lightness;
          chroma += f.chroma;
          count++;
        }
      }
      if (count > 0) out[grid.ti(x, y)] = packHsl((light / count) | 0, (sat / count) | 0, ((hue * 256) / chroma) | 0);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Locs

const WALL_DECO_DIR_X = [1, 0, -1, 0];
const WALL_DECO_DIR_Y = [0, -1, 0, 1];
const WALL_DIAG_X = [1, -1, -1, 1];
const WALL_DIAG_Y = [-1, -1, 1, 1];

export interface PlacedLoc extends LocSpawn {
  name: string;
  /** triangle range within the loc soup */
  firstTriangle: number;
  triangleCount: number;
}

export class LocBuilder {
  private modelCache = new Map<number, Model | null>();
  constructor(private cache: CacheStore, private defs: Defs) {}

  private baseModel(id: number): Model | null {
    if (!this.modelCache.has(id)) {
      const data = this.cache.file(ARCHIVE.MODELS, id);
      let m: Model | null = null;
      try {
        m = data ? Model.decode(data) : null;
      } catch (e) {
        console.warn(`  model ${id} failed to decode: ${(e as Error).message}`);
      }
      this.modelCache.set(id, m);
    }
    return this.modelCache.get(id)!;
  }

  /** Port of LocType.getRawModel + the shape-10 diagonal turn in getStaticEntity. */
  model(loc: LocType, rotation: number, shape: number): Model | null {
    let mirrored = loc.mirror;
    if (shape === 2 && rotation > 3) mirrored = !mirrored;
    let model: Model | null = null;
    if (!loc.shapes) {
      if (shape !== 10 || !loc.models) return null;
      const parts: Model[] = [];
      for (const id of loc.models) {
        const m = this.baseModel(id);
        if (!m) return null;
        parts.push(m);
      }
      model = parts.length === 1 ? parts[0].clone() : Model.merge(parts);
    } else {
      const i = loc.shapes.indexOf(shape);
      if (i < 0 || !loc.models) return null;
      const m = this.baseModel(loc.models[i]);
      if (!m) return null;
      model = m.clone();
    }
    if (mirrored) model.mirrorZ();
    if (shape === 4 && rotation > 3) {
      model.rotate45();
      model.translate(45, 0, -45);
    }
    const q = rotation & 3;
    if (q === 1) model.rotate90();
    else if (q === 2) model.rotate180();
    else if (q === 3) model.rotate270();
    if (loc.recolS && loc.recolD) for (let i = 0; i < loc.recolS.length; i++) model.recolor(loc.recolS[i], loc.recolD[i]);
    if (loc.retexS && loc.retexD) for (let i = 0; i < loc.retexS.length; i++) model.retexture(loc.retexS[i], loc.retexD[i]);
    if (loc.resizeX !== 128 || loc.resizeY !== 128 || loc.resizeZ !== 128) model.resize(loc.resizeX, loc.resizeY, loc.resizeZ);
    if (loc.offX || loc.offY || loc.offZ) model.translate(loc.offX, loc.offY, loc.offZ);
    if (shape === 10 && rotation > 3) model.rotate45();
    return model;
  }

  resolve(id: number): LocType {
    const loc = this.defs.loc(id);
    if (loc.models || !loc.multiLocs) return loc;
    // Default varbit state is 0; fall back to the first defined child.
    const child = loc.multiLocs.find((c) => c >= 0);
    return child !== undefined ? this.defs.loc(child) : loc;
  }

  build(grid: TileGrid): { soup: Soup; placed: PlacedLoc[] } {
    const soup = new Soup();
    const placed: PlacedLoc[] = [];
    // walloff of the wall standing on each tile, used to push wall decorations out
    const wallOff = new Map<string, number>();
    for (const s of grid.locs) {
      if (s.type <= 3) wallOff.set(`${s.plane},${s.x},${s.y}`, this.resolve(s.id).walloff);
    }

    for (const s of grid.locs) {
      const loc = this.resolve(s.id);
      const first = soup.triangleCount;
      const swapped = s.rot === 1 || s.rot === 3;
      const width = swapped ? loc.length : loc.width;
      const length = swapped ? loc.width : loc.length;
      const west = s.x + (width >> 1);
      const east = s.x + ((width + 1) >> 1);
      const south = s.y + (length >> 1);
      const north = s.y + ((length + 1) >> 1);
      const avgY = (grid.h(s.plane, west, north) + grid.h(s.plane, east, south) + grid.h(s.plane, west, south) + grid.h(s.plane, east, north)) >> 2;
      const fineX = (s.x << 7) + (width << 6);
      const fineY = (s.y << 7) + (length << 6);

      const parts: { model: Model | null; dx: number; dy: number }[] = [];
      const add = (rotation: number, shape: number, dx = 0, dy = 0) => parts.push({ model: this.model(loc, rotation, shape), dx, dy });
      const t = s.type;
      const r = s.rot;
      const wo = wallOff.get(`${s.plane},${s.x},${s.y}`);
      if (t === 22) add(r, 22);
      else if (t === 10 || t === 11) add(t === 11 ? r + 4 : r, 10);
      else if (t >= 12) add(r, t);
      else if (t === 0 || t === 1 || t === 3 || t === 9) add(r, t);
      else if (t === 2) {
        add(r + 4, 2);
        add((r + 1) & 3, 2);
      } else if (t === 4) add(r, 4);
      else if (t === 5) {
        const off = wo ?? 16;
        add(r, 4, off * WALL_DECO_DIR_X[r], off * WALL_DECO_DIR_Y[r]);
      } else if (t === 6) {
        const off = wo !== undefined ? wo >> 1 : 8;
        add(r + 4, 4, off * WALL_DIAG_X[r], off * WALL_DIAG_Y[r]);
      } else if (t === 7) add(((r + 2) & 3) + 4, 4);
      else if (t === 8) {
        const off = wo !== undefined ? wo >> 1 : 8;
        add(r + 4, 4, off * WALL_DIAG_X[r], off * WALL_DIAG_Y[r]);
        add(((r + 2) & 3) + 4, 4);
      }

      for (const { model, dx, dy } of parts) {
        if (!model) continue;
        emitModel(soup, model, this.defs, fineX + dx, avgY, fineY + dy, loc.hillskew !== 0 ? (vx, vz) => grid.heightAt(s.plane, vx, vz) - avgY : null);
      }
      const triangleCount = soup.triangleCount - first;
      if (triangleCount > 0) placed.push({ ...s, name: loc.name, firstTriangle: first, triangleCount });
    }
    return { soup, placed };
  }
}

/** Appends a model's visible faces; skew(x, z) returns extra height for hill-skewed locs. */
export function emitModel(soup: Soup, m: Model, defs: Defs, ox: number, oy: number, oz: number, skew: ((x: number, z: number) => number) | null) {
  const n = m.vertexCount;
  const X = new Float64Array(n);
  const Y = new Float64Array(n);
  const Z = new Float64Array(n);
  for (let v = 0; v < n; v++) {
    X[v] = m.vx[v] + ox;
    Z[v] = m.vz[v] + oz;
    Y[v] = m.vy[v] + oy + (skew ? skew(X[v], Z[v]) : 0);
  }
  for (let t = 0; t < m.triangleCount; t++) {
    const type = m.info ? m.info[t] & 3 : 0;
    const alpha = m.alpha ? m.alpha[t] : 0;
    if (type === 2 || alpha === 255) continue;
    const tex = m.textures ? m.textures[t] : -1;
    let rgb: number;
    if (alpha === 254 || (type === 3 && tex < 0)) rgb = 0;
    else if (tex >= 0) rgb = hslToRgb(defs.textureColors[tex] ?? 0);
    else rgb = hslToRgb(m.colors[t]);
    const a = m.ta[t];
    const b = m.tb[t];
    const c = m.tc[t];
    soup.tri(X[a], Y[a], Z[a], X[b], Y[b], Z[b], X[c], Y[c], Z[c], rgb, 255 - alpha);
  }
}
