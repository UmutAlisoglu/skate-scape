// Generated patterns (rt4 TextureOp*: BarkPattern, PerlinNoise, WaveInterference, LineScatter).
import type { Reader } from '../cache/reader.ts';
import { COSINE, createTrigonometryTables, div, f32, fill, imul, JavaRandom, randomInt, SINE, smoothstepLookup, T, TextureOp, toInt } from './core.ts';
import { permutationTable } from './ops-pattern.ts';

export class BarkPattern extends TextureOp {
  private cornerSize = 0;
  private maxHeight = 819; private cornerMode = 0; private maxWidth = 2048; private roundness = 1024; private minWidth = 1024;
  private minHeight = 409; private brightnessVariation = 1024; private roundnessVariation = 1024; private seed = 0;
  constructor() { super(0, true); }
  override decode(opcode: number, buf: Reader) {
    if (opcode === 0) this.seed = buf.g1();
    else if (opcode === 1) this.minWidth = buf.g2();
    else if (opcode === 2) this.maxWidth = buf.g2();
    else if (opcode === 3) this.minHeight = buf.g2();
    else if (opcode === 4) this.maxHeight = buf.g2();
    else if (opcode === 5) this.roundness = buf.g2();
    else if (opcode === 6) this.cornerMode = buf.g1();
    else if (opcode === 7) this.roundnessVariation = buf.g2();
    else if (opcode === 8) this.brightnessVariation = buf.g2();
  }
  override monochromeOutput(row: number) {
    const output = this.monoCache.get(row);
    if (!this.monoCache.invalid) return output;
    const allRows = this.monoCache.all();
    let curX = 0, prevRowOffset = 0, rowDelta = 0, rowOffset = 0, prevBandIdx = 0, lastRow = true, firstRow = true, prevBandCount = 0, curBandIdx = 0;
    const W = T.width, H = T.height;
    const minW = imul(W, this.minWidth) >> 12, maxW = imul(W, this.maxWidth) >> 12, maxH = imul(this.maxHeight, H) >> 12, minH = imul(H, this.minHeight) >> 12;
    if (maxH <= 1) return allRows[row];
    const maxBands = div(W, minW) + 1;
    this.cornerSize = imul(div(W, 8), this.roundness) >> 12;
    let prevBands = Array.from({ length: maxBands }, () => new Int32Array(3)), curBands = Array.from({ length: maxBands }, () => new Int32Array(3));
    const rng = new JavaRandom(this.seed);
    for (;;) {
      let width = minW + randomInt(maxW - minW, rng);
      let height = randomInt(maxH - minH, rng) + minH;
      let endX = curX + width;
      if (W < endX) { endX = W; width = W - curX; }
      let startY: number, spanCount: number;
      if (firstRow) startY = 0;
      else {
        let scanIdx = prevBandIdx;
        startY = prevBands[prevBandIdx][2];
        spanCount = 0;
        let wrappedEnd = rowDelta + endX;
        if (wrappedEnd < 0) wrappedEnd += W;
        if (W < wrappedEnd) wrappedEnd -= W;
        for (;;) {
          const scanBand = prevBands[scanIdx];
          if (wrappedEnd >= scanBand[0] && scanBand[1] >= wrappedEnd) {
            if (prevBandIdx !== scanIdx) {
              let wrappedStart = rowDelta + curX;
              if (wrappedStart < 0) wrappedStart += W;
              if (wrappedStart > W) wrappedStart -= W;
              for (let j = 1; j <= spanCount; j++) startY = Math.max(startY, prevBands[(prevBandIdx + j) % prevBandCount][2]);
              for (let j = 0; j <= spanCount; j++) {
                const gap = prevBands[(prevBandIdx + j) % prevBandCount], gapY = gap[2];
                if (gapY === startY) continue;
                const gapStart = gap[0], gapEnd = gap[1];
                let fillStart: number, fillEnd: number;
                if (wrappedEnd > wrappedStart) { fillStart = Math.max(wrappedStart, gapStart); fillEnd = Math.min(wrappedEnd, gapEnd); }
                else if (gapStart === 0) { fillEnd = Math.min(wrappedEnd, gapEnd); fillStart = 0; }
                else { fillStart = Math.max(wrappedStart, gapStart); fillEnd = W; }
                this.renderBranch(gapY, rng, prevRowOffset + fillStart, -fillStart + fillEnd, startY - gapY, allRows);
              }
            }
            prevBandIdx = scanIdx;
            break;
          }
          spanCount++;
          scanIdx++;
          if (scanIdx >= prevBandCount) scanIdx = 0;
        }
      }
      if (H >= startY + height) lastRow = false;
      else height = H - startY;
      if (endX === W) {
        this.renderBranch(startY, rng, rowOffset + curX, width, height, allRows);
        if (lastRow) return output;
        lastRow = true;
        prevRowOffset = rowOffset;
        firstRow = false;
        const entry = curBands[curBandIdx++];
        entry[0] = curX;
        prevBandIdx = 0;
        prevBandCount = curBandIdx;
        curBandIdx = 0;
        entry[2] = height + startY;
        entry[1] = endX;
        rowOffset = randomInt(W, rng);
        rowDelta = rowOffset - prevRowOffset;
        const tmp = prevBands;
        curX = 0;
        prevBands = curBands;
        spanCount = rowDelta;
        if (rowDelta < 0) spanCount = rowDelta + W;
        curBands = tmp;
        if (W < spanCount) spanCount -= W;
        for (;;) {
          const prev = prevBands[prevBandIdx];
          if (prev[0] <= spanCount && prev[1] >= spanCount) break;
          prevBandIdx++;
          if (prevBandCount <= prevBandIdx) prevBandIdx = 0;
        }
      } else {
        const entry = curBands[curBandIdx++];
        entry[1] = endX; entry[2] = height + startY; entry[0] = curX;
        this.renderBranch(startY, rng, curX + rowOffset, width, height, allRows);
        curX = endX;
      }
    }
  }
  private renderBranch(startY: number, rng: JavaRandom, x: number, width: number, height: number, allRows: Int32Array[]) {
    const brightness = this.brightnessVariation > 0 ? 4096 - randomInt(this.brightnessVariation, rng) : 4096;
    const cornerVariation = imul(this.roundnessVariation, this.cornerSize) >> 12;
    const corner = this.cornerSize - (cornerVariation > 0 ? randomInt(cornerVariation, rng) : 0);
    const W = T.width, M = T.widthMask;
    if (W <= x) x -= W;
    // fills `count` pixels from `at`, wrapping around the right edge
    const span = (rowData: Int32Array, at: number, count: number, value: number) => {
      if (W >= count + at) fill(rowData, at, count, value);
      else { const first = W - at; fill(rowData, at, first, value); fill(rowData, 0, count - first, value); }
    };
    if (corner > 0) {
      if (height <= 0 || width <= 0) return;
      const halfW = div(width, 2), halfH = div(height, 2);
      const cornerW = halfW < corner ? halfW : corner, cornerH = halfH >= corner ? corner : halfH;
      const innerWidth = width - cornerW * 2, innerX = cornerW + x;
      for (let row = 0; row < height; row++) {
        const rowData = allRows[startY + row];
        if (row < cornerH) {
          const fade = div(imul(row, brightness), cornerH);
          for (let col = 0; col < cornerW; col++) {
            const colFade = div(imul(col, brightness), cornerW);
            rowData[M & (col + x)] = rowData[(width + x - col - 1) & M] = this.cornerMode === 0 ? imul(colFade, fade) >> 12 : fade <= colFade ? fade : colFade;
          }
          span(rowData, innerX, innerWidth, fade);
        } else {
          const below = height - row - 1;
          if (below >= cornerH) {
            for (let col = 0; col < cornerW; col++) rowData[M & (x + col)] = rowData[(x + width - col - 1) & M] = div(imul(brightness, col), cornerW);
            span(rowData, innerX, innerWidth, brightness);
          } else {
            const fade = div(imul(below, brightness), cornerH);
            for (let col = 0; col < cornerW; col++) {
              const edgeFade = div(imul(brightness, col), cornerW);
              rowData[M & (x + col)] = rowData[M & (x + width - col - 1)] = this.cornerMode === 0 ? imul(edgeFade, fade) >> 12 : fade <= edgeFade ? fade : edgeFade;
            }
            span(rowData, innerX, innerWidth, fade);
          }
        }
      }
    } else for (let i = 0; i < height; i++) span(allRows[startY + i], x, width, brightness);
  }
}

