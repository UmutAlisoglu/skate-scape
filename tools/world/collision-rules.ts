// Which exported objects are solid, and which tops become grind lines. Grass and wall decorations must not
// trap the skater; walls, fences, benches and flat-topped blocks give grind lines.
import type { Defs } from '../cache/defs.ts';
import type { RailPiece } from '../../src/shared/rails.ts';

/** One placed object's triangles in a soup. Tile coordinates are relative to the exported map's corner. */
export interface PlacedTriangles { id: number; name: string; type: number; rot: number; plane: number; x: number; y: number; first: number; count: number }

const debris = /rock|stone|pebble|rubble|boulder|debris|stump|root|log|branch|twig|skull|bones|pot|jug|bucket|sack|basket/i;
/** skateable furniture keeps its collision whatever it's made of (stone blocks, benches, steps...) */
const skateable = /block|wall|ledge|step|stair|bench|table|crate|counter|stall|chest|altar|pillar|plinth|bridge/i;
const decorativePlant = /grass|flower|daisies|bush|shrub|plant|weed|reeds|fern|nettle|thistle|mushroom|fungus|lily|seaweed|wheat|corn|cabbage|potato|onion|flax|herb|vine|ivy|cactus|sapling|fire|smoke/i;

/**
 * Marks the solid triangles of the placed objects and measures grind lines on walls, fences and blocks.
 * `vertex(t, v, axis)` reads a corner in metres on three.js axes (x east, y up, z south), relative to the map
 * corner. `tileBase` (absolute world tile of the map corner) keeps rail ids unique across the whole world.
 */
export function classifyLocs(placed: PlacedTriangles[], triangles: number, vertex: (t: number, v: number, axis: number) => number, defs: Defs, tileBase: [number, number]) {
  const solid = new Uint8Array(triangles);
  const pieces: RailPiece[] = [];
  let clutter = 0;

  const extent = (first: number, length: number) => {
    let low = Infinity, high = -Infinity, minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let t = first; t < first + length; t++) for (let v = 0; v < 3; v++) {
      const x = vertex(t, v, 0), y = vertex(t, v, 1), z = vertex(t, v, 2);
      low = Math.min(low, y); high = Math.max(high, y); minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
    }
    return { low, high, minX, maxX, minZ, maxZ };
  };
  /**
   * Something a rolling board shouldn't stop on: anything below 0.5 m and at most 2 m across, and rocks,
   * stones, stumps and other debris up to about waist height and 2.6 m across (players kept getting stuck on them).
   */
  const isClutter = (first: number, length: number, name: string) => {
    if (skateable.test(name)) return false;
    const e = extent(first, length), height = e.high - e.low, across = Math.hypot(e.maxX - e.minX, e.maxZ - e.minZ);
    return (height <= 0.5 && across <= 2) || (debris.test(name) && height <= 0.9 && across <= 2.6);
  };
  /** The edges of a block's flat top (0.35-1.6 m up, a real top face, not a pillar or pyramid), or null. */
  const blockTop = (first: number, length: number) => {
    const { low, high, minX, maxX, minZ, maxZ } = extent(first, length);
    if (high - low < 0.35 || high - low > 1.6 || Math.hypot(maxX - minX, maxZ - minZ) > 3.5) return null;
    let tx0 = Infinity, tx1 = -Infinity, tz0 = Infinity, tz1 = -Infinity;
    for (let t = first; t < first + length; t++) for (let v = 0; v < 3; v++) if (vertex(t, v, 1) >= high - 0.05) {
      tx0 = Math.min(tx0, vertex(t, v, 0)); tx1 = Math.max(tx1, vertex(t, v, 0)); tz0 = Math.min(tz0, vertex(t, v, 2)); tz1 = Math.max(tz1, vertex(t, v, 2));
    }
    const area = (tx1 - tx0) * (tz1 - tz0), footprint = (maxX - minX) * (maxZ - minZ);
    if (!(area >= 0.2 && area >= footprint * 0.45)) return null;
    const corners = [[tx0, tz0], [tx1, tz0], [tx1, tz1], [tx0, tz1]];
    return corners.map(([x, z], i) => { const [nx, nz] = corners[(i + 1) % 4]; return [{ x, y: high, z }, { x: nx, y: high, z: nz }]; })
      .filter(([a, b]) => Math.hypot(b.x - a.x, b.z - a.z) >= 0.5);
  };
  /** Mostly upward-facing, thin and at least half a tile in area: something you can stand on. */
  const isFloor = (first: number, length: number) => {
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
  };

  for (const loc of placed) {
    if (decorativePlant.test(loc.name) || (loc.type >= 4 && loc.type <= 8)) continue;
    const { first, count: length } = loc;
    // Ground decoration is passable (grass, flowers, debris) unless it blocks walking, is a known obstacle,
    // or is a walkable floor such as bridge decks and planks.
    if (loc.type === 22 && defs.loc(loc.id).blockwalk !== 1 && !/rock|boulder|fence|barrier|crate|statue/i.test(loc.name) && !isFloor(first, length)) continue;
    // Small clutter (pebbles, rocks, rubble, stumps, sacks, pots...) is ridden through instead of stopping you.
    // Walls and fences (however low), floors and flat-topped blocks (ledges to grind) stay solid.
    if (!isFloor(first, length) && isClutter(first, length, loc.name) && !(loc.type <= 3 || loc.type === 9) && !blockTop(first, length)) { clutter++; continue; }
    solid.fill(1, first, first + length);
    const id = `loc-${loc.id}-${loc.plane}-${loc.type}-${loc.rot}-${tileBase[0] + loc.x}-${tileBase[1] + loc.y}`;
    const name = loc.name === 'null' ? 'Stone ledge' : loc.name;
    // walls (straight, corner, diagonal) and fence-like objects: their tops become grind lines
    if (!/door/i.test(loc.name) && (loc.type <= 3 || loc.type === 9 || /fence|railing|bench/i.test(loc.name))) {
      const vertices: number[][] = [];
      for (let t = first; t < first + length; t++) for (let v = 0; v < 3; v++) vertices.push([vertex(t, v, 0), vertex(t, v, 1), vertex(t, v, 2)]);
      const groups = loc.type === 2 ? splitCorner(vertices, loc.x, loc.y) : [vertices];
      groups.forEach((group, i) => {
        const top = topLine(group);
        if (top) pieces.push({ id: `${id}${groups.length > 1 ? `-${i}` : ''}`, name, ...top });
      });
    } else if ((loc.type === 10 || loc.type === 11) && !/door|tree|bush|plant|statue|sign|lamp|torch|banner|flag|gate/i.test(loc.name)) {
      // blocky objects with a flat top (stone blocks, low ruin walls, crates, stalls): the top's edges are ledges,
      // and a row of blocks welds into one long ledge on each side
      const top = blockTop(first, length);
      if (top) top.forEach((edge, k) => pieces.push({ id: `${id}-e${k}`, name, width: 0.1, points: edge }));
    }
  }
  return { solid, pieces, clutter };
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
