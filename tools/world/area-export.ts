// Builds a rectangle of 2009scape map regions into the game's streamed world formats, block by block (4x4 regions
// at a time, each loaded with a one-region border for terrain blending, heights and shadows), so even the whole
// of Gielinor never has to fit in memory. Per block it builds the terrain and objects, then packs them straight into
//   render/      indexed render chunks on a 16-tile grid (+ manifest.json)
//   collision/   per 16-tile cell: solid objects (<cx>_<cy>.bin), terrain (.t.bin), grind lines (.rails.json)
//   minimap/     RS-style minimap tiles (4 px per tile) and a 1 px per tile overview for the world map
//   traversal.bin, runes.json, manifest.json
// Platform-free: the files go to an AreaFiles sink, which is the disk for tools/export-area.ts (Node) and memory
// for the browser build (src/world/gitlab/worker.ts).
import type { Js5Store, Xtea } from '../cache/js5.ts';
import { ARCHIVE, type Defs } from '../cache/defs.ts';
import { TileGrid } from './region.ts';
import { buildTerrain, type LocBuilder, type Soup, type TileRect } from './mesh.ts';
import { classifyLocs } from './collision-rules.ts';
import { connectRails } from '../../src/shared/rails.ts';
import { encodeRenderChunk, type RenderChunkRecord, type RenderManifest } from '../../src/shared/render-chunk.ts';
import { writeSoupCorner } from '../../src/shared/soup.ts';
import type { CollisionIndex } from '../../src/world/load.ts';
import type { Rail } from '../../src/game/skater.ts';
import { placesIn } from '../../src/game/places.ts';
import { placeRunes } from '../../src/game/runes.ts';

export interface Area { regionX: number; regionY: number; w: number; h: number; /** spawn in world tile coords */ spawn: [number, number] }
export const AREAS: Record<string, Area> = {
  // Lumbridge castle, town, river and surroundings
  lumbridge: { regionX: 49, regionY: 49, w: 3, h: 3, spawn: [3222, 3218] },
  // greater Misthalin: Lumbridge, Draynor, Wizards' Tower, Al Kharid, Varrock, Barbarian Village, Edgeville, Grand Exchange
  misthalin: { regionX: 48, regionY: 49, w: 5, h: 6, spawn: [3222, 3218] },
  // the whole mainland: Kandarin to Morytania, Karamja and the desert to the top of the Wilderness
  gielinor: { regionX: 33, regionY: 39, w: 28, h: 26, spawn: [3222, 3218] },
};
/** regions per block side for the disk export; the browser builds one region at a time (AreaExportOptions.block) */
export const BLOCK = 4, CELL = 16, MARGIN = 64, MAP_SCALE = 4;

/** The area's output files, by path relative to its folder (public/world/<area>/ on disk). */
export interface AreaFiles {
  write(path: string, data: Uint8Array | string): void;
  read(path: string): Uint8Array;
}

export interface AreaExportOptions {
  name: string;
  area: Area;
  cache: Js5Store;
  defs: Defs;
  builder: LocBuilder;
  xteas: Map<number, Xtea>;
  /** share of trees kept (1 = all) */
  treeDensity: number;
  /** regions per block side (BLOCK) */
  block?: number;
  files: AreaFiles;
  encodePng(width: number, height: number, rgba: Uint8Array): Uint8Array;
  log(message: string): void;
  warn(message: string): void;
}

type Stats = { terrain: number; locs: number; solid: number; clutter: number; rails: number; kept: number; removed: number; water: number; voids: number };
export interface BlockResult { chunks: RenderChunkRecord[]; cells: CollisionIndex['cells']; textures: number[]; minimap: boolean; stats: Stats }
/** A built block: its record plus the per-tile layers assemble() joins (traversal, ground heights, map overview). */
export interface BlockOutput { result: BlockResult; traversal: Uint8Array; heights: Float32Array; overview: Uint8Array }

// Water stops a rolling rider. The tile's blocked flag also covers rocks, cliffs and fenced-off areas, so only
// blocked tiles whose overlay is a water texture count (669 and 651 are the HD water textures).
const WATER_TEXTURES = new Set([669, 651]);

