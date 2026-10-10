import * as THREE from 'three';

const COUNT = 72, RATE = 80;

/** Square particles (like the reference's grind sparks) that shrink and fade from `hot` to `cool`; normal blending
 *  so they read on bright ground. */
function particleMaterial(hot: THREE.Color, cool: THREE.Color, size: number) {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { hot: { value: hot }, cool: { value: cool }, size: { value: size } },
    vertexShader: `attribute float glow; varying float vGlow; uniform float size;
      void main() { vGlow = glow; gl_PointSize = glow > 0.0 ? size * (0.4 + 0.6 * glow) : 0.0; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `varying float vGlow; uniform vec3 hot; uniform vec3 cool;
      void main() { if (vGlow <= 0.0) discard; gl_FragColor = vec4(mix(cool, hot, vGlow), min(1.0, vGlow * 1.6)); }`,
  });
}
export const SPARK_COLORS = { hot: new THREE.Color(1, 0.86, 0.35), cool: new THREE.Color(0.95, 0.42, 0.08) };
/** RS magic blue, for Surge */
export const SURGE_COLORS = { hot: new THREE.Color(0.75, 0.95, 1), cool: new THREE.Color(0.15, 0.45, 1) };
/** special attacks: rune cyan, dragonfire, godsword gold */
export const RUNE_COLORS = { hot: new THREE.Color(0.8, 1, 1), cool: new THREE.Color(0.1, 0.75, 0.85) };
export const FIRE_COLORS = { hot: new THREE.Color(1, 0.92, 0.45), cool: new THREE.Color(0.95, 0.18, 0.04) };
export const GOLD_COLORS = { hot: new THREE.Color(1, 1, 0.75), cool: new THREE.Color(0.9, 0.62, 0.08) };

/** Grind sparks thrown back off the trucks: a small CPU particle pool drawn as one Points object. */
export class GrindSparks {
  readonly points: THREE.Points;
  private readonly positions = new Float32Array(COUNT * 3);
  private readonly glow = new Float32Array(COUNT);
  private readonly velocity = new Float32Array(COUNT * 3);
  private readonly life = new Float32Array(COUNT);
  private readonly span = new Float32Array(COUNT);
  private next = 0; private carry = 0;

  constructor(colors = SPARK_COLORS, size = 8, private spread = 1) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    geometry.setAttribute('glow', new THREE.BufferAttribute(this.glow, 1));
    this.points = new THREE.Points(geometry, particleMaterial(colors.hot, colors.cool, size));
    this.points.frustumCulled = false;
  }

  /** Emits from `at` while grinding (travel = unit direction of motion); pass null to let the sparks die out. */
  update(dt: number, at: THREE.Vector3 | null, travelX = 0, travelZ = 0, speed = 0) {
    if (at) {
      this.carry += dt * RATE * Math.min(1, 0.4 + speed / 8);
      for (; this.carry >= 1; this.carry--) {
        const i = this.next; this.next = (this.next + 1) % COUNT;
        const back = 1 + Math.random() * 1.6, side = (Math.random() - 0.5) * 1.6, jitter = 0.3 * this.spread;
        this.positions.set([at.x + (Math.random() - 0.5) * jitter, at.y + 0.04 + Math.random() * (this.spread - 1), at.z + (Math.random() - 0.5) * jitter], i * 3);
        this.velocity.set([-travelX * back + travelZ * side, 0.6 + Math.random() * 1.8, -travelZ * back - travelX * side], i * 3);
        this.life[i] = this.span[i] = 0.22 + Math.random() * 0.25;
      }
    }
    for (let i = 0; i < COUNT; i++) {
      if (this.life[i] <= 0) { this.glow[i] = 0; continue; }
      this.life[i] = Math.max(0, this.life[i] - dt);
      this.velocity[i * 3 + 1] -= 9.8 * dt;
      for (let axis = 0; axis < 3; axis++) this.positions[i * 3 + axis] += this.velocity[i * 3 + axis] * dt;
      this.glow[i] = this.life[i] / this.span[i];
    }
    const geometry = this.points.geometry;
    geometry.attributes.position.needsUpdate = true; geometry.attributes.glow.needsUpdate = true;
  }
}
