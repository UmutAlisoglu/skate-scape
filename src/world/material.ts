import * as THREE from 'three';
import { loadJson } from './load.ts';

export async function worldMaterials(base: string) {
  const [atlas, info] = await Promise.all([
    new THREE.TextureLoader().loadAsync(`${base}/atlas.png`),
    loadJson<{ width: number; height: number; columns: number; cell: number; padding: number; size: number }>(`${base}/manifest.json`),
  ]);
  atlas.colorSpace = THREE.SRGBColorSpace;
  atlas.flipY = false;
  atlas.generateMipmaps = false;
  atlas.minFilter = THREE.LinearFilter;
  atlas.magFilter = THREE.LinearFilter;
  const create = (transparent: boolean) => {
    const material = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, transparent, depthWrite: !transparent });
    material.onBeforeCompile = (shader) => {
      shader.uniforms.surfaceAtlas = { value: atlas };
      shader.vertexShader = `attribute float surface; varying float vSurface; varying vec3 vSurfacePosition; varying vec3 vSurfaceNormal;\n${shader.vertexShader}`;
      shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>\nvSurface = surface; vSurfacePosition = (modelMatrix * vec4(transformed, 1.0)).xyz; vSurfaceNormal = normalize(mat3(modelMatrix) * objectNormal);`);
      shader.fragmentShader = `uniform sampler2D surfaceAtlas; varying float vSurface; varying vec3 vSurfacePosition; varying vec3 vSurfaceNormal;\n${shader.fragmentShader}`;
      shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `
        #include <color_fragment>
        vec3 n = abs(normalize(vSurfaceNormal));
        vec2 surfaceUV = n.y > max(n.x, n.z) ? vSurfacePosition.xz : (n.x > n.z ? vSurfacePosition.zy : vSurfacePosition.xy);
        if (vSurface > 0.5) {
          float id = vSurface - 1.0;
          vec2 tile = vec2(mod(id, ${info.columns}.0), floor(id / ${info.columns}.0));
          vec2 atlasUV = (tile * ${info.cell}.0 + ${info.padding}.0 + fract(surfaceUV * 0.8) * ${info.size - 1}.0 + 0.5) / vec2(${info.width}.0, ${info.height}.0);
          vec4 texel = texture2D(surfaceAtlas, atlasUV);
          if (texel.a < 0.12) discard;
          diffuseColor.rgb = texel.rgb;
        } else {
          float grayness = max(diffuseColor.r, max(diffuseColor.g, diffuseColor.b)) - min(diffuseColor.r, min(diffuseColor.g, diffuseColor.b));
          float grain = fract(sin(dot(floor(surfaceUV * 85.0), vec2(12.9898, 78.233))) * 43758.5453);
          diffuseColor.rgb *= 0.95 + grain * 0.1;
          if (grayness < 0.055 && n.y < 0.5) {
            vec2 brick = surfaceUV * vec2(1.6, 3.2); brick.x += mod(floor(brick.y), 2.0) * 0.5;
            vec2 f = fract(brick);
            float mortar = smoothstep(0.025, 0.055, min(min(f.x, 1.0-f.x), min(f.y, 1.0-f.y)));
            diffuseColor.rgb *= 0.64 + 0.36 * mortar;
          }
        }
      `);
    };
    material.customProgramCacheKey = () => 'scape-surfaces-v1';
    return material;
  };
  return { opaque: create(false), translucent: create(true) };
}
