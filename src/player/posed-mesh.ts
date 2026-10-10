// A cache model posed the way the RS client animates it: the composed vertices are transformed by a pose
// (rs-pose.ts) every frame and written out with the client's normals (smooth unless a face is flat).
// Players (avatar.ts) and NPCs (npc-actor.ts) both draw through it.
import * as THREE from 'three';
import { hdFaceColor } from '../shared/color.ts';
import type { PartModel } from '../shared/player-data.ts';
import { rsMaterial, layerOf, type Surfaces } from '../world/rs-material.ts';
import { applyPose, type AnimBase, type Pose } from './rs-pose.ts';

/** Parts merged into one model (RS units: x right, y down, z behind) with per-triangle colours. */
export interface ComposedModel {
  x: number[]; y: number[]; z: number[]; labels: number[];
  tris: number[]; flat: boolean[]; colors: number[]; textures: number[]; uvs: number[];
}

/** Merges parts, dropping the faces the GL client never draws (hidden, black, invisible). */
export function composeParts(parts: PartModel[]): ComposedModel {
  const out: ComposedModel = { x: [], y: [], z: [], labels: [], tris: [], flat: [], colors: [], textures: [], uvs: [] };
  for (const p of parts) {
    const offset = out.x.length;
    for (let i = 0; i < p.v.length; i += 3) { out.x.push(p.v[i]); out.y.push(p.v[i + 1]); out.z.push(p.v[i + 2]); }
    out.labels.push(...p.b);
    for (let t = 0; t < p.c.length; t++) {
      const type = p.i ? p.i[t] : 0, alpha = p.a ? p.a[t] : 0;
      if (type === 2 || type === 3 || alpha >= 254) continue;
      out.tris.push(p.t[t * 3] + offset, p.t[t * 3 + 1] + offset, p.t[t * 3 + 2] + offset);
      out.flat.push(type === 1); out.colors.push(p.c[t]);
      const tex = p.x ? p.x[t] : -1;
      out.textures.push(tex);
      for (let k = 0; k < 6; k++) out.uvs.push(tex >= 0 && p.u ? p.u[t * 6 + k] : 0);
    }
  }
  return out;
}

export class PosedMesh {
  readonly mesh: THREE.Mesh;
  private geometry = new THREE.BufferGeometry();
  baseX = new Float64Array(0); baseY = new Float64Array(0); baseZ = new Float64Array(0);
  private vx = new Float64Array(0); private vy = new Float64Array(0); private vz = new Float64Array(0);
  private tris = new Int32Array(0);
  private flat: boolean[] = [];
  /** vertex indices per animation label */
  groups: number[][] = [];
  private smooth = new Float64Array(0); private faces = new Float64Array(0);

  constructor(private surfaces: Surfaces | null, material: THREE.Material = rsMaterial({ vertexColors: true, surfaces })) {
    this.mesh = new THREE.Mesh(this.geometry, material);
  }

  /** Takes a composed model; colours are HSL16 lit with `ambient` (the client's 64 for players). */
  setModel(model: ComposedModel, ambient: number, textureBrightness: Record<number, number> = {}) {
    this.baseX = Float64Array.from(model.x); this.baseY = Float64Array.from(model.y); this.baseZ = Float64Array.from(model.z);
    this.vx = new Float64Array(model.x.length); this.vy = new Float64Array(model.x.length); this.vz = new Float64Array(model.x.length);
    this.tris = Int32Array.from(model.tris); this.flat = model.flat;
    this.smooth = new Float64Array(model.x.length * 3); this.faces = new Float64Array(model.tris.length);
    this.groups = [];
    model.labels.forEach((l, v) => (this.groups[l] ??= []).push(v));
    const triCount = model.tris.length / 3, color = new Uint8Array(triCount * 9), surface = new Float32Array(triCount * 3);
    for (let t = 0; t < triCount; t++) {
      const tex = model.textures[t];
      const rgb = hdFaceColor(model.colors[t] & 0xffff, ambient, tex >= 0 ? (textureBrightness[tex] ?? 0) : 0);
      for (let k = 0; k < 3; k++) color.set([(rgb >> 16) & 0xff, (rgb >> 8) & 0xff, rgb & 0xff], t * 9 + k * 3);
      surface.fill(tex >= 0 ? layerOf(this.surfaces, tex) : 0, t * 3, t * 3 + 3);
    }
    this.geometry.dispose();
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(triCount * 9), 3));
    this.geometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(triCount * 9), 3));
    this.geometry.setAttribute('color', new THREE.BufferAttribute(color, 3, true));
    this.geometry.setAttribute('uv', new THREE.BufferAttribute(Float32Array.from(model.uvs), 2));
    this.geometry.setAttribute('surface', new THREE.BufferAttribute(surface, 1));
    this.mesh.geometry = this.geometry;
  }

  /** Poses the model and writes positions + RS-style normals. */
  render(pose: Pose, base: AnimBase | null, origins: Int32Array) {
    const { vx, vy, vz } = this;
    vx.set(this.baseX); vy.set(this.baseY); vz.set(this.baseZ);
    if (base && pose.size) applyPose(pose, base, origins, this.groups, vx, vy, vz);
    const tris = this.tris, smooth = this.smooth.fill(0), faces = this.faces;
    for (let t = 0; t < tris.length; t += 3) {
      const a = tris[t], b = tris[t + 1], c = tris[t + 2];
      // three axes: (x, -y, -z)
      const abx = vx[b] - vx[a], aby = -(vy[b] - vy[a]), abz = -(vz[b] - vz[a]);
      const acx = vx[c] - vx[a], acy = -(vy[c] - vy[a]), acz = -(vz[c] - vz[a]);
      let nx = aby * acz - abz * acy, ny = abz * acx - abx * acz, nz = abx * acy - aby * acx;
      const l = Math.hypot(nx, ny, nz) || 1;
      nx /= l; ny /= l; nz /= l;
      faces[t] = nx; faces[t + 1] = ny; faces[t + 2] = nz;
      if (this.flat[t / 3]) continue;
      for (const v of [a, b, c]) { smooth[v * 3] += nx; smooth[v * 3 + 1] += ny; smooth[v * 3 + 2] += nz; }
    }
    const pos = this.geometry.attributes.position.array as Float32Array;
    const nor = this.geometry.attributes.normal.array as Float32Array;
    for (let i = 0; i < tris.length; i++) {
      const v = tris[i];
      pos[i * 3] = vx[v] / 128; pos[i * 3 + 1] = -vy[v] / 128; pos[i * 3 + 2] = -vz[v] / 128;
      const t = i - (i % 3);
      let x = smooth[v * 3], y = smooth[v * 3 + 1], z = smooth[v * 3 + 2];
      const l = Math.hypot(x, y, z);
      if (this.flat[t / 3] || l === 0) { x = faces[t]; y = faces[t + 1]; z = faces[t + 2]; }
      else { x /= l; y /= l; z /= l; }
      nor[i * 3] = x; nor[i * 3 + 1] = y; nor[i * 3 + 2] = z;
    }
    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.normal.needsUpdate = true;
    this.geometry.computeBoundingSphere();
  }
}
