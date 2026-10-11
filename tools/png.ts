import { deflateSync } from 'node:zlib';
import { encodePngWith } from './png-core.ts';

/** Minimal RGBA PNG encoder (8-bit, no filtering). */
export function encodePng(width: number, height: number, rgba: Buffer | Uint8Array) {
  return Buffer.from(encodePngWith(width, height, rgba, (rows) => deflateSync(rows, { level: 9 })).buffer);
}
