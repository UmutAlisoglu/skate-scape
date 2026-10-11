// Fills, gradients and per-pixel arithmetic ops (rt4 TextureOp*: MonochromeFill, ColorFill, Horizontal/Vertical
// Gradient, Brickwork, BoxBlur, Clamp, Combine, Curve, Flip, ColorGradient).
import type { Reader } from '../cache/reader.ts';
import { COSINE, createTrigonometryTables, div, fill, imul, JavaRandom, randomInt, T, TextureOp } from './core.ts';

export class MonochromeFill extends TextureOp {
  private value = 4096;
  constructor() { super(0, true); }
  override decode(opcode: number, buf: Reader) { if (opcode === 0) this.value = div(buf.g1() << 12, 255); }
  override monochromeOutput(row: number) {
    const out = this.monoCache.get(row);
    if (this.monoCache.invalid) fill(out, 0, T.width, this.value);
    return out;
  }
}

export class ColorFill extends TextureOp {
  private red = 0; private green = 0; private blue = 0;
  constructor() { super(0, false); this.setColor(0); }
  private setColor(color: number) { this.green = (color >> 4) & 0xff0; this.blue = (color & 0xff) << 4; this.red = (color >> 12) & 0xff0; }
  override decode(opcode: number, buf: Reader) { if (opcode === 0) this.setColor(buf.g3()); }
  override colorOutput(row: number) {
    const out = this.colorCache.get(row);
    if (this.colorCache.invalid) { out[0].fill(this.red, 0, T.width); out[1].fill(this.green, 0, T.width); out[2].fill(this.blue, 0, T.width); }
    return out;
  }
}

export class HorizontalGradient extends TextureOp {
  constructor() { super(0, true); }
  override monochromeOutput() { return T.widthFractions; }
}

export class VerticalGradient extends TextureOp {
  constructor() { super(0, true); }
  override monochromeOutput(y: number) {
    const out = this.monoCache.get(y);
    if (this.monoCache.invalid) fill(out, 0, T.width, T.heightFractions[y]);
    return out;
  }
}

export class Brickwork extends TextureOp {
  private rowHeight = 0; private halfMortarSize = 0; private columnWidth = 0;
  private columnPositions: Int32Array[] = []; private rowPositions = new Int32Array(0); private cellBrightness: Int32Array[] = [];
  private rowJitter = 204; private colorVariation = 1024; private scrollOffsetY = 0; private columnJitter = 409;
  private rows = 8; private mortarSize = 81; private columns = 4; private columnOffset = 1024;
  constructor() { super(0, true); }
  override postDecode() { this.buildLookupTable(); }
  override decode(opcode: number, buf: Reader) {
    if (opcode === 0) this.columns = buf.g1();
    else if (opcode === 1) this.rows = buf.g1();
    else if (opcode === 2) this.columnJitter = buf.g2();
    else if (opcode === 3) this.rowJitter = buf.g2();
    else if (opcode === 4) this.columnOffset = buf.g2();
    else if (opcode === 5) this.scrollOffsetY = buf.g2();
    else if (opcode === 6) this.mortarSize = buf.g2();
    else if (opcode === 7) this.colorVariation = buf.g2();
  }
  private buildLookupTable() {
    const rng = new JavaRandom(this.rows);
    this.rowHeight = div(4096, this.rows);
    this.halfMortarSize = div(this.mortarSize, 2);
    this.columnPositions = Array.from({ length: this.rows }, () => new Int32Array(this.columns + 1));
    const halfRowHeight = div(this.rowHeight, 2);
    this.rowPositions = new Int32Array(this.rows + 1);
    this.cellBrightness = Array.from({ length: this.rows }, () => new Int32Array(this.columns));
    this.columnWidth = div(4096, this.columns);
    const halfColWidth = div(this.columnWidth, 2);
    for (let r = 0; r < this.rows; r++) {
      if (r > 0) {
        const jitter = imul(randomInt(4096, rng) - 2048, this.rowJitter) >> 12;
        this.rowPositions[r] = this.rowPositions[r - 1] + this.rowHeight + (imul(jitter, halfRowHeight) >> 12);
      }
      this.columnPositions[r][0] = 0;
      for (let c = 0; c < this.columns; c++) {
        if (c > 0) {
          const colJitter = imul(randomInt(4096, rng) - 2048, this.columnJitter) >> 12;
          this.columnPositions[r][c] = this.columnPositions[r][c - 1] + this.columnWidth + (imul(halfColWidth, colJitter) >> 12);
        }
        this.cellBrightness[r][c] = this.colorVariation <= 0 ? 4096 : 4096 - randomInt(this.colorVariation, rng);
      }
      this.columnPositions[r][this.columns] = 4096;
    }
    this.rowPositions[this.rows] = 4096;
  }
  override monochromeOutput(row: number) {
    const out = this.monoCache.get(row);
    if (!this.monoCache.invalid) return out;
    let rowIdx = 0, y = T.heightFractions[row] + this.scrollOffsetY;
    while (y < 0) y += 4096;
    while (y > 4096) y -= 4096;
    while (this.rows > rowIdx && y >= this.rowPositions[rowIdx]) rowIdx++;
    const brickRow = rowIdx - 1, rowEnd = this.rowPositions[rowIdx], evenRow = (rowIdx & 1) === 0, rowStart = this.rowPositions[rowIdx - 1];
    if (rowStart + this.halfMortarSize < y && rowEnd - this.halfMortarSize > y) {
      for (let col = 0; col < T.width; col++) {
        let colIdx = 0;
        const offset = evenRow ? this.columnOffset : -this.columnOffset;
        let x = T.widthFractions[col] + (imul(this.columnWidth, offset) >> 12);
        while (x < 0) x += 4096;
        while (x > 4096) x -= 4096;
        while (this.columns > colIdx && x >= this.columnPositions[brickRow][colIdx]) colIdx++;
        const colEnd = this.columnPositions[brickRow][colIdx], brickCol = colIdx - 1, colStart = this.columnPositions[brickRow][brickCol];
        out[col] = colStart + this.halfMortarSize < x && colEnd - this.halfMortarSize > x ? this.cellBrightness[brickRow][brickCol] : 0;
      }
    } else fill(out, 0, T.width, 0);
    return out;
  }
}

