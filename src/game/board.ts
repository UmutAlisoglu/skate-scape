import * as THREE from 'three';
import type { Skater } from './skater.ts';
import { dampAngle, ease } from '../shared/motion.ts';
import { rsMaterial, gammaColor } from '../world/rs-material.ts';

/** Procedural placeholder deck; no additional cache assets required. */
export class Skateboard {
  readonly root = new THREE.Group();
  private deck = new THREE.Group();
  private wheels: THREE.Mesh[] = [];
  private deckMaterial = rsMaterial({ color: 0x4c3b25 });
  constructor() {
    this.root.rotation.order = 'YXZ';
    const outline = new THREE.Shape();
    outline.moveTo(-0.14, -0.38);
    outline.lineTo(-0.14, 0.38);
    outline.quadraticCurveTo(-0.14, 0.52, 0, 0.52);
    outline.quadraticCurveTo(0.14, 0.52, 0.14, 0.38);
    outline.lineTo(0.14, -0.38);
    outline.quadraticCurveTo(0.14, -0.52, 0, -0.52);
    outline.quadraticCurveTo(-0.14, -0.52, -0.14, -0.38);
    const geometry = new THREE.ExtrudeGeometry(outline, { depth: 0.035, bevelEnabled: false, curveSegments: 6 });
    geometry.rotateX(-Math.PI / 2);
    const deck = new THREE.Mesh(geometry, this.deckMaterial);
    deck.position.y = 0.095;
    const grip = new THREE.Mesh(new THREE.ShapeGeometry(outline), rsMaterial({ color: 0x232d2c, side: THREE.DoubleSide }));
    grip.rotation.x = -Math.PI / 2;
    grip.position.y = 0.132;
    this.deck.add(deck, grip);
    const wheelGeometry = new THREE.CylinderGeometry(0.055, 0.055, 0.065, 10);
    wheelGeometry.rotateZ(Math.PI / 2);
    const wheelMaterial = rsMaterial({ color: 0xe4d7b6 });
    for (const z of [-0.32, 0.32]) {
      const truck = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.025, 0.035), rsMaterial({ color: 0x99a1a6 }));
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

  setColor(color: number) { this.deckMaterial.uniforms.baseColor.value.copy(gammaColor(color)); }

  update(skater: Skater, dt: number, steer: number) {
    this.root.position.set(skater.position.x, skater.position.y - (skater.grinding ? 0.08 : 0), skater.position.z);
    this.root.rotation.y = skater.heading;
    this.root.rotation.x = skater.pitch;
    const progress = skater.trick ? ease(skater.trick.elapsed / skater.trick.duration) : 0;
    this.deck.rotation.x=dampAngle(this.deck.rotation.x,skater.manual?0.14:skater.charge*-0.025,24,dt);
    this.deck.rotation.y=dampAngle(this.deck.rotation.y,skater.trick?.kind==='shove'?progress*Math.PI*2:0,45,dt);
    this.deck.rotation.z=dampAngle(this.deck.rotation.z,skater.trick?.kind==='flip'?progress*Math.PI*2:-steer*Math.min(skater.speed/9,1)*0.1,45,dt);
    for (const wheel of this.wheels) wheel.rotation.x -= skater.speed * dt / 0.055;
  }
}
