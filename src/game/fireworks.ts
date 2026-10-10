import * as THREE from 'three';

const COUNT = 220;
const PALETTE = [0xff5a3c, 0xffd34a, 0x6be36b, 0x4ab8ff, 0xd879ff, 0xffffff].map((c) => new THREE.Color(c));

/** RS level-up fireworks: a burst of coloured stars that shoot up around the rider, then fall and fade. */
export class Fireworks {
  readonly points: THREE.Points;
  private readonly positions = new Float32Array(COUNT * 3);
  private readonly colors = new Float32Array(COUNT * 3);
  private readonly velocity = new Float32Array(COUNT * 3);
  private readonly base = new Float32Array(COUNT * 3);
  private readonly life = new Float32Array(COUNT);
  private next = 0;
  constructor() {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));
    this.points = new THREE.Points(geometry, new THREE.PointsMaterial({ size: 7, sizeAttenuation: false, vertexColors: true, transparent: true, depthWrite: false, fog: false }));
    this.points.frustumCulled = false;
  }
  /** Launches a burst at a point; bigger bursts for level-ups. */
  burst(at: THREE.Vector3, size: 'challenge' | 'level') {
    const count = size === 'level' ? 140 : 80;
    for (let n = 0; n < count; n++) {
      const i = this.next; this.next = (this.next + 1) % COUNT;
      const a = Math.random() * Math.PI * 2, up = 4 + Math.random() * (size === 'level' ? 5 : 3), out = 1 + Math.random() * 2.5;
      this.positions.set([at.x, at.y + 1.2, at.z], i * 3);
      this.velocity.set([Math.cos(a) * out, up, Math.sin(a) * out], i * 3);
      const color = PALETTE[Math.floor(Math.random() * PALETTE.length)];
      this.base.set([color.r, color.g, color.b], i * 3);
      this.life[i] = 1 + Math.random() * 0.7;
    }
  }
  update(dt: number) {
    for (let i = 0; i < COUNT; i++) {
      if (this.life[i] <= 0) { this.colors[i * 3] = this.colors[i * 3 + 1] = this.colors[i * 3 + 2] = 0; this.positions[i * 3 + 1] = -1e4; continue; }
      this.life[i] -= dt;
      this.velocity[i * 3 + 1] -= 6 * dt;
      for (let k = 0; k < 3; k++) { this.velocity[i * 3 + k] *= 1 - 1.2 * dt; this.positions[i * 3 + k] += this.velocity[i * 3 + k] * dt; }
      const glow = Math.max(0, Math.min(1, this.life[i] / 0.6)) * (0.7 + 0.3 * Math.sin(this.life[i] * 40));
      for (let k = 0; k < 3; k++) this.colors[i * 3 + k] = this.base[i * 3 + k] * glow;
    }
    const geometry = this.points.geometry;
    geometry.attributes.position.needsUpdate = true; geometry.attributes.color.needsUpdate = true;
  }
}
