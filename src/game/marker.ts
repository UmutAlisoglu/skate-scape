import * as THREE from 'three';
import type { Point, Skater } from './skater.ts';

/** skate.'s session marker shown as an RS hint arrow: remembers a spot, direction and speed to retry a line. */
export class SessionMarker {
  saved: { position: Point; heading: number; speed: number } | null = null;
  private readonly arrow = new THREE.Group();
  private readonly pointer = new THREE.Group();
  constructor(scene: THREE.Scene) {
    const yellow = new THREE.MeshBasicMaterial({ color: 0xf2d22c, fog: false }), dark = new THREE.MeshBasicMaterial({ color: 0x5a4708, fog: false });
    const head = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.38, 4), yellow); head.rotation.x = Math.PI; head.position.y = 0.19;
    const shaft = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.32, 0.13), yellow); shaft.position.y = 0.52;
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.52, 24), dark); ring.rotation.x = -Math.PI / 2;
    const glow = new THREE.Mesh(new THREE.RingGeometry(0.3, 0.42, 24), yellow); glow.rotation.x = -Math.PI / 2;
    this.pointer.add(head, shaft);
    this.arrow.add(this.pointer, ring, glow); this.arrow.visible = false; scene.add(this.arrow);
  }
  /** Saves the spot while rolling on the ground; returns the message to show. */
  set(skater: Skater) {
    if (!skater.grounded || skater.grinding || skater.bailTime > 0) return 'Land first, then set your session marker';
    this.saved = { position: { ...skater.position }, heading: skater.travelHeading, speed: skater.speed };
    this.arrow.position.set(skater.position.x, skater.position.y + 0.03, skater.position.z); this.arrow.visible = true;
    return `Session marker set · ${(skater.speed * 3.6).toFixed(0)} km/h · X to return`;
  }
  get position() { return this.saved?.position ?? null; }
  update(time: number) {
    if (!this.arrow.visible) return;
    this.pointer.position.y = 1.7 + Math.sin(time / 260) * 0.12; this.pointer.rotation.y = time / 900;
  }
}
