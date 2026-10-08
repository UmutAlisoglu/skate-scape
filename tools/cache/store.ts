// Reads the on-disk JS5 cache (main_file_cache.dat2 + idx files) used by the 530 / 2009scape client.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { createRequire } from 'node:module';
import { Reader } from './reader.ts';

const require = createRequire(import.meta.url);
const Bunzip = require('seek-bzip') as { decode(input: Buffer, expectedSize?: number): Buffer };

const SECTOR = 520;

export type Xtea = [number, number, number, number];

export interface Js5Index {
  groupIds: number[];
  groupNameHashes: Map<number, number>; // name hash -> group id
  fileIds: Map<number, number[]>; // group id -> file ids
}

/** JS5 group-name hash: Java String.hashCode over the lowercased name. */
export function nameHash(name: string) {
  let h = 0;
  const s = name.toLowerCase();
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
  return h;
}

export class CacheStore {
  private dat: Buffer;
  private idx = new Map<number, Buffer>();
  private indices = new Map<number, Js5Index>();
  private groupCache = new Map<string, Map<number, Uint8Array>>();

  constructor(dir: string) {
    this.dat = readFileSync(join(dir, 'main_file_cache.dat2'));
    for (let i = 0; i <= 255; i++) {
      const p = join(dir, `main_file_cache.idx${i}`);
      if (existsSync(p)) this.idx.set(i, readFileSync(p));
    }
  }

  /** Raw (still compressed / encrypted) container bytes for an archive's group. */
  readRaw(archive: number, group: number): Uint8Array | null {
    const index = this.idx.get(archive);
    if (!index || index.length < group * 6 + 6) return null;
    const o = group * 6;
    const len = (index[o] << 16) | (index[o + 1] << 8) | index[o + 2];
    let sector = (index[o + 3] << 16) | (index[o + 4] << 8) | index[o + 5];
    if (len <= 0 || sector <= 0) return null;

    const out = new Uint8Array(len);
    let read = 0;
    let chunk = 0;
    const bigGroup = group > 0xffff;
    const headerLen = bigGroup ? 10 : 8;
    const dataLen = SECTOR - headerLen;
    while (read < len) {
      if (sector === 0) return null;
      const p = sector * SECTOR;
      const d = this.dat;
      let hGroup: number, hChunk: number, next: number, hArchive: number;
      if (bigGroup) {
        hGroup = d.readInt32BE(p);
        hChunk = d.readUInt16BE(p + 4);
        next = (d[p + 6] << 16) | (d[p + 7] << 8) | d[p + 8];
        hArchive = d[p + 9];
      } else {
        hGroup = d.readUInt16BE(p);
        hChunk = d.readUInt16BE(p + 2);
        next = (d[p + 4] << 16) | (d[p + 5] << 8) | d[p + 6];
        hArchive = d[p + 7];
      }
      if (hGroup !== group || hChunk !== chunk || hArchive !== archive) return null;
      const n = Math.min(dataLen, len - read);
      out.set(d.subarray(p + headerLen, p + headerLen + n), read);
      read += n;
      chunk++;
      sector = next;
    }
    return out;
  }

  /** Decodes a JS5 container (optionally XTEA-encrypted) into its uncompressed payload. */
  static decompress(raw: Uint8Array, key?: Xtea): Uint8Array {
    let data = raw;
    if (key && (key[0] | key[1] | key[2] | key[3]) !== 0) {
      data = raw.slice();
      // Only the container body is encrypted, not the 2-byte version trailer the store appends.
      const bodyLen = new DataView(raw.buffer, raw.byteOffset).getInt32(1);
      const end = Math.min(raw.length, raw[0] === 0 ? 5 + bodyLen : 9 + bodyLen);
      xteaDecrypt(data, key, 5, end);
    }
    const r = new Reader(data);
    const type = r.g1();
    const len = r.g4();
    if (type === 0) return r.bytes(len);
    const uncompressedLen = r.g4();
    const payload = data.subarray(9, 9 + len);
    if (type === 1) {
      // Jagex strips the "BZh1" header.
      const withHeader = Buffer.concat([Buffer.from('BZh1'), Buffer.from(payload)]);
      return new Uint8Array(Bunzip.decode(withHeader, uncompressedLen));
    }
    return new Uint8Array(gunzipSync(payload));
  }

