// Ops that remap or mix their inputs (rt4 TextureOp*: PolarDistort, Tile, Interpolate, Invert, Kaleidoscope,
// Monochrome, ColorReplace, Binary).
import type { Reader } from '../cache/reader.ts';
import { COSINE, createTrigonometryTables, div, f32, imul, SINE, T, TextureOp } from './core.ts';

export class PolarDistort extends TextureOp {
  private amplitude = 32768;
  constructor() { super(3, false); }
  override postDecode() { createTrigonometryTables(); }
  override decode(opcode: number, buf: Reader) {
    if (opcode === 0) this.amplitude = buf.g2() << 4;
    else if (opcode === 1) this.monochrome = buf.g1() === 1;
  }
  override colorOutput(row: number) {
    const out = this.colorCache.get(row);
    if (!this.colorCache.invalid) return out;
    const angles = this.childMono(1, row), radii = this.childMono(2, row), [dr, dg, db] = out;
    for (let col = 0; col < T.width; col++) {
      const angle = (imul(angles[col], 255) >> 12) & 0xff, radius = imul(radii[col], this.amplitude) >> 12;
      const dx = imul(radius, COSINE![angle]) >> 12, dy = imul(SINE![angle], radius) >> 12;
      const srcX = ((dx >> 12) + col) & T.widthMask, srcY = T.heightMask & (row + (dy >> 12));
      const src = this.childColor(srcY, 0);
      dr[col] = src[0][srcX]; dg[col] = src[1][srcX]; db[col] = src[2][srcX];
    }
    return out;
  }
  override monochromeOutput(row: number) {
    const out = this.monoCache.get(row);
    if (!this.monoCache.invalid) return out;
    const angles = this.childMono(1, row), radii = this.childMono(2, row);
    for (let col = 0; col < T.width; col++) {
      const radius = imul(this.amplitude, radii[col]) >> 12, angle = (angles[col] >> 4) & 0xff;
      const dx = imul(COSINE![angle], radius) >> 12, dy = imul(SINE![angle], radius) >> 12;
      out[col] = this.childMono(0, T.heightMask & ((dy >> 12) + row))[T.widthMask & ((dx >> 12) + col)];
    }
    return out;
  }
}

export class Tile extends TextureOp {
  private horizontal = 4; private vertical = 4;
  constructor() { super(1, false); }
  override decode(opcode: number, buf: Reader) {
    if (opcode === 0) this.horizontal = buf.g1();
    else if (opcode === 1) this.vertical = buf.g1();
  }
  private sourceRow(row: number, tileHeight: number) { return tileHeight <= 0 ? 0 : div(imul(T.height, row % tileHeight), tileHeight); }
  private sourceCol(i: number, tileWidth: number) { return tileWidth <= 0 ? 0 : div(imul(T.width, i % tileWidth), tileWidth); }
  override monochromeOutput(row: number) {
    const out = this.monoCache.get(row);
    if (!this.monoCache.invalid) return out;
    const tileWidth = div(T.width, this.horizontal), tileHeight = div(T.height, this.vertical);
    const input = this.childMono(0, this.sourceRow(row, tileHeight));
    for (let i = 0; i < T.width; i++) out[i] = input[this.sourceCol(i, tileWidth)];
    return out;
  }
  override colorOutput(row: number) {
    const out = this.colorCache.get(row);
    if (!this.colorCache.invalid) return out;
    const tileWidth = div(T.width, this.horizontal), tileHeight = div(T.height, this.vertical);
    const input = this.childColor(this.sourceRow(row, tileHeight), 0);
    for (let i = 0; i < T.width; i++) { const s = this.sourceCol(i, tileWidth); out[0][i] = input[0][s]; out[1][i] = input[1][s]; out[2][i] = input[2][s]; }
    return out;
  }
}

export class Interpolate extends TextureOp {
  constructor() { super(3, false); }
  override decode(opcode: number, buf: Reader) { if (opcode === 0) this.monochrome = buf.g1() === 1; }
  override colorOutput(row: number) {
    const out = this.colorCache.get(row);
    if (!this.colorCache.invalid) return out;
    const mask = this.childMono(2, row), a = this.childColor(row, 0), b = this.childColor(row, 1);
    for (let col = 0; col < T.width; col++) {
      const blend = mask[col];
      for (let ch = 0; ch < 3; ch++) {
        out[ch][col] = blend === 4096 ? a[ch][col] : blend === 0 ? b[ch][col] : (imul(4096 - blend, b[ch][col]) + imul(blend, a[ch][col])) >> 12;
      }
    }
    return out;
  }
  override monochromeOutput(row: number) {
    const out = this.monoCache.get(row);
    if (!this.monoCache.invalid) return out;
    const a = this.childMono(0, row), b = this.childMono(1, row), mask = this.childMono(2, row);
    for (let col = 0; col < T.width; col++) {
      const blend = mask[col];
      out[col] = blend === 4096 ? a[col] : blend === 0 ? b[col] : (imul(blend, a[col]) + imul(4096 - blend, b[col])) >> 12;
    }
    return out;
  }
}

