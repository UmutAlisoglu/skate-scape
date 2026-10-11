// One shader for everything in the world, reproducing the 2009 HD client's fixed-function look:
//   lit = clamp(vertexColor * (ambient + diffuse * dot(N, L)))      (GL light0 + negative light1, FogManager defaults)
//   out = lit (x texture, by the texture's combine mode), then linear fog.
// Colors stay in the client's gamma space end to end, so the shader writes final colors directly
// (no three.js lighting, color-space conversion or tone mapping).
import * as THREE from 'three';
import type { SurfaceManifest } from '../shared/surfaces.ts';
import { layerLookup } from '../shared/surfaces.ts';
import { assetFetch } from './load.ts';

/** Shared by every RS material: change once, everything follows. */
export const rsUniforms = {
  // Direction toward the sun: the client's light0 at (-50, -60, -50) in RS axes (x east, y down, z north).
  lightDir: { value: new THREE.Vector3(-50, 60, 50).normalize() },
  ambient: { value: 1.1523438 },
  diffuse: { value: 0.69921875 },
  fogColor: { value: gammaColor(0xc8c0a8) },
  fogNear: { value: 30 },
  fogFar: { value: 62 },
  // see-through cutout: world geometry between the camera and the rider dissolves (set every frame by main.ts)
  cutCamera: { value: new THREE.Vector3() },
  cutTarget: { value: new THREE.Vector3() },
  cutRadius: { value: 0 },
};

export interface Surfaces {
  manifest: SurfaceManifest;
  texture: THREE.DataArrayTexture;
  info: THREE.DataTexture;
  /** cache texture id + 1 -> layer + 1 */
  lookup: Uint16Array;
}