  index(archive: number): Js5Index {
    let idx = this.indices.get(archive);
    if (idx) return idx;
    const raw = this.readRaw(255, archive);
    if (!raw) throw new Error(`missing index for archive ${archive}`);
    idx = decodeIndex(CacheStore.decompress(raw));
    this.indices.set(archive, idx);
    return idx;
  }

  groupId(archive: number, name: string): number | undefined {
    return this.index(archive).groupNameHashes.get(nameHash(name));
  }

  /** All files of a group, keyed by file id. */
  group(archive: number, group: number, key?: Xtea): Map<number, Uint8Array> | null {
    const cacheKey = `${archive}:${group}`;
    const cached = this.groupCache.get(cacheKey);
    if (cached) return cached;
    const raw = this.readRaw(archive, group);
    if (!raw) return null;
    let data: Uint8Array;
    try {
      data = CacheStore.decompress(raw, key);
    } catch {
      return null;
    }
    const fileIds = this.index(archive).fileIds.get(group) ?? [0];
    const files = splitGroup(data, fileIds);
    // Map groups are tied to their key; everything else is safe to memoize.
    if (!key) this.groupCache.set(cacheKey, files);
    return files;
  }

  file(archive: number, group: number, file = 0, key?: Xtea): Uint8Array | null {
    return this.group(archive, group, key)?.get(file) ?? null;
  }
}

function decodeIndex(data: Uint8Array): Js5Index {
  const r = new Reader(data);
  const protocol = r.g1();
  if (protocol !== 5 && protocol !== 6) throw new Error(`bad index protocol ${protocol}`);
  if (protocol >= 6) r.g4();
  const flags = r.g1();
  const size = r.g2();
  const groupIds: number[] = [];
  let acc = 0;
  for (let i = 0; i < size; i++) groupIds.push((acc += r.g2()));
  const groupNameHashes = new Map<number, number>();
  if (flags & 1) for (let i = 0; i < size; i++) groupNameHashes.set(r.g4(), groupIds[i]);
  r.pos += size * 4; // checksums
  r.pos += size * 4; // versions
  const groupSizes = groupIds.map(() => r.g2());
  const fileIds = new Map<number, number[]>();
  for (let i = 0; i < size; i++) {
    const ids: number[] = [];
    let f = 0;
    for (let j = 0; j < groupSizes[i]; j++) ids.push((f += r.g2()));
    fileIds.set(groupIds[i], ids);
  }
  return { groupIds, groupNameHashes, fileIds };
}

function splitGroup(data: Uint8Array, fileIds: number[]): Map<number, Uint8Array> {
  const out = new Map<number, Uint8Array>();
  const count = fileIds.length;
  if (count <= 1) {
    out.set(fileIds[0] ?? 0, data);
    return out;
  }
  const stripes = data[data.length - 1];
  const tableStart = data.length - 1 - stripes * count * 4;
  const r = new Reader(data);
  r.pos = tableStart;
  const sizes = new Array<number>(count).fill(0);
  const stripeLens: number[][] = [];
  for (let s = 0; s < stripes; s++) {
    let len = 0;
    const row: number[] = [];
    for (let f = 0; f < count; f++) {
      len += r.g4();
      row.push(len);
      sizes[f] += len;
    }
    stripeLens.push(row);
  }
  const files = sizes.map((n) => new Uint8Array(n));
  const written = new Array<number>(count).fill(0);
  let src = 0;
  for (let s = 0; s < stripes; s++) {
    for (let f = 0; f < count; f++) {
      const n = stripeLens[s][f];
      files[f].set(data.subarray(src, src + n), written[f]);
      written[f] += n;
      src += n;
    }
  }
  fileIds.forEach((id, i) => out.set(id, files[i]));
  return out;
}

function xteaDecrypt(data: Uint8Array, key: Xtea, start: number, end: number) {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const blocks = Math.floor((end - start) / 8);
  for (let b = 0; b < blocks; b++) {
    const o = start + b * 8;
    let v0 = view.getInt32(o);
    let v1 = view.getInt32(o + 4);
    let sum = 0xc6ef3720 | 0;
    for (let i = 0; i < 32; i++) {
      v1 = (v1 - ((((v0 << 4) ^ (v0 >>> 5)) + v0) ^ (sum + key[(sum >>> 11) & 3]))) | 0;
      sum = (sum - 0x9e3779b9) | 0;
      v0 = (v0 - ((((v1 << 4) ^ (v1 >>> 5)) + v1) ^ (sum + key[sum & 3]))) | 0;
    }
    view.setInt32(o, v0);
    view.setInt32(o + 4, v1);
  }
}
