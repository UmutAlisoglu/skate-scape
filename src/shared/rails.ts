import type { Point, Rail } from '../game/skater.ts';

/** The measured top of one wall/fence object: a polyline that may rise and fall (hills, bridge arches). */
export interface RailPiece { id: string; name: string; width: number; points: Point[] }

/** Ends of different pieces closer than this (and within WELD_HEIGHT vertically) become one shared point. */
export const WELD = 0.32, WELD_HEIGHT = 0.5;

const key = (p: Point) => `${Math.round(p.x * 1000)},${Math.round(p.y * 1000)},${Math.round(p.z * 1000)}`;

/**
 * Turns measured wall/fence tops into grind segments that connect. Touching ends of neighbouring pieces
 * (tile boundaries, corners, sloped steps) are welded to one shared point, so a grind can follow a whole
 * fence up hills and round corners; straight runs with a steady slope are then merged into one segment.
 */
export function connectRails(pieces: RailPiece[]): Rail[] {
  const usable = pieces.filter((piece) => piece.points.length >= 2).map((piece) => ({ ...piece, points: piece.points.map((p) => ({ ...p })) }));
  // 1. weld piece ends (union-find over a spatial hash)
  const ends: Point[] = [], owner: number[] = [];
  usable.forEach((piece, i) => { ends.push(piece.points[0], piece.points[piece.points.length - 1]); owner.push(i, i); });
  const parent = ends.map((_, i) => i);
  const find = (i: number): number => { while (parent[i] !== i) i = parent[i] = parent[parent[i]]; return i; };
  const cell = (v: number) => Math.floor(v / WELD);
  const grid = new Map<string, number[]>();
  ends.forEach((p, i) => { const k = `${cell(p.x)},${cell(p.z)}`; const list = grid.get(k); if (list) list.push(i); else grid.set(k, [i]); });
  ends.forEach((p, i) => {
    for (let gx = -1; gx <= 1; gx++) for (let gz = -1; gz <= 1; gz++) for (const j of grid.get(`${cell(p.x) + gx},${cell(p.z) + gz}`) ?? []) {
      if (j <= i || owner[j] === owner[i]) continue;
      const q = ends[j];
      if (Math.hypot(q.x - p.x, q.z - p.z) <= WELD && Math.abs(q.y - p.y) <= WELD_HEIGHT) parent[find(j)] = find(i);
    }
  });
  const clusters = new Map<number, Point[]>();
  ends.forEach((p, i) => { const root = find(i); const list = clusters.get(root); if (list) list.push(p); else clusters.set(root, [p]); });
  for (const members of clusters.values()) {
    if (members.length < 2) continue;
    const x = members.reduce((s, p) => s + p.x, 0) / members.length, y = members.reduce((s, p) => s + p.y, 0) / members.length, z = members.reduce((s, p) => s + p.z, 0) / members.length;
    for (const p of members) { p.x = x; p.y = y; p.z = z; }
  }

  // 2. one segment per polyline step
  const at = new Map<string, Set<Rail>>();
  const add = (rail: Rail) => { for (const p of [rail.a, rail.b]) { const k = key(p); let set = at.get(k); if (!set) at.set(k, set = new Set()); set.add(rail); } };
  const remove = (rail: Rail) => { for (const p of [rail.a, rail.b]) at.get(key(p))?.delete(rail); };
  for (const piece of usable) {
    for (let i = 1; i < piece.points.length; i++) {
      const a = piece.points[i - 1], b = piece.points[i];
      if (Math.hypot(b.x - a.x, b.z - a.z) < 0.05) continue;
      add({ id: piece.points.length > 2 ? `${piece.id}#${i}` : piece.id, name: piece.name, width: piece.width, a: { ...a }, b: { ...b } });
    }
  }

  // 3. merge straight runs with a steady slope through nodes shared by exactly two segments
  for (let changed = true; changed;) {
    changed = false;
    for (const [k, set] of at) {
      if (set.size !== 2) continue;
      const [first, second] = [...set];
      const node = key(first.a) === k ? first.a : first.b;
      const from = key(first.a) === k ? first.b : first.a, to = key(second.a) === k ? second.b : second.a;
      if (key(from) === key(to)) continue;
      const d1x = node.x - from.x, d1z = node.z - from.z, d2x = to.x - node.x, d2z = to.z - node.z;
      const l1 = Math.hypot(d1x, d1z), l2 = Math.hypot(d2x, d2z);
      if ((d1x * d2x + d1z * d2z) / (l1 * l2) < 0.9994) continue; // more than 2 degrees of bend
      if (Math.abs(from.y + (to.y - from.y) * (l1 / (l1 + l2)) - node.y) > 0.03) continue; // the slope changes here
      remove(first); remove(second);
      add({ ...first, a: from, b: to, width: Math.max(first.width ?? 0.08, second.width ?? 0.08) });
      changed = true;
    }
  }
  const result = new Set<Rail>();
  for (const set of at.values()) for (const rail of set) result.add(rail);
  return [...result];
}
