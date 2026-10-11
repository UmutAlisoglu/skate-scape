// Pattern and colour ops (rt4 TextureOp*: ColorMultiply, Waveform, Noise, Diamond, Voronoi, SquareGrid, HslAdjust).
import type { Reader } from '../cache/reader.ts';
import { createTrigonometryTables, div, f32, imul, JavaRandom, randomInt, SINE, T, TextureOp, toInt } from './core.ts';

export class ColorMultiply extends TextureOp {
  private green = 4096; private red = 4096; private blue = 4096;
  constructor() { super(1, false); }
  override decode(opcode: number, buf: Reader) {
    if (opcode === 0) this.red = buf.g2();
    else if (opcode === 1) this.green = buf.g2();
    else if (opcode === 2) this.blue = buf.g2();
  }
  override colorOutput(row: number) {
    const out = this.colorCache.get(row);
    if (this.colorCache.invalid) {
      const [sr, sg, sb] = this.childColor(row, 0), [dr, dg, db] = out;
      for (let i = 0; i < T.width; i++) {
        const r = sr[i], g = sg[i], b = sb[i];
        // (the client multiplies only grey pixels, and crosses the green and blue inputs)
        if (r === b && g === b) { dr[i] = imul(this.red, r) >> 12; dg[i] = imul(b, this.green) >> 12; db[i] = imul(g, this.blue) >> 12; }
        else { dr[i] = this.red; dg[i] = this.green; db[i] = this.blue; }
      }
    }
    return out;
  }
}

export class Waveform extends TextureOp {
  private waveform = 0; private shape = 0; private frequency = 1;
  constructor() { super(0, true); }
  override postDecode() { createTrigonometryTables(); }
  override decode(opcode: number, buf: Reader) {
    if (opcode === 0) this.shape = buf.g1();
    else if (opcode === 1) this.waveform = buf.g1();
    else if (opcode === 3) this.frequency = buf.g1();
  }
  override monochromeOutput(row: number) {
    const out = this.monoCache.get(row);
    if (!this.monoCache.invalid) return out;
    const rowFraction = T.heightFractions[row], halfRow = (rowFraction - 2048) >> 1;
    for (let i = 0; i < T.width; i++) {
      const colFraction = T.widthFractions[i], halfCol = (colFraction - 2048) >> 1;
      let value: number;
      if (this.shape === 0) value = imul(colFraction - rowFraction, this.frequency);
      else {
        const distSq = (imul(halfCol, halfCol) + imul(halfRow, halfRow)) >> 12;
        value = toInt(Math.sqrt(f32(f32(distSq) / 4096)) * 4096);
        value = toInt(imul(value, this.frequency) * 3.141592653589793);
      }
      value -= value & 0xfffff000;
      if (this.waveform === 0) value = (SINE![(value >> 4) & 0xff] + 4096) >> 1;
      else if (this.waveform === 2) { value -= 2048; if (value < 0) value = -value; value = (2048 - value) << 1; }
      out[i] = value;
    }
    return out;
  }
}

export class Noise extends TextureOp {
  constructor() { super(0, true); }
  private hash(x: number, y: number) {
    const h = (y + imul(x, 57)) | 0, s = h ^ (h << 1);
    return 4096 - div((imul(s, (imul(imul(s, s), 15731) + 789221) | 0) + 1376312589) & 0x7fffffff, 262144);
  }
  override monochromeOutput(row: number) {
    const out = this.monoCache.get(row);
    if (this.monoCache.invalid) { const y = T.heightFractions[row]; for (let i = 0; i < T.width; i++) out[i] = this.hash(y, T.widthFractions[i]) % 4096; }
    return out;
  }
}

export class Diamond extends TextureOp {
  private border = 585;
  constructor() { super(0, true); }
  override decode(opcode: number, buf: Reader) { if (opcode === 0) this.border = buf.g2(); }
  override monochromeOutput(row: number) {
    const out = this.monoCache.get(row);
    if (!this.monoCache.invalid) return out;
    const y = T.heightFractions[row], b = this.border;
    for (let col = 0; col < T.width; col++) {
      const x = T.widthFractions[col];
      if (x > b && 4096 - b > x && 2048 - b < y && y < b + 2048) out[col] = 4096 - div(Math.abs(2048 - x) << 12, 2048 - b);
      else if (x > 2048 - b && x < b + 2048) out[col] = div((Math.abs(y - 2048) - b) << 12, 2048 - b);
      else if (y < b || 4096 - b < y) out[col] = div((Math.abs(x - 2048) - b) << 12, 2048 - b);
      else if (b <= x && x <= 4096 - b) out[col] = 0;
      else out[col] = 4096 - div(Math.abs(2048 - y) << 12, 2048 - b);
    }
    return out;
  }
}