export class Invert extends TextureOp {
  constructor() { super(1, false); }
  override decode(opcode: number, buf: Reader) { if (opcode === 0) this.monochrome = buf.g1() === 1; }
  override monochromeOutput(row: number) {
    const out = this.monoCache.get(row);
    if (this.monoCache.invalid) { const src = this.childMono(0, row); for (let i = 0; i < T.width; i++) out[i] = 4096 - src[i]; }
    return out;
  }
  override colorOutput(row: number) {
    const out = this.colorCache.get(row);
    if (this.colorCache.invalid) { const src = this.childColor(row, 0); for (let ch = 0; ch < 3; ch++) for (let i = 0; i < T.width; i++) out[ch][i] = 4096 - src[ch][i]; }
    return out;
  }
}

export class Kaleidoscope extends TextureOp {
  private mappedX = 0; private mappedY = 0;
  constructor() { super(1, false); }
  override decode(opcode: number, buf: Reader) { if (opcode === 0) this.monochrome = buf.g1() === 1; }
  private map(row: number, col: number) {
    const angle = f32(Math.atan2(T.widthFractions[col] - 2048, T.heightFractions[row] - 2048));
    if (angle >= -3.141592653589793 && -2.356194490192345 >= angle) { this.mappedY = row; this.mappedX = col; }
    else if (angle <= -1.5707963267948966 && -2.356194490192345 <= angle) { this.mappedX = row; this.mappedY = col; }
    else if (angle <= -0.7853981633974483 && angle >= -1.5707963267948966) { this.mappedX = T.width - row; this.mappedY = col; }
    else if (angle <= 0 && angle >= -0.7853981633974483) { this.mappedX = col; this.mappedY = T.height - row; }
    else if (angle >= 0 && angle <= 0.7853981633974483) { this.mappedX = T.width - col; this.mappedY = T.height - row; }
    else if (angle >= 0.7853981633974483 && angle <= 1.5707963267948966) { this.mappedX = T.width - row; this.mappedY = T.height - col; }
    else if (angle >= 1.5707963267948966 && angle <= 2.356194490192345) { this.mappedY = T.height - col; this.mappedX = row; }
    else if (angle >= 2.356194490192345 && angle <= 3.141592653589793) { this.mappedX = T.width - col; this.mappedY = row; }
    this.mappedX &= T.widthMask; this.mappedY &= T.heightMask;
  }
  override monochromeOutput(row: number) {
    const out = this.monoCache.get(row);
    if (this.monoCache.invalid) for (let i = 0; i < T.width; i++) { this.map(row, i); out[i] = this.childMono(0, this.mappedY)[this.mappedX]; }
    return out;
  }
  override colorOutput(row: number) {
    const out = this.colorCache.get(row);
    if (this.colorCache.invalid) for (let i = 0; i < T.width; i++) {
      this.map(row, i);
      const input = this.childColor(this.mappedY, 0);
      out[0][i] = input[0][this.mappedX]; out[1][i] = input[1][this.mappedX]; out[2][i] = input[2][this.mappedX];
    }
    return out;
  }
}

export class Monochrome extends TextureOp {
  constructor() { super(1, true); }
  override monochromeOutput(row: number) {
    const out = this.monoCache.get(row);
    if (this.monoCache.invalid) { const [r, g, b] = this.childColor(row, 0); for (let i = 0; i < T.width; i++) out[i] = div(b[i] + r[i] + g[i], 3); }
    return out;
  }
}

export class ColorReplace extends TextureOp {
  private green = 4096; private blue = 4096; private red = 4096; private tolerance = 409;
  private readonly target = new Int32Array(3);
  constructor() { super(1, false); }
  override decode(opcode: number, buf: Reader) {
    if (opcode === 0) this.tolerance = buf.g2();
    else if (opcode === 1) this.blue = buf.g2();
    else if (opcode === 2) this.green = buf.g2();
    else if (opcode === 3) this.red = buf.g2();
    else if (opcode === 4) {
      // (the client's own unpacking: blue always 0, red shifted past its channel)
      const packed = buf.g3();
      this.target[2] = (packed >> 12) & 0;
      this.target[1] = (packed >> 4) & 0xff0;
      this.target[0] = (packed & 0xff0000) << 4;
    }
  }
  override colorOutput(row: number) {
    const out = this.colorCache.get(row);
    if (!this.colorCache.invalid) return out;
    const [sr, sg, sb] = this.childColor(row, 0), [dr, dg, db] = out, t = this.target, tol = this.tolerance;
    for (let i = 0; i < T.width; i++) {
      const r = sr[i], g = sg[i], b = sb[i];
      if (Math.abs(r - t[0]) <= tol && Math.abs(g - t[1]) <= tol && Math.abs(b - t[2]) <= tol) {
        dr[i] = imul(this.red, r) >> 12; dg[i] = imul(this.green, g) >> 12; db[i] = imul(this.blue, b) >> 12;
      } else { dr[i] = r; dg[i] = g; db[i] = b; }
    }
    return out;
  }
}

export class Binary extends TextureOp {
  private max = 4096; private min = 0;
  constructor() { super(1, true); }
  override decode(opcode: number, buf: Reader) {
    if (opcode === 0) this.min = buf.g2();
    else if (opcode === 1) this.max = buf.g2();
  }
  override monochromeOutput(row: number) {
    const out = this.monoCache.get(row);
    if (this.monoCache.invalid) { const src = this.childMono(0, row); for (let i = 0; i < T.width; i++) out[i] = this.min <= src[i] && src[i] <= this.max ? 4096 : 0; }
    return out;
  }
}