export class PerlinNoise extends TextureOp {
  private frequencies = new Int16Array(0); private amplitudes: Int16Array | null = null;
  private frequencyY = 4; private frequencyX = 4; private normalize = true; private persistence = 1638;
  private perm: Int8Array = new Int8Array(512); private octaves = 4; private seed = 0;
  constructor() { super(0, true); }
  override decode(opcode: number, buf: Reader) {
    if (opcode === 0) this.normalize = buf.g1() === 1;
    else if (opcode === 1) this.octaves = buf.g1();
    else if (opcode === 2) {
      this.persistence = buf.g2b();
      if (this.persistence < 0) { this.amplitudes = new Int16Array(this.octaves); for (let i = 0; i < this.octaves; i++) this.amplitudes[i] = buf.g2b(); }
    } else if (opcode === 3) this.frequencyX = this.frequencyY = buf.g1();
    else if (opcode === 4) this.seed = buf.g1();
    else if (opcode === 5) this.frequencyX = buf.g1();
    else if (opcode === 6) this.frequencyY = buf.g1();
  }
  override postDecode() {
    this.perm = permutationTable(this.seed);
    if (this.persistence > 0) {
      this.amplitudes = new Int16Array(this.octaves); this.frequencies = new Int16Array(this.octaves);
      for (let i = 0; i < this.octaves; i++) {
        this.amplitudes[i] = toInt(Math.pow(f32(f32(this.persistence) / 4096), i) * 4096);
        this.frequencies[i] = toInt(Math.pow(2, i));
      }
    } else if (this.amplitudes && this.amplitudes.length === this.octaves) {
      this.frequencies = new Int16Array(this.octaves);
      for (let i = 0; i < this.octaves; i++) this.frequencies[i] = toInt(Math.pow(2, i));
    }
    for (let i = this.octaves - 1; i >= 1; i--) {
      const amp = this.amplitudes![i];
      if (amp > 8 || amp < -8) break;
      this.octaves--;
    }
  }
  private sample(xPos: number, permYNext: number, permY: number, scaledFreqX: number, yFrac: number, smoothY: number) {
    const p = this.perm, yFracNeg = yFrac - 4096, cellX = xPos >> 12;
    let cellXNext = cellX + 1;
    const cellXMasked = cellX & 0xff;
    if (cellXNext >= scaledFreqX) cellXNext = 0;
    const xFrac = xPos & 0xfff;
    let grad = p[cellXMasked + permY] & 3;
    const smoothX = smoothstepLookup[xFrac];
    let dot0 = grad > 1 ? (grad === 2 ? xFrac - yFrac : -xFrac - yFrac) : grad === 0 ? yFrac + xFrac : -xFrac + yFrac;
    cellXNext &= 0xff;
    const xFracNeg = xFrac - 4096;
    grad = p[permY + cellXNext] & 3;
    let dot1 = grad <= 1 ? (grad === 0 ? yFrac + xFracNeg : -xFracNeg + yFrac) : grad === 2 ? xFracNeg - yFrac : -xFracNeg - yFrac;
    grad = p[cellXMasked + permYNext] & 3;
    const top = dot0 + (imul(dot1 - dot0, smoothX) >> 12);
    dot0 = grad > 1 ? (grad === 2 ? xFrac - yFracNeg : -xFrac - yFracNeg) : grad === 0 ? xFrac + yFracNeg : yFracNeg - xFrac;
    grad = p[permYNext + cellXNext] & 3;
    dot1 = grad > 1 ? (grad === 2 ? xFracNeg - yFracNeg : -yFracNeg - xFracNeg) : grad === 0 ? xFracNeg + yFracNeg : yFracNeg - xFracNeg;
    const bottom = dot0 + (imul(dot1 - dot0, smoothX) >> 12);
    return top + (imul(smoothY, bottom - top) >> 12);
  }
  private octave(octave: number, scaledY: number) {
    const scale = this.frequencies[octave] << 12;
    let yPos = imul(scaledY, scale) >> 12;
    const cellY = yPos >> 12, permY = this.perm[cellY & 0xff] & 0xff;
    yPos &= 0xfff;
    const scaledFreqX = imul(this.frequencyX, scale) >> 12, scaledFreqY = imul(scale, this.frequencyY) >> 12;
    let cellYNext = cellY + 1;
    if (cellYNext >= scaledFreqY) cellYNext = 0;
    return { scale, yPos, permY, permYNext: this.perm[cellYNext & 0xff] & 0xff, scaledFreqX, smoothY: smoothstepLookup[yPos] };
  }
  private noiseRow(row: number, out: Int32Array) {
    const scaledY = imul(this.frequencyY, T.heightFractions[row]), amps = this.amplitudes!;
    const at = (o: ReturnType<PerlinNoise['octave']>, col: number) => this.sample(imul(o.scale, imul(this.frequencyX, T.widthFractions[col])) >> 12, o.permYNext, o.permY, o.scaledFreqX, o.yPos, o.smoothY);
    if (this.octaves === 1) {
      const amplitude = amps[0], o = this.octave(0, scaledY);
      for (let col = 0; col < T.width; col++) {
        const noise = imul(amplitude, at(o, col)) >> 12;
        out[col] = this.normalize ? (noise >> 1) + 2048 : noise;
      }
      return;
    }
    let amplitude = amps[0];
    if (amplitude > 8 || amplitude < -8) {
      const o = this.octave(0, scaledY);
      for (let col = 0; col < T.width; col++) out[col] = imul(at(o, col), amplitude) >> 12;
    }
    for (let octave = 1; octave < this.octaves; octave++) {
      amplitude = amps[octave];
      if (!(amplitude > 8 || amplitude < -8)) continue;
      const o = this.octave(octave, scaledY);
      if (this.normalize && octave === this.octaves - 1) {
        for (let col = 0; col < T.width; col++) { const noise = (imul(amplitude, at(o, col)) >> 12) + out[col]; out[col] = (noise >> 1) + 2048; }
      } else for (let col = 0; col < T.width; col++) out[col] += imul(at(o, col), amplitude) >> 12;
    }
  }
  override monochromeOutput(row: number) {
    const out = this.monoCache.get(row);
    if (this.monoCache.invalid) this.noiseRow(row, out);
    return out;
  }
}