export class BoxBlur extends TextureOp {
  private radiusX = 1; private radiusY = 1;
  constructor() { super(1, false); }
  override decode(opcode: number, buf: Reader) {
    if (opcode === 0) this.radiusX = buf.g1();
    else if (opcode === 1) this.radiusY = buf.g1();
    else if (opcode === 2) this.monochrome = buf.g1() === 1;
  }
  override monochromeOutput(row: number) {
    const out = this.monoCache.get(row);
    if (!this.monoCache.invalid) return out;
    const kernelH = this.radiusY + this.radiusY + 1, invKernelH = div(65536, kernelH);
    const kernelW = this.radiusX + this.radiusX + 1, invKernelW = div(65536, kernelW);
    const blurred: Int32Array[] = new Array(kernelH);
    for (let y = row - this.radiusY; y <= row + this.radiusY; y++) {
      const src = this.childMono(0, y & T.heightMask), dest = new Int32Array(T.width);
      let acc = 0;
      for (let x = -this.radiusX; x <= this.radiusX; x++) acc += src[x & T.widthMask];
      for (let x = 0; T.width > x;) {
        dest[x] = imul(invKernelW, acc) >> 16;
        acc -= src[T.widthMask & (x - this.radiusX)];
        x++;
        acc += src[T.widthMask & (this.radiusX + x)];
      }
      blurred[this.radiusY + y - row] = dest;
    }
    for (let x = 0; x < T.width; x++) {
      let sum = 0;
      for (let j = 0; j < kernelH; j++) sum += blurred[j][x];
      out[x] = imul(invKernelH, sum) >> 16;
    }
    return out;
  }
  override colorOutput(row: number) {
    const out = this.colorCache.get(row);
    if (!this.colorCache.invalid) return out;
    const kernelW = this.radiusX + this.radiusX + 1, invKernelW = div(65536, kernelW);
    const kernelH = this.radiusY + this.radiusY + 1, invKernelH = div(65536, kernelH);
    const blurred: Int32Array[][] = new Array(kernelH);
    for (let y = row - this.radiusY; y <= this.radiusY + row; y++) {
      const src = this.childColor(T.heightMask & y, 0), dest = [new Int32Array(T.width), new Int32Array(T.width), new Int32Array(T.width)];
      let accR = 0, accG = 0, accB = 0;
      const [srcR, srcG, srcB] = src;
      for (let k = -this.radiusX; k <= this.radiusX; k++) { const i = k & T.widthMask; accG += srcG[i]; accR += srcR[i]; accB += srcB[i]; }
      const [rowR, rowG, rowB] = dest;
      for (let x = 0; T.width > x;) {
        rowR[x] = imul(accR, invKernelW) >> 16; rowG[x] = imul(accG, invKernelW) >> 16; rowB[x] = imul(invKernelW, accB) >> 16;
        const trail = T.widthMask & (x - this.radiusX);
        accB -= srcB[trail]; x++; accR -= srcR[trail]; accG -= srcG[trail];
        const lead = (this.radiusX + x) & T.widthMask;
        accB += srcB[lead]; accG += srcG[lead]; accR += srcR[lead];
      }
      blurred[this.radiusY + y - row] = dest;
    }
    const [outR, outG, outB] = out;
    for (let x = 0; x < T.width; x++) {
      let r = 0, g = 0, b = 0;
      for (let j = 0; j < kernelH; j++) { const b3 = blurred[j]; b += b3[2][x]; g += b3[1][x]; r += b3[0][x]; }
      outR[x] = imul(invKernelH, r) >> 16; outG[x] = imul(invKernelH, g) >> 16; outB[x] = imul(b, invKernelH) >> 16;
    }
    return out;
  }
}

