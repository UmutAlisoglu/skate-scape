import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { Point } from './skater.ts';
import type { WorldCollision } from '../world/collision.ts';

export class ChaseCamera {
  readonly controls: OrbitControls;
  follow = true;
  private desired = new THREE.Vector3();
  private target = new THREE.Vector3();
  private previous = new THREE.Vector3();
  private offset = new THREE.Vector3();
  private initialized = false;
  private dragging = false;
  private manualUntil = 0;
  constructor(private camera: THREE.PerspectiveCamera, canvas: HTMLElement) {
    this.controls = new OrbitControls(camera, canvas);
    this.controls.enableDamping = true; this.controls.enablePan = false;
    this.controls.minDistance = 1.5; this.controls.maxDistance = 18; this.controls.maxPolarAngle = Math.PI * 0.49;
    this.controls.addEventListener('start', () => { this.dragging = true; });
    this.controls.addEventListener('end', () => { this.dragging = false; this.manualUntil = performance.now() + 2000; });
  }
  snap(position: Point, heading: number) {
    this.controls.target.set(position.x,position.y+0.85,position.z);
    this.camera.position.set(position.x+Math.sin(heading)*4.8,position.y+2.6,position.z+Math.cos(heading)*4.8);
    this.previous.set(position.x,position.y,position.z); this.initialized = true; this.manualUntil = 0;
    this.controls.update();
  }
  update(position: Point, heading: number, speed: number, skating: boolean, dt: number, collision: WorldCollision) {
    this.target.set(position.x, position.y + 0.85, position.z);
    if (!this.initialized) { this.previous.set(position.x, position.y, position.z); this.initialized = true; }
    const automatic = skating && this.follow && !this.dragging && performance.now() > this.manualUntil;
    if (automatic) {
      const distance = 4.6 + speed * 0.12;
      this.desired.set(position.x + Math.sin(heading) * distance, position.y + 2.6, position.z + Math.cos(heading) * distance);
      this.camera.position.lerp(this.desired, 1 - Math.exp(-5 * dt));
    } else {
      this.offset.set(position.x, position.y, position.z).sub(this.previous);
      this.camera.position.add(this.offset);
    }
    this.previous.set(position.x, position.y, position.z);
    this.controls.target.lerp(this.target, 1 - Math.exp(-14 * dt)); this.controls.update();
    this.camera.fov += ((62 + Math.min(speed, 30) * 0.9) - this.camera.fov) * (1 - Math.exp(-4 * dt));
    this.camera.updateProjectionMatrix();
    this.desired.copy(this.camera.position);
    // walls, roofs, arches and trees between the camera and the rider dissolve (the RS shader's cutout), so the
    // camera keeps its distance instead of jumping in or climbing over them; it only stays above the terrain
    const terrain = collision.groundAt(this.camera.position.x, this.camera.position.z, this.camera.position.y + 20, true);
    if (terrain !== null && this.camera.position.y < terrain + 0.6) this.camera.position.y = terrain + 0.6;
    // never closer than this to the rider (inside the cape is all black): look down from above instead
    if (this.camera.position.distanceTo(this.controls.target) < 1.3) {
      this.camera.position.set(this.controls.target.x + Math.sin(heading) * 0.7, this.controls.target.y + 1.8, this.controls.target.z + Math.cos(heading) * 0.7);
    }
  }
  restore() { this.camera.position.copy(this.desired); }
}
