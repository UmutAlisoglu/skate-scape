// Turns a TileGrid into shaded triangle soups (terrain + locs), following the HD client's scene build:
// per-vertex colors (lightness scaled the way GlModel / GlTile do), smooth normals, texture coordinates
// and the ground shadow map objects cast on the tiles around them.
import { packHsl, hslToRgb, hdFaceColor, greyRgb, scaleLightness, HD_BRIGHTNESS } from '../../src/shared/color.ts';
import type { Defs, LocType } from '../cache/defs.ts';
import { ARCHIVE } from '../cache/defs.ts';
import type { CacheStore } from '../cache/store.ts';
import { Model } from '../cache/model.ts';
import type { TileGrid, LocSpawn } from './region.ts';
import { retainTree, isTree } from './tree-policy.ts';

class Grow<T extends Float32Array | Int32Array | Uint8Array> {
  length = 0;
  constructor(private make: (n: number) => T, public data: T = make(1 << 16)) {}
  push(...values: number[]) {
    if (this.length + values.length > this.data.length) {
      const next = this.make(Math.max(this.data.length * 2, this.length + values.length));
      next.set(this.data);
      this.data = next;
    }
    for (let i = 0; i < values.length; i++) this.data[this.length++] = values[i];
  }
  view() {
    return this.data.subarray(0, this.length) as T;
  }
}

/**
 * Growable triangle soup in RS axes (x east, y down, z north; fine units, 128 = 1 tile).
 * Per corner: position, color (0xRRGGBB before lighting), normal, texture coordinate. Per face: alpha, texture.
 */
export class Soup {
  pos = new Grow((n) => new Float32Array(n));
  rgb = new Grow((n) => new Int32Array(n));
  normal = new Grow((n) => new Float32Array(n));
  uv = new Grow((n) => new Float32Array(n));
  alpha = new Grow((n) => new Uint8Array(n));
  textures = new Grow((n) => new Int32Array(n));
  get triangleCount() {
    return this.alpha.length;
  }
  /** p: 9 coords, rgb: 3 colors, n: 9 normal components, uv: 6 (or null), alpha 0-255 opaque, texture id or -1 */
  tri(p: ArrayLike<number>, rgb: ArrayLike<number>, n: ArrayLike<number>, uv: ArrayLike<number> | null, alpha = 255, texture = -1) {
    this.pos.push(...Array.from(p));
    this.rgb.push(rgb[0], rgb[1], rgb[2]);
    this.normal.push(...Array.from(n));
    if (uv) this.uv.push(uv[0], uv[1], uv[2], uv[3], uv[4], uv[5]);
    else this.uv.push(0, 0, 0, 0, 0, 0);
    this.alpha.push(alpha);
    this.textures.push(texture);
  }
}

// ShapedTile tables from the client
const VERTEX_INDICES = [[1, 3, 5, 7], [1, 3, 5, 7], [1, 3, 5, 7], [1, 3, 5, 7, 6], [1, 3, 5, 7, 6], [1, 3, 5, 7, 6], [1, 3, 5, 7, 6], [1, 3, 5, 7, 2, 6], [1, 3, 5, 7, 2, 8], [1, 3, 5, 7, 2, 8], [1, 3, 5, 7, 11, 12], [1, 3, 5, 7, 11, 12], [1, 3, 5, 7, 13, 14]];
const TRIANGLE_INDICES = [[0, 1, 2, 3, 0, 0, 1, 3], [1, 1, 2, 3, 1, 0, 1, 3], [0, 1, 2, 3, 1, 0, 1, 3], [0, 0, 1, 2, 0, 0, 2, 4, 1, 0, 4, 3], [0, 0, 1, 4, 0, 0, 4, 3, 1, 1, 2, 4], [0, 0, 4, 3, 1, 0, 1, 2, 1, 0, 2, 4], [0, 1, 2, 4, 1, 0, 1, 4, 1, 0, 4, 3], [0, 4, 1, 2, 0, 4, 2, 5, 1, 0, 4, 5, 1, 0, 5, 3], [0, 4, 1, 2, 0, 4, 2, 3, 0, 4, 3, 5, 1, 0, 4, 5], [0, 0, 4, 5, 1, 4, 1, 2, 1, 4, 2, 3, 1, 4, 3, 5], [0, 0, 1, 5, 0, 1, 4, 5, 0, 1, 2, 4, 1, 0, 5, 3, 1, 5, 4, 3, 1, 4, 2, 3], [1, 0, 1, 5, 1, 1, 4, 5, 1, 1, 2, 4, 0, 0, 5, 3, 0, 5, 4, 3, 0, 4, 2, 3], [1, 0, 5, 4, 1, 0, 1, 5, 0, 0, 4, 3, 0, 4, 5, 3, 0, 5, 2, 3, 0, 1, 2, 5]];

