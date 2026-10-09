import * as THREE from 'three';
import { gammaColor } from './rs-material.ts';

/** Sky dome that follows the camera: the client's fog color at the horizon, fading to a clear blue overhead. */
export function createSky(horizon: THREE.Color, zenith: THREE.ColorRepresentation = 0x6f9ddb) {
  const material = new THREE.ShaderMaterial({
    name: 'Sky',
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    uniforms: { horizon: { value: horizon }, zenith: { value: gammaColor(zenith) } },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = position;
        vec4 view = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * view;
        gl_Position.z = gl_Position.w; // always at the far plane
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 horizon;
      uniform vec3 zenith;
      varying vec3 vDir;
      void main() {
        float h = normalize(vDir).y;
        float t = smoothstep(0.0, 0.55, h);
        gl_FragColor = vec4(mix(horizon, zenith, t), 1.0);
      }`,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(50, 24, 12), material);
  sky.name = 'Sky';
  sky.frustumCulled = false;
  sky.renderOrder = -1000;
  sky.onBeforeRender = (_renderer, _scene, camera) => {
    sky.position.copy(camera.position);
    sky.updateMatrixWorld();
  };
  return sky;
}
