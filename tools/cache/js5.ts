// The JS5 cache format shared by every store: sector chains, containers, reference tables and group splitting.
// Platform-free, so the same code reads the cache from disk (store.ts, Node) and over HTTP (http-store.ts, browser).
import Bunzip from 'seek-bzip';
import { gunzipSync } from 'fflate';
import { Reader } from './reader.ts';

export const SECTOR = 520;

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

/** Where a group's sector chain starts and how long it is, from its 6-byte idx entry (null when absent). */
export function indexEntry(index: Uint8Array | undefined, group: number): { length: number; sector: number } | null {
  if (!index || index.length < group * 6 + 6) return null;
  const o = group * 6;
  const length = (index[o] << 16) | (index[o + 1] << 8) | index[o + 2];
  const sector = (index[o + 3] << 16) | (index[o + 4] << 8) | index[o + 5];
  return length <= 0 || sector <= 0 ? null : { length, sector };
}

/**
 * Follows a group's sector chain through the data file. `sectorAt(sector)` returns the sector's 520 bytes, or
 * null when they aren't available (the HTTP store hasn't fetched them yet), which ends the read with null.
 */
export function readChain(archive: number, group: number, entry: { length: number; sector: number }, sectorAt: (sector: number) => Uint8Array | null): Uint8Array | null {
  const out = new Uint8Array(entry.length);
  let read = 0, chunk = 0, sector = entry.sector;
  const bigGroup = group > 0xffff;
  const headerLen = bigGroup ? 10 : 8;
  const dataLen = SECTOR - headerLen;
  while (read < entry.length) {
    if (sector === 0) return null;
    const d = sectorAt(sector);
    if (!d) return null;
    let hGroup: number, hChunk: number, next: number, hArchive: number;
    if (bigGroup) {
      hGroup = ((d[0] << 24) | (d[1] << 16) | (d[2] << 8) | d[3]) | 0;
      hChunk = (d[4] << 8) | d[5];
      next = (d[6] << 16) | (d[7] << 8) | d[8];
      hArchive = d[9];
    } else {
      hGroup = (d[0] << 8) | d[1];
      hChunk = (d[2] << 8) | d[3];
      next = (d[4] << 16) | (d[5] << 8) | d[6];
      hArchive = d[7];
    }
    if (hGroup !== group || hChunk !== chunk || hArchive !== archive) return null;
    const n = Math.min(dataLen, entry.length - read);
    out.set(d.subarray(headerLen, headerLen + n), read);
    read += n;
    chunk++;
    sector = next;
  }
  return out;
}

/** A JS5 container, decrypted (when keyed) but still compressed. type 0 = stored, 1 = bzip2, 2 = gzip. */
export interface Container { type: number; payload: Uint8Array; uncompressedLength: number }

export function openContainer(raw: Uint8Array, key?: Xtea): Container {
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
  if (type === 0) return { type, payload: r.bytes(len), uncompressedLength: len };
  if (type !== 1 && type !== 2) throw new Error(`unknown container compression ${type}`);
  const uncompressedLength = r.g4();
  if (len < 0 || 9 + len > data.length || uncompressedLength < 0) throw new Error('corrupt container (wrong XTEA key?)');
  return { type, payload: data.subarray(9, 9 + len), uncompressedLength };
}

/** bzip2 container payload (Jagex strips the "BZh1" header) -> uncompressed bytes. */
export function bunzip2(payload: Uint8Array, uncompressedLength: number): Uint8Array {
  installBufferShim();
  const withHeader = new Uint8Array(payload.length + 4);
  withHeader.set([0x42, 0x5a, 0x68, 0x31]);
  withHeader.set(payload, 4);
  const out = new Uint8Array(uncompressedLength);
  Bunzip.decode(withHeader, out);
  return out;
}

/** A container's uncompressed payload, decoded synchronously anywhere (gzip through fflate). */
export function decodeContainer(raw: Uint8Array, key?: Xtea): Uint8Array {
  const { type, payload, uncompressedLength } = openContainer(raw, key);
  if (type === 0) return payload;
  if (type === 1) return bunzip2(payload, uncompressedLength);
  const out = gunzipSync(payload);
  if (out.length !== uncompressedLength) throw new Error('gzip container has the wrong length');
  return out;
}

/**
 * Reads groups and files out of a JS5 cache. Subclasses supply each group's uncompressed payload: from disk
 * (CacheStore) or from blocks fetched over HTTP (HttpCacheStore).
 */
export abstract class Js5Store {
  private indices = new Map<number, Js5Index>();
  private groupCache = new Map<string, Map<number, Uint8Array>>();

  /** A group's uncompressed container payload, or null when it is missing or can't be decoded with `key`. */
  protected abstract payload(archive: number, group: number, key?: Xtea): Uint8Array | null;

  index(archive: number): Js5Index {
    let idx = this.indices.get(archive);
    if (idx) return idx;
    const data = this.payload(255, archive);
    if (!data) throw new Error(`missing index for archive ${archive}`);
    idx = decodeIndex(data);
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
    const data = this.payload(archive, group, key);
    if (!data) return null;
    const fileIds = this.index(archive).fileIds.get(group) ?? [0];
    const files = splitGroup(data, fileIds);
    // Map groups are tied to their key; everything else is safe to memoize.
    if (!key) this.groupCache.set(cacheKey, files);
    return files;
  }

  file(archive: number, group: number, file = 0, key?: Xtea): Uint8Array | null {
    return this.group(archive, group, key)?.get(file) ?? null;
  }

  /** Forgets the memoized groups (not the reference tables), freeing them once a build is done. */
  protected forgetGroups() { this.groupCache.clear(); }
}

export function decodeIndex(data: Uint8Array): Js5Index {
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

/**
 * seek-bzip allocates its scratch tables with Node's Buffer (and reads the block magic with toString('hex')).
 * Browsers have no Buffer, so give it the little it uses.
 */
function installBufferShim() {
  const scope = globalThis as { Buffer?: unknown };
  if (scope.Buffer) return;
  class BzipBuffer extends Uint8Array {
    override toString(encoding?: string) {
      if (encoding !== 'hex') return super.toString();
      let s = '';
      for (const b of this) s += b.toString(16).padStart(2, '0');
      return s;
    }
    copy(target: Uint8Array, targetStart = 0, start = 0, end = this.length) {
      target.set(this.subarray(start, end), targetStart);
      return end - start;
    }
  }
  scope.Buffer = BzipBuffer;
}
