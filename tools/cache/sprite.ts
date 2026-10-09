import { Reader } from './reader.ts';

/** JS5 indexed sprite, including row/column storage and optional alpha planes. */
export function decodeSprite(data: Uint8Array): { width: number; height: number; pixels: Uint8Array } {
  const r = new Reader(data);
  r.pos = data.length - 2;
  const frames = r.g2();
  if (frames < 1 || frames > 4096) throw new Error('Invalid sprite frame count');
  r.pos = data.length - frames * 8 - 7;
  const width = r.g2(), height = r.g2(), paletteSize = r.g1() + 1;
  if (width < 1 || height < 1 || width * height > 16_777_216) throw new Error('Invalid sprite dimensions');
  const xs = Array.from({ length: frames }, () => r.g2());
  const ys = Array.from({ length: frames }, () => r.g2());
  const widths = Array.from({ length: frames }, () => r.g2());
  const heights = Array.from({ length: frames }, () => r.g2());
  r.pos = data.length - frames * 8 - 7 - (paletteSize - 1) * 3;
  const palette = [0];
  for (let i = 1; i < paletteSize; i++) palette.push(r.g3() || 1);
  r.pos = 0;
  const flags = r.g1(), w = widths[0], h = heights[0];
  if (w < 1 || h < 1 || xs[0] + w > width || ys[0] + h > height) throw new Error('Invalid sprite crop');
  const indices = new Uint8Array(w * h);
  const alpha = new Uint8Array(w * h).fill(255);
  for (let i = 0; i < w * h; i++) indices[(flags & 1) ? (i % h) * w + Math.floor(i / h) : i] = r.g1();
  if (flags & 2) for (let i = 0; i < w * h; i++) alpha[(flags & 1) ? (i % h) * w + Math.floor(i / h) : i] = r.g1();
  const pixels = new Uint8Array(width * height * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const index = y * w + x, dest = ((y + ys[0]) * width + x + xs[0]) * 4;
    const color = palette[indices[index]];
    pixels[dest] = color >> 16; pixels[dest + 1] = color >> 8; pixels[dest + 2] = color;
    pixels[dest + 3] = indices[index] ? alpha[index] : 0;
  }
  return { width, height, pixels };
}