export class Clamp extends TextureOp {
  private lower = 0; private upper = 4096;
  constructor() { super(1, false); }
  override decode(opcode: number, buf: Reader) {
    if (opcode === 0) this.lower = buf.g2();
    else if (opcode === 1) this.upper = buf.g2();
    else if (opcode === 2) this.monochrome = buf.g1() === 1;
  }
  private c(v: number) { return this.lower > v ? this.lower : v > this.upper ? this.upper : v; }
  override colorOutput(row: number) {
    const out = this.colorCache.get(row);
    if (this.colorCache.invalid) {
      const input = this.childColor(row, 0);
      for (let ch = 0; ch < 3; ch++) for (let i = 0; i < T.width; i++) out[ch][i] = this.c(input[ch][i]);
    }
    return out;
  }
  override monochromeOutput(row: number) {
    const out = this.monoCache.get(row);
    if (this.monoCache.invalid) { const input = this.childMono(0, row); for (let i = 0; i < T.width; i++) out[i] = this.c(input[i]); }
    return out;
  }
}

/** One channel of TextureOpCombine's blend functions (a = input 0, b = input 1). */
function combine(func: number, out: Int32Array, a: Int32Array, b: Int32Array) {
  const w = T.width;
  if (func === 1) for (let i = 0; i < w; i++) out[i] = b[i] + a[i];
  else if (func === 2) for (let i = 0; i < w; i++) out[i] = a[i] - b[i];
  else if (func === 3) for (let i = 0; i < w; i++) out[i] = imul(b[i], a[i]) >> 12;
  else if (func === 4) for (let i = 0; i < w; i++) out[i] = b[i] === 0 ? 4096 : div(a[i] << 12, b[i]);
  else if (func === 5) for (let i = 0; i < w; i++) out[i] = 4096 - (imul(4096 - a[i], 4096 - b[i]) >> 12);
  else if (func === 6) for (let i = 0; i < w; i++) { const bv = b[i]; out[i] = bv >= 2048 ? 4096 - (imul(4096 - a[i], 4096 - bv) >> 11) : imul(bv, a[i]) >> 11; }
  else if (func === 7) for (let i = 0; i < w; i++) { const av = a[i]; out[i] = av === 4096 ? 4096 : div(b[i] << 12, 4096 - av); }
  else if (func === 8) for (let i = 0; i < w; i++) { const av = a[i]; out[i] = av === 0 ? 0 : 4096 - div((4096 - b[i]) << 12, av); }
  else if (func === 9) for (let i = 0; i < w; i++) out[i] = a[i] < b[i] ? a[i] : b[i];
  else if (func === 10) for (let i = 0; i < w; i++) out[i] = a[i] > b[i] ? a[i] : b[i];
  else if (func === 11) for (let i = 0; i < w; i++) out[i] = b[i] < a[i] ? a[i] - b[i] : b[i] - a[i];
  else if (func === 12) for (let i = 0; i < w; i++) out[i] = b[i] + a[i] - (imul(a[i], b[i]) >> 11);
}

export class Combine extends TextureOp {
  private func = 6;
  constructor() { super(2, false); }
  override decode(opcode: number, buf: Reader) {
    if (opcode === 0) this.func = buf.g1();
    else if (opcode === 1) this.monochrome = buf.g1() === 1;
  }
  override monochromeOutput(row: number) {
    const out = this.monoCache.get(row);
    if (this.monoCache.invalid) combine(this.func, out, this.childMono(0, row), this.childMono(1, row));
    return out;
  }
  override colorOutput(row: number) {
    const out = this.colorCache.get(row);
    if (this.colorCache.invalid) {
      const a = this.childColor(row, 0), b = this.childColor(row, 1);
      for (let ch = 0; ch < 3; ch++) combine(this.func, out[ch], a[ch], b[ch]);
    }
    return out;
  }
}

