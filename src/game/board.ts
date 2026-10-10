import * as THREE from 'three';
import type { Skater } from './skater.ts';
import type { GrabKind } from './tricks.ts';
import { deckTexture, type DeckDesign } from './decks.ts';
import { dampAngle, ease } from '../shared/motion.ts';
import { gammaColor, rsMaterial } from '../world/rs-material.ts';

/** Grab tweaks: the hand pulls the board up on one side (radians: nose up, yaw, roll toward the toe side). */
const GRAB_TWEAK: Record<GrabKind, [number, number, number]> = {
  indy: [0.06, 0, 0.22], melon: [0.04, 0, -0.26], method: [0.1, 0.25, -0.5], nosegrab: [0.34, 0, 0.05], tailgrab: [-0.34, 0, 0.05],
};
/** Deck rotation relative to the trucks' frame: flip tricks spin it by their spin spec over the trick's duration. */
export function deckAttitude(skater: Pick<Skater, 'trick' | 'manual' | 'noseManual' | 'charge' | 'grab' | 'speed'>, steer = 0): [number, number, number] {
  if (skater.trick) {
    const t = ease(skater.trick.elapsed / skater.trick.duration), s = skater.trick.spin, turn = Math.PI * 2;
    return [t * s.pitch * turn, t * s.shove * turn, t * s.flip * turn];
  }
  if (skater.grab) return GRAB_TWEAK[skater.grab.kind];
  const lean = -steer * Math.min(skater.speed / 9, 1) * 0.1;
  if (skater.manual) return [skater.noseManual ? -0.14 : 0.14, 0, lean];
  return [skater.charge * -0.025, 0, lean];
}

/** Deck shape: half length and width (m), where the kicks start, the top height and the ply thickness. */
const DECK = { half: 0.52, width: 0.14, flat: 0.33, top: 0.132, thick: 0.035 };
const halfWidth = (z: number) => { const end = Math.abs(z) - (DECK.half - DECK.width); return end <= 0 ? DECK.width : DECK.width * Math.sqrt(Math.max(0.0025, 1 - (end / DECK.width) ** 2)); };
const kick = (z: number) => (Math.abs(z) > DECK.flat ? (Math.abs(z) - DECK.flat) ** 1.3 * 0.55 : 0);
/** A popsicle deck: rounded nose and tail kicked up, slight concave; grip on top, graphic underneath. */
function deckGeometry() {
  const rows: number[] = [];
  for (let i = 0; i <= 28; i++) { const t = i / 28; rows.push(-DECK.half + DECK.half * 2 * (0.5 - 0.5 * Math.cos(t * Math.PI))); }
  const top: number[] = [], bottom: number[] = [], sides: number[] = [], uv: number[] = [];
  const point = (z: number, side: number, lift: number): number[] => { const w = halfWidth(z); return [w * side, DECK.top + kick(z) - (side === 0 ? 0.005 : 0) - lift, z]; };
  for (let i = 0; i < rows.length - 1; i++) {
    const z0 = rows[i], z1 = rows[i + 1];
    for (const [a, b] of [[-1, 0], [0, 1]]) {
      top.push(...point(z0, a, 0), ...point(z1, a, 0), ...point(z1, b, 0), ...point(z0, a, 0), ...point(z1, b, 0), ...point(z0, b, 0));
      const quad = [point(z0, a, DECK.thick), point(z0, b, DECK.thick), point(z1, b, DECK.thick), point(z0, a, DECK.thick), point(z1, b, DECK.thick), point(z1, a, DECK.thick)];
      for (const p of quad) { bottom.push(...p); uv.push((DECK.width - p[0]) / (DECK.width * 2), 1 - (p[2] + DECK.half) / (DECK.half * 2)); }
    }
    for (const s of [-1, 1]) {
      const [a, b, c, d] = [point(z0, s, 0), point(z1, s, 0), point(z1, s, DECK.thick), point(z0, s, DECK.thick)];
      sides.push(...(s < 0 ? [...a, ...d, ...c, ...a, ...c, ...b] : [...a, ...b, ...c, ...a, ...c, ...d]));
    }
  }
  const geometry = (points: number[]) => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(points, 3)); g.computeVertexNormals(); return g; };
  const under = geometry(bottom); under.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return { top: geometry(top), bottom: under, sides: geometry(sides) };
}

