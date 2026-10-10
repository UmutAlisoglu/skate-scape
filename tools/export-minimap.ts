// Draws an RS-style minimap of an exported area: terrain colours seen from above, with walls and fences
// as light lines. Usage: npm run export:minimap [-- <area>]   (after export:world and export:collision)
import { readFileSync, writeFileSync } from 'node:fs';
import { soupPositions } from '../src/shared/soup.ts';
import type { CollisionIndex } from '../src/world/load.ts';
import { encodePng } from './png.ts';

const area = process.argv[2] ?? 'misthalin';
if (!/^[a-z0-9_-]+$/i.test(area)) throw new Error('Invalid area name');
const base = `public/world/${area}`;
const manifest = JSON.parse(readFileSync(`${base}/manifest.json`, 'utf8')) as { sizeTiles: [number, number] };
const SCALE = 4; // pixels per tile
const [W, H] = [manifest.sizeTiles[0] * SCALE, manifest.sizeTiles[1] * SCALE];
const rgba = new Uint8Array(W * H * 4);
const height = new Float32Array(W * H).fill(-Infinity);

function readSoup(path: string) {
  const data = readFileSync(path), count = data.readUInt32LE(0);
  return { count, positions: soupPositions(data.buffer, data.byteOffset, count), colors: data.subarray(4 + count * 18) };
}
/** Pixel of a three-space point (x east, z north-negative); north is up in the image. */
const px = (x: number) => (x / 128) * SCALE, py = (z: number) => H + (z / 128) * SCALE;

// terrain: fill each triangle's footprint with its colour, keeping the highest surface per pixel
const terrain = readSoup(`${base}/terrain.bin`);
for (let t = 0; t < terrain.count; t++) {
  const p = terrain.positions, o = t * 9;
  const xs = [px(p[o]), px(p[o + 3]), px(p[o + 6])], ys = [py(p[o + 2]), py(p[o + 5]), py(p[o + 8])], hs = [p[o + 1], p[o + 4], p[o + 7]];
  const area = (xs[1] - xs[0]) * (ys[2] - ys[0]) - (xs[2] - xs[0]) * (ys[1] - ys[0]);
  if (Math.abs(area) < 1e-6) continue;
  const [r, g, b] = [terrain.colors[t * 4], terrain.colors[t * 4 + 1], terrain.colors[t * 4 + 2]];
  for (let y = Math.max(0, Math.floor(Math.min(...ys))); y <= Math.min(H - 1, Math.ceil(Math.max(...ys))); y++)
    for (let x = Math.max(0, Math.floor(Math.min(...xs))); x <= Math.min(W - 1, Math.ceil(Math.max(...xs))); x++) {
      const cx = x + 0.5, cy = y + 0.5;
      const w0 = ((xs[1] - cx) * (ys[2] - cy) - (xs[2] - cx) * (ys[1] - cy)) / area;
      const w1 = ((xs[2] - cx) * (ys[0] - cy) - (xs[0] - cx) * (ys[2] - cy)) / area;
      const w2 = 1 - w0 - w1;
      if (w0 < -1e-4 || w1 < -1e-4 || w2 < -1e-4) continue;
      const h = w0 * hs[0] + w1 * hs[1] + w2 * hs[2], i = y * W + x;
      if (h < height[i]) continue;
      height[i] = h;
      rgba.set([r, g, b, 255], i * 4);
    }
}

// water (textured in the client, so its base colour is pale): the RS minimap's blue, slightly darker offshore
const traversal = readFileSync(`${base}/traversal.bin`);
for (let ty = 0; ty < manifest.sizeTiles[1]; ty++) for (let tx = 0; tx < manifest.sizeTiles[0]; tx++) {
  if (!traversal[tx + ty * manifest.sizeTiles[0]]) continue;
  for (let y = 0; y < SCALE; y++) for (let x = 0; x < SCALE; x++) {
    const i = (H - 1 - (ty * SCALE + y)) * W + tx * SCALE + x, shade = ((tx * 7 + ty * 13) % 5) - 2;
    rgba.set([46 + shade, 78 + shade, 132 + shade * 2, 255], i * 4);
  }
}

// walls and fences: steep collision faces near the ground, drawn as light lines (the RS minimap's white walls)
const index = JSON.parse(readFileSync(`${base}/collision/index.json`, 'utf8')) as CollisionIndex;
const wall = new Uint8Array(W * H);
const line = (x0: number, y0: number, x1: number, y1: number) => {
  const steps = Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)));
  for (let s = 0; s <= steps; s++) {
    const x = Math.floor(x0 + ((x1 - x0) * s) / (steps || 1)), y = Math.floor(y0 + ((y1 - y0) * s) / (steps || 1));
    if (x >= 0 && y >= 0 && x < W && y < H) wall[y * W + x] = 1;
  }
};
for (const [cx, cy] of index.cells) {
  const cell = readSoup(`${base}/collision/${cx}_${cy}.bin`), p = cell.positions;
  for (let t = 0; t < cell.count; t++) {
    const o = t * 9;
    const ax = p[o + 3] - p[o], ay = p[o + 4] - p[o + 1], az = p[o + 5] - p[o + 2], bx = p[o + 6] - p[o], by = p[o + 7] - p[o + 1], bz = p[o + 8] - p[o + 2];
    const nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx, length = Math.hypot(nx, ny, nz);
    if (!length || Math.abs(ny) / length > 0.3) continue;
    const top = Math.max(p[o + 1], p[o + 4], p[o + 7]) / 128, low = Math.min(p[o + 1], p[o + 4], p[o + 7]) / 128;
    const gx = Math.floor(px(p[o])), gy = Math.floor(py(p[o + 2]));
    const ground = gx >= 0 && gy >= 0 && gx < W && gy < H ? height[gy * W + gx] / 128 : 0;
    if (low > ground + 1.2 || top - low < 0.4) continue; // roofs, upper floors and small clutter
    line(px(p[o]), py(p[o + 2]), px(p[o + 3]), py(p[o + 5]));
    line(px(p[o + 3]), py(p[o + 5]), px(p[o + 6]), py(p[o + 8]));
  }
}
for (let i = 0; i < W * H; i++) if (wall[i]) rgba.set([226, 222, 210, 255], i * 4);

writeFileSync(`${base}/minimap.png`, encodePng(W, H, rgba));
writeFileSync(`${base}/minimap.json`, JSON.stringify({ scale: SCALE, width: W, height: H }));
console.log(`Wrote ${base}/minimap.png (${W}x${H}, ${SCALE} px per tile)`);