export class Curve extends TextureOp {
  private lastMarker: number[] = []; private firstMarker: number[] = [];
  private markers: number[][] | null = null;
  private readonly lookup = new Int16Array(257);
  private mode = 0;
  constructor() { super(1, true); }
  private marker(i: number) { return i >= 0 ? (i >= this.markers!.length ? this.firstMarker : this.markers![i]) : this.lastMarker; }
  private buildLookupTable() {
    const m = this.markers!;
    const store = (i: number, v: number) => { this.lookup[i] = v <= -32768 ? -32767 : v >= 32768 ? 32767 : v; };
    for (let i = 0; i < 257; i++) {
      const value = i << 4;
      let idx = 1;
      while (idx < m.length - 1 && m[idx][0] <= value) idx++;
      const cur = m[idx], prev = m[idx - 1];
      if (this.mode === 2) {
        const t = this.marker(idx - 2)[1], result = cur[1], weight = prev[1], diff = result - t, nextVal = this.marker(idx + 1)[1];
        const frac = div((value - prev[0]) << 12, cur[0] - prev[0]);
        const a = nextVal + weight - result - t, fracSq = imul(frac, frac) >> 12, b = t - weight - a, c = imul(diff, frac) >> 12;
        store(i, weight + (imul(fracSq, b) >> 12) + (imul(fracSq, imul(frac, a) >> 12) >> 12) + c);
      } else if (this.mode === 1) {
        const t = div((value - prev[0]) << 12, cur[0] - prev[0]);
        const weight = (4096 - COSINE![(t >> 5) & 0xff]) >> 1;
        store(i, (imul(weight, cur[1]) + imul(prev[1], 4096 - weight)) >> 12);
      } else {
        const t = div((value - prev[0]) << 12, cur[0] - prev[0]);
        store(i, (imul(cur[1], t) + imul(4096 - t, prev[1])) >> 12);
      }
    }
  }
  override monochromeOutput(row: number) {
    const out = this.monoCache.get(row);
    if (this.monoCache.invalid) {
      const input = this.childMono(0, row);
      for (let i = 0; i < T.width; i++) { let idx = input[i] >> 4; if (idx < 0) idx = 0; if (idx > 256) idx = 256; out[i] = this.lookup[idx]; }
    }
    return out;
  }
  override postDecode() {
    this.markers ??= [[0, 0], [4096, 4096]];
    if (this.markers.length < 2) throw new Error('Curve operation requires at least two markers');
    if (this.mode === 2) {
      const m = this.markers, first = m[0], second = m[1], secondLast = m[m.length - 2], last = m[m.length - 1];
      this.lastMarker = [first[0] + first[0] - second[0], -second[1] + first[1] + first[1]];
      this.firstMarker = [secondLast[0] + secondLast[0] - last[0], -last[1] + secondLast[1] + secondLast[1]];
    }
    createTrigonometryTables();
    this.buildLookupTable();
  }
  override decode(opcode: number, buf: Reader) {
    if (opcode !== 0) return;
    this.mode = buf.g1();
    this.markers = Array.from({ length: buf.g1() }, () => [0, 0]);
    for (const marker of this.markers) { marker[0] = buf.g2(); marker[1] = buf.g2(); }
  }
}

export class Flip extends TextureOp {
  private horizontal = true; private vertical = true;
  constructor() { super(1, false); }
  override decode(opcode: number, buf: Reader) {
    if (opcode === 0) this.horizontal = buf.g1() === 1;
    else if (opcode === 1) this.vertical = buf.g1() === 1;
    else if (opcode === 2) this.monochrome = buf.g1() === 1;
  }
  private copy(dest: Int32Array, src: Int32Array) {
    if (this.horizontal) for (let x = 0; x < T.width; x++) dest[x] = src[T.widthMask - x];
    else dest.set(src.subarray(0, T.width));
  }
  override colorOutput(row: number) {
    const out = this.colorCache.get(row);
    if (this.colorCache.invalid) { const src = this.childColor(this.vertical ? T.heightMask - row : row, 0); for (let ch = 0; ch < 3; ch++) this.copy(out[ch], src[ch]); }
    return out;
  }
  override monochromeOutput(row: number) {
    const out = this.monoCache.get(row);
    if (this.monoCache.invalid) this.copy(out, this.childMono(0, this.vertical ? T.heightMask - row : row));
    return out;
  }
}

