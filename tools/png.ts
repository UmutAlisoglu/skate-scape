import { deflateSync } from 'node:zlib';

const crcTable = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});

/** Minimal RGBA PNG encoder (8-bit, no filtering). */
export function encodePng(width: number, height: number, rgba: Buffer | Uint8Array) {
  const chunk = (type: string, body: Buffer) => {
    const data = Buffer.concat([Buffer.from(type), body]);
    let crc = -1;
    for (const byte of data) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    const out = Buffer.alloc(body.length + 12);
    out.writeUInt32BE(body.length);
    data.copy(out, 4);
    out.writeInt32BE(~crc, out.length - 4);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const source = Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength);
  const rows = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) source.copy(rows, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(rows, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
