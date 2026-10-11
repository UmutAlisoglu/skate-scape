// Surfaces (the RS texture array the world shader samples) that grow as regions bring textures in, instead of the
// fixed strip export:surfaces writes. Layers are uploaded one at a time (DataArrayTexture.addLayerUpdate).
import * as THREE from 'three';
import type { Surfaces } from '../rs-material.ts';
import type { TextureLayer } from './protocol.ts';

const SIZE = 128;
/** room for every texture the cache defines (the whole map uses about 250) */
const CAPACITY = 512;

export function growingSurfaces(): Surfaces & { add(layers: TextureLayer[]): void; missing(ids: number[]): number[] } {
  const pixels = new Uint8Array(SIZE * SIZE * 4 * CAPACITY);
  const texture = new THREE.DataArrayTexture(pixels, SIZE, SIZE, CAPACITY);
  texture.format = THREE.RGBAFormat;
  texture.type = THREE.UnsignedByteType;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  const info = new Uint8Array(CAPACITY * 4), infoTexture = new THREE.DataTexture(info, CAPACITY, 1);
  infoTexture.needsUpdate = true;
  const lookup = new Uint16Array(4096), requested = new Set<number>();
  const manifest = { version: 2 as const, size: SIZE, layers: [] as number[], blend: [] as number[], opaque: [] as boolean[], material: [] as number[] };
  return {
    manifest, texture, info: infoTexture, lookup,
    /** the ids not yet in the array (and not asked for before) */
    missing(ids) {
      const out = ids.filter((id) => id >= 0 && id + 1 < lookup.length && !lookup[id + 1] && !requested.has(id));
      for (const id of out) requested.add(id);
      return out;
    },
    add(layers) {
      for (const layer of layers) {
        if (lookup[layer.id + 1] || manifest.layers.length >= CAPACITY) continue;
        const index = manifest.layers.length;
        pixels.set(layer.rgba, index * SIZE * SIZE * 4);
        info.set([layer.blend, layer.opaque ? 255 : 0, layer.material & 0xff, 255], index * 4);
        manifest.layers.push(layer.id); manifest.blend.push(layer.blend); manifest.opaque.push(layer.opaque); manifest.material.push(layer.material);
        lookup[layer.id + 1] = index + 1;
        texture.addLayerUpdate(index);
      }
      if (layers.length) { texture.needsUpdate = true; infoTexture.needsUpdate = true; }
    },
  };
}