export class WaveInterference extends TextureOp {
  private offsetY1 = 0; private frequency = 12288; private offsetY2 = 2048; private offsetX2 = 0; private offsetX1 = 2048;
  private amplitude = 4096; private divisor = 8192;
  constructor() { super(0, true); }
  override postDecode() { createTrigonometryTables(); }
  override decode(opcode: number, buf: Reader) {
    if (opcode === 0) this.offsetX1 = buf.g2();
    else if (opcode === 1) this.offsetY1 = buf.g2();
    else if (opcode === 2) this.offsetX2 = buf.g2();
    else if (opcode === 3) this.offsetY2 = buf.g2();
    else if (opcode === 4) this.frequency = buf.g2();
    else if (opcode === 5) this.amplitude = buf.g2();
    else if (opcode === 6) this.divisor = buf.g2();
  }
  private bound(phase: number) {
    const cos = COSINE![(imul(phase, 255) >> 12) & 0xff];
    return imul(div(div(cos << 12, this.frequency) << 12, this.divisor), this.amplitude) >> 12;
  }
  override monochromeOutput(row: number) {
    const out = this.monoCache.get(row);
    if (!this.monoCache.invalid) return out;
    const wrap = (v: number) => { if (v < -2048) v += 4096; return v > 2048 ? v - 4096 : v; };
    const y = T.heightFractions[row] - 2048;
    for (let col = 0; col < T.width; col++) {
      const x = T.widthFractions[col] - 2048;
      const y1 = wrap(y + this.offsetY1), x1 = wrap(this.offsetX1 + x), x2 = wrap(x + this.offsetX2), y2 = wrap(y + this.offsetY2);
      const primary = (() => { const b = this.bound(imul(y1 - x1, this.frequency) >> 12); return y1 + x1 < b && -b < y1 + x1; })();
      const secondary = () => { const b = this.bound(imul(this.frequency, x2 + y2) >> 12); return b > y2 - x2 && -b < y2 - x2; };
      out[col] = primary || secondary() ? 4096 : 0;
    }
    return out;
  }
}

