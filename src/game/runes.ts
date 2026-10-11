import * as THREE from 'three';
import type { LocalPlace } from './places.ts';
import type { Rail } from './skater.ts';

/** RS elemental runes hidden in each town, THPS letter-style: above real grind lines, one of them up high. */
export const RUNE_KINDS = [
  { name: 'Air rune', color: 0xf2f2f2 }, { name: 'Water rune', color: 0x3f8cff }, { name: 'Earth rune', color: 0x5fae4a },
  { name: 'Fire rune', color: 0xff5a2a }, { name: 'Cosmic rune', color: 0xf3e04a },
];
export interface TownRune { id: string; place: string; kind: number; position: THREE.Vector3 }
export const RUNE_XP = { each: 1500, set: 15000 };

/** Deterministic choice (the same spots every session) from a string. */
function hash(text: string) { let h = 2166136261; for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

/**
 * Picks five rune spots around a place from its grind lines: four at ollie height (0.4-1.4 m above the ground),
 * one higher (1.4-3 m: a wallride, kicker or quarter pipe gets you there), spread at least 9 m apart.
 */
export function placeRunes(place: LocalPlace, rails: Rail[], terrainAt: (x: number, z: number, y: number) => number | null): TownRune[] {
  const candidates = rails.flatMap((rail) => {
    const length = Math.hypot(rail.b.x - rail.a.x, rail.b.z - rail.a.z);
    const x = (rail.a.x + rail.b.x) / 2, z = (rail.a.z + rail.b.z) / 2, y = (rail.a.y + rail.b.y) / 2;
    if (length < 2.5 || Math.hypot(x - place.x, z - place.z) > 45) return [];
    const ground = terrainAt(x, z, y + 0.1);
    if (ground === null) return [];
    return [{ x, y, z, height: y - ground, key: hash(`${place.id}:${rail.id}`) }];
  }).sort((a, b) => a.key - b.key);
  const chosen: typeof candidates = [];
  const take = (low: number, high: number, count: number) => {
    for (const c of candidates) {
      if (chosen.length >= 5 || count <= 0) return;
      if (c.height < low || c.height > high || chosen.some((o) => Math.hypot(o.x - c.x, o.z - c.z) < 9)) continue;
      chosen.push(c); count--;
    }
  };
  take(1.4, 3, 1); take(0.4, 1.4, 5 - chosen.length); take(0.2, 3, 5 - chosen.length);
  return chosen.map((c, i) => ({ id: `${place.id}-rune-${i}`, place: place.id, kind: i % RUNE_KINDS.length, position: new THREE.Vector3(c.x, c.y + 0.85, c.z) }));
}

/** The rune tokens in the scene: spinning, bobbing, with a soft beam so they can be spotted from a distance. */
export class RuneTokens {
  private readonly meshes = new Map<string, THREE.Group>();
  private readonly beamGeometry = new THREE.CylinderGeometry(0.05, 0.05, 6, 6, 1, true).translate(0, 3, 0);
  readonly runes: TownRune[] = [];
  constructor(private readonly scene: THREE.Scene, runes: TownRune[], private readonly collected: (id: string) => boolean) { this.add(runes); }
  /** Places more runes (a town whose streets were just built in the browser). */
  add(runes: TownRune[]) {
    const { scene, collected, beamGeometry } = this;
    for (const rune of runes) {
      if (this.runes.some((r) => r.id === rune.id)) continue;
      this.runes.push(rune);
      if (collected(rune.id)) continue;
      const color = RUNE_KINDS[rune.kind].color, group = new THREE.Group();
      const stone = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.42, 0.1), new THREE.MeshBasicMaterial({ color: 0x8c8a86 }));
      const glyph = new THREE.Mesh(new THREE.OctahedronGeometry(0.11), new THREE.MeshBasicMaterial({ color }));
      glyph.position.z = 0.06;
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.03, 6, 20), new THREE.MeshBasicMaterial({ color }));
      const beam = new THREE.Mesh(beamGeometry, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.25, depthWrite: false }));
      beam.position.y = -0.85;
      group.add(stone, glyph, ring, beam); group.position.copy(rune.position);
      scene.add(group); this.meshes.set(rune.id, group);
    }
  }
  /** Animates and returns the runes the rider touches this frame (removed from the scene). */
  update(time: number, rider: THREE.Vector3) {
    const touched: TownRune[] = [];
    for (const rune of this.runes) {
      const mesh = this.meshes.get(rune.id);
      if (!mesh) continue;
      mesh.rotation.y = time / 500; mesh.position.y = rune.position.y + Math.sin(time / 380 + rune.kind) * 0.08;
      mesh.visible = mesh.position.distanceToSquared(rider) < 90 * 90;
      if (Math.hypot(rider.x - rune.position.x, rider.y + 0.7 - rune.position.y, rider.z - rune.position.z) < 1.1) {
        mesh.parent?.remove(mesh); this.meshes.delete(rune.id); touched.push(rune);
      }
    }
    return touched;
  }
  remaining(place: string) { return this.runes.filter((r) => r.place === place && this.meshes.has(r.id)); }
}