const BLEND = 5;
/** HD tile lightness before shadows (SceneGraph: 74 - shadow). */
const TILE_LIGHTNESS = 74;

/** Ground shadow map per plane at tile corners ((width + 1) x (height + 1)), filled by LocBuilder. */
export function emptyShadows(grid: TileGrid) {
  return [0, 1, 2, 3].map(() => new Uint8Array((grid.width + 1) * (grid.height + 1)));
}

export function buildTerrain(grid: TileGrid, defs: Defs, shadows: Uint8Array[] = emptyShadows(grid)): Soup {
  const soup = new Soup();
  const W = grid.width;
  const H = grid.height;
  const W1 = W + 1;
  for (let plane = 0; plane < 4; plane++) {
    const underlays = grid.underlays[plane];
    const overlays = grid.overlays[plane];
    const blended = blendUnderlays(grid, plane, defs);
    const shadow = shadows[plane];
    const s = (x: number, y: number) => (x < 0 || y < 0 || x > W || y > H ? 0 : shadow[x + y * W1]);
    // corner lightness: 74 minus the weighted shadow around the corner
    const light = new Int32Array(W1 * (H + 1));
    for (let x = 0; x <= W; x++)
      for (let y = 0; y <= H; y++)
        light[x + y * W1] = TILE_LIGHTNESS - ((s(x + 1, y) >> 3) + (s(x - 1, y) >> 2) + (s(x, y - 1) >> 2) + (s(x, y + 1) >> 3) + (s(x, y) >> 1));
    // corner colors: the touching underlay tiles' blended colors, averaged, at the corner's lightness
    const cornerRgb = (cx: number, cy: number) => {
      let r = 0, g = 0, b = 0, n = 0;
      for (const [tx, ty] of [[cx - 1, cy - 1], [cx, cy - 1], [cx - 1, cy], [cx, cy]]) {
        if (tx < 0 || ty < 0 || tx >= W || ty >= H) continue;
        const hsl = blended[grid.ti(tx, ty)];
        if (underlays[grid.ti(tx, ty)] === 0 || hsl < 0) continue;
        const rgb = hslToRgb(scaleLightness(hsl, light[cx + cy * W1]), HD_BRIGHTNESS);
        r += rgb >> 16; g += (rgb >> 8) & 0xff; b += rgb & 0xff; n++;
      }
      return n ? ((Math.round(r / n) << 16) | (Math.round(g / n) << 8) | Math.round(b / n)) : -1;
    };
    const heightNormal = (cx: number, cy: number): [number, number, number] => {
      // RS axes: y down. Gradient of the corner heightmap, normal points up (-y).
      const dx = grid.h(plane, cx + 1, cy) - grid.h(plane, cx - 1, cy);
      const dz = grid.h(plane, cx, cy + 1) - grid.h(plane, cx, cy - 1);
      const l = Math.hypot(dx, 256, dz);
      return [-dx / l, -256 / l, -dz / l];
    };

    for (let x = 0; x < W; x++) {
      for (let y = 0; y < H; y++) {
        const t = grid.ti(x, y);
        const u = underlays[t];
        const o = overlays[t];
        if (u === 0 && o === 0) continue;
        const heights = [grid.h(plane, x, y), grid.h(plane, x + 1, y), grid.h(plane, x + 1, y + 1), grid.h(plane, x, y + 1)];
        const corners = [[x, y], [x + 1, y], [x + 1, y + 1], [x, y + 1]] as const;
        const lightness = corners.map(([cx, cy]) => light[cx + cy * W1]);
        const normals = corners.map(([cx, cy]) => heightNormal(cx, cy));
        const under = u > 0 && blended[t] >= 0 ? corners.map(([cx, cy]) => cornerRgb(cx, cy)) : null;
        const flu = u > 0 ? defs.underlay(u - 1) : null;
        const underTexture = flu && flu.texture >= 0 ? { id: flu.texture, scale: flu.textureScale || 128 } : null;

        let over: number[] | null = null;
        let overTexture: { id: number; scale: number } | null = null;
        if (o > 0) {
          const flo = defs.overlay(o - 1);
          if (flo.texture >= 0) {
            overTexture = { id: flo.texture, scale: flo.textureScale || 128 };
            over = lightness.map((l) => greyRgb(l));
          } else if (flo.color >= 0) over = lightness.map((l) => hslToRgb(scaleLightness(flo.color, l), HD_BRIGHTNESS));
        }

        const x0 = x * 128;
        const z0 = y * 128;
        const shape = o === 0 ? 0 : grid.shapes[plane][t] + 1;
        const rot = grid.rotations[plane][t];
        // Every tile goes through the shaped-tile path; shape 0/1 are the two-triangle plain tiles.
        const codes = shape <= 1 ? [1, 3, 5, 7] : VERTEX_INDICES[shape];
        const tris = shape === 0 ? [0, 0, 1, 2, 0, 0, 2, 3] : shape === 1 ? [1, 0, 1, 2, 1, 0, 2, 3] : TRIANGLE_INDICES[shape];
        const verts = codes.map((code) => shapedVertex(code, shape <= 1 ? 0 : rot, x0, z0, heights));
        for (let i = 0; i < tris.length; i += 4) {
          const isOverlay = tris[i] === 1;
          const colors = isOverlay ? over : under;
          if (!colors || colors.some((c) => c < 0)) continue;
          const texture = isOverlay ? overTexture : underTexture;
          const idx = [tris[i + 1], tris[i + 2], tris[i + 3]].map((v) => (shape > 1 && v < 4 ? (v - rot) & 3 : v));
          const p: number[] = [], rgb: number[] = [], n: number[] = [], uv: number[] = [];
          for (const k of idx) {
            const v = verts[k];
            p.push(v.x, v.y, v.z);
            rgb.push(blendCorners(colors, v.wx, v.wz));
            const nn = blendNormals(normals, v.wx, v.wz);
            n.push(nn[0], nn[1], nn[2]);
            if (texture) uv.push(v.x / texture.scale, v.z / texture.scale);
          }
          soup.tri(p, rgb, n, texture ? uv : null, 255, texture ? texture.id : -1);
        }
      }
    }
  }
  return soup;
}

