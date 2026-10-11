// Reads the on-disk JS5 cache (main_file_cache.dat2 + idx files) used by the 530 / 2009scape client.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { bunzip2, indexEntry, Js5Store, openContainer, readChain, SECTOR, type Xtea } from './js5.ts';

export { nameHash, type Js5Index, type Xtea } from './js5.ts';

export class CacheStore extends Js5Store {
  private dat: Buffer;
  private idx = new Map<number, Buffer>();

  constructor(dir: string) {
    super();
    this.dat = readFileSync(join(dir, 'main_file_cache.dat2'));
    for (let i = 0; i <= 255; i++) {
      const p = join(dir, `main_file_cache.idx${i}`);
      if (existsSync(p)) this.idx.set(i, readFileSync(p));
    }
  }

  /** Raw (still compressed / encrypted) container bytes for an archive's group. */
  readRaw(archive: number, group: number): Uint8Array | null {
    const entry = indexEntry(this.idx.get(archive), group);
    if (!entry) return null;
    return readChain(archive, group, entry, (sector) => {
      const p = sector * SECTOR;
      return p + SECTOR <= this.dat.length ? this.dat.subarray(p, p + SECTOR) : this.dat.subarray(p);
    });
  }

  /** Decodes a JS5 container (optionally XTEA-encrypted) into its uncompressed payload. */
  static decompress(raw: Uint8Array, key?: Xtea): Uint8Array {
    const { type, payload, uncompressedLength } = openContainer(raw, key);
    if (type === 0) return payload;
    if (type === 1) return bunzip2(payload, uncompressedLength);
    return new Uint8Array(gunzipSync(payload));
  }

  protected payload(archive: number, group: number, key?: Xtea): Uint8Array | null {
    const raw = this.readRaw(archive, group);
    if (!raw) return null;
    try {
      return CacheStore.decompress(raw, key);
    } catch (e) {
      if (archive === 255) throw e;
      return null;
    }
  }
}