/** Loads the client-rendered texture strip as a WebGL2 texture array (layer i = rows i*size..). */
export async function loadSurfaces(base: string): Promise<Surfaces> {
  const manifestResponse = await assetFetch(`${base}/manifest.json`);
  if (!manifestResponse.ok) throw new Error(`${base}/manifest.json: HTTP ${manifestResponse.status}. Run npm run export:surfaces.`);
  const manifest = (await manifestResponse.json()) as SurfaceManifest;
  if (manifest.version !== 2) throw new Error('Outdated surface textures. Run npm run export:surfaces.');
  const image = await assetFetch(`${base}/textures.png`).then((r) => {
    if (!r.ok) throw new Error(`${base}/textures.png: HTTP ${r.status}. Run npm run export:surfaces.`);
    return r.blob();
  }).then((blob) => createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' }));
  const { size, layers } = manifest;
  const canvas = new OffscreenCanvas(size, size * layers.length);
  const context = canvas.getContext('2d', { willReadFrequently: true })!;
  context.drawImage(image, 0, 0);
  const pixels = context.getImageData(0, 0, size, size * layers.length).data;
  const texture = new THREE.DataArrayTexture(new Uint8Array(pixels.buffer, pixels.byteOffset, pixels.byteLength), size, size, layers.length);
  texture.format = THREE.RGBAFormat;
  texture.type = THREE.UnsignedByteType;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  // Per layer: R = combine mode, G = opaque, B = material type.
  const info = new Uint8Array(Math.max(1, layers.length) * 4);
  layers.forEach((_, i) => info.set([manifest.blend[i], manifest.opaque[i] ? 255 : 0, manifest.material[i] & 0xff, 255], i * 4));
  const infoTexture = new THREE.DataTexture(info, Math.max(1, layers.length), 1);
  infoTexture.needsUpdate = true;
  return { manifest, texture, info: infoTexture, lookup: layerLookup(manifest) };
}

/** Layer + 1 for a cache texture id, or 0 when the texture isn't in the strip. */
export function layerOf(surfaces: Surfaces | null, textureId: number) {
  return surfaces && textureId + 1 < surfaces.lookup.length ? surfaces.lookup[textureId + 1] : 0;
}

export interface RsMaterialOptions {
  surfaces?: Surfaces | null;
  /** read per-vertex `color` (RGB or RGBA, client gamma space) */
  vertexColors?: boolean;
  /** multiplier color (client gamma space) */
  color?: THREE.ColorRepresentation;
  /** texture for meshes without a per-vertex `surface` attribute (cache texture id) */
  textureId?: number;
  transparent?: boolean;
  opacity?: number;
  side?: THREE.Side;
  /** dissolves where it hides the rider from the camera (world geometry, not the rider) */
  cutout?: boolean;
}

const vertexShader = /* glsl */ `
attribute float surface;
uniform float fixedLayer;
uniform vec3 baseColor;
varying vec3 vColorRS;
varying float vAlpha;
varying vec3 vNormalW;
varying vec2 vUvRS;
varying float vLayer;
varying float vFogDepth;
varying vec3 vWorldRS;
void main() {
  vec4 local = vec4(position, 1.0);
  vec3 objectNormal = normal;
#ifdef USE_INSTANCING
  local = instanceMatrix * local;
  objectNormal = mat3(instanceMatrix) * objectNormal;
#endif
  vec4 world = modelMatrix * local;
  vWorldRS = world.xyz;
  vNormalW = normalize(mat3(modelMatrix) * objectNormal);
  vec3 c = baseColor;
  vAlpha = 1.0;
#if defined(USE_COLOR_ALPHA)
  c *= color.rgb;
  vAlpha = color.a;
#elif defined(USE_COLOR)
  c *= color;
#endif
#ifdef USE_INSTANCING_COLOR
  c *= instanceColor;
#endif
  vColorRS = c;
  vUvRS = uv;
  vLayer = fixedLayer > 0.5 ? fixedLayer : surface;
  vec4 view = viewMatrix * world;
  vFogDepth = -view.z;
  gl_Position = projectionMatrix * view;
}
`;

const fragmentShader = /* glsl */ `
precision highp sampler2DArray;
uniform sampler2DArray surfaceTextures;
uniform sampler2D layerInfo;
uniform bool hasSurfaces;
uniform vec3 lightDir;
uniform float ambient;
uniform float diffuse;
uniform vec3 fogColor;
uniform float fogNear;
uniform float fogFar;
uniform float opacity;
uniform float cutout;
uniform vec3 cutCamera;
uniform vec3 cutTarget;
uniform float cutRadius;
varying vec3 vWorldRS;
varying vec3 vColorRS;
varying float vAlpha;
varying vec3 vNormalW;
varying vec2 vUvRS;
varying float vLayer;
varying float vFogDepth;
const float BAYER[16] = float[16](0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0);
void main() {
  if (cutout > 0.5 && cutRadius > 0.0) {
    // a capsule from the camera to the rider's chest, narrowing toward the rider so the ground under the
    // board stays; inside it the surface dissolves (screen-door dither at the edge), so walls, arches, roofs,
    // trees and chandeliers never hide the rider
    vec3 seg = cutTarget - cutCamera;
    float t = clamp(dot(vWorldRS - cutCamera, seg) / max(dot(seg, seg), 0.0001), 0.0, 1.0);
    // a little wider at the camera end, where nearby walls fill the screen
    float r = cutRadius * (1.0 + 0.5 * (1.0 - t)) * (1.0 - smoothstep(0.62, 0.97, t));
    float d = distance(vWorldRS, cutCamera + seg * t);
    if (distance(vWorldRS, cutCamera) < 0.8) discard;
    if (d < r) {
      ivec2 p = ivec2(mod(gl_FragCoord.xy, 4.0));
      float edge = clamp((r - d) / min(r * 0.3, 0.22), 0.0, 1.0);
      if (edge > (BAYER[p.x + p.y * 4] + 0.5) / 16.0) discard;
    }
  }
  vec3 n = normalize(vNormalW);
  if (!gl_FrontFacing) n = -n;
  float light = ambient + diffuse * dot(n, lightDir);
  vec3 c = clamp(vColorRS * light, 0.0, 1.0);
  float alpha = vAlpha * opacity;
  if (hasSurfaces && vLayer > 0.5) {
    int layer = int(vLayer + 0.5) - 1;
    vec4 info = texelFetch(layerInfo, ivec2(layer, 0), 0);
    vec4 texel = texture(surfaceTextures, vec3(vUvRS, float(layer)));
    if (info.g < 0.5) {
      if (texel.a < 0.5) discard;
    }
    int blend = int(info.r * 255.0 + 0.5);
    if (blend == 1) c = min(c + texel.rgb, 1.0);
    else if (blend == 2) c = max(c - texel.rgb, 0.0);
    else if (blend == 3) c = clamp(c + texel.rgb - 0.5, 0.0, 1.0);
    else c *= texel.rgb;
  }
  float fog = clamp((vFogDepth - fogNear) / (fogFar - fogNear), 0.0, 1.0);
  gl_FragColor = vec4(mix(c, fogColor, fog), alpha);
}
`;

const emptyArray = (() => {
  const t = new THREE.DataArrayTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, 1);
  t.needsUpdate = true;
  return t;
})();
const emptyInfo = (() => {
  const t = new THREE.DataTexture(new Uint8Array([0, 255, 0, 255]), 1, 1);
  t.needsUpdate = true;
  return t;
})();

/** A Color holding the hex value's raw 0-1 channels (no sRGB -> linear conversion), as the shader expects. */
export function gammaColor(color: THREE.ColorRepresentation) {
  const hex = new THREE.Color(color).getHex();
  return new THREE.Color().setRGB(((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255, THREE.LinearSRGBColorSpace);
}

export function rsMaterial(options: RsMaterialOptions = {}): THREE.ShaderMaterial {
  const surfaces = options.surfaces ?? null;
  return new THREE.ShaderMaterial({
    name: 'RS',
    vertexShader,
    fragmentShader,
    vertexColors: options.vertexColors ?? false,
    transparent: options.transparent ?? false,
    depthWrite: !(options.transparent ?? false),
    side: options.side ?? THREE.FrontSide,
    uniforms: {
      ...rsUniforms,
      surfaceTextures: { value: surfaces?.texture ?? emptyArray },
      layerInfo: { value: surfaces?.info ?? emptyInfo },
      hasSurfaces: { value: !!surfaces },
      fixedLayer: { value: options.textureId !== undefined ? layerOf(surfaces, options.textureId) : 0 },
      baseColor: { value: gammaColor(options.color ?? 0xffffff) },
      opacity: { value: options.opacity ?? 1 },
      cutout: { value: options.cutout ? 1 : 0 },
    },
  });
}