interface TileVertex { x: number; y: number; z: number; /** 0-1 position within the tile */ wx: number; wz: number }

function shapedVertex(code: number, rot: number, x0: number, z0: number, h: number[]): TileVertex {
  if ((code & 1) === 0 && code <= 8) code = ((code - rot - rot - 1) & 7) + 1;
  else if (code > 8 && code <= 12) code = ((code - rot - 9) & 3) + 9;
  else if (code > 12 && code <= 16) code = ((code - rot - 13) & 3) + 13;
  const [sw, se, ne, nw] = h;
  const at = (fx: number, fz: number, y: number): TileVertex => ({ x: x0 + fx * 128, y, z: z0 + fz * 128, wx: fx, wz: fz });
  switch (code) {
    case 1: return at(0, 0, sw);
    case 2: return at(0.5, 0, (sw + se) >> 1);
    case 3: return at(1, 0, se);
    case 4: return at(1, 0.5, (se + ne) >> 1);
    case 5: return at(1, 1, ne);
    case 6: return at(0.5, 1, (ne + nw) >> 1);
    case 7: return at(0, 1, nw);
    case 8: return at(0, 0.5, (nw + sw) >> 1);
    case 9: return at(0.5, 0.25, (sw + se) >> 1);
    case 10: return at(0.75, 0.5, (se + ne) >> 1);
    case 11: return at(0.5, 0.75, (ne + nw) >> 1);
    case 12: return at(0.25, 0.5, (nw + sw) >> 1);
    case 13: return at(0.25, 0.25, sw);
    case 14: return at(0.75, 0.25, se);
    case 15: return at(0.75, 0.75, ne);
    default: return at(0.25, 0.75, nw);
  }
}

