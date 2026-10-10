import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { rsMaterial, type Surfaces } from '../world/rs-material.ts';
import type { WorldCollision } from '../world/collision.ts';
import { box, mirrorZ, planarUv, quarterShape, wedge, PLANKS, STONE, type Part } from './props.ts';
import { rampTop, type Ramp } from './transition.ts';
import type { Rail } from './skater.ts';

/**
 * Skate 4-style mega ramp: a tower you climb, a long roll-in, a curved kicker that throws you ~9 m up over a gap,
 * a long landing and a vert quarter pipe at the end. The kicker and the quarter pipe are analytic transitions.
 */
export const MEGA = { width: 7, tower: 10, towerDepth: 4, rollIn: 22, flat: 3, kicker: { radius: 8, height: 3.2, deck: 1 }, gap: 8, landingDeck: 2, landing: 18, landingHeight: 3.5, runout: 8,
  quarter: { width: 8, radius: 4.5, height: 4.2, deck: 1.8 },
  /** on its ramps: top speed (m/s) and downhill gravity multiplier */
  boostCap: 19, slopeBoost: 1.8 };
/** A landmark's place on the map: world tile, facing (eighths of a turn, from the site search) and its base height (m). */
export interface Site { id: string; name: string; tile: [number, number]; heading: number; top: number }
export const MEGA_RAMPS: Site[] = [
  { id: 'lumbridge', name: 'Lumbridge mega ramp', tile: [3242, 3298], heading: 5, top: 3.26 },
  { id: 'falador', name: 'Falador mega ramp', tile: [3004, 3316], heading: 4, top: 3.75 },
  { id: 'desert', name: 'Desert mega ramp', tile: [3290, 3114], heading: 3, top: 3.16 },
  { id: 'seers', name: "Seers' mega ramp", tile: [2746, 3478], heading: 4, top: 3.31 },
];
/** Catapults: ride onto the pad and you're thrown to another town. */
export interface CatapultSite { id: string; name: string; tile: [number, number]; top: number; to: string }
export const CATAPULTS: CatapultSite[] = [
  { id: 'lumbridge', name: 'Lumbridge catapult', tile: [3251, 3233], top: 2.03, to: 'varrock' },
  { id: 'varrock', name: 'Varrock catapult', tile: [3222, 3431], top: 2.19, to: 'falador' },
  { id: 'falador', name: 'Falador catapult', tile: [2992, 3377], top: 2.56, to: 'lumbridge' },
  { id: 'ardougne', name: 'Ardougne catapult', tile: [2658, 3310], top: 2.5, to: 'castlewars' },
  { id: 'castlewars', name: 'Castle Wars catapult', tile: [2463, 3098], top: 1.92, to: 'ardougne' },
  { id: 'canifis', name: 'Canifis catapult', tile: [3495, 3484], top: 3.75, to: 'varrock' },
];

const kickerTop = rampTop(MEGA.kicker as Ramp), quarterTop = rampTop(MEGA.quarter as Ramp);
const total = MEGA.towerDepth + MEGA.rollIn + MEGA.flat + kickerTop.w + MEGA.kicker.deck + MEGA.gap + MEGA.landingDeck + MEGA.landing + MEGA.runout + quarterTop.w + MEGA.quarter.deck;

interface Built { site: Site; group: THREE.Group; inverse: THREE.Matrix4; length: number }
export interface BuiltCatapult { site: CatapultSite; group: THREE.Group; arm: THREE.Object3D; pad: THREE.Vector3; swing: number; cooldown: number }

/** Builds the mega ramps and catapults on this map: their geometry, solid collision, grind lines and quarter pipes. */
export class Landmarks {
  readonly ramps: Built[] = [];
  readonly catapults: BuiltCatapult[] = [];
  private materials: Record<Part['material'], THREE.Material>;
  private local = new THREE.Vector3();
  constructor(private scene: THREE.Scene, private collision: WorldCollision, surfaces: Surfaces | null, private localTile: (tile: [number, number]) => THREE.Vector3 | null) {
    this.materials = {
      wood: rsMaterial({ surfaces, textureId: PLANKS, color: 0xa47a4c, cutout: true }),
      stone: rsMaterial({ surfaces, textureId: STONE, color: 0x8c877d, cutout: true }),
      metal: rsMaterial({ color: 0x55666c, cutout: true }),
    };
    const rails: Rail[] = [], ramps: Ramp[] = [];
    for (const site of MEGA_RAMPS) { const built = this.buildMegaRamp(site, rails, ramps); if (built) this.ramps.push(built); }
    for (const site of CATAPULTS) { const built = this.buildCatapult(site); if (built) this.catapults.push(built); }
    collision.rails = [...collision.rails, ...rails];
    collision.ramps = [...collision.ramps, ...ramps];
  }

