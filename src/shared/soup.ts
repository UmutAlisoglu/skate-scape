/**
 * Triangle soups (terrain.bin, locs.bin, collision cells): u32 triangle count, then per corner x (u16), y (i16)
 * and -z (u16) in RS fine units (128 per tile) on three.js axes, then rgba per triangle. Storing x and -z
 * unsigned lets a map reach 512 tiles in each direction (signed 16-bit stopped at 256).
 */
export const SOUP_TRIANGLE_BYTES = 22;

/** Corner positions in RS fine units on three.js axes (x east, y up, z south, so north is negative). */
export function soupPositions(buffer: ArrayBufferLike, byteOffset: number, triangles: number): Int32Array {
  let source = buffer, offset = byteOffset + 4;
  if (offset % 2) { source = new Uint8Array(buffer, offset, triangles * 18).slice().buffer; offset = 0; }
  const unsigned = new Uint16Array(source, offset, triangles * 9), signed = new Int16Array(source, offset, triangles * 9);
  const out = new Int32Array(triangles * 9);
  for (let i = 0; i < triangles * 3; i++) {
    out[i * 3] = unsigned[i * 3];
    out[i * 3 + 1] = signed[i * 3 + 1];
    out[i * 3 + 2] = -unsigned[i * 3 + 2];
  }
  return out;
}

const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, Math.round(value)));
/** Writes one corner (RS fine units, three.js axes). Geometry hanging past the map's west/north edge is clamped to it. */
export function writeSoupCorner(view: DataView, corner: number, x: number, y: number, z: number) {
  const at = 4 + corner * 6;
  view.setUint16(at, clamp(x, 0, 65535), true);
  view.setInt16(at + 2, clamp(y, -32768, 32767), true);
  view.setUint16(at + 4, clamp(-z, 0, 65535), true);
}
