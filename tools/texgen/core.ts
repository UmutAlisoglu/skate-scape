// TypeScript port of the 2009 client's procedural texture graph (rt4 TextureOp, Texture, the image caches and the
// noise helpers; see NOTICE.md). The Java works in 32-bit ints, so the port keeps its arithmetic exact:
// rows are Int32Arrays (stores wrap like Java ints), multiplications go through Math.imul, and integer division
// truncates (div). Shared static state (Texture.width etc. in the client) lives in `T`.
import { Reader } from '../cache/reader.ts';

export const imul = Math.imul;
/** Java int division */
export const div = (a: number, b: number) => {
  if (b === 0) throw new Error('/ by zero');
  return (a / b) | 0;
};
/** Java (int) cast of a double: truncates, saturates, NaN -> 0 */
export const toInt = (d: number) => (d !== d ? 0 : d >= 2147483647 ? 2147483647 : d <= -2147483648 ? -2147483648 : Math.trunc(d));
/** Java (int) cast of a float expression */
export const f32 = Math.fround;
export const clamp = (max: number, value: number, min: number) => (min > value ? min : value > max ? max : value);

/** java.util.Random: the 48-bit linear congruential generator, exactly. */
export class JavaRandom {
  private hi = 0; // upper 24 bits of the seed
  private lo = 0; // lower 24 bits
  constructor(seed: number) { this.setSeed(seed); }
  setSeed(seed: number) {
    // (seed ^ 0x5DEECE66D) & ((1 << 48) - 1); seed is a Java long built from an int here
    const s = BigInt.asUintN(48, BigInt(seed) ^ 0x5deece66dn);
    this.hi = Number(s >> 24n); this.lo = Number(s & 0xffffffn);
  }
  next(bits: number) {
    // seed = seed * 0x5DEECE66D + 0xB mod 2^48, in 24-bit halves
    const mHi = 0x5de, mLo = 0xece66d;
    const lo = this.lo * mLo + 0xb;
    const carry = Math.floor(lo / 0x1000000);
    const hi = (this.hi * mLo + this.lo * mHi + carry) % 0x1000000;
    this.lo = lo % 0x1000000; this.hi = hi;
    // (int) (seed >>> (48 - bits))
    const value = this.hi * 0x1000000 + this.lo; // < 2^48, exact
    return Math.floor(value / 2 ** (48 - bits)) | 0;
  }
  nextInt(bound?: number) {
    if (bound === undefined) return this.next(32);
    if (bound <= 0) throw new Error('bound must be positive');
    if ((bound & -bound) === bound) return Number((BigInt(bound) * BigInt(this.next(31))) >> 31n);
    let bits: number, val: number;
    do { bits = this.next(31); val = bits % bound; } while (((bits - val + (bound - 1)) | 0) < 0);
    return val;
  }
}

/** RandomUtils.nextInt: the client's own bounded draw on top of Random.nextInt(). */
export function randomInt(bound: number, random: JavaRandom) {
  if (bound <= 0) throw new Error('bound must be positive');
  if ((bound & (bound - 1)) === 0) return Math.floor(((random.nextInt() >>> 0) * bound) / 4294967296) | 0;
  const threshold = (-2147483648 - (4294967296 % bound)) | 0;
  let sample: number;
  do sample = random.nextInt(); while (threshold <= sample);
  const correction = (bound - 1) & (sample >> 31);
  return correction + ((sample + (sample >>> 31)) | 0) % bound;
}

/** Texture's statics: the size being generated and its lookup tables. */
export const T = {
  width: 0, height: 0, widthMask: 0, heightMask: 0, widthScale: 0,
  widthFractions: new Int32Array(0), heightFractions: new Int32Array(0),
  brightness: -1, brightnessMap: new Int32Array(256),
  provider: null as TextureProvider | null,
  sprites: null as SpriteSource | null,
};

export interface TextureProvider {
  /** ARGB pixels of another texture at full brightness (TextureOpTexture) */
  getPixels(textureId: number): Int32Array | null;
  isLowDetail(textureId: number): boolean;
}
/** Archive 8 sprites: RGB pixels of a sprite group's first frame, already expanded to its full canvas */
export interface SpriteSource { sprite(group: number): { width: number; height: number; pixels: Int32Array } | null }

export function setBrightness(value: number) {
  if (T.brightness === value) return;
  for (let i = 0; i < 256; i++) {
    const mapped = toInt(Math.pow(i / 255, value) * 255);
    T.brightnessMap[i] = mapped > 255 ? 255 : mapped;
  }
  T.brightness = value;
}

export function setSize(height: number, width: number) {
  if (T.width !== width) {
    T.widthFractions = new Int32Array(width);
    for (let x = 0; x < width; x++) T.widthFractions[x] = div(x << 12, width);
    T.widthScale = width === 64 ? 2048 : 4096;
    T.widthMask = width - 1;
    T.width = width;
  }
  if (T.height === height) return;
  if (T.width === height) T.heightFractions = T.widthFractions;
  else {
    T.heightFractions = new Int32Array(height);
    for (let y = 0; y < height; y++) T.heightFractions[y] = div(y << 12, height);
  }
  T.height = height;
  T.heightMask = height - 1;
}

