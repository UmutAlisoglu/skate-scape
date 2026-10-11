// Ops that read images or shade height fields (rt4 TextureOp*: Stripes, Range, Mandelbrot, BumpMap, NormalMap,
// Emboss, Texture, Sprite, TiledSprite).
import type { Reader } from '../cache/reader.ts';
import { div, f32, fill, imul, normalBrightnessLookup, setSize, T, TextureOp, toInt } from './core.ts';

export class Stripes extends TextureOp {
  private starts = new Int32Array(0); private ends = new Int32Array(0);
  private direction = 0; private count = 10; private width = 2048;
  constructor() { super(0, true); }
  override postDecode() {
    let offset = 0;
    this.ends = new Int32Array(this.count + 1);
    const step = div(4096, this.count);
    this.starts = new Int32Array(this.count + 1);
    const span = imul(this.width, step) >> 12;
    for (let i = 0; i < this.count; i++) { this.starts[i] = offset; this.ends[i] = offset + span; offset += step; }
    this.starts[this.count] = 4096;
    this.ends[this.count] = this.ends[0] + 4096;
  }
  override decode(opcode: number, buf: Reader) {
    if (opcode === 0) this.count = buf.g1();
    else if (opcode === 1) this.width = buf.g2();
    else if (opcode === 2) this.direction = buf.g1();
  }
  private value(v: number) {
    for (let i = 0; i < this.count; i++) if (this.starts[i] <= v && v < this.starts[i + 1]) return v < this.ends[i] ? 4096 : 0;
    return 0;
  }
  override monochromeOutput(row: number) {
    const out = this.monoCache.get(row);
    if (!this.monoCache.invalid) return out;
    const y = T.heightFractions[row];
    if (this.direction === 0) fill(out, 0, T.width, this.value(y));
    else for (let col = 0; col < T.width; col++) {
      const x = T.widthFractions[col], d = this.direction;
      const v = d === 1 ? x : d === 2 ? ((x + y - 4096) >> 1) + 2048 : d === 3 ? ((x - y) >> 1) + 2048 : 0;
      out[col] = this.value(v);
    }
    return out;
  }
}

export class Range extends TextureOp {
  private min = 1024; private span = 2048; private max = 3072;
  constructor() { super(1, false); }
  override decode(opcode: number, buf: Reader) {
    if (opcode === 0) this.min = buf.g2();
    else if (opcode === 1) this.max = buf.g2();
    else if (opcode === 2) this.monochrome = buf.g1() === 1;
  }
  override postDecode() { this.span = this.max - this.min; }
  override monochromeOutput(row: number) {
    const out = this.monoCache.get(row);
    if (this.monoCache.invalid) { const src = this.childMono(0, row); for (let i = 0; i < T.width; i++) out[i] = this.min + (imul(src[i], this.span) >> 12); }
    return out;
  }
  override colorOutput(row: number) {
    const out = this.colorCache.get(row);
    if (this.colorCache.invalid) { const src = this.childColor(row, 0); for (let ch = 0; ch < 3; ch++) for (let i = 0; i < T.width; i++) out[ch][i] = this.min + (imul(this.span, src[ch][i]) >> 12); }
    return out;
  }
}

export class Mandelbrot extends TextureOp {
  private zoom = 1365; private offsetY = 0; private offsetX = 0; private maxIterations = 20;
  constructor() { super(0, true); }
  override decode(opcode: number, buf: Reader) {
    if (opcode === 0) this.zoom = buf.g2();
    else if (opcode === 1) this.maxIterations = buf.g2();
    else if (opcode === 2) this.offsetX = buf.g2();
    else if (opcode === 3) this.offsetY = buf.g2();
  }
  override monochromeOutput(row: number) {
    const out = this.monoCache.get(row);
    if (!this.monoCache.invalid) return out;
    for (let i = 0; i < T.width; i++) {
      const cy = this.offsetY + div(T.heightFractions[row] << 12, this.zoom), cx = this.offsetX + div(T.widthFractions[i] << 12, this.zoom);
      let zx = cx, zy = cy, iteration = 0, zxSq = imul(cx, cx) >> 12, zySq = imul(cy, cy) >> 12;
      while (zxSq + zySq < 16384 && this.maxIterations > iteration) {
        zy = (((imul(zx, zy) >> 12) * 2) | 0) + cy;
        iteration++;
        zx = zxSq + cx - zySq;
        zySq = imul(zy, zy) >> 12;
        zxSq = imul(zx, zx) >> 12;
      }
      out[i] = iteration >= this.maxIterations - 1 ? 0 : div(iteration << 12, this.maxIterations);
    }
    return out;
  }
}