/** The map regions block (bx, by) loads, including its one-region border. */
export function blockRegions(area: Area, bx: number, by: number, block = BLOCK) {
  const rx0 = area.regionX + bx * block, ry0 = area.regionY + by * block;
  const bw = Math.min(block, area.regionX + area.w - rx0), bh = Math.min(block, area.regionY + area.h - ry0);
  return { rx0, ry0, bw, bh, grid: { regionX0: rx0 - 1, regionY0: ry0 - 1, regionsW: bw + 2, regionsH: bh + 2 } };
}

export class AreaExport {
  readonly areaX: number; readonly areaY: number; readonly sizeX: number; readonly sizeY: number;
  readonly blocksX: number; readonly blocksY: number; readonly block: number;

  constructor(private readonly o: AreaExportOptions) {
    const { area } = o;
    this.areaX = area.regionX * 64; this.areaY = area.regionY * 64; this.sizeX = area.w * 64; this.sizeY = area.h * 64;
    this.block = o.block ?? BLOCK;
    this.blocksX = Math.ceil(area.w / this.block); this.blocksY = Math.ceil(area.h / this.block);
  }

  private waterOverlay(o: number) { return o > 0 && WATER_TEXTURES.has(this.o.defs.overlay(o - 1).texture); }

  /** Builds one block of up to BLOCK x BLOCK regions and writes its render chunks, collision cells and minimap tile. */
  exportBlock(bx: number, by: number): BlockOutput {
    const { area, cache, defs, builder, xteas, files } = this.o, { areaX, areaY } = this;
    const { rx0, ry0, bw, bh, grid: gridRect } = blockRegions(area, bx, by, this.block);
    const tx0 = (rx0 - area.regionX) * 64, ty0 = (ry0 - area.regionY) * 64, tw = bw * 64, th = bh * 64;
    const result: BlockResult = { chunks: [], cells: [], textures: [], minimap: false, stats: { terrain: 0, locs: 0, solid: 0, clutter: 0, rails: 0, kept: 0, removed: 0, water: 0, voids: 0 } };
    const traversal = new Uint8Array(tw * th).fill(2), heights = new Float32Array(tw * th), overview = new Uint8Array(tw * th * 4);
    const output: BlockOutput = { result, traversal, heights, overview };
    let mapped = false;
    for (let ry = ry0; ry < ry0 + bh; ry++) for (let rx = rx0; rx < rx0 + bw; rx++) if (cache.groupId(ARCHIVE.MAPS, `m${rx}_${ry}`) !== undefined) mapped = true;
    if (!mapped) { result.stats.voids = tw * th; return output; }

    const grid = new TileGrid(gridRect.regionX0, gridRect.regionY0, gridRect.regionsW, gridRect.regionsH);
    grid.load(cache, xteas, this.o.warn);
    const inner: TileRect = { x0: 64, y0: 64, x1: 64 + tw, y1: 64 + th };
    // spawns inside the block get geometry; those just outside only shade its ground
    const inside = (s: { x: number; y: number }) => s.x >= inner.x0 && s.x < inner.x1 && s.y >= inner.y0 && s.y < inner.y1;
    const near = grid.locs.filter((s) => s.x >= inner.x0 - 8 && s.x < inner.x1 + 8 && s.y >= inner.y0 - 8 && s.y < inner.y1 + 8);
    grid.locs.length = 0; grid.locs.push(...near);
    const built = builder.build(grid, this.o.treeDensity, inside);
    const terrain = buildTerrain(grid, defs, built.shadows, inner);
    const locs = built.soup;
    Object.assign(result.stats, { terrain: terrain.triangleCount, locs: locs.triangleCount, kept: built.keptTrees, removed: built.removedTrees });

    // grid -> map coordinates: fine units east / north of the map corner (three.js z = -north)
    const offX = (grid.baseX - areaX) * 128, offY = (grid.baseY - areaY) * 128;
    const east = (soup: Soup, corner: number) => Math.round(soup.pos.data[corner * 3] + offX);
    const up = (soup: Soup, corner: number) => Math.round(-soup.pos.data[corner * 3 + 1]);
    const north = (soup: Soup, corner: number) => Math.round(soup.pos.data[corner * 3 + 2] + offY);
    // the 16-tile cell a triangle belongs to (by its centre), kept inside this block so blocks never share a file
    const cx0 = tx0 / CELL, cx1 = (tx0 + tw) / CELL - 1, cy0 = ty0 / CELL, cy1 = (ty0 + th) / CELL - 1;
    const cellOf = (soup: Soup, t: number): [number, number] => {
      const x = (east(soup, t * 3) + east(soup, t * 3 + 1) + east(soup, t * 3 + 2)) / 384, y = (north(soup, t * 3) + north(soup, t * 3 + 1) + north(soup, t * 3 + 2)) / 384;
      return [Math.max(cx0, Math.min(cx1, Math.floor(x / CELL))), Math.max(cy0, Math.min(cy1, Math.floor(y / CELL)))];
    };

    // ---- render chunks ----
    const textures = new Set<number>();
    for (const [label, soup] of [['terrain', terrain], ['locs', locs]] as const) {
      const n = soup.triangleCount, RGB = soup.rgb.data, N = soup.normal.data, UV = soup.uv.data, A = soup.alpha.data, T = soup.textures.data;
      const groups = new Map<string, number[]>();
      for (let t = 0; t < n; t++) {
        if (T[t] >= 0) textures.add(T[t]);
        const [cx, cy] = cellOf(soup, t), k = `${cx}_${cy}_${A[t] === 255 ? 'opaque' : 'translucent'}`;
        let ids = groups.get(k);
        if (!ids) groups.set(k, (ids = []));
        ids.push(t);
      }
      for (const [k, ids] of groups) {
        const P: number[] = [], Nn: number[] = [], C: number[] = [], S: number[] = [], U: number[] = [], I: number[] = [], lookup = new Map<string, number>();
        const bounds: [number, number, number, number, number, number] = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
        for (const t of ids) {
          const surface = T[t] + 1, alpha = A[t];
          for (let v = 0; v < 3; v++) {
            const c = t * 3 + v, x = east(soup, c), y = up(soup, c), z = -north(soup, c);
            const nx = Math.round(N[c * 3] * 127), ny = Math.round(-N[c * 3 + 1] * 127), nz = Math.round(-N[c * 3 + 2] * 127);
            const rgb = RGB[c], u = surface ? UV[c * 2] : 0, w = surface ? UV[c * 2 + 1] : 0;
            const vertexKey = `${x},${y},${z},${nx},${ny},${nz},${rgb},${alpha},${surface},${u},${w}`;
            let index = lookup.get(vertexKey);
            if (index === undefined) {
              index = P.length / 3; lookup.set(vertexKey, index);
              P.push(x, y, z); Nn.push(nx, ny, nz); C.push((rgb >> 16) & 0xff, (rgb >> 8) & 0xff, rgb & 0xff, alpha); S.push(surface); U.push(u, w);
              bounds[0] = Math.min(bounds[0], x / 128); bounds[1] = Math.min(bounds[1], y / 128); bounds[2] = Math.min(bounds[2], z / 128);
              bounds[3] = Math.max(bounds[3], x / 128); bounds[4] = Math.max(bounds[4], y / 128); bounds[5] = Math.max(bounds[5], z / 128);
            }
            I.push(index);
          }
        }
        // positions relative to the chunk's lowest corner stay within 16 bits anywhere on the map
        const origin: [number, number, number] = [Math.round(bounds[0] * 128), Math.round(bounds[1] * 128), Math.round(bounds[2] * 128)];
        for (let i = 0; i < P.length; i += 3) { P[i] -= origin[0]; P[i + 1] -= origin[1]; P[i + 2] -= origin[2]; }
        if (P.some((v) => v < -32768 || v > 32767)) throw new Error(`render chunk ${label}_${k} is too large for 16-bit positions`);
        const buffer = encodeRenderChunk({ positions: Int16Array.from(P), normals: Int8Array.from(Nn), colors: Uint8Array.from(C), surfaces: Uint16Array.from(S), uvs: Float32Array.from(U), indices: Uint32Array.from(I) });
        const id = `${label}_${k}`, file = `${id}.bin`;
        files.write(`render/${file}`, new Uint8Array(buffer));
        result.chunks.push({ id, file, kind: k.endsWith('translucent') ? 'translucent' : 'opaque', triangles: ids.length, vertices: P.length / 3, bytes: buffer.byteLength, bounds, origin });
      }
    }
    result.textures = [...textures].sort((a, b) => a - b);

    // ---- collision: solid objects, terrain and grind lines per cell ----
    const vertex = (t: number, v: number, axis: number) => {
      const c = t * 3 + v;
      return axis === 0 ? east(locs, c) / 128 : axis === 1 ? up(locs, c) / 128 : -north(locs, c) / 128;
    };
    const placed = built.placed.map((p) => ({ id: p.id, name: p.name, type: p.type, rot: p.rot, plane: p.plane, x: p.x + offX / 128, y: p.y + offY / 128, first: p.firstTriangle, count: p.triangleCount }));
    const { solid, pieces, clutter } = classifyLocs(placed, locs.triangleCount, vertex, defs, [areaX, areaY]);
    const rails = connectRails(pieces);
    Object.assign(result.stats, { clutter, rails: rails.length });
    const cellLocs = new Map<string, number[]>(), cellTerrain = new Map<string, number[]>(), cellRails = new Map<string, Rail[]>();
    const push = <T>(map: Map<string, T[]>, k: string, value: T) => { const list = map.get(k); if (list) list.push(value); else map.set(k, [value]); };
    for (let t = 0; t < locs.triangleCount; t++) if (solid[t]) { push(cellLocs, cellOf(locs, t).join('_'), t); result.stats.solid++; }
    for (let t = 0; t < terrain.triangleCount; t++) push(cellTerrain, cellOf(terrain, t).join('_'), t);
    for (const rail of rails) {
      const cx = Math.max(cx0, Math.min(cx1, Math.floor((rail.a.x + rail.b.x) / 2 / CELL))), cy = Math.max(cy0, Math.min(cy1, Math.floor(-(rail.a.z + rail.b.z) / 2 / CELL)));
      push(cellRails, `${cx}_${cy}`, rail);
    }
    const writeCellSoup = (path: string, soup: Soup, ids: number[], ox: number, on: number) => {
      const out = new Uint8Array(4 + ids.length * 22), view = new DataView(out.buffer, out.byteOffset, out.length);
      view.setUint32(0, ids.length, true);
      ids.forEach((t, j) => { for (let v = 0; v < 3; v++) { const c = t * 3 + v; writeSoupCorner(view, j * 3 + v, east(soup, c) - ox, up(soup, c), -(north(soup, c) - on)); } });
      out.fill(255, 4 + ids.length * 18); // collision ignores colour and transparency
      files.write(path, out);
    };
    for (const k of new Set([...cellLocs.keys(), ...cellTerrain.keys(), ...cellRails.keys()])) {
      const [cx, cy] = k.split('_').map(Number), ox = (cx * CELL - MARGIN) * 128, on = (cy * CELL - MARGIN) * 128;
      const solidIds = cellLocs.get(k) ?? [], terrainIds = cellTerrain.get(k) ?? [], railList = cellRails.get(k) ?? [];
      if (solidIds.length) writeCellSoup(`collision/${k}.bin`, locs, solidIds, ox, on);
      if (terrainIds.length) writeCellSoup(`collision/${k}.t.bin`, terrain, terrainIds, ox, on);
      if (railList.length) files.write(`collision/${k}.rails.json`, JSON.stringify(railList));
      result.cells.push([cx, cy, solidIds.length, terrainIds.length, railList.length]);
    }

    // ---- traversal (water 1, no terrain 2) and ground heights ----
    const covered = new Uint8Array(tw * th);
    for (let t = 0; t < terrain.triangleCount; t++) {
      const x = Math.floor((east(terrain, t * 3) + east(terrain, t * 3 + 1) + east(terrain, t * 3 + 2)) / 384) - tx0;
      const y = Math.floor((north(terrain, t * 3) + north(terrain, t * 3 + 1) + north(terrain, t * 3 + 2)) / 384) - ty0;
      if (x >= 0 && y >= 0 && x < tw && y < th) covered[x + y * tw] = 1;
    }
    for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) {
      const i = grid.ti(inner.x0 + x, inner.y0 + y), o = x + y * tw;
      traversal[o] = !covered[o] ? 2 : (grid.flags[0][i] & 1) && !(grid.flags[1][i] & 2) && this.waterOverlay(grid.overlays[0][i]) ? 1 : 0;
      heights[o] = -grid.heightAt(0, (inner.x0 + x) * 128 + 64, (inner.y0 + y) * 128 + 64) / 128;
      if (traversal[o] === 1) result.stats.water++; else if (traversal[o] === 2) result.stats.voids++;
    }