const GRADIENT_PRESETS: Record<number, number[][]> = {
  1: [[0, 0, 0, 0], [4096, 4096, 4096, 4096]],
  2: [[0, 2650, 2602, 2361], [2867, 2313, 1799, 1558], [3072, 2618, 1734, 1413], [3276, 2296, 1220, 947], [3481, 2072, 963, 722], [3686, 2730, 2152, 1766], [3891, 2232, 1060, 915], [4096, 1686, 1413, 1140]],
  3: [[0, 0, 0, 4096], [663, 0, 4096, 4096], [1363, 0, 4096, 0], [2048, 4096, 4096, 0], [2727, 4096, 0, 0], [3411, 4096, 0, 4096], [4096, 0, 0, 4096]],
  4: [[0, 0, 0, 0], [1843, 0, 0, 1493], [2457, 0, 0, 2939], [2781, 0, 1124, 3565], [3481, 546, 3084, 4031], [4096, 4096, 4096, 4096]],
  5: [[0, 80, 192, 321], [155, 321, 449, 562], [389, 578, 690, 803], [671, 947, 995, 1140], [897, 1285, 1397, 1509], [1175, 1525, 1429, 1413], [1368, 1734, 1461, 1333], [1507, 1413, 1525, 1702],
    [1736, 1108, 1590, 2056], [2088, 1766, 2056, 2666], [2355, 2409, 2586, 3276], [2691, 3116, 3148, 3228], [3031, 3806, 3710, 3196], [3522, 3437, 3421, 3019], [3727, 3116, 3148, 3228], [4096, 2377, 2505, 2746]],
  6: [[2048, 0, 4096, 0], [2867, 4096, 4096, 0], [3276, 4096, 4096, 0], [4096, 4096, 0, 0]],
};

export class ColorGradient extends TextureOp {
  private samples: number[][] | null = null;
  private readonly colors = new Int32Array(257);
  constructor() { super(1, false); }
  private preset(id: number) {
    if (id === 0) return;
    const preset = GRADIENT_PRESETS[id];
    if (!preset) throw new Error('Invalid gradient preset');
    this.samples = preset.map((s) => [...s]);
  }
  override postDecode() { if (!this.samples) this.preset(1); this.interpolate(); }
  override decode(opcode: number, buf: Reader) {
    if (opcode !== 0) return;
    const id = buf.g1();
    if (id !== 0) { this.preset(id); return; }
    this.samples = Array.from({ length: buf.g1() }, () => [buf.g2(), buf.g1() << 4, buf.g1() << 4, buf.g1() << 4]);
  }
  private interpolate() {
    const s = this.samples!, count = s.length;
    if (count <= 0) return;
    for (let i = 0; i < 257; i++) {
      let idx = 0;
      const value = i << 4;
      for (let j = 0; count > j && value >= s[j][0]; j++) idx++;
      let r: number, g: number, b: number;
      if (count > idx) {
        const sample = s[idx];
        if (idx > 0) {
          const prev = s[idx - 1], t = div((value - prev[0]) << 12, sample[0] - prev[0]), inv = 4096 - t;
          b = (imul(prev[3], inv) + imul(sample[3], t)) >> 12;
          r = (imul(inv, prev[1]) + imul(t, sample[1])) >> 12;
          g = (imul(inv, prev[2]) + imul(t, sample[2])) >> 12;
        } else { r = sample[1]; b = sample[3]; g = sample[2]; }
      } else { const sample = s[count - 1]; b = sample[3]; g = sample[2]; r = sample[1]; }
      r = Math.max(0, Math.min(255, r >> 4)); g = Math.max(0, Math.min(255, g >> 4)); b = Math.max(0, Math.min(255, b >> 4));
      this.colors[i] = b | (g << 8) | (r << 16);
    }
  }
  override colorOutput(row: number) {
    const out = this.colorCache.get(row);
    if (this.colorCache.invalid) {
      const input = this.childMono(0, row), [r, g, b] = out;
      for (let i = 0; i < T.width; i++) {
        let idx = input[i] >> 4; if (idx < 0) idx = 0; if (idx > 256) idx = 256;
        const c = this.colors[idx];
        r[i] = (c >> 12) & 0xff0; g[i] = (c >> 4) & 0xff0; b[i] = (c & 0xff) << 4;
      }
    }
    return out;
  }
}