/**
 * The client's row caches (ColorImageCache / MonochromeImageCache): `capacity` rows of an image `height` rows tall,
 * least recently used rows recycled. `invalid` says whether the row returned by get() must be recomputed.
 */
class RowCache<R> {
  invalid = false;
  private slots: R[];
  private slotOf: Int32Array; // row -> slot + 1
  private rowOf: Int32Array; // slot -> row
  private order: number[] = []; // slots, most recently used first
  private singleRow = -1;
  private size = 0;
  constructor(private capacity: number, private height: number, make: () => R) {
    this.slots = Array.from({ length: capacity }, make);
    this.slotOf = new Int32Array(height);
    this.rowOf = new Int32Array(capacity);
  }
  get(row: number): R {
    if (this.capacity === this.height) {
      this.invalid = this.slotOf[row] === 0;
      this.slotOf[row] = 1;
      return this.slots[row];
    }
    if (this.capacity === 1) {
      this.invalid = this.singleRow !== row;
      this.singleRow = row;
      return this.slots[0];
    }
    let slot = this.slotOf[row] - 1;
    if (slot < 0) {
      this.invalid = true;
      if (this.size < this.capacity) slot = this.size++;
      else {
        slot = this.order.pop()!;
        this.slotOf[this.rowOf[slot]] = 0;
      }
      this.slotOf[row] = slot + 1; this.rowOf[slot] = row;
    } else {
      this.invalid = false;
      this.order.splice(this.order.indexOf(slot), 1);
    }
    this.order.unshift(slot);
    return this.slots[slot];
  }
  /** every row (only for a full cache); marks them all valid */
  all(): R[] {
    if (this.capacity !== this.height) throw new Error('Can only retrieve a full image cache');
    this.slotOf.fill(1);
    return this.slots;
  }
}
export class MonoCache extends RowCache<Int32Array> {
  constructor(capacity: number, height: number, width: number) { super(capacity, height, () => new Int32Array(width)); }
}
export class ColorCache extends RowCache<Int32Array[]> {
  constructor(capacity: number, height: number, width: number) { super(capacity, height, () => [new Int32Array(width), new Int32Array(width), new Int32Array(width)]); }
}

export let SINE: Int32Array | null = null, COSINE: Int32Array | null = null;
export function createTrigonometryTables() {
  if (SINE && COSINE) return;
  SINE = new Int32Array(256); COSINE = new Int32Array(256);
  for (let i = 0; i < 256; i++) {
    const radians = (i / 255) * 6.283185307179586;
    SINE[i] = toInt(Math.sin(radians) * 4096);
    COSINE[i] = toInt(Math.cos(radians) * 4096);
  }
}

/** MonochromeImageCache's static tables. */
export const normalBrightnessLookup = new Int8Array(32896);
export const smoothstepLookup = new Int32Array(4096);
{
  let offset = 0;
  for (let i = 0; i < 256; i++) for (let j = 0; j <= i; j++) normalBrightnessLookup[offset++] = toInt(255 / Math.sqrt(f32(f32(j * j + i * i + 65535) / f32(65535))));
  for (let x = 0; x < 4096; x++) {
    const cubed = imul(x, imul(x, x) >> 12) >> 12, linear = imul(x, 6) - 61440, factor = (imul(x, linear) >> 12) + 40960;
    smoothstepLookup[x] = imul(cubed, factor) >> 12;
  }
}

export abstract class TextureOp {
  readonly inputs: TextureOp[];
  cacheHeight = 0;
  protected mono: MonoCache | null = null;
  protected color: ColorCache | null = null;
  constructor(inputCount: number, public monochrome: boolean) { this.inputs = new Array(inputCount); }

  decode(_opcode: number, _buf: Reader) {}
  postDecode() {}
  requiredSpriteId() { return -1; }
  requiredTextureId() { return -1; }

  monochromeOutput(_row: number): Int32Array { throw new Error('This operation does not have a monochrome output'); }
  colorOutput(_row: number): Int32Array[] { throw new Error('This operation does not have a colour output'); }

  protected childMono(input: number, row: number) {
    const op = this.inputs[input];
    return op.monochrome ? op.monochromeOutput(row) : op.colorOutput(row)[0];
  }
  protected childColor(row: number, input: number) {
    const op = this.inputs[input];
    if (op.monochrome) { const m = op.monochromeOutput(row); return [m, m, m]; }
    return op.colorOutput(row);
  }
  /** the client's allocateImageCache(height, width) */
  allocate(height: number, width: number) {
    const capacity = this.cacheHeight === 255 ? height : this.cacheHeight;
    if (this.monochrome) this.mono = new MonoCache(capacity, height, width);
    else this.color = new ColorCache(capacity, height, width);
  }
  clear() { this.mono = null; this.color = null; }
  /** the row cache for the current mode (non-null while generating) */
  protected get monoCache() { return this.mono!; }
  protected get colorCache() { return this.color!; }
}

/** Java's ArrayUtils.fill(dest, off, length, value) */
export const fill = (dest: Int32Array, off: number, length: number, value: number) => dest.fill(value, off, off + length);
/** ArrayUtils.fillRange(dest, from, to, value): fills [from, to) */
export const fillRange = (dest: Int32Array, from: number, to: number, value: number) => { if (to > from) dest.fill(value, from, to); };