const permutationTables = new Map<number, Int8Array>();
/** TextureOpVoronoi.getPermutationTable: a seeded shuffle of 0..254, mirrored into the upper half. */
export function permutationTable(seed: number) {
  let table = permutationTables.get(seed);
  if (!table) {
    const rng = new JavaRandom(seed);
    table = new Int8Array(512);
    for (let i = 0; i < 255; i++) table[i] = i;
    for (let i = 0; i < 255; i++) {
      const remaining = 255 - i, swap = randomInt(remaining, rng), tmp = table[swap];
      table[swap] = table[remaining];
      table[remaining] = table[511 - i] = tmp;
    }
    permutationTables.set(seed, table);
  }
  return table;
}

export class Voronoi extends TextureOp {
  private outputType = 2; private jitter = 2048; private seed = 0; private metric = 1;
  private cellsY = 5; private cellsX = 5;
  private perm: Int8Array = new Int8Array(512); private offsets = new Int16Array(512);
  constructor() { super(0, true); }
  override postDecode() {
    this.perm = permutationTable(this.seed);
    const rng = new JavaRandom(this.seed);
    this.offsets = new Int16Array(512);
    if (this.jitter > 0) for (let i = 0; i < 512; i++) this.offsets[i] = randomInt(this.jitter, rng);
  }
  override decode(opcode: number, buf: Reader) {
    if (opcode === 0) this.cellsX = this.cellsY = buf.g1();
    else if (opcode === 1) this.seed = buf.g1();
    else if (opcode === 2) this.jitter = buf.g2();
    else if (opcode === 3) this.outputType = buf.g1();
    else if (opcode === 4) this.metric = buf.g1();
    else if (opcode === 5) this.cellsX = buf.g1();
    else if (opcode === 6) this.cellsY = buf.g1();
  }
  override monochromeOutput(row: number) {
    const out = this.monoCache.get(row);
    if (!this.monoCache.invalid) return out;
    const scaledY = imul(this.cellsY, T.heightFractions[row]) + 2048, cellY = scaledY >> 12;
    for (let col = 0; col < T.width; col++) {
      let n1 = 0x7fffffff, n2 = 0x7fffffff, n3 = 0x7fffffff, n4 = 0x7fffffff;
      const scaledX = imul(this.cellsX, T.widthFractions[col]) + 2048, cellX = scaledX >> 12;
      for (let cy = cellY - 1; cy <= cellY + 1; cy++) {
        const permY = this.perm[(this.cellsY <= cy ? cy - this.cellsY : cy) & 0xff] & 0xff;
        for (let cx = cellX - 1; cx <= cellX + 1; cx++) {
          const p = (this.perm[((this.cellsX <= cx ? cx - this.cellsX : cx) + permY) & 0xff] & 0xff) * 2;
          let dx = -(cx << 12) + scaledX - this.offsets[p];
          let dy = scaledY - this.offsets[p + 1] - (cy << 12);
          let dist: number;
          const m = this.metric;
          if (m === 1) dist = (imul(dy, dy) + imul(dx, dx)) >> 12;
          else if (m === 3) { dx = Math.abs(dx); dy = Math.abs(dy); dist = dy >= dx ? dy : dx; }
          else if (m === 4) {
            dx = toInt(Math.sqrt(f32(f32(Math.abs(dx)) / 4096)) * 4096);
            dy = toInt(Math.sqrt(f32(f32(Math.abs(dy)) / 4096)) * 4096);
            dist = dy + dx; dist = imul(dist, dist) >> 12;
          } else if (m === 5) {
            dx = imul(dx, dx); dy = imul(dy, dy);
            dist = toInt(Math.sqrt(Math.sqrt(f32(f32((dy + dx) | 0) / 16777216))) * 4096);
          } else if (m === 2) dist = Math.abs(dx) + Math.abs(dy);
          else dist = toInt(Math.sqrt(f32(f32((imul(dy, dy) + imul(dx, dx)) | 0) / 16777216)) * 4096);
          if (dist < n1) { n4 = n3; n3 = n2; n2 = n1; n1 = dist; }
          else if (dist < n2) { n4 = n3; n3 = n2; n2 = dist; }
          else if (n3 > dist) { n4 = n3; n3 = dist; }
          else if (dist < n4) n4 = dist;
        }
      }
      const type = this.outputType;
      if (type === 0) out[col] = n1;
      else if (type === 1) out[col] = n2;
      else if (type === 3) out[col] = n3;
      else if (type === 4) out[col] = n4;
      else if (type === 2) out[col] = n2 - n1;
    }
    return out;
  }
}

