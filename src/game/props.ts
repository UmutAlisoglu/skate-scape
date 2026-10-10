import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { MeshBVH } from 'three-mesh-bvh';
import type { Rail } from './skater.ts';
import { rampTop, type Ramp } from './transition.ts';
import { rsMaterial, type Surfaces } from '../world/rs-material.ts';
import type { WorldCollision } from '../world/collision.ts';

/** Quick-drop obstacles (skate.'s object dropper): placed anywhere, saved per map on this browser. */
export type PropKind = 'kicker' | 'quarter' | 'rail' | 'ledge' | 'funbox' | 'bank';
export const PROP_KINDS: { kind: PropKind; label: string }[] = [
  { kind: 'kicker', label: 'Kicker' }, { kind: 'quarter', label: 'Quarter pipe' }, { kind: 'rail', label: 'Flat rail' },
  { kind: 'ledge', label: 'Ledge' }, { kind: 'funbox', label: 'Funbox' }, { kind: 'bank', label: 'Bank' },
];
export interface PropData { id: string; kind: PropKind; x: number; y: number; z: number; yaw: number }

// cache textures already used by the training grounds (all in the exported texture set)
const STONE = 72, PLANKS = 160;
/** Quarter pipe size: 82 degrees at the coping, so airs go straight up (vert) */
export const QUARTER = { width: 3.2, radius: 2.2, height: 1.9, deck: 1.3 };

interface Part { geometry: THREE.BufferGeometry; material: 'wood' | 'stone' | 'metal'; solid: boolean }
interface Shape { parts: Part[]; rails: { a: [number, number, number]; b: [number, number, number]; width: number; name: string }[]; quarter?: boolean }

/** Non-indexed geometry from a flat list of triangle corners (local space: forward is -z). */
function triangles(points: number[]) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
  geometry.computeVertexNormals();
  return geometry;
}
const quad = (a: number[], b: number[], c: number[], d: number[]) => [...a, ...b, ...c, ...a, ...c, ...d];
/** A ramp wedge rising toward -z from z0 (height 0) to z1 (height h), with a vertical back and sides. */
function wedge(width: number, z0: number, z1: number, h: number) {
  const l = -width / 2, r = width / 2;
  const points = [
    ...quad([l, 0, z0], [r, 0, z0], [r, h, z1], [l, h, z1]),
    ...quad([l, h, z1], [r, h, z1], [r, 0, z1], [l, 0, z1]),
    l, 0, z0, l, h, z1, l, 0, z1,
    r, 0, z0, r, 0, z1, r, h, z1,
  ];
  return triangles(points);
}
/** Mirror along z, keeping faces pointing outward (mirroring flips the triangle winding, so swap two corners). */
function mirrorZ(geometry: THREE.BufferGeometry) {
  const p = geometry.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) p.setZ(i, -p.getZ(i));
  for (let t = 0; t < p.count; t += 3) {
    const x = p.getX(t + 1), y = p.getY(t + 1), z = p.getZ(t + 1);
    p.setXYZ(t + 1, p.getX(t + 2), p.getY(t + 2), p.getZ(t + 2)); p.setXYZ(t + 2, x, y, z);
  }
  geometry.computeVertexNormals();
  return geometry;
}
const box = (w: number, h: number, d: number, x = 0, y = h / 2, z = 0) => new THREE.BoxGeometry(w, h, d).translate(x, y, z).toNonIndexed();

