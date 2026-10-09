import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import type { Point, SkateWorld, Rail } from '../game/skater.ts';

/** Static world-space meshes; rendering and collision can use different geometry. */
export class WorldCollision implements SkateWorld {
  rails: Rail[] = [];
  private traversal: { width: number; height: number; data: Uint8Array } | null = null;
  private trees: MeshBVH[];
  private ray = new THREE.Ray(new THREE.Vector3(), new THREE.Vector3(0, -1, 0));
  private segment = new THREE.Line3();
  private box = new THREE.Box3();
  private trianglePoint = new THREE.Vector3();
  private capsulePoint = new THREE.Vector3();
  private correction = new THREE.Vector3();
  private normal = new THREE.Vector3();
  private position = new THREE.Vector3();
  private readonly radius = 0.22;
  private readonly height = 1.5;

  constructor(geometries: THREE.BufferGeometry[]) {
    this.trees = geometries.filter((g) => g.getAttribute('position').count > 0).map((geometry) => new MeshBVH(geometry));
  }

  addGeometry(geometry: THREE.BufferGeometry) { this.trees.push(new MeshBVH(geometry)); }
  setTraversal(width: number, height: number, data: Uint8Array) {
    if (data.length !== width * height) throw new Error('Traversal map size does not match the world');
    this.traversal = { width, height, data };
  }
  canRideAt(x: number, z: number, y: number): boolean {
    if (!this.traversal) return true;
    const tx = Math.floor(x), ty = Math.floor(-z), map = this.traversal;
    if (tx < 0 || ty < 0 || tx >= map.width || ty >= map.height || !map.data[tx + ty * map.width]) return true;
    const terrain = this.groundAt(x,z,y+0.46,true), support = this.groundAt(x,z,y+0.46);
    return terrain !== null && support !== null && support > terrain + 0.12;
  }

  groundAt(x: number, z: number, fromY: number, terrainOnly = false): number | null {
    this.ray.origin.set(x, fromY, z);
    this.ray.direction.set(0, -1, 0);
    let y: number | null = null;
    for (const tree of terrainOnly ? this.trees.slice(0, 1) : this.trees) {
      // Accept walkable slopes; winding in the cache can vary.
      const hits = tree.raycast(this.ray, THREE.DoubleSide, 0, 30);
      for (const hit of hits) {
        if (!hit.face || Math.abs(hit.face.normal.y) < 0.65) continue;
        if (y === null || hit.point.y > y) y = hit.point.y;
      }
    }
    return y;
  }

  /** Pull the rendered camera in front of walls, while preserving its orbit distance. */
  placeCamera(target: THREE.Vector3, desired: THREE.Vector3, result: THREE.Vector3): THREE.Vector3 {
    this.ray.origin.copy(target);
    this.ray.direction.subVectors(desired, target);
    let distance = this.ray.direction.length();
    if (distance === 0) return result.copy(target);
    this.ray.direction.multiplyScalar(1 / distance);
    for (const tree of this.trees) {
      const hit = tree.raycastFirst(this.ray, THREE.DoubleSide, 0.05, distance);
      if (hit) distance = Math.min(distance, Math.max(0.1, hit.distance - 0.2));
    }
    return result.copy(target).addScaledVector(this.ray.direction, distance);
  }

  move(from: Point, delta: Point): Point & { blocked: boolean; normal?: Point } {
    this.position.set(from.x, from.y, from.z);
    // A fast skater cannot skip through a thin wall between frames.
    const steps = Math.max(1, Math.ceil(Math.hypot(delta.x, delta.y, delta.z) / 0.1));
    let blocked = false;
    let impact = 0;
    let contact: Point | undefined;
    for (let step = 0; step < steps; step++) {
      this.position.x += delta.x / steps;
      this.position.y += delta.y / steps;
      this.position.z += delta.z / steps;
      for (let pass = 0; pass < 4; pass++) {
        let corrected = false;
        for (const tree of this.trees) {
          this.segment.start.copy(this.position).y += this.radius + 0.02;
          this.segment.end.copy(this.position).y += this.height - this.radius;
          this.box.makeEmpty().expandByPoint(this.segment.start).expandByPoint(this.segment.end).expandByScalar(this.radius);
          tree.shapecast({
            intersectsBounds: (box) => box.intersectsBox(this.box),
            intersectsTriangle: (triangle) => {
              const distance = triangle.closestPointToSegment(this.segment, this.trianglePoint, this.capsulePoint);
              if (distance >= this.radius - 0.00001) return false;
              this.correction.subVectors(this.capsulePoint, this.trianglePoint);
              if (distance < 0.00001) {
                triangle.getNormal(this.correction);
                this.normal.copy(this.segment.start).add(this.segment.end).multiplyScalar(0.5).sub(this.trianglePoint);
                if (this.correction.dot(this.normal) < 0) this.correction.negate();
              } else this.correction.multiplyScalar(1 / distance);
              this.correction.multiplyScalar(this.radius - distance + 0.00001);
              triangle.getNormal(this.normal);
              if (Math.abs(this.normal.y) < 0.65 && Math.hypot(this.correction.x, this.correction.z) > 0.0001) {
                blocked = true;
                const horizontal = Math.hypot(this.correction.x, this.correction.z);
                const nx = this.correction.x / horizontal, nz = this.correction.z / horizontal;
                const strength = -(delta.x * nx + delta.z * nz);
                if (strength > impact) { impact = strength; contact = { x: nx, y: 0, z: nz }; }
              }
              this.position.add(this.correction);
              this.segment.start.add(this.correction);
              this.segment.end.add(this.correction);
              corrected = true;
              return false;
            },
          });
        }
        if (!corrected) break;
      }
    }
    return { x: this.position.x, y: this.position.y, z: this.position.z, blocked, normal: contact };
  }
}