/** Bilinear blend of four corner colors (SW, SE, NE, NW) at a point inside the tile. */
function blendCorners(c: number[], fx: number, fz: number) {
  const w = [(1 - fx) * (1 - fz), fx * (1 - fz), fx * fz, (1 - fx) * fz];
  let r = 0, g = 0, b = 0;
  for (let i = 0; i < 4; i++) {
    r += (c[i] >> 16) * w[i];
    g += ((c[i] >> 8) & 0xff) * w[i];
    b += (c[i] & 0xff) * w[i];
  }
  return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b);
}

function blendNormals(n: [number, number, number][], fx: number, fz: number): [number, number, number] {
  const w = [(1 - fx) * (1 - fz), fx * (1 - fz), fx * fz, (1 - fx) * fz];
  const out: [number, number, number] = [0, 0, 0];
  for (let i = 0; i < 4; i++) for (let k = 0; k < 3; k++) out[k] += n[i][k] * w[i];
  const l = Math.hypot(...out) || 1;
  return [out[0] / l, out[1] / l, out[2] / l];
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
      // 2009scape ships 42-byte black placeholder quads for some missing roof models; skip them.
      if (m && m.vertexCount === 4 && m.triangleCount === 2 && m.colors[0] === 0 && m.colors[1] === 0 && !m.textures) m = null;
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

  build(grid: TileGrid, treeDensity = 1): { soup: Soup; placed: PlacedLoc[]; shadows: Uint8Array[]; removedTrees: number; keptTrees: number } {
    const soup = new Soup();
    const placed: PlacedLoc[] = [];
    const shadows = emptyShadows(grid);
    const W1 = grid.width + 1;
    const shade = (plane: number, x: number, y: number, value: number) => {
      if (x < 0 || y < 0 || x > grid.width || y > grid.height) return;
      const i = x + y * W1;
      if (shadows[plane][i] < value) shadows[plane][i] = value;
    };
    let removedTrees = 0, keptTrees = 0;
    // walloff of the wall standing on each tile, used to push wall decorations out
    const wallOff = new Map<string, number>();
    for (const s of grid.locs) {
      if (s.type <= 3) wallOff.set(`${s.plane},${s.x},${s.y}`, this.resolve(s.id).walloff);
    }

    for (const s of grid.locs) {
      const loc = this.resolve(s.id);
      if (!retainTree(loc.name, s.id, grid.baseX + s.x, grid.baseY + s.y, treeDensity)) { removedTrees++; continue; }
      if (isTree(loc.name)) keptTrees++;
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

      const ambient = loc.ambient + 64;
      for (const { model, dx, dy } of parts) {
        if (!model) continue;
        emitModel(soup, model, this.defs, fineX + dx, avgY, fineY + dy, loc.hillskew !== 0 ? (vx, vz) => grid.heightAt(s.plane, vx, vz) - avgY : null, ambient);
      }

      // Ground shadows, as SceneGraph.addLoc marks them.
      if (loc.active && parts.some((p) => p.model)) {
        if (t === 10 || t === 11) {
          let radius = 0;
          for (const { model } of parts) if (model) for (let v = 0; v < model.vertexCount; v++) radius = Math.max(radius, Math.hypot(model.vx[v], model.vz[v]));
          const size = Math.min(30, Math.trunc(radius / 4)) || 15;
          for (let sx = 0; sx <= width; sx++) for (let sy = 0; sy <= length; sy++) shade(s.plane, s.x + sx, s.y + sy, size);
        } else if (t === 0) {
          const corners = [[[0, 0], [0, 1]], [[0, 1], [1, 1]], [[1, 0], [1, 1]], [[0, 0], [1, 0]]][r];
          for (const [cx, cy] of corners) shade(s.plane, s.x + cx, s.y + cy, 50);
        } else if (t === 1 || t === 3) {
          const [cx, cy] = [[0, 1], [1, 1], [1, 0], [0, 0]][r];
          shade(s.plane, s.x + cx, s.y + cy, 50);
        }
      }
      const triangleCount = soup.triangleCount - first;
      if (triangleCount > 0) placed.push({ ...s, name: loc.name, firstTriangle: first, triangleCount });
    }
    return { soup, placed, shadows, removedTrees, keptTrees };
  }
}