function shape(kind: PropKind): Shape {
  switch (kind) {
    case 'kicker': return { parts: [{ geometry: wedge(1.4, 0.75, -0.75, 0.5), material: 'wood', solid: true }, { geometry: box(1.46, 0.03, 0.06, 0, 0.5, -0.75), material: 'metal', solid: false }], rails: [] };
    case 'bank': return { parts: [{ geometry: wedge(2.6, 1.3, -1.3, 1.2), material: 'wood', solid: true }, { geometry: box(2.66, 0.04, 0.08, 0, 1.2, -1.3), material: 'metal', solid: false }], rails: [{ a: [-1.3, 1.22, -1.3], b: [1.3, 1.22, -1.3], width: 0.08, name: 'Bank lip' }] };
    case 'ledge': return {
      parts: [{ geometry: box(0.7, 0.42, 3.2), material: 'stone', solid: true }, { geometry: box(0.74, 0.02, 3.24, 0, 0.43), material: 'metal', solid: false }],
      rails: [-0.35, 0.35].map((x) => ({ a: [x, 0.44, 1.6] as [number, number, number], b: [x, 0.44, -1.6] as [number, number, number], width: 0.06, name: 'Ledge' })),
    };
    case 'rail': return {
      parts: [
        { geometry: new THREE.CylinderGeometry(0.03, 0.03, 3.4, 8).rotateX(Math.PI / 2).translate(0, 0.48, 0).toNonIndexed(), material: 'metal', solid: false },
        ...[-1.5, 1.5].map((z) => ({ geometry: box(0.05, 0.48, 0.05, 0, 0.24, z), material: 'metal' as const, solid: true })),
        { geometry: box(0.06, 0.06, 3.4, 0, 0.48, 0), material: 'metal', solid: true },
      ],
      rails: [{ a: [0, 0.515, 1.7], b: [0, 0.515, -1.7], width: 0.06, name: 'Flat rail' }],
    };
    case 'funbox': {
      const up = wedge(1.8, 2.5, 1.1, 0.5), down = mirrorZ(wedge(1.8, 2.5, 1.1, 0.5));
      return {
        parts: [{ geometry: up, material: 'wood', solid: true }, { geometry: down, material: 'wood', solid: true }, { geometry: box(1.8, 0.5, 2.2), material: 'wood', solid: true },
          ...[-0.9, 0.9].map((x) => ({ geometry: box(0.05, 0.03, 2.2, x, 0.5), material: 'metal' as const, solid: false }))],
        rails: [-0.9, 0.9].map((x) => ({ a: [x, 0.52, 1.1] as [number, number, number], b: [x, 0.52, -1.1] as [number, number, number], width: 0.05, name: 'Funbox edge' })),
      };
    }
    case 'quarter': {
      const { width, radius, height, deck } = QUARTER, l = -width / 2, r = width / 2, top = rampTop({ radius, height } as Ramp);
      const face: number[] = [], sides: number[] = [], steps = 16;
      const at = (i: number) => { const a = (top.angle * i) / steps; return [radius * Math.sin(a), radius * (1 - Math.cos(a))]; };
      for (let i = 0; i < steps; i++) {
        const [w0, y0] = at(i), [w1, y1] = at(i + 1);
        face.push(...quad([l, y0, -w0], [r, y0, -w0], [r, y1, -w1], [l, y1, -w1]));
        // side panels under the face (vertical strips down to the floor)
        sides.push(...quad([l, 0, -w0], [l, y0, -w0], [l, y1, -w1], [l, 0, -w1]), ...quad([r, 0, -w1], [r, y1, -w1], [r, y0, -w0], [r, 0, -w0]));
      }
      const b = -(top.w + deck), c = -top.w;
      const platform = [
        ...quad([l, height, c], [r, height, c], [r, height, b], [l, height, b]), // deck top
        ...quad([l, 0, b], [l, height, b], [r, height, b], [r, 0, b]), // back
        ...quad([l, 0, c], [l, height, c], [l, height, b], [l, 0, b]), ...quad([r, 0, b], [r, height, b], [r, height, c], [r, 0, c]), // deck sides
      ];
      return {
        quarter: true,
        parts: [
          { geometry: triangles(face), material: 'wood', solid: false },
          { geometry: triangles(sides), material: 'wood', solid: true },
          { geometry: triangles(platform), material: 'wood', solid: true },
          { geometry: new THREE.CylinderGeometry(0.035, 0.035, width, 8).rotateZ(Math.PI / 2).translate(0, height, c).toNonIndexed(), material: 'metal', solid: false },
        ],
        rails: [{ a: [l, height + 0.035, c], b: [r, height + 0.035, c], width: 0.07, name: 'Coping' }],
      };
    }
  }
}

/** Planar texture coordinates from each corner's dominant normal axis (1 texture tile per metre). */
function planarUv(geometry: THREE.BufferGeometry) {
  const p = geometry.getAttribute('position'), n = geometry.getAttribute('normal'), uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const nx = Math.abs(n.getX(i)), ny = Math.abs(n.getY(i));
    uv[i * 2] = nx > 0.5 ? p.getZ(i) : p.getX(i);
    uv[i * 2 + 1] = ny > 0.5 ? p.getZ(i) : p.getY(i);
  }
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

interface Built { group: THREE.Group; tree: MeshBVH | null; rails: Rail[]; ramp: Ramp | null }