export class LineScatter extends TextureOp {
  private baseAngle = 0; private lineCount = 2000; private lineLength = 16; private angleSpread = 4096; private seed = 0;
  constructor() { super(0, true); }
  override postDecode() { createTrigonometryTables(); }
  override decode(opcode: number, buf: Reader) {
    if (opcode === 0) this.seed = buf.g1();
    else if (opcode === 1) this.lineCount = buf.g2();
    else if (opcode === 2) this.lineLength = buf.g1();
    else if (opcode === 3) this.baseAngle = buf.g2();
    else if (opcode === 4) this.angleSpread = buf.g2();
  }
  override monochromeOutput(row: number) {
    const output = this.monoCache.get(row);
    if (!this.monoCache.invalid) return output;
    const halfSpread = this.angleSpread >> 1, allRows = this.monoCache.all(), rng = new JavaRandom(this.seed);
    for (let i = 0; i < this.lineCount; i++) {
      const angle = this.angleSpread > 0 ? this.baseAngle + randomInt(this.angleSpread, rng) - halfSpread : this.baseAngle;
      let x0 = randomInt(T.width, rng);
      const trig = (angle >> 4) & 0xff;
      let y0 = randomInt(T.height, rng);
      let x1 = x0 + (imul(this.lineLength, COSINE![trig]) >> 12), y1 = y0 + (imul(SINE![trig], this.lineLength) >> 12);
      let dx = x1 - x0, dy = y1 - y0;
      if (dx === 0 && dy === 0) continue;
      if (dx < 0) dx = -dx;
      if (dy < 0) dy = -dy;
      const steep = dy > dx;
      if (steep) { const t0 = x0, t1 = x1; x1 = y1; y1 = t1; x0 = y0; y0 = t0; }
      if (x0 > x1) { const t0 = x0, t1 = y0; x0 = x1; y0 = y1; y1 = t1; x1 = t0; }
      const run = x1 - x0;
      let deltaY = y1 - y0, y = y0;
      if (deltaY < 0) deltaY = -deltaY;
      let error = -div(run, 2);
      const base = 1024 - (randomInt(4096, rng) >> 2), yStep = y1 <= y0 ? -1 : 1, step = div(2048, run);
      for (let x = x0; x < x1; x++) {
        error += deltaY;
        const intensity = imul(step, x - x0) + base + 1024, maskedY = y & T.heightMask;
        if (error > 0) { error -= run; y += yStep; }
        const maskedX = T.widthMask & x;
        if (steep) allRows[maskedY][maskedX] = intensity;
        else allRows[maskedX][maskedY] = intensity;
      }
    }
    return output;
  }
}
