import * as THREE from 'three';
import { soupPositions } from '../shared/soup.ts';

export interface WorldManifest {
  name: string;
  baseTile: [number, number];
  sizeTiles: [number, number];
  spawn: [number, number];
  /** 2: terrain, collision and grind lines stream per cell (tools/export-area.ts) */
  format?: number;
}
/** Per-object metadata written by export-world (locs.json; older exports kept it inside the manifest). */
export type PlacedLoc = { id: number; name: string; type: number; rot: number; plane: number; x: number; y: number; t: [number, number] };
/**
 * Collision split into square cells of `cell` tiles (see tools/export-area.ts). Each entry is
 * [cellX, cellY (north), solid object triangles, terrain triangles, grind segments]; a cell's soups are stored
 * relative to its corner minus `margin` tiles (so geometry hanging over the edge still fits).
 */
export interface CollisionIndex { version: 2; cell: number; margin: number; cells: [number, number, number, number, number][] }
/** Fine-unit origin (x, north) a collision cell's soups are stored relative to. */
export const cellOrigin = (index: Pick<CollisionIndex, 'cell' | 'margin'>, cx: number, cy: number): [number, number] =>
  [(cx * index.cell - index.margin) * 128, (cy * index.cell - index.margin) * 128];

// sRGB byte -> linear float, so cache colors look right under three's color management
const SRGB_TO_LINEAR = new Float32Array(256);
for (let i = 0; i < 256; i++) {
  const c = i / 255;
  SRGB_TO_LINEAR[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/**
 * Where the exported game assets live: next to the game by default, or on a separate host (Cloudflare R2, a CDN)
 * when the build sets VITE_ASSET_BASE, e.g. VITE_ASSET_BASE=https://assets.example.com/ npm run build.
 */
export const ASSET_BASE = (import.meta.env?.VITE_ASSET_BASE as string | undefined)?.replace(/\/?$/, '/') ?? import.meta.env?.BASE_URL ?? '/';

/**
 * Asset files built in the browser (?source=gitlab builds the world from the 2009scape cache, see
 * src/world/gitlab/build.ts) by URL. assetFetch and assetUrl serve them in place of the network.
 */
const builtAssets = new Map<string, Uint8Array>(), builtUrls = new Map<string, string>();
/** Serves `files` (paths relative to `base`) from memory from now on. */
export function provideAssets(base: string, files: Map<string, Uint8Array>) {
  for (const [path, data] of files) builtAssets.set(`${base}/${path}`, data);
}
/** Stops serving these built files from memory (the resolver can bring them back). */
export function forgetAssets(urls: string[]) {
  for (const url of urls) {
    builtAssets.delete(url);
    const blobUrl = builtUrls.get(url);
    if (blobUrl) { URL.revokeObjectURL(blobUrl); builtUrls.delete(url); }
  }
}
let resolver: ((url: string) => Promise<boolean>) | null = null;
/** Called for a URL that isn't in memory; true when it provided the file again (the built world's evicted regions). */
export function setAssetResolver(resolve: (url: string) => Promise<boolean>) { resolver = resolve; }

/** fetch() for game assets: built files from memory, everything else from the network. */
export async function assetFetch(url: string, init?: RequestInit): Promise<Response> {
  let data = builtAssets.get(url);
  if (!data && resolver && await resolver(url)) data = builtAssets.get(url);
  if (!data) return fetch(url, init);
  if (init?.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  return (new Response(data as Uint8Array<ArrayBuffer>, { headers: { 'Content-Type': url.endsWith('.json') ? 'application/json' : url.endsWith('.png') ? 'image/png' : 'application/octet-stream' } }));
}
/** A URL an <img> can load an asset from (a blob URL for built files). */
export function assetUrl(url: string): string {
  const data = builtAssets.get(url);
  if (!data) return url;
  let blobUrl = builtUrls.get(url);
  if (!blobUrl) builtUrls.set(url, (blobUrl = URL.createObjectURL(new Blob([data as Uint8Array<ArrayBuffer>], { type: url.endsWith('.png') ? 'image/png' : '' }))));
  return blobUrl;
}

/**
 * Decodes an exported triangle soup (see tools/export-world.ts) into opaque + translucent geometries.
 * Positions are converted from RS fine units to meters (128 = 1).
 */
interface SoupOptions { positionsOnly?: boolean; surfaces?: boolean; /** fine units (x, north) added to stored corners */ origin?: [number, number] }

export async function loadSoup(url: string, options: SoupOptions = {}): Promise<{ opaque: THREE.BufferGeometry; translucent: THREE.BufferGeometry | null }> {
  const response = await assetFetch(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}. Run the asset exporters in the README.`);
  const buf = await response.arrayBuffer();
  let surfaces: Uint16Array | undefined;
  if (options.surfaces) {
    const response = await assetFetch(url.replace('.bin', '.materials.bin'));
    if (!response.ok) throw new Error('Surface references missing. Run npm run export:world and npm run export:surfaces.');
    surfaces = new Uint16Array(await response.arrayBuffer());
  }
  return decodeSoup(buf, url, options, surfaces);
}

export async function loadJson<T>(url: string): Promise<T> {
  const response = await assetFetch(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}. Run the asset exporters in the README.`);
  try { return await response.json() as T; }
  catch { throw new Error(`${url}: invalid JSON. Run the asset exporters in the README.`); }
}

export async function loadBytes(url: string): Promise<Uint8Array> {
  const response = await assetFetch(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}. Run the asset exporters in the README.`);
  return new Uint8Array(await response.arrayBuffer());
}

export function decodeSoup(buf: ArrayBuffer, source = 'triangle soup', options: SoupOptions = {}, surfaces?: Uint16Array): { opaque: THREE.BufferGeometry; translucent: THREE.BufferGeometry | null } {
  if (buf.byteLength < 4) throw new Error(`${source}: missing triangle header`);
  const n = new DataView(buf).getUint32(0, true);
  if (buf.byteLength !== 4 + n * 22) throw new Error(`${source}: invalid triangle data. Run the asset exporters in the README.`);
  if (surfaces && surfaces.length !== n) throw new Error(`${source}: material reference count does not match geometry`);
  const pos = soupPositions(buf, 0, n, options.origin?.[0] ?? 0, options.origin?.[1] ?? 0);
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