export class PropManager {
  props: PropData[] = [];
  private built = new Map<string, Built>();
  private ghost: THREE.Group | null = null; private ghostKind: PropKind | null = null;
  private readonly materials: Record<Part['material'], THREE.Material>;
  private readonly ghostMaterial = new THREE.MeshBasicMaterial({ color: 0xa8f0b0, transparent: true, opacity: 0.42, depthWrite: false });
  constructor(private scene: THREE.Scene, private collision: WorldCollision, private baseRails: Rail[], textures: Surfaces | null, private storageKey: string, private storage: Storage | null = globalThis.localStorage ?? null) {
    this.materials = {
      wood: rsMaterial({ surfaces: textures, textureId: PLANKS, color: 0x9a7048 }),
      stone: rsMaterial({ surfaces: textures, textureId: STONE, color: 0x9a958a }),
      metal: rsMaterial({ color: 0x55666c }),
    };
  }
  load() {
    try { const saved = JSON.parse(this.storage?.getItem(this.storageKey) ?? '[]') as PropData[]; for (const prop of saved) this.add(prop, false); } catch { /* corrupt or blocked storage: start empty */ }
  }
  private save() { try { this.storage?.setItem(this.storageKey, JSON.stringify(this.props)); } catch { /* storage full or blocked */ } }

  add(prop: PropData, persist = true) {
    if (this.props.length >= 60) return false;
    const s = shape(prop.kind), group = new THREE.Group(), solids: THREE.BufferGeometry[] = [];
    group.position.set(prop.x, prop.y, prop.z); group.rotation.y = prop.yaw; group.updateMatrixWorld(true);
    for (const part of s.parts) {
      if (part.material !== 'metal') planarUv(part.geometry);
      group.add(new THREE.Mesh(part.geometry, this.materials[part.material]));
      if (part.solid) solids.push(part.geometry.clone().applyMatrix4(group.matrixWorld).deleteAttribute('normal').deleteAttribute('uv'));
    }
    this.scene.add(group);
    const tree = solids.length ? this.collision.addGeometry(mergeGeometries(solids)!) : null;
    const world = (v: [number, number, number]) => { const p = new THREE.Vector3(...v).applyMatrix4(group.matrixWorld); return { x: p.x, y: p.y, z: p.z }; };
    const rails = s.rails.map((rail, i) => ({ id: s.quarter ? `${prop.id}-coping` : `${prop.id}-rail${i}`, name: rail.name, width: rail.width, a: world(rail.a), b: world(rail.b) }));
    const ramp: Ramp | null = s.quarter ? { id: prop.id, origin: { x: prop.x, y: prop.y, z: prop.z }, yaw: prop.yaw, ...QUARTER } : null;
    this.built.set(prop.id, { group, tree, rails, ramp });
    this.props.push(prop); this.refresh();
    if (persist) this.save();
    return true;
  }
  remove(id: string) {
    const built = this.built.get(id); if (!built) return;
    this.scene.remove(built.group); if (built.tree) this.collision.removeTree(built.tree);
    this.built.delete(id); this.props = this.props.filter((p) => p.id !== id); this.refresh(); this.save();
  }
  clear() { for (const prop of [...this.props]) this.remove(prop.id); }
  /** Nearest prop within `radius` of a point. */
  nearest(x: number, z: number, radius = 3) {
    let best: PropData | null = null, distance = radius;
    for (const prop of this.props) { const d = Math.hypot(prop.x - x, prop.z - z); if (d < distance) { distance = d; best = prop; } }
    return best;
  }
  private refresh() {
    const built = [...this.built.values()];
    this.collision.rails = [...this.baseRails, ...built.flatMap((b) => b.rails)];
    this.collision.ramps = built.flatMap((b) => (b.ramp ? [b.ramp] : []));
  }
  /** Translucent preview of a prop about to be dropped; null hides it. */
  preview(prop: Omit<PropData, 'id'> | null) {
    if (!prop) { if (this.ghost) this.ghost.visible = false; return; }
    if (this.ghostKind !== prop.kind) {
      if (this.ghost) this.scene.remove(this.ghost);
      this.ghost = new THREE.Group(); this.ghostKind = prop.kind;
      for (const part of shape(prop.kind).parts) this.ghost.add(new THREE.Mesh(part.geometry, this.ghostMaterial));
      this.scene.add(this.ghost);
    }
    this.ghost!.visible = true; this.ghost!.position.set(prop.x, prop.y, prop.z); this.ghost!.rotation.y = prop.yaw;
  }
}
