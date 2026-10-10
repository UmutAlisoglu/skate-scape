import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import type { Point, SkateWorld, Rail } from '../game/skater.ts';
import type { Ramp } from '../game/transition.ts';
import { decodeSoup, loadJson, type CollisionIndex } from './load.ts';

const RAIL_CELL = 8;
/** height of a lip the capsule ignores (see move) */
const STEP = 0.12;
type Cell = { tree: MeshBVH; box: THREE.Box3 };

/**
 * World-space collision; rendering and collision use different geometry. Static trees (terrain first, then
 * parks and props) are always queried; streamed cells (see CollisionStream) only where a query overlaps them.
 */
export class WorldCollision implements SkateWorld {
  private allRails: Rail[] = [];
  /** quarter pipes from quick-drop props (their riding faces are analytic, see transition.ts) */
  ramps: Ramp[] = [];
  private railGrid = new Map<string, Rail[]>();
  private traversal: { width: number; height: number; data: Uint8Array } | null = null;
  private trees: MeshBVH[];
  private cells = new Map<string, Cell>();
  private nearby: MeshBVH[] = [];
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

  addGeometry(geometry: THREE.BufferGeometry) { const tree = new MeshBVH(geometry); this.trees.push(tree); return tree; }
  removeTree(tree: MeshBVH) { this.trees = this.trees.filter((t) => t !== tree); }
  /** Adds (geometry) or drops (null) one streamed collision cell. */
  setCell(key: string, geometry: THREE.BufferGeometry | null) {
    if (!geometry) { this.cells.delete(key); return; }
    geometry.computeBoundingBox();
    this.cells.set(key, { tree: new MeshBVH(geometry), box: geometry.boundingBox!.clone() });
  }
  hasCell(key: string) { return this.cells.has(key); }
  get cellCount() { return this.cells.size; }

