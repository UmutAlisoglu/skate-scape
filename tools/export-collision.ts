// Export only solid loc faces. Grass and wall decorations must not trap the skater.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { CacheStore } from './cache/store.ts';
import { Defs } from './cache/defs.ts';
import type { CollisionIndex, PlacedLoc } from '../src/world/load.ts';
import { connectRails, type RailPiece } from '../src/shared/rails.ts';
import { soupPositions } from '../src/shared/soup.ts';

const area = process.argv[2] ?? 'lumbridge';
if (!/^[a-z0-9_-]+$/i.test(area)) throw new Error('Invalid area name');
const base = `public/world/${area}`;
const manifestJson = JSON.parse(readFileSync(`${base}/manifest.json`, 'utf8'));
const work = `work/world/${area}`;
const placedLocs: PlacedLoc[] = manifestJson.locs ?? JSON.parse(readFileSync(`${work}/locs.json`, 'utf8'));
const data = readFileSync(`${work}/locs.bin`);
const count = data.readUInt32LE(0);
if (data.length !== 4 + count * 22) throw new Error('Invalid locs.bin length');
const solid = new Uint8Array(count);
const defs = new Defs(new CacheStore('vendor/2009scape-cache'));
const pieces: RailPiece[] = [];
const positions = soupPositions(data.buffer, data.byteOffset, count);
const vertex = (t: number, v: number, axis: number) => positions[t * 9 + v * 3 + axis] / 128;
/** Below shin height and at most ~1.6 m across: something a rolling board shouldn't crash on. */
let clutter = 0;
function isClutter(first: number, length: number) {
  let low = Infinity, high = -Infinity, minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let t = first; t < first + length; t++) for (let v = 0; v < 3; v++) {
    const x = vertex(t, v, 0), y = vertex(t, v, 1), z = vertex(t, v, 2);
    low = Math.min(low, y); high = Math.max(high, y); minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
  }
  return high - low <= 0.45 && Math.hypot(maxX - minX, maxZ - minZ) <= 1.6;
}
/** Mostly upward-facing, thin and at least half a tile in area: something you can stand on. */
function isFloor(first: number, length: number) {
  let up = 0, total = 0, low = Infinity, high = -Infinity;
  for (let t = first; t < first + length; t++) {
    const ax = vertex(t, 1, 0) - vertex(t, 0, 0), ay = vertex(t, 1, 1) - vertex(t, 0, 1), az = vertex(t, 1, 2) - vertex(t, 0, 2);
    const bx = vertex(t, 2, 0) - vertex(t, 0, 0), by = vertex(t, 2, 1) - vertex(t, 0, 1), bz = vertex(t, 2, 2) - vertex(t, 0, 2);
    const nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
    const area = Math.hypot(nx, ny, nz) / 2;
    total += area;
    if (Math.abs(ny) / (2 * area || 1) > 0.9) up += area;
    for (let v = 0; v < 3; v++) { low = Math.min(low, vertex(t, v, 1)); high = Math.max(high, vertex(t, v, 1)); }
  }
  return up > 0.5 && up / (total || 1) > 0.45 && high - low < 0.6;
}
/**
 * The top of one wall/fence piece as a polyline along its long axis. Heights are sampled at most 1 m apart from
 * the vertices near each sample, so the line follows sloped ground and arches instead of sitting flat at the
 * highest point. Returns null for shapes that are not a reachable, thin, wall-like run.
 */
