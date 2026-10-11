// Minimal RGBA PNG encoder (8-bit, no filtering), platform-free: the zlib stream comes from the caller (Node's
// deflateSync in tools/png.ts) or, without one, is written as stored blocks (larger, but synchronous anywhere).
const crcTable = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});

export function encodePngWith(width: number, height: number, rgba: Uint8Array, zlib: (data: Uint8Array) => Uint8Array = storedZlib): Uint8Array {
  const rows = new Uint8Array(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) rows.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), y * (width * 4 + 1) + 1);
  const header = new Uint8Array(13), hv = new DataView(header.buffer);
  hv.setUint32(0, width);
  hv.setUint32(4, height);
  header[8] = 8;
  header[9] = 6;
  const chunks = [chunk('IHDR', header), chunk('IDAT', zlib(rows)), chunk('IEND', new Uint8Array(0))];
  const out = new Uint8Array(8 + chunks.reduce((n, c) => n + c.length, 0));
  out.set([137, 80, 78, 71, 13, 10, 26, 10]);
  let at = 8;
  for (const c of chunks) { out.set(c, at); at += c.length; }
  return out;
}

function chunk(type: string, body: Uint8Array) {
  const out = new Uint8Array(body.length + 12), view = new DataView(out.buffer);
  view.setUint32(0, body.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(body, 8);
  let crc = -1;
  for (let i = 4; i < out.length - 4; i++) crc = crcTable[(crc ^ out[i]) & 0xff] ^ (crc >>> 8);
  view.setInt32(out.length - 4, ~crc);
  return out;
}

/** A zlib stream of uncompressed (stored) deflate blocks. */
export function storedZlib(data: Uint8Array): Uint8Array {
  const blocks = Math.max(1, Math.ceil(data.length / 65535));
  const out = new Uint8Array(2 + blocks * 5 + data.length + 4), view = new DataView(out.buffer);
  out[0] = 0x78; out[1] = 0x01;
  let at = 2;
  for (let b = 0; b < blocks; b++) {
    const part = data.subarray(b * 65535, Math.min(data.length, (b + 1) * 65535));
    out[at] = b === blocks - 1 ? 1 : 0;
    view.setUint16(at + 1, part.length, true);
    view.setUint16(at + 3, ~part.length & 0xffff, true);
    out.set(part, at + 5);
    at += 5 + part.length;
  }
  let a = 1, s = 0;
  for (let i = 0; i < data.length; i++) { a = (a + data[i]) % 65521; s = (s + a) % 65521; }
  view.setUint32(at, ((s << 16) | a) >>> 0);
  return out;
}