export class BumpMap extends TextureOp {
  private readonly light = new Int32Array(3);
  private azimuth = 3216; private strength = 4096; private elevation = 3216;
  constructor() { super(1, true); }
  override decode(opcode: number, buf: Reader) {
    if (opcode === 0) this.strength = buf.g2();
    else if (opcode === 1) this.azimuth = buf.g2();
    else if (opcode === 2) this.elevation = buf.g2();
  }
  override postDecode() {
    const l = this.light, cosElev = Math.cos(f32(f32(this.elevation) / 4096));
    l[0] = toInt(cosElev * 4096 * Math.sin(f32(f32(this.azimuth) / 4096)));
    l[1] = toInt(Math.cos(f32(f32(this.azimuth) / 4096)) * cosElev * 4096);
    l[2] = toInt(Math.sin(f32(f32(this.elevation) / 4096)) * 4096);
    const zSq = imul(l[2], l[2]) >> 12, ySq = imul(l[1], l[1]) >> 12, xSq = imul(l[0], l[0]) >> 12;
    const magnitude = toInt(Math.sqrt((xSq + ySq + zSq) >> 12) * 4096);
    if (magnitude !== 0) { l[2] = div(l[2] << 12, magnitude); l[0] = div(l[0] << 12, magnitude); l[1] = div(l[1] << 12, magnitude); }
  }
  override monochromeOutput(row: number) {
    const out = this.monoCache.get(row);
    if (!this.monoCache.invalid) return out;
    const scale = imul(T.widthScale, this.strength) >> 12;
    const prev = this.childMono(0, T.heightMask & (row - 1)), cur = this.childMono(0, row), next = this.childMono(0, (row + 1) & T.heightMask);
    for (let i = 0; i < T.width; i++) {
      const dx = imul(cur[T.widthMask & (i - 1)] - cur[(i + 1) & T.widthMask], scale) >> 12, dy = imul(scale, next[i] - prev[i]) >> 12;
      let ax = dx >> 4; if (ax < 0) ax = -ax; if (ax > 255) ax = 255;
      let ay = dy >> 4; if (ay < 0) ay = -ay; if (ay > 255) ay = 255;
      const nz = normalBrightnessLookup[(imul(ay, ay + 1) >> 1) + ax] & 0xff;
      const ny = imul(dy, nz) >> 8, nx = imul(nz, dx) >> 8;
      out[i] = (imul(imul(nz, 4096) >> 8, this.light[2]) >> 12) + (imul(ny, this.light[1]) >> 12) + (imul(this.light[0], nx) >> 12);
    }
    return out;
  }
}

export class NormalMap extends TextureOp {
  private strength = 4096; private biased = true;
  constructor() { super(1, false); }
  override decode(opcode: number, buf: Reader) {
    if (opcode === 0) this.strength = buf.g2();
    else if (opcode === 1) this.biased = buf.g1() === 1;
  }
  override colorOutput(row: number) {
    const out = this.colorCache.get(row);
    if (!this.colorCache.invalid) return out;
    const prev = this.childMono(0, T.heightMask & (row - 1)), cur = this.childMono(0, row), next = this.childMono(0, (row + 1) & T.heightMask);
    for (let col = 0; col < T.width; col++) {
      const dy = imul(this.strength, next[col] - prev[col]), dx = imul(this.strength, cur[(col + 1) & T.widthMask] - cur[T.widthMask & (col - 1)]);
      const dyn = dy >> 12, dxn = dx >> 12, dySq = imul(dyn, dyn) >> 12, dxSq = imul(dxn, dxn) >> 12;
      const length = toInt(Math.sqrt(f32(f32((dxSq + dySq + 4096) | 0) / 4096)) * 4096);
      let nx = 0, ny = 0, nz = 0;
      if (length !== 0) { nz = div(16777216, length); ny = div(dy, length); nx = div(dx, length); }
      if (this.biased) { ny = (ny >> 1) + 2048; nz = (nz >> 1) + 2048; nx = (nx >> 1) + 2048; }
      out[0][col] = nx; out[1][col] = ny; out[2][col] = nz;
    }
    return out;
  }
}