export class SquareGrid extends TextureOp {
  private border = 204; private repeatY = 1; private repeatX = 1;
  constructor() { super(0, true); }
  override decode(opcode: number, buf: Reader) {
    if (opcode === 0) this.repeatX = buf.g1();
    else if (opcode === 1) this.repeatY = buf.g1();
    else if (opcode === 2) this.border = buf.g2();
  }
  override monochromeOutput(row: number) {
    const out = this.monoCache.get(row);
    if (!this.monoCache.invalid) return out;
    const wrap = (v: number) => { while (v < 0) v += 4; while (v > 3) v -= 4; return v; };
    for (let i = 0; i < T.width; i++) {
      const colFraction = T.widthFractions[i], rowFraction = T.heightFractions[row];
      let cellX = imul(this.repeatX, colFraction) >> 12;
      const cellY = imul(rowFraction, this.repeatY) >> 12;
      const fracX = imul(this.repeatX, colFraction % div(4096, this.repeatX)), fracY = imul(rowFraction % div(4096, this.repeatY), this.repeatY);
      if (this.border > fracY) {
        cellX = wrap(cellX - cellY);
        if (cellX !== 1 || this.border > fracX) { out[i] = 0; continue; }
      }
      if (fracX < this.border) {
        cellX = wrap(cellX - cellY);
        if (cellX > 0) { out[i] = 0; continue; }
      }
      out[i] = 4096;
    }
    return out;
  }
}

export class HslAdjust extends TextureOp {
  private hueShift = 0; private lightnessShift = 0; private saturationShift = 0;
  constructor() { super(1, false); }
  override decode(opcode: number, buf: Reader) {
    if (opcode === 0) this.hueShift = buf.g2b();
    else if (opcode === 1) this.saturationShift = div(buf.g1b() << 12, 100);
    else if (opcode === 2) this.lightnessShift = div(buf.g1b() << 12, 100);
  }
  override colorOutput(row: number) {
    const out = this.colorCache.get(row);
    if (!this.colorCache.invalid) return out;
    const [sr, sg, sb] = this.childColor(row, 0), [dr, dg, db] = out;
    for (let i = 0; i < T.width; i++) {
      // rgbToHsl
      const r = sr[i], g = sg[i], b = sb[i];
      const rgMax = r > g ? r : g, max = b <= rgMax ? rgMax : b, rgMin = g > r ? r : g, min = b >= rgMin ? rgMin : b, delta = max - min;
      let hue = 0;
      if (delta > 0) {
        const dg = div((max - g) << 12, delta), dr = div((max - r) << 12, delta), dbb = div((max - b) << 12, delta);
        if (r === max) hue = min === g ? dbb + 20480 : -dg + 4096;
        else if (max === g) hue = min === b ? dr + 4096 : -dbb + 12288;
        else hue = min === r ? dg + 12288 : -dr + 20480;
        hue = div(hue, 6);
      }
      let lightness = div(min + max, 2);
      let saturation = lightness > 0 && lightness < 4096 ? div(delta << 12, lightness > 2048 ? 8192 - lightness * 2 : lightness * 2) : 0;
      // adjust
      lightness += this.lightnessShift;
      if (lightness < 0) lightness = 0;
      saturation += this.saturationShift;
      if (lightness > 4096) lightness = 4096;
      if (saturation < 0) saturation = 0;
      if (saturation > 4096) saturation = 4096;
      hue += this.hueShift;
      while (hue < 0) hue += 4096;
      while (hue > 4096) hue -= 4096;
      // hslToRgb (unassigned channels keep the previous pixel's value, as in the client)
      const l = lightness, s = saturation;
      const q = l <= 2048 ? imul(l, s + 4096) >> 12 : l + s - (imul(l, s) >> 12);
      if (q <= 0) this.rgb[0] = this.rgb[1] = this.rgb[2] = l;
      else {
        const hue6 = imul(hue, 6), p = l + l - q, sector = hue6 >> 12, chroma = div((q - p) << 12, q), frac = hue6 - (sector << 12);
        const ramp = imul(imul(q, chroma) >> 12, frac) >> 12, up = ramp + p, down = q - ramp, c = this.rgb;
        if (sector === 0) { c[2] = p; c[0] = q; c[1] = up; }
        else if (sector === 1) { c[2] = p; c[1] = q; c[0] = down; }
        else if (sector === 2) { c[0] = p; c[1] = q; c[2] = up; }
        else if (sector === 3) { c[1] = down; c[2] = q; c[0] = p; }
        else if (sector === 4) { c[2] = q; c[0] = up; c[1] = p; }
        else if (sector === 5) { c[1] = p; c[0] = q; c[2] = down; }
      }
      dr[i] = this.rgb[0]; dg[i] = this.rgb[1]; db[i] = this.rgb[2];
    }
    return out;
  }
  private readonly rgb = new Int32Array(3);
}
