/** public/surfaces/manifest.json, written by tools/export-surfaces.ts */
export interface SurfaceManifest {
  version: 2;
  /** texture size in pixels (square) */
  size: number;
  /** cache texture id for each layer of textures.png (a vertical strip, layer i at y = i * size) */
  layers: number[];
  /** GL combine mode per layer: 0 modulate, 1 add, 2 subtract, 3 add-signed */
  blend: number[];
  /** false when the texture's alpha channel cuts holes (leaves, grass, fences) */
  opaque: boolean[];
  /** client material type (e.g. water) */
  material: number[];
}

/** Maps cache texture id + 1 (0 = untextured) to layer + 1 (0 = untextured). */
export function layerLookup(manifest: SurfaceManifest): Uint16Array {
  const max = manifest.layers.reduce((m, id) => Math.max(m, id), 0);
  const lookup = new Uint16Array(max + 2);
  manifest.layers.forEach((id, layer) => (lookup[id + 1] = layer + 1));
  return lookup;
}