  private place(group: THREE.Group, parts: Part[], solids: THREE.BufferGeometry[]) {
    group.updateMatrixWorld(true);
    for (const part of parts) {
      if (part.material !== 'metal') planarUv(part.geometry);
      group.add(new THREE.Mesh(part.geometry, this.materials[part.material]));
      if (part.solid) solids.push(part.geometry.clone().applyMatrix4(group.matrixWorld).deleteAttribute('normal').deleteAttribute('uv'));
    }
  }

  private buildMegaRamp(site: Site, rails: Rail[], ramps: Ramp[]): Built | null {
    const at = this.localTile(site.tile);
    if (!at) return null;
    const M = MEGA, W = M.width, heading = (site.heading * Math.PI) / 4, top = site.top + 0.25;
    const group = new THREE.Group(); group.name = site.name;
    group.position.set(at.x, top, at.z); group.rotation.y = heading; group.updateMatrixWorld(true);
    const zTower = -M.towerDepth, zRollEnd = zTower - M.rollIn, zKick = zRollEnd - M.flat, zKickEnd = zKick - kickerTop.w - M.kicker.deck;
    const zLanding = zKickEnd - M.gap, zSlope = zLanding - M.landingDeck, zLandingEnd = zSlope - M.landing, zQuarter = zLandingEnd - M.runout;
    const parts: Part[] = [
      // a stone slab levels the ground under the whole thing
      { geometry: box(W + 2, 3, total + 10, 0, -1.5, -(total + 10) / 2 + 2), material: 'stone', solid: true },
      { geometry: box(W, M.tower, M.towerDepth, 0, M.tower / 2, zTower / 2), material: 'wood', solid: true },
      { geometry: mirrorZ(wedge(W, 0, -M.rollIn, M.tower)).translate(0, 0, zRollEnd), material: 'wood', solid: true },
      // the landing: a short flat deck at the top (so a slow jump still lands on something), then a long slope
      { geometry: box(W, M.landingHeight, M.landingDeck, 0, M.landingHeight / 2, zLanding - M.landingDeck / 2), material: 'wood', solid: true },
      { geometry: mirrorZ(wedge(W, 0, -M.landing, M.landingHeight)).translate(0, 0, zLandingEnd), material: 'wood', solid: true },
      // the ladder up the back of the tower
      ...[-0.45, 0.45].map((x) => ({ geometry: box(0.08, M.tower, 0.08, x, M.tower / 2, 0.15), material: 'metal' as const, solid: false })),
      ...Array.from({ length: Math.floor((M.tower - 0.4) / 0.48) }, (_, i) => ({ geometry: box(0.9, 0.05, 0.05, 0, 0.4 + i * 0.48, 0.15), material: 'metal' as const, solid: false })),
    ];
    const solids: THREE.BufferGeometry[] = [];
    this.place(group, parts, solids);
    // the kicker and the quarter pipe are curved transitions (their faces are ridden analytically)
    const kickGroup = new THREE.Group(); kickGroup.position.z = zKick; group.add(kickGroup);
    this.place(kickGroup, quarterShape({ width: W, ...M.kicker }).parts, solids);
    const quarterGroup = new THREE.Group(); quarterGroup.position.z = zQuarter; group.add(quarterGroup);
    const qp = quarterShape(M.quarter);
    this.place(quarterGroup, qp.parts, solids);
    this.scene.add(group);
    this.collision.addGeometry(mergeGeometries(solids)!);
    const world = (x: number, y: number, z: number) => { const p = new THREE.Vector3(x, y, z).applyMatrix4(group.matrixWorld); return { x: p.x, y: p.y, z: p.z }; };
    // grind lines: the slab's long edges, the tower top's sides, the kicker lip and the quarter pipe's coping
    const h = W / 2 + 1, slabEnd = -total - 8;
    rails.push(
      ...[-h, h].map((x, i) => ({ id: `mega-${site.id}-slab${i}`, name: 'Mega ramp ledge', width: 0.1, a: world(x, 0, 1.5), b: world(x, 0, slabEnd) })),
      ...[-W / 2, W / 2].map((x, i) => ({ id: `mega-${site.id}-tower${i}`, name: 'Tower edge', width: 0.1, a: world(x, M.tower, 0), b: world(x, M.tower, zTower) })),
      { id: `mega-${site.id}-coping`, name: 'Coping', width: 0.07, ...(() => { const r = qp.rails[0]; return { a: world(r.a[0], r.a[1], r.a[2] + zQuarter), b: world(r.b[0], r.b[1], r.b[2] + zQuarter) }; })() },
    );
    ramps.push({ id: `mega-${site.id}-kicker`, origin: world(0, 0, zKick), yaw: heading, width: W, ...M.kicker });
    ramps.push({ id: `mega-${site.id}`, origin: world(0, 0, zQuarter), yaw: heading, ...M.quarter });
    // a sign on the tower
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(5, 1.25), new THREE.MeshBasicMaterial({ map: signTexture('MEGA RAMP'), transparent: true, side: THREE.DoubleSide }));
    sign.position.set(W / 2 + 0.02, M.tower - 1.2, zTower / 2); sign.rotation.y = Math.PI / 2; group.add(sign);
    return { site, group, inverse: group.matrixWorld.clone().invert(), length: total + 8 };
  }

  private buildCatapult(site: CatapultSite): BuiltCatapult | null {
    const at = this.localTile(site.tile);
    if (!at) return null;
    const group = new THREE.Group(); group.name = site.name;
    group.position.set(at.x, site.top, at.z);
    const parts: Part[] = [
      { geometry: box(3.2, 0.2, 3.2, 0, 0.1, -2.2), material: 'wood', solid: true },
      ...[-0.9, 0.9].map((x) => ({ geometry: box(0.25, 1.4, 2.6, x, 0.7, 0.6), material: 'wood' as const, solid: true })),
      { geometry: box(2.1, 0.2, 0.2, 0, 1.3, 0.6), material: 'metal', solid: false },
    ];
    this.place(group, parts, []);
    const arm = new THREE.Group(); arm.position.set(0, 1.3, 0.6);
    const beam = new THREE.Mesh(box(0.25, 0.25, 4, 0, 0, -1.6), this.materials.wood), cup = new THREE.Mesh(box(0.9, 0.35, 0.9, 0, 0.1, -3.6), this.materials.wood);
    arm.add(beam, cup); arm.rotation.x = -0.5; group.add(arm);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(2.8, 0.7), new THREE.MeshBasicMaterial({ map: signTexture(`TO ${site.to.toUpperCase()}`), transparent: true, side: THREE.DoubleSide }));
    sign.position.set(0, 1.9, 1.95); group.add(sign);
    this.scene.add(group);
    group.updateMatrixWorld(true);
    const pad = new THREE.Vector3(0, 0.2, -2.2).applyMatrix4(group.matrixWorld);
    return { site, group, arm, pad, swing: 0, cooldown: 0 };
  }

  /** The mega ramp the rider is on (for its speed boost), if any. */
  megaAt(position: { x: number; y: number; z: number }) {
    for (const r of this.ramps) {
      const p = this.local.set(position.x, position.y, position.z).applyMatrix4(r.inverse);
      if (Math.abs(p.x) < MEGA.width / 2 + 1.2 && p.z < 2 && p.z > -r.length && p.y > -1.5) return r;
    }
    return null;
  }
  /** The mega ramp whose ladder the rider is at (standing on the slab or on lower ground behind it). */
  ladderAt(position: { x: number; y: number; z: number }) {
    return this.ramps.find((r) => { const p = this.local.set(position.x, position.y, position.z).applyMatrix4(r.inverse); return Math.hypot(p.x, p.z - 1.2) < 2.6 && p.y > -3.5 && p.y < 1.5; }) ?? null;
  }
  /** Where you stand at the top of a mega ramp, facing down the roll-in. */
  towerTop(r: Built) {
    const p = new THREE.Vector3(0, MEGA.tower, -1.2).applyMatrix4(r.group.matrixWorld);
    return { position: p, heading: r.group.rotation.y };
  }
  /** A catapult within a few metres (for the hint). */
  catapultNear(position: { x: number; z: number }) {
    return this.catapults.find((c) => Math.hypot(c.pad.x - position.x, c.pad.z - position.z) < 7) ?? null;
  }
  /** Teleport spots: the foot of each mega ramp's ladder and beside each catapult's pad. */
  spots(places: { id: string; name: string }[]) {
    const at = (group: THREE.Object3D, x: number, z: number) => { const p = group.localToWorld(new THREE.Vector3(x, 0, z)); return { x: p.x, z: p.z }; };
    return [
      ...this.ramps.map((r) => ({ id: `mega-${r.site.id}`, name: r.site.name, blurb: 'Climb the tower, drop in and send it over the gap', ...at(r.group, 0, 2.6) })),
      ...this.catapults.map((c) => ({ id: `catapult-${c.site.id}`, name: c.site.name, blurb: `Roll onto the pad to fly to ${places.find((p) => p.id === c.site.to)?.name ?? c.site.to}`, ...at(c.group, 3.5, -2.2) })),
    ];
  }
  /** A catapult whose pad the rider has just rolled onto. */
  catapultAt(position: { x: number; y: number; z: number }) {
    return this.catapults.find((c) => c.cooldown <= 0 && Math.hypot(c.pad.x - position.x, c.pad.z - position.z) < 1.7 && Math.abs(c.pad.y - position.y) < 1.2) ?? null;
  }
  /** The arm draws back while the destination loads (the rider waits in the cup). */
  windUp(c: BuiltCatapult) { c.cooldown = Infinity; c.swing = -1; }
  /**
   * Fires a catapult at a target point: the arm swings, and the velocity (m/s) that lands the rider there comes back.
   * It's a high lob (50°+ coming down) so you drop into the town instead of skimming into its walls.
   */
  fire(c: BuiltCatapult, target: THREE.Vector3) {
    c.swing = 1; c.cooldown = 6;
    const dx = target.x - c.pad.x, dz = target.z - c.pad.z, distance = Math.hypot(dx, dz), dy = target.y - c.pad.y;
    const horizontal = Math.max(20, Math.min(40, distance / 6)), time = distance / horizontal, gravity = 14;
    return { vx: (dx / distance) * horizontal, vy: (dy + 0.5 * gravity * time * time) / time, vz: (dz / distance) * horizontal, time };
  }
  /** Faces every catapult toward its destination (once positions are known) and animates the arms. */
  update(dt: number, aim: (to: string) => THREE.Vector3 | null) {
    for (const c of this.catapults) {
      c.cooldown = Math.max(0, c.cooldown - dt);
      if (!c.group.userData.aimed) {
        const target = aim(c.site.to);
        if (target) { c.group.rotation.y = Math.atan2(-(target.x - c.group.position.x), -(target.z - c.group.position.z)); c.group.userData.aimed = true; c.group.updateMatrixWorld(true); c.pad.set(0, 0.2, -2.2).applyMatrix4(c.group.matrixWorld); }
      }
      if (c.swing < 0) c.arm.rotation.x = THREE.MathUtils.damp(c.arm.rotation.x, -0.85, 3, dt);
      else if (c.swing > 0) { c.swing = Math.max(0, c.swing - dt * 0.6); c.arm.rotation.x = -0.5 + Math.sin(Math.min(1, (1 - c.swing) * 4) * Math.PI / 2) * 2.1 * Math.min(1, c.swing * 3); }
    }
  }
}

/** A painted wooden sign in RS gold lettering. */
function signTexture(text: string) {
  const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 128;
  const c = canvas.getContext('2d')!;
  c.fillStyle = '#3b2a16'; c.fillRect(0, 0, 512, 128); c.strokeStyle = '#d4b674'; c.lineWidth = 8; c.strokeRect(6, 6, 500, 116);
  c.font = 'bold 64px Georgia, serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillStyle = '#ffd76a'; c.fillText(text, 256, 68, 480);
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
