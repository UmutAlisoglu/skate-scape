import * as THREE from 'three';

export interface WorldManifest {
  name: string;
  baseTile: [number, number];
  sizeTiles: [number, number];
  spawn: [number, number];
  locs: { id: number; name: string; type: number; rot: number; plane: number; x: number; y: number; t: [number, number] }[];
}

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
export async function loadSoup(url: string): Promise<{ opaque: THREE.BufferGeometry; translucent: THREE.BufferGeometry | null }> {
  const buf = await (await fetch(url)).arrayBuffer();
  const n = new DataView(buf).getUint32(0, true);
  const pos = new Int16Array(buf, 4, n * 9);
  const col = new Uint8Array(buf, 4 + n * 18, n * 4);

  let translucentCount = 0;
  for (let t = 0; t < n; t++) if (col[t * 4 + 3] < 255) translucentCount++;

  const build = (wantTranslucent: boolean, count: number) => {
    const P = new Float32Array(count * 9);
    const C = new Float32Array(count * 12);
    let o = 0;
    for (let t = 0; t < n; t++) {
      const a = col[t * 4 + 3];
      if (a < 255 !== wantTranslucent) continue;
      for (let i = 0; i < 9; i++) P[o * 9 + i] = pos[t * 9 + i] / 128;
      const r = SRGB_TO_LINEAR[col[t * 4]];
      const g = SRGB_TO_LINEAR[col[t * 4 + 1]];
      const b = SRGB_TO_LINEAR[col[t * 4 + 2]];
      for (let v = 0; v < 3; v++) {
        C[o * 12 + v * 4] = r;
        C[o * 12 + v * 4 + 1] = g;
        C[o * 12 + v * 4 + 2] = b;
        C[o * 12 + v * 4 + 3] = a / 255;
      }
      o++;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(P, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(C, 4));
    geo.computeVertexNormals(); // non-indexed -> flat face normals
    geo.computeBoundingSphere();
    return geo;
  };

  return {
    opaque: build(false, n - translucentCount),
    translucent: translucentCount > 0 ? build(true, translucentCount) : null,
  };
}