/** Procedural deck (no extra cache assets): RS-lit grip and plies, with an unlit painted graphic underneath. */
export class Skateboard {
  readonly root = new THREE.Group();
  private deck = new THREE.Group();
  private wheels: THREE.Mesh[] = [];
  private deckMaterial = rsMaterial({ color: 0xc8a06a, side: THREE.DoubleSide });
  private truckMaterial = rsMaterial({ color: 0x5a6064 });
  private wheelMaterial = rsMaterial({ color: 0x8a8068 });
  private graphic = new THREE.MeshBasicMaterial({ color: 0xc0c0c0, side: THREE.DoubleSide });
  constructor() {
    this.root.rotation.order = 'YXZ';
    const shape = deckGeometry();
    const grip = new THREE.Mesh(shape.top, rsMaterial({ color: 0x232d2c, side: THREE.DoubleSide }));
    this.deck.add(grip, new THREE.Mesh(shape.sides, this.deckMaterial), new THREE.Mesh(shape.bottom, this.graphic));
    const wheelGeometry = new THREE.CylinderGeometry(0.055, 0.055, 0.065, 10);
    wheelGeometry.rotateZ(Math.PI / 2);
    const wheelMaterial = this.wheelMaterial;
    for (const z of [-0.32, 0.32]) {
      const truck = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.025, 0.035), this.truckMaterial);
      truck.position.set(0, 0.075, z);
      this.deck.add(truck);
      for (const x of [-0.17, 0.17]) {
        const wheel = new THREE.Mesh(wheelGeometry, wheelMaterial);
        wheel.position.set(x, 0.055, z);
        this.wheels.push(wheel);
        this.deck.add(wheel);
      }
    }
    this.root.add(this.deck);
  }

  setDeck([x, y, z]: [number, number, number]) { this.deck.rotation.set(x, y, z); }
  get deckAngles(): [number, number, number] { return [this.deck.rotation.x, this.deck.rotation.y, this.deck.rotation.z]; }
  /** The deck's underside graphic (see decks.ts); the plies stay wood-coloured. */
  setDesign(design: DeckDesign) { this.graphic.map = deckTexture(design); this.graphic.needsUpdate = true; }
  /** The board's metal (boards.ts): plies, trucks and wheels; the graphic underneath stays. */
  setTier(tier: { color: number; trim: number; wheel: number }) {
    (this.deckMaterial.uniforms.baseColor.value as THREE.Color).copy(gammaColor(tier.color));
    (this.truckMaterial.uniforms.baseColor.value as THREE.Color).copy(gammaColor(tier.trim));
    (this.wheelMaterial.uniforms.baseColor.value as THREE.Color).copy(gammaColor(tier.wheel));
  }

  update(skater: Skater, dt: number, steer: number) {
    this.root.position.set(skater.position.x, skater.position.y - (skater.grinding ? 0.08 : 0), skater.position.z);
    this.root.rotation.y = skater.heading;
    this.root.rotation.x = skater.pitch;
    const [x, y, z] = deckAttitude(skater, steer);
    // flips are exact over the trick; everything else eases in
    const rate = skater.trick ? 60 : 18;
    this.deck.rotation.x = dampAngle(this.deck.rotation.x, x, rate, dt);
    this.deck.rotation.y = dampAngle(this.deck.rotation.y, y, rate, dt);
    this.deck.rotation.z = dampAngle(this.deck.rotation.z, z, rate, dt);
    for (const wheel of this.wheels) wheel.rotation.x -= skater.speed * dt / 0.055;
  }
}
