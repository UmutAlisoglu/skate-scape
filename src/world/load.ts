import * as THREE from 'three';
import { soupPositions } from '../shared/soup.ts';

export interface WorldManifest {
  name: string;
  baseTile: [number, number];
  sizeTiles: [number, number];
  spawn: [number, number];
}
/** Per-object metadata written by export-world (locs.json; older exports kept it inside the manifest). */
export type PlacedLoc = { id: number; name: string; type: number; rot: number; plane: number; x: number; y: number; t: [number, number] };
/** Collision split into square cells of `cell` tiles: [cellX, cellY, triangles] (see export-collision). */
export interface CollisionIndex { cell: number; cells: [number, number, number][] }

// sRGB byte -> linear float, so cache colors look right under three's color management
const SRGB_TO_LINEAR = new Float32Array(256);
for (let i = 0; i < 256; i++) {
  const c = i / 255;
  SRGB_TO_LINEAR[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/**
 * Decodes an exported triangle soup (see tools/export-world.ts) into opaque + translucent geometries.
 * Positions are converted from RS fine units to meters (128 = 1).
 */
interface SoupOptions { positionsOnly?: boolean; surfaces?: boolean }

export async function loadSoup(url: string, options: SoupOptions = {}): Promise<{ opaque: THREE.BufferGeometry; translucent: THREE.BufferGeometry | null }> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}. Run the asset exporters in the README.`);
  const buf = await response.arrayBuffer();
  let surfaces: Uint16Array | undefined;
  if (options.surfaces) {
    const response = await fetch(url.replace('.bin', '.materials.bin'));
    if (!response.ok) throw new Error('Surface references missing. Run npm run export:world and npm run export:surfaces.');
    surfaces = new Uint16Array(await response.arrayBuffer());
  }
  return decodeSoup(buf, url, options, surfaces);
}

export async function loadJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}. Run the asset exporters in the README.`);
  try { return await response.json() as T; }
  catch { throw new Error(`${url}: invalid JSON. Run the asset exporters in the README.`); }
}

export async function loadBytes(url: string): Promise<Uint8Array> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}. Run the asset exporters in the README.`);
  return new Uint8Array(await response.arrayBuffer());
}

export function decodeSoup(buf: ArrayBuffer, source = 'triangle soup', options: SoupOptions = {}, surfaces?: Uint16Array): { opaque: THREE.BufferGeometry; translucent: THREE.BufferGeometry | null } {
  if (buf.byteLength < 4) throw new Error(`${source}: missing triangle header`);
  const n = new DataView(buf).getUint32(0, true);
  if (buf.byteLength !== 4 + n * 22) throw new Error(`${source}: invalid triangle data. Run the asset exporters in the README.`);
  if (surfaces && surfaces.length !== n) throw new Error(`${source}: material reference count does not match geometry`);
  const pos = soupPositions(buf, 0, n);
  const col = new Uint8Array(buf, 4 + n * 18, n * 4);

  let translucentCount = 0;
  for (let t = 0; t < n; t++) if (col[t * 4 + 3] < 255) translucentCount++;

  const build = (wantTranslucent: boolean, count: number) => {
    const P = new Float32Array(count * 9);
    const C = options.positionsOnly ? null : new Float32Array(count * 12);
    const S = surfaces ? new Float32Array(count * 3) : null;
    let o = 0;
    for (let t = 0; t < n; t++) {
      const a = col[t * 4 + 3];
      if (a < 255 !== wantTranslucent) continue;
      for (let i = 0; i < 9; i++) P[o * 9 + i] = pos[t * 9 + i] / 128;
      if (S) S.fill(surfaces![t], o * 3, o * 3 + 3);
      if (C) {
        const r = SRGB_TO_LINEAR[col[t * 4]];
        const g = SRGB_TO_LINEAR[col[t * 4 + 1]];
        const b = SRGB_TO_LINEAR[col[t * 4 + 2]];
        for (let v = 0; v < 3; v++) {
          C[o * 12 + v * 4] = r;
          C[o * 12 + v * 4 + 1] = g;
          C[o * 12 + v * 4 + 2] = b;
          C[o * 12 + v * 4 + 3] = a / 255;
        }
      }
      o++;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(P, 3));
    if (S) geo.setAttribute('surface', new THREE.BufferAttribute(S, 1));
    if (C) {
      geo.setAttribute('color', new THREE.BufferAttribute(C, 4));
      geo.computeVertexNormals(); // non-indexed -> flat face normals
    }
    geo.computeBoundingSphere();
    return geo;
  };

  return {
    opaque: build(false, n - translucentCount),
    translucent: translucentCount > 0 ? build(true, translucentCount) : null,
  };
}