function topLine(vertices: number[][]): { width: number; points: { x: number; y: number; z: number }[] } | null {
  if (vertices.length < 3) return null;
  let cx = 0, cz = 0, xx = 0, zz = 0, xz = 0, low = Infinity, high = -Infinity;
  for (const [x, y, z] of vertices) { cx += x; cz += z; xx += x * x; zz += z * z; xz += x * z; low = Math.min(low, y); high = Math.max(high, y); }
  const n = vertices.length; cx /= n; cz /= n;
  const angle = 0.5 * Math.atan2(2 * (xz / n - cx * cz), (xx / n - cx * cx) - (zz / n - cz * cz));
  const ax = Math.cos(angle), az = Math.sin(angle);
  const along = vertices.map(([x, , z]) => (x - cx) * ax + (z - cz) * az);
  const across = vertices.map(([x, , z]) => -(x - cx) * az + (z - cz) * ax);
  const lo = Math.min(...along), hi = Math.max(...along), acrossLo = Math.min(...across), acrossHi = Math.max(...across);
  const width = acrossHi - acrossLo, middle = (acrossLo + acrossHi) / 2;
  if (!(high - low > 0.3 && high - low < 4.5 && hi - lo > 0.8 && hi - lo < 24 && width < 1.1)) return null;
  const start = lo + 0.05, end = hi - 0.05, steps = Math.max(1, Math.ceil((end - start) / 1));
  const samples: { s: number; y: number | null }[] = [];
  for (let k = 0; k <= steps; k++) {
    const s = start + ((end - start) * k) / steps;
    let y: number | null = null;
    vertices.forEach((v, i) => { if (Math.abs(along[i] - s) <= 0.25 && (y === null || v[1] > y)) y = v[1]; });
    samples.push({ s, y });
  }
  // fill samples with no nearby vertex (long flat faces) from their neighbours
  const known = samples.filter((p) => p.y !== null);
  if (!known.length) return null;
  for (const p of samples) if (p.y === null) {
    const before = [...known].reverse().find((q) => q.s < p.s), after = known.find((q) => q.s > p.s);
    p.y = before && after ? before.y! + (after.y! - before.y!) * (p.s - before.s) / (after.s - before.s) : (before ?? after)!.y;
  }
  // drop samples that lie on a straight line between their neighbours (Douglas-Peucker, 4 cm)
  const keep = new Set([0, samples.length - 1]);
  const simplify = (i: number, j: number) => {
    let worst = -1, distance = 0.04;
    for (let k = i + 1; k < j; k++) {
      const expected = samples[i].y! + (samples[j].y! - samples[i].y!) * (samples[k].s - samples[i].s) / (samples[j].s - samples[i].s);
      if (Math.abs(samples[k].y! - expected) > distance) { distance = Math.abs(samples[k].y! - expected); worst = k; }
    }
    if (worst >= 0) { keep.add(worst); simplify(i, worst); simplify(worst, j); }
  };
  simplify(0, samples.length - 1);
  const points = samples.filter((_, i) => keep.has(i)).map(({ s, y }) => ({ x: cx + ax * s - az * middle, y: y!, z: cz + az * s + ax * middle }));
  return { width: Math.max(0.08, width), points };
}
/** An L-shaped corner wall covers two adjacent edges of its tile: split its vertices by edge. */
function splitCorner(vertices: number[][], tileX: number, tileY: number): number[][][] {
  // tile edges in world units: west, north, east, south (north is the higher tile y, i.e. lower z)
  const edges = [(v: number[]) => Math.abs(v[0] - tileX), (v: number[]) => Math.abs(v[2] + tileY + 1), (v: number[]) => Math.abs(v[0] - tileX - 1), (v: number[]) => Math.abs(v[2] + tileY)];
  const counts = [0, 0, 0, 0];
  for (const v of vertices) { const d = edges.map((edge) => edge(v)); counts[d.indexOf(Math.min(...d))]++; }
  const order = [0, 1, 2, 3].sort((a, b) => counts[b] - counts[a]);
  const [e1, e2] = order;
  if ((e1 + 2) % 4 === e2 || !counts[e2]) return [vertices];
  const groups: number[][][] = [[], []];
  for (const v of vertices) groups[edges[e1](v) <= edges[e2](v) ? 0 : 1].push(v);
  return groups;
}
for (const placed of placedLocs) {
  const decorativePlant = /grass|flower|daisies|bush|reeds|fern|nettle|thistle|mushroom|lily|seaweed|wheat|cabbage|potato|onion|flax|fire|smoke/i.test(placed.name);
  if (decorativePlant || (placed.type >= 4 && placed.type <= 8)) continue;
  const [first, length] = placed.t;
  if (first < 0 || length < 0 || first + length > count) throw new Error(`Invalid triangle range for loc ${placed.id}`);
  // Ground decoration is passable (grass, flowers, debris) unless it blocks walking, is a known obstacle,
  // or is a walkable floor such as bridge decks and planks.
  if (placed.type === 22 && defs.loc(placed.id).blockwalk !== 1 && !/rock|boulder|fence|barrier|crate|statue/i.test(placed.name) && !isFloor(first, length)) continue;
  // Small clutter (pebbles, rubble, stumps, sacks, fungus...) is ridden through instead of bailing on it.
  // Long low things (curbs, ledges, low walls) and floors stay solid.
  if (placed.type !== 22 || !isFloor(first, length)) { if (isClutter(first, length) && !(placed.type <= 3 || placed.type === 9)) { clutter++; continue; } }
  solid.fill(1, first, first + length);
  // walls (straight, corner, diagonal) and fence-like objects: their tops become grind lines
  if (!/door/i.test(placed.name) && (placed.type <= 3 || placed.type === 9 || /fence|railing|bench/i.test(placed.name))) {
    const vertices: number[][] = [];
    for (let t = first; t < first + length; t++) for (let v = 0; v < 3; v++) vertices.push([vertex(t, v, 0), vertex(t, v, 1), vertex(t, v, 2)]);
    const groups = placed.type === 2 ? splitCorner(vertices, placed.x, placed.y) : [vertices];
    const name = placed.name === 'null' ? 'Stone ledge' : placed.name;
    groups.forEach((group, i) => {
      const top = topLine(group);
      if (top) pieces.push({ id: `loc-${placed.id}-${placed.plane}-${placed.type}-${placed.rot}-${placed.x}-${placed.y}${groups.length > 1 ? `-${i}` : ''}`, name, ...top });
    });
  }
}
// Collision streams in square cells (by triangle centroid) so a big world never loads all at once.
const CELL = 16;
const cells = new Map<string, number[]>();
let solidCount = 0;
for (let i = 0; i < count; i++) {
  if (!solid[i]) continue;
  solidCount++;
  const x = (vertex(i, 0, 0) + vertex(i, 1, 0) + vertex(i, 2, 0)) / 3, z = (vertex(i, 0, 2) + vertex(i, 1, 2) + vertex(i, 2, 2)) / 3;
  const key = `${Math.floor(x / CELL)}_${Math.floor(-z / CELL)}`;
  const list = cells.get(key); if (list) list.push(i); else cells.set(key, [i]);
}
const cellDir = `${base}/collision`;
if (existsSync(cellDir)) rmSync(cellDir, { recursive: true });
mkdirSync(cellDir, { recursive: true });
const index: CollisionIndex = { cell: CELL, cells: [] };
for (const [key, triangles] of cells) {
  const output = Buffer.alloc(4 + triangles.length * 22);
  output.writeUInt32LE(triangles.length);
  triangles.forEach((t, j) => {
    data.copy(output, 4 + j * 18, 4 + t * 18, 4 + (t + 1) * 18);
    // Collision is independent of visual transparency.
    output.fill(255, 4 + triangles.length * 18 + j * 4, 4 + triangles.length * 18 + (j + 1) * 4);
  });
  writeFileSync(`${cellDir}/${key}.bin`, output);
  const [cx, cy] = key.split('_').map(Number);
  index.cells.push([cx, cy, triangles.length]);
}
writeFileSync(`${cellDir}/index.json`, JSON.stringify(index));
if (existsSync(`${base}/collision.bin`)) rmSync(`${base}/collision.bin`);
const connectedRails = connectRails(pieces);
writeFileSync(`${base}/rails.json`, JSON.stringify(connectedRails));
console.log(`Wrote ${cellDir}: ${solidCount} solid triangles (${count} visual triangles) in ${cells.size} cells of ${CELL} tiles; largest ${Math.max(...[...cells.values()].map((c) => c.length))}`);
console.log(`Skipped ${clutter} small clutter objects (ridden through)`);
console.log(`Joined ${pieces.length} wall/fence tops into ${connectedRails.length} connected grind segments`);