/**
 * Appends a model's visible faces with HD vertex colors, smooth/flat normals and texture coordinates.
 * skew(x, z) returns extra height for hill-skewed locs.
 */
export function emitModel(soup: Soup, m: Model, defs: Defs, ox: number, oy: number, oz: number, skew: ((x: number, z: number) => number) | null, ambient = 64) {
  const n = m.vertexCount;
  const X = new Float64Array(n);
  const Y = new Float64Array(n);
  const Z = new Float64Array(n);
  for (let v = 0; v < n; v++) {
    X[v] = m.vx[v] + ox;
    Z[v] = m.vz[v] + oz;
    Y[v] = m.vy[v] + oy + (skew ? skew(X[v], Z[v]) : 0);
  }
  const vertexNormals = m.vertexNormals();
  const uvs = m.textures ? m.uvs() : null;
  const cfg = defs.textures;
  for (let t = 0; t < m.triangleCount; t++) {
    const type = m.info ? m.info[t] & 3 : 0;
    const alpha = m.alpha ? m.alpha[t] : 0;
    // The GL client never draws hidden (2) or black (3) faces, and alpha >= 254 is invisible.
    if (type === 2 || type === 3 || alpha >= 254) continue;
    let tex = m.textures ? m.textures[t] : -1;
    if (tex >= cfg.count || (tex >= 0 && !cfg.defined[tex])) tex = -1;
    const rgb = hdFaceColor(m.colors[t], ambient, tex >= 0 ? cfg.brightness[tex] : 0);
    const a = m.ta[t], b = m.tb[t], c = m.tc[t];
    let normals: number[];
    if (type === 1) {
      const f = m.faceNormal(t);
      normals = [...f, ...f, ...f];
    } else {
      normals = [a, b, c].flatMap((v) => [vertexNormals[v * 3], vertexNormals[v * 3 + 1], vertexNormals[v * 3 + 2]]);
      // A vertex only touched by flat faces has no smooth normal; use this face's.
      if (normals.some((v) => Number.isNaN(v)) || [0, 3, 6].some((i) => normals[i] === 0 && normals[i + 1] === 0 && normals[i + 2] === 0)) {
        const f = m.faceNormal(t);
        normals = [...f, ...f, ...f];
      }
    }
    soup.tri([X[a], Y[a], Z[a], X[b], Y[b], Z[b], X[c], Y[c], Z[c]], [rgb, rgb, rgb], normals, uvs && tex >= 0 ? uvs.subarray(t * 6, t * 6 + 6) : null, 255 - alpha, tex);
  }
}