    // ---- minimap tile: terrain colours from above, water, and walls as light lines ----
    const W = tw * MAP_SCALE, H = th * MAP_SCALE, rgba = new Uint8Array(W * H * 4), top = new Float32Array(W * H).fill(-Infinity);
    const px = (fineEast: number) => (fineEast / 128 - tx0) * MAP_SCALE, py = (fineNorth: number) => H - (fineNorth / 128 - ty0) * MAP_SCALE;
    for (let t = 0; t < terrain.triangleCount; t++) {
      const xs = [0, 1, 2].map((v) => px(east(terrain, t * 3 + v))), ys = [0, 1, 2].map((v) => py(north(terrain, t * 3 + v))), hs = [0, 1, 2].map((v) => up(terrain, t * 3 + v));
      const a = (xs[1] - xs[0]) * (ys[2] - ys[0]) - (xs[2] - xs[0]) * (ys[1] - ys[0]);
      if (Math.abs(a) < 1e-6) continue;
      const rgb = terrain.rgb.data[t * 3];
      for (let y = Math.max(0, Math.floor(Math.min(...ys))); y <= Math.min(H - 1, Math.ceil(Math.max(...ys))); y++)
        for (let x = Math.max(0, Math.floor(Math.min(...xs))); x <= Math.min(W - 1, Math.ceil(Math.max(...xs))); x++) {
          const cx = x + 0.5, cy = y + 0.5;
          const w0 = ((xs[1] - cx) * (ys[2] - cy) - (xs[2] - cx) * (ys[1] - cy)) / a, w1 = ((xs[2] - cx) * (ys[0] - cy) - (xs[0] - cx) * (ys[2] - cy)) / a, w2 = 1 - w0 - w1;
          if (w0 < -1e-4 || w1 < -1e-4 || w2 < -1e-4) continue;
          const h = w0 * hs[0] + w1 * hs[1] + w2 * hs[2], i = y * W + x;
          if (h < top[i]) continue;
          top[i] = h; rgba.set([(rgb >> 16) & 0xff, (rgb >> 8) & 0xff, rgb & 0xff, 255], i * 4);
        }
    }
    for (let ty = 0; ty < th; ty++) for (let tx = 0; tx < tw; tx++) {
      const kind = traversal[tx + ty * tw];
      if (!kind) continue;
      const shade = (((tx0 + tx) * 7 + (ty0 + ty) * 13) % 5) - 2;
      for (let y = 0; y < MAP_SCALE; y++) for (let x = 0; x < MAP_SCALE; x++) {
        const i = (H - 1 - (ty * MAP_SCALE + y)) * W + tx * MAP_SCALE + x;
        // 1 = water (the RS minimap's blue), 2 = no terrain (dark, like the RS minimap's black)
        rgba.set(kind === 2 ? [18, 16, 14, 255] : [46 + shade, 78 + shade, 132 + shade * 2, 255], i * 4);
      }
    }
    const wall = new Uint8Array(W * H);
    const line = (x0: number, y0: number, x1: number, y1: number) => {
      const steps = Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)));
      for (let s = 0; s <= steps; s++) {
        const x = Math.floor(x0 + ((x1 - x0) * s) / (steps || 1)), y = Math.floor(y0 + ((y1 - y0) * s) / (steps || 1));
        if (x >= 0 && y >= 0 && x < W && y < H) wall[y * W + x] = 1;
      }
    };
    for (let t = 0; t < locs.triangleCount; t++) {
      if (!solid[t]) continue;
      const p = [0, 1, 2].map((v) => [east(locs, t * 3 + v), up(locs, t * 3 + v), north(locs, t * 3 + v)]);
      const ax = p[1][0] - p[0][0], ay = p[1][1] - p[0][1], az = p[1][2] - p[0][2], bx2 = p[2][0] - p[0][0], by2 = p[2][1] - p[0][1], bz = p[2][2] - p[0][2];
      const nx = ay * bz - az * by2, ny = az * bx2 - ax * bz, nz = ax * by2 - ay * bx2, length = Math.hypot(nx, ny, nz);
      if (!length || Math.abs(ny) / length > 0.3) continue;
      const high = Math.max(p[0][1], p[1][1], p[2][1]) / 128, low = Math.min(p[0][1], p[1][1], p[2][1]) / 128;
      const gx = Math.floor(px(p[0][0])), gy = Math.floor(py(p[0][2]));
      const ground = gx >= 0 && gy >= 0 && gx < W && gy < H && top[gy * W + gx] > -Infinity ? top[gy * W + gx] / 128 : 0;
      if (low > ground + 1.2 || high - low < 0.4) continue; // roofs, upper floors and small clutter
      line(px(p[0][0]), py(p[0][2]), px(p[1][0]), py(p[1][2])); line(px(p[1][0]), py(p[1][2]), px(p[2][0]), py(p[2][2]));
    }
    for (let i = 0; i < W * H; i++) if (wall[i]) rgba.set([226, 222, 210, 255], i * 4);
    files.write(`minimap/${bx}_${by}.png`, this.o.encodePng(W, H, rgba)); result.minimap = true;
    // the world map's overview: one pixel per tile (rows bottom-up, like the tile grid)
    for (let ty = 0; ty < th; ty++) for (let tx = 0; tx < tw; tx++) {
      const sum = [0, 0, 0];
      for (let y = 0; y < MAP_SCALE; y++) for (let x = 0; x < MAP_SCALE; x++) { const i = ((H - 1 - (ty * MAP_SCALE + y)) * W + tx * MAP_SCALE + x) * 4; sum[0] += rgba[i]; sum[1] += rgba[i + 1]; sum[2] += rgba[i + 2]; }
      overview.set([...sum.map((v) => Math.round(v / (MAP_SCALE * MAP_SCALE))), 255], (tx + ty * tw) * 4);
    }
    return output;
  }

  /**
   * Joins the finished blocks (handed back one at a time by `block`): manifests, the traversal map, the minimap
   * overview and the town runes. Returns the cache textures the area uses.
   */
  assemble(block: (bx: number, by: number) => BlockOutput): { textures: number[] } {
    const { name, area, files, log, warn } = this.o, { areaX, areaY, sizeX, sizeY, blocksX, blocksY } = this;
    const chunks: RenderChunkRecord[] = [], cells: CollisionIndex['cells'] = [], textures = new Set<number>(), tiles: [number, number][] = [];
    const traversal = new Uint8Array(sizeX * sizeY), heights = new Float32Array(sizeX * sizeY), overview = new Uint8Array(sizeX * sizeY * 4);
    const totals: Stats = { terrain: 0, locs: 0, solid: 0, clutter: 0, rails: 0, kept: 0, removed: 0, water: 0, voids: 0 };
    for (let by = 0; by < blocksY; by++) for (let bx = 0; bx < blocksX; bx++) {
      const { result, traversal: trav, heights: hf, overview: ov } = block(bx, by);
      chunks.push(...result.chunks); cells.push(...result.cells); for (const t of result.textures) textures.add(t);
      if (result.minimap) tiles.push([bx, by]);
      for (const key of Object.keys(totals) as (keyof Stats)[]) totals[key] += result.stats[key];
      const B = this.block * 64, tx0 = bx * B, ty0 = by * B, tw = Math.min(B, sizeX - tx0), th = Math.min(B, sizeY - ty0);
      for (let y = 0; y < th; y++) {
        traversal.set(trav.subarray(y * tw, (y + 1) * tw), tx0 + (ty0 + y) * sizeX);
        heights.set(hf.subarray(y * tw, (y + 1) * tw), tx0 + (ty0 + y) * sizeX);
        overview.set(ov.subarray(y * tw * 4, (y + 1) * tw * 4), (tx0 + (ty0 + y) * sizeX) * 4);
      }
    }
    files.write('traversal.bin', traversal);
    const render: RenderManifest = { version: 3, cellSize: CELL, triangles: chunks.reduce((n, c) => n + c.triangles, 0), vertices: chunks.reduce((n, c) => n + c.vertices, 0), bytes: chunks.reduce((n, c) => n + c.bytes, 0), chunks };
    files.write('render/manifest.json', JSON.stringify(render));
    const index: CollisionIndex = { version: 2, cell: CELL, margin: MARGIN, cells };
    files.write('collision/index.json', JSON.stringify(index));
    // world map overview, north up (image rows run top-down)
    const image = new Uint8Array(sizeX * sizeY * 4);
    for (let y = 0; y < sizeY; y++) image.set(overview.subarray(y * sizeX * 4, (y + 1) * sizeX * 4), (sizeY - 1 - y) * sizeX * 4);
    for (let i = 0; i < sizeX * sizeY; i++) if (!image[i * 4 + 3]) image.set([11, 26, 20, 255], i * 4);
    files.write('minimap/overview.png', this.o.encodePng(sizeX, sizeY, image));
    files.write('minimap.json', JSON.stringify({ version: 2, scale: MAP_SCALE, width: sizeX * MAP_SCALE, height: sizeY * MAP_SCALE, block: this.block * 64, tiles, overview: 'minimap/overview.png' }));

    // town runes (THPS letters) above the real grind lines around each teleport spot, decided here once
    const rails: Rail[] = [], text = new TextDecoder();
    for (const [cx, cy, , , railCount] of cells) if (railCount) rails.push(...JSON.parse(text.decode(files.read(`collision/${cx}_${cy}.rails.json`))) as Rail[]);
    const terrainAt = (x: number, z: number) => { const tx = Math.floor(x), ty = Math.floor(-z); return tx >= 0 && ty >= 0 && tx < sizeX && ty < sizeY && traversal[tx + ty * sizeX] !== 2 ? heights[tx + ty * sizeX] : null; };
    const places = placesIn([areaX, areaY], [sizeX, sizeY]);
    const runes = places.flatMap((place) => placeRunes(place, rails.filter((r) => Math.hypot((r.a.x + r.b.x) / 2 - place.x, (r.a.z + r.b.z) / 2 - place.z) < 60), terrainAt))
      .map((rune) => ({ id: rune.id, place: rune.place, kind: rune.kind, position: [+rune.position.x.toFixed(3), +rune.position.y.toFixed(3), +rune.position.z.toFixed(3)] }));
    files.write('runes.json', JSON.stringify(runes));
    // every teleport should land on open, dry ground
    for (const place of places) {
      const i = Math.floor(place.x) + Math.floor(-place.z) * sizeX;
      if (traversal[i]) warn(`  teleport ${place.id} lands on ${traversal[i] === 1 ? 'water' : 'void'}`);
    }
    files.write('manifest.json', JSON.stringify({
      name, format: 2, baseTile: [areaX, areaY], sizeTiles: [sizeX, sizeY], spawn: [area.spawn[0] - areaX, area.spawn[1] - areaY],
      treeCover: { density: this.o.treeDensity, kept: totals.kept, removed: totals.removed },
    }));
    log(`World ${name}: ${sizeX}x${sizeY} tiles, ${totals.terrain.toLocaleString()} terrain + ${totals.locs.toLocaleString()} object triangles (${totals.solid.toLocaleString()} solid, ${totals.clutter} clutter objects ridden through)`);
    log(`  ${chunks.length} render chunks (${(render.bytes / 1e6).toFixed(0)} MB), ${cells.length} collision cells, ${totals.rails} grind segments, ${runes.length} town runes in ${places.length} places`);
    log(`  ${totals.water} water and ${totals.voids} void tiles; trees ${totals.kept} kept, ${totals.removed} removed`);
    return { textures: [...textures].sort((a, b) => a - b) };
  }
}
