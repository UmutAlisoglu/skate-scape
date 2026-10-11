// rt4 Texture: decodes a texture definition (archive 9) into its op graph and renders it, plus the generator that
// renders a set of textures the way tools/texgen/java/rt4/TexGen.java drives the client code (export:surfaces).
import { Reader } from '../cache/reader.ts';
import { setBrightness, setSize, T, type SpriteSource, type TextureOp, type TextureProvider } from './core.ts';
import { BoxBlur, Brickwork, Clamp, ColorFill, ColorGradient, Combine, Curve, Flip, HorizontalGradient, MonochromeFill, VerticalGradient } from './ops-basic.ts';
import { ColorMultiply, Diamond, HslAdjust, Noise, SquareGrid, Voronoi, Waveform } from './ops-pattern.ts';
import { Binary, ColorReplace, Interpolate, Invert, Kaleidoscope, Monochrome, PolarDistort, Tile } from './ops-transform.ts';
import { BumpMap, Emboss, Mandelbrot, NormalMap, Range, Sprite, Stripes, TextureRef, TiledSprite } from './ops-image.ts';
import { BarkPattern, LineScatter, PerlinNoise, WaveInterference } from './ops-noise.ts';
import { ShapeRasterizer } from './ops-shape.ts';

const OPS: (new () => TextureOp)[] = [
  MonochromeFill, ColorFill, HorizontalGradient, VerticalGradient, Brickwork, BoxBlur, Clamp, Combine, Curve, Flip,
  ColorGradient, ColorMultiply, Waveform, Noise, Diamond, Voronoi, SquareGrid, HslAdjust, TiledSprite, PolarDistort,
  Tile, Interpolate, Invert, Kaleidoscope, Monochrome, ColorReplace, Binary, Stripes, BarkPattern, ShapeRasterizer,
  Range, Mandelbrot, BumpMap, NormalMap, PerlinNoise, Emboss, TextureRef, WaveInterference, LineScatter, Sprite,
];

function decodeOp(buf: Reader): TextureOp {
  buf.g1();
  const type = buf.g1(), Op = OPS[type];
  if (!Op) throw new Error(`unknown texture op ${type}`);
  const op = new Op();
  op.cacheHeight = buf.g1();
  const opcodes = buf.g1();
  for (let i = 0; i < opcodes; i++) op.decode(buf.g1(), buf);
  op.postDecode();
  return op;
}

export class Texture {
  private readonly operations: TextureOp[];
  private readonly colorOp: TextureOp;
  private readonly alphaOp: TextureOp;

  constructor(buf: Reader) {
    const count = buf.g1(), inputs: number[][] = [];
    this.operations = [];
    for (let i = 0; i < count; i++) {
      const op = decodeOp(buf);
      inputs.push(Array.from({ length: op.inputs.length }, () => buf.g1()));
      this.operations.push(op);
    }
    this.operations.forEach((op, i) => inputs[i].forEach((input, j) => (op.inputs[j] = this.operations[input])));
    this.colorOp = this.operations[buf.g1()];
    this.alphaOp = this.operations[buf.g1()];
  }

  private begin(height: number, width: number, brightness: number, provider: TextureProvider, sprites: SpriteSource) {
    setBrightness(brightness);
    T.provider = provider; T.sprites = sprites;
    setSize(height, width);
    for (const op of this.operations) op.allocate(height, width);
  }
  private end() { for (const op of this.operations) op.clear(); }
  private channels(row: number) {
    if (this.colorOp.monochrome) { const m = this.colorOp.monochromeOutput(row); return [m, m, m]; }
    return this.colorOp.colorOutput(row);
  }

  /** ARGB pixels (alpha 0), as nested TextureRef ops read them (GlTexture.getPixels). */
  argb(height: number, transpose: boolean, width: number, brightness: number, sprites: SpriteSource, provider: TextureProvider, flipX: boolean): Int32Array {
    this.begin(height, width, brightness, provider, sprites);
    const pixels = new Int32Array(height * width);
    const start = flipX ? width - 1 : 0, end = flipX ? -1 : width, step = flipX ? -1 : 1;
    let dest = 0;
    for (let y = 0; y < height; y++) {
      if (transpose) dest = y;
      const [red, green, blue] = this.channels(y);
      for (let x = start; x !== end; x += step) {
        const r = T.brightnessMap[Math.max(0, Math.min(255, red[x] >> 4))], g = T.brightnessMap[Math.max(0, Math.min(255, green[x] >> 4))], b = T.brightnessMap[Math.max(0, Math.min(255, blue[x] >> 4))];
        pixels[dest++] = (r << 16) + (g << 8) + b;
        if (transpose) dest += width - 1;
      }
    }
    this.end();
    return pixels;
  }