  get rails() { return this.allRails; }
  set rails(list: Rail[]) {
    this.allRails = list; this.railGrid.clear();
    for (const rail of list) {
      const x0 = Math.floor(Math.min(rail.a.x, rail.b.x) / RAIL_CELL), x1 = Math.floor(Math.max(rail.a.x, rail.b.x) / RAIL_CELL);
      const z0 = Math.floor(Math.min(rail.a.z, rail.b.z) / RAIL_CELL), z1 = Math.floor(Math.max(rail.a.z, rail.b.z) / RAIL_CELL);
      for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
        const key = `${x},${z}`, cell = this.railGrid.get(key);
        if (cell) cell.push(rail); else this.railGrid.set(key, [rail]);
      }
    }
  }
  /** Rails with any part within `radius` (up to one grid cell) of a point. */
  railsNear(x: number, z: number, radius = 2): Rail[] {
    const found = new Set<Rail>();
    for (let gx = Math.floor((x - radius) / RAIL_CELL); gx <= Math.floor((x + radius) / RAIL_CELL); gx++)
      for (let gz = Math.floor((z - radius) / RAIL_CELL); gz <= Math.floor((z + radius) / RAIL_CELL); gz++)
        for (const rail of this.railGrid.get(`${gx},${gz}`) ?? []) found.add(rail);
    return [...found];
  }

  /** Static trees plus streamed cells overlapping the horizontal box. */
  private treesIn(minX: number, minZ: number, maxX: number, maxZ: number): MeshBVH[] {
    if (!this.cells.size) return this.trees;
    this.nearby.length = 0;
    for (const tree of this.trees) this.nearby.push(tree);
    for (const cell of this.cells.values()) {
      const b = cell.box;
      if (b.max.x >= minX && b.min.x <= maxX && b.max.z >= minZ && b.min.z <= maxZ) this.nearby.push(cell.tree);
    }
    return this.nearby;
  }
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
    for (const tree of terrainOnly ? this.trees.slice(0, 1) : [...this.treesIn(x, z, x, z)]) {
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
    for (const tree of [...this.treesIn(Math.min(target.x, desired.x), Math.min(target.z, desired.z), Math.max(target.x, desired.x), Math.max(target.z, desired.z))]) {
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
      const reach = this.radius + 0.1;
      const trees = [...this.treesIn(this.position.x - reach, this.position.z - reach, this.position.x + reach, this.position.z + reach)];
      for (let pass = 0; pass < 4; pass++) {
        let corrected = false;
        for (const tree of trees) {
          this.segment.start.copy(this.position).y += this.radius + 0.02;
          this.segment.end.copy(this.position).y += this.height - this.radius;
          this.box.makeEmpty().expandByPoint(this.segment.start).expandByPoint(this.segment.end).expandByScalar(this.radius);
          tree.shapecast({
            intersectsBounds: (box) => box.intersectsBox(this.box),
            intersectsTriangle: (triangle) => {
              // lips within a few centimetres of the feet (rug edges, tile seams, deck boards) are ridden over:
              // the ground follower steps onto them, so the capsule shouldn't bump on their sides
              if (Math.max(triangle.a.y, triangle.b.y, triangle.c.y) < this.position.y + STEP) return false;
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

/**
 * Streams collision cells around a point: fetches cells within `radius` and builds at most one BVH per update
 * so crossing into new streets never stalls a frame for long. Built cells stay cached until the loaded total
 * passes `budget` triangles; then the farthest ones go first, so riding back through a block costs nothing.
 */
export class CollisionStream {
  private pending = new Map<string, Promise<void>>();
  private ready: { key: string; geometry: THREE.BufferGeometry }[] = [];
  private constructor(private base: string, private collision: WorldCollision, private index: CollisionIndex, private radius: number, private budget = 1_800_000) {}
  static async load(base: string, collision: WorldCollision, radius = 44) {
    return new CollisionStream(base, collision, await loadJson<CollisionIndex>(`${base}/collision/index.json`), radius);
  }
  get loading() { return this.pending.size + this.ready.length; }
  private within(p: Point, radius: number) {
    const size = this.index.cell, tx = p.x, ty = -p.z, keys: string[] = [];
    for (const [cx, cy] of this.index.cells) {
      const dx = Math.max(cx * size - tx, 0, tx - (cx + 1) * size), dy = Math.max(cy * size - ty, 0, ty - (cy + 1) * size);
      if (dx * dx + dy * dy <= radius * radius) keys.push(`${cx}_${cy}`);
    }
    return keys;
  }
  private fetchCell(key: string) {
    let job = this.pending.get(key);
    if (!job) {
      job = fetch(`${this.base}/collision/${key}.bin`).then(async (response) => {
        if (!response.ok) throw new Error(`collision cell ${key}: HTTP ${response.status}`);
        this.ready.push({ key, geometry: decodeSoup(await response.arrayBuffer(), key, { positionsOnly: true }).opaque });
      }).finally(() => this.pending.delete(key));
      this.pending.set(key, job);
    }
    return job;
  }
  private build(limit: number) {
    for (let i = 0; i < limit && this.ready.length; i++) {
      const { key, geometry } = this.ready.shift()!;
      if (!this.collision.hasCell(key)) this.collision.setCell(key, geometry);
    }
  }
  /** Loads everything near a point before gameplay starts or a teleport lands. */
  async preload(p: Point) {
    await Promise.all(this.within(p, this.radius).filter((key) => !this.collision.hasCell(key)).map((key) => this.fetchCell(key)));
    this.build(Infinity);
  }
  update(p: Point) {
    const wanted = new Set(this.within(p, this.radius));
    for (const key of wanted) if (!this.collision.hasCell(key) && !this.pending.has(key) && this.pending.size < 4 && !this.ready.some((r) => r.key === key)) void this.fetchCell(key);
    this.build(1);
    const size = this.index.cell, loaded = this.index.cells.filter(([cx, cy]) => this.collision.hasCell(`${cx}_${cy}`));
    let total = loaded.reduce((sum, cell) => sum + cell[2], 0);
    if (total <= this.budget) return;
    const distance = ([cx, cy]: [number, number, number]) => Math.hypot((cx + 0.5) * size - p.x, (cy + 0.5) * size + p.z);
    for (const cell of loaded.sort((a, b) => distance(b) - distance(a))) {
      const key = `${cell[0]}_${cell[1]}`;
      if (total <= this.budget || wanted.has(key)) break;
      this.collision.setCell(key, null); total -= cell[2];
    }
  }
}