export class Emboss extends TextureOp {
  private strength = 4096;
  constructor() { super(1, true); }
  override decode(opcode: number, buf: Reader) { if (opcode === 0) this.strength = buf.g2(); }
  override monochromeOutput(row: number) {
    const out = this.monoCache.get(row);
    if (!this.monoCache.invalid) return out;
    const prev = this.childMono(0, (row - 1) & T.heightMask), cur = this.childMono(0, row), next = this.childMono(0, T.heightMask & (row + 1));
    for (let i = 0; i < T.width; i++) {
      const dy = imul(next[i] - prev[i], this.strength), dx = imul(this.strength, cur[T.widthMask & (i + 1)] - cur[(i - 1) & T.widthMask]);
      const dxn = dx >> 12, dyn = dy >> 12, dxSq = imul(dxn, dxn) >> 12, dySq = imul(dyn, dyn) >> 12;
      const magnitude = toInt(Math.sqrt(f32(f32((dySq + dxSq + 4096) | 0) / 4096)) * 4096);
      out[i] = 4096 - (magnitude === 0 ? 0 : div(16777216, magnitude));
    }
    return out;
  }
}

/** Writes RGB pixels (0xRRGGBB) into the three 12-bit channels, resampling a row of `width` to the texture width. */
function unpackRow(out: Int32Array[], pixels: Int32Array, width: number, height: number, row: number) {
  let offset = imul(height === T.height ? row : div(imul(height, row), T.height), width);
  const [r, g, b] = out;
  for (let i = 0; i < T.width; i++) {
    const c = T.width === width ? pixels[offset++] : pixels[offset + div(imul(width, i), T.width)];
    b[i] = (c & 0xff) << 4; g[i] = (c >> 4) & 0xff0; r[i] = (c >> 12) & 0xff0;
  }
}

export class TextureRef extends TextureOp {
  private pixels: Int32Array | null = null; private width = 0; private height = 0; private textureId = -1;
  constructor() { super(0, false); }
  override decode(opcode: number, buf: Reader) { if (opcode === 0) this.textureId = buf.g2(); }
  override requiredTextureId() { return this.textureId; }
  override clear() { super.clear(); this.pixels = null; }
  private load() {
    if (this.pixels) return true;
    if (this.textureId < 0) return false;
    const prevWidth = T.width, prevHeight = T.height, size = T.provider!.isLowDetail(this.textureId) ? 64 : 128;
    this.pixels = T.provider!.getPixels(this.textureId);
    this.height = this.width = size;
    setSize(prevHeight, prevWidth);
    return this.pixels !== null;
  }
  override colorOutput(row: number) {
    const out = this.colorCache.get(row);
    if (this.colorCache.invalid && this.load()) unpackRow(out, this.pixels!, this.width, this.height, row);
    return out;
  }
}

export class Sprite extends TextureOp {
  protected width = 0; protected height = 0; protected pixels: Int32Array | null = null;
  private spriteId = -1;
  constructor() { super(0, false); }
  override decode(opcode: number, buf: Reader) { if (opcode === 0) this.spriteId = buf.g2(); }
  override requiredSpriteId() { return this.spriteId; }
  override clear() { super.clear(); this.pixels = null; }
  protected load() {
    if (this.pixels) return true;
    if (this.spriteId < 0) return false;
    const sprite = T.sprites!.sprite(this.spriteId);
    if (!sprite) throw new Error(`sprite ${this.spriteId} is missing`);
    this.height = sprite.height; this.width = sprite.width; this.pixels = sprite.pixels;
    return true;
  }
  override colorOutput(row: number) {
    const out = this.colorCache.get(row);
    if (this.colorCache.invalid && this.load()) unpackRow(out, this.pixels!, this.width, this.height, row);
    return out;
  }
}

export class TiledSprite extends Sprite {
  override colorOutput(row: number) {
    const out = this.colorCache.get(row);
    if (this.colorCache.invalid && this.load()) {
      const offset = imul(row % this.height, this.height), [r, g, b] = out;
      for (let i = 0; i < T.width; i++) {
        const c = this.pixels![offset + (i % this.width)];
        b[i] = (c & 0xff) << 4; g[i] = (c >> 4) & 0xff0; r[i] = (c >> 12) & 0xff0;
      }
    }
    return out;
  }
}