  /** RGBA bytes for the GL texture (generateRgbaBytes): black pixels are transparent. */
  rgba(height: number, width: number, transpose: boolean, provider: TextureProvider, brightness: number, sprites: SpriteSource): Uint8Array {
    const bytes = new Uint8Array(width * 4 * height);
    this.begin(height, width, brightness, provider, sprites);
    let i = 0;
    for (let y = 0; y < height; y++) {
      if (transpose) i = y << 2;
      const [red, green, blue] = this.channels(y);
      const alpha = this.alphaOp.monochrome ? this.alphaOp.monochromeOutput(y) : this.alphaOp.colorOutput(y)[0];
      for (let x = width - 1; x >= 0; x--) {
        // (the brightness map is read per pixel: a nested texture rendered meanwhile leaves its own behind)
        const r = T.brightnessMap[Math.max(0, Math.min(255, red[x] >> 4))], g = T.brightnessMap[Math.max(0, Math.min(255, green[x] >> 4))], b = T.brightnessMap[Math.max(0, Math.min(255, blue[x] >> 4))];
        const a = r === 0 && g === 0 && b === 0 ? 0 : Math.max(0, Math.min(255, alpha[x] >> 4));
        bytes[i++] = r; bytes[i++] = g; bytes[i++] = b; bytes[i++] = a;
        if (transpose) i += (width << 2) - 4;
      }
    }
    this.end();
    return bytes;
  }
}

/** Per-texture flags after the op graph in a texture definition. */
export interface TextureFlags { blurred: boolean; mirror: boolean; wrapS: boolean; wrapT: boolean; blend: number; scrollU: number; scrollV: number }

/** Decodes the first frame of an indexed cache sprite (archive 8) onto its full canvas, as RGB (index 0 = black). */
export function decodeSprite(data: Uint8Array): { width: number; height: number; pixels: Int32Array } {
  const b = new Reader(data);
  b.pos = data.length - 2;
  const frames = b.g2();
  b.pos = data.length - frames * 8 - 7;
  const canvasWidth = b.g2(), canvasHeight = b.g2(), paletteSize = b.g1() + 1, xOffset = b.g2();
  b.pos += (frames - 1) * 2;
  const yOffset = b.g2();
  b.pos += (frames - 1) * 2;
  const width = b.g2();
  b.pos += (frames - 1) * 2;
  const height = b.g2();
  b.pos = data.length - frames * 8 - 7 - (paletteSize - 1) * 3;
  const palette = new Int32Array(paletteSize);
  for (let i = 1; i < paletteSize; i++) { const color = b.g3(); palette[i] = color === 0 ? 1 : color; }
  b.pos = 0;
  const flags = b.g1(), count = width * height, pixels = new Int32Array(count);
  if ((flags & 1) === 0) for (let i = 0; i < count; i++) pixels[i] = palette[b.g1()];
  else for (let x = 0; x < width; x++) for (let y = 0; y < height; y++) pixels[x + y * width] = palette[b.g1()];
  if (width === canvasWidth && height === canvasHeight) return { width, height, pixels };
  const full = new Int32Array(canvasWidth * canvasHeight);
  for (let y = 0; y < height; y++) full.set(pixels.subarray(y * width, (y + 1) * width), (y + yOffset) * canvasWidth + xOffset);
  return { width: canvasWidth, height: canvasHeight, pixels: full };
}

/**
 * Renders cache textures at `size` px the way export:surfaces does (TexGen.java): RGBA at brightness 0.7,
 * transposed when the texture is mirrored; nested textures are read as ARGB at full brightness.
 * `definition(id)` returns archive 9 group `id` (file 0), `sprite(id)` archive 8 group `id` (file 0).
 */
export class TextureGenerator implements TextureProvider {
  private readonly textures = new Map<number, { texture: Texture; flags: TextureFlags } | null>();
  private readonly sprites: SpriteSource;
  constructor(private readonly size: number, private readonly definition: (id: number) => Uint8Array | null, sprite: (id: number) => Uint8Array | null) {
    const cache = new Map<number, ReturnType<typeof decodeSprite> | null>();
    this.sprites = { sprite: (id) => { if (!cache.has(id)) { const data = sprite(id); cache.set(id, data ? decodeSprite(data) : null); } return cache.get(id)!; } };
  }
  /** the decoded texture and its flags, or null when it has no definition */
  load(id: number) {
    if (!this.textures.has(id)) {
      const data = this.definition(id);
      let entry: { texture: Texture; flags: TextureFlags } | null = null;
      if (data) {
        const buf = new Reader(data), texture = new Texture(buf);
        const flags: TextureFlags = { blurred: buf.g1() === 1, mirror: buf.g1() === 1, wrapS: buf.g1() === 1, wrapT: buf.g1() === 1, blend: buf.g1() & 3, scrollU: buf.g1b(), scrollV: buf.g1b() };
        entry = { texture, flags };
      }
      this.textures.set(id, entry);
    }
    return this.textures.get(id)!;
  }
  /** size x size RGBA, as export:surfaces stores it */
  render(id: number): { rgba: Uint8Array; flags: TextureFlags } | null {
    const entry = this.load(id);
    if (!entry) return null;
    return { rgba: entry.texture.rgba(this.size, this.size, entry.flags.mirror, this, 0.7, this.sprites), flags: entry.flags };
  }
  getPixels(id: number) {
    const entry = this.load(id);
    return entry ? entry.texture.argb(this.size, entry.flags.mirror, this.size, 1, this.sprites, this, false) : null;
  }
  isLowDetail() { return this.size === 64; }
}
