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
    this.camera.fov += ((62 + speed * 0.9) - this.camera.fov) * (1 - Math.exp(-4 * dt));
    this.camera.updateProjectionMatrix();
    this.desired.copy(this.camera.position);
    collision.placeCamera(this.controls.target, this.desired, this.camera.position);
  }
  restore() { this.camera.position.copy(this.desired); }
}
