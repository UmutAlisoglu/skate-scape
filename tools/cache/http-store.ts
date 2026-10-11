// Reads the JS5 cache straight from a remote copy (2009scape's GitLab repository) with HTTP Range requests, so the
// browser can build the world without anyone hosting converted assets. The data file is fetched in large aligned
// blocks (a 1 MB request covers ~2,000 sectors), a few at a time, and every block is kept in an optional BlockCache
// (IndexedDB in the browser) so a second visit downloads nothing.
//
// The world pipeline reads the cache synchronously, so reading is split in two: an async prefetch() fetches and
// decompresses the groups a step will need (gzip through DecompressionStream), then the synchronous Js5Store reads
// see only decoded groups. Reading a group that wasn't prefetched throws MissingGroupError, which callers catch to
// prefetch it and retry.
import { bunzip2, indexEntry, Js5Store, openContainer, readChain, SECTOR, type Xtea } from './js5.ts';

/** Where the cache files are and how they're versioned. */
export interface CacheSource {
  /** stable for one version of the data (the commit), used as the cache key prefix */
  id: string;
  /** URL of a file of the cache folder (main_file_cache.dat2, main_file_cache.idx5, …) */
  cacheFile(name: string): string;
  /** URL of the region XTEA keys (xteas.json) */
  xteas: string;
}

/** 2009scape's GitLab repository at a fixed commit. The API's raw endpoint sends CORS headers and honours Range. */
export function gitlabSource(project = '2009scape/2009scape', ref = 'bea45a9e93592b567f9b9293b82a36c8773244be', api = 'https://gitlab.com/api/v4'): CacheSource {
  const raw = (path: string) => `${api}/projects/${encodeURIComponent(project)}/repository/files/${encodeURIComponent(path)}/raw?ref=${ref}&lfs=true`;
  return { id: `gitlab:${project}@${ref}`, cacheFile: (name) => raw(`Server/data/cache/${name}`), xteas: raw('Server/data/configs/xteas.json') };
}

/** Persistent storage for fetched blocks and files (IndexedDB in the browser, nothing in tests). */
export interface BlockCache {
  get(keys: string[]): Promise<(Uint8Array | undefined)[]>;
  put(entries: [string, Uint8Array][]): Promise<void>;
}

export interface FetchStats {
  requests: number;
  bytes: number;
  cacheHits: number;
  cacheBytes: number;
  /** most requests started within any 60 s window (GitLab allows 500 a minute per IP without a login) */
  peakPerMinute: number;
  fetchMs: number;
}

export class MissingGroupError extends Error {
  constructor(readonly archive: number, readonly group: number) { super(`cache group ${archive}:${group} was not prefetched`); }
}

/** Fetches whole files and byte ranges with a concurrency limit, a per-minute ceiling and the block cache. */
export class Fetcher {
  readonly stats: FetchStats = { requests: 0, bytes: 0, cacheHits: 0, cacheBytes: 0, peakPerMinute: 0, fetchMs: 0 };
  private active = 0;
  private queue: (() => void)[] = [];
  private started: number[] = [];

  constructor(private readonly options: { concurrency?: number; perMinute?: number; cache?: BlockCache | null; fetch?: typeof fetch } = {}) {}

  /** Cached copies of `keys`, then `load` for the rest (results in key order). */
  async cached(keys: string[], load: (i: number) => Promise<Uint8Array>): Promise<Uint8Array[]> {
    const hits = this.options.cache ? await this.options.cache.get(keys).catch(() => keys.map(() => undefined)) : keys.map(() => undefined);
    const fresh: [string, Uint8Array][] = [];
    const out = await Promise.all(keys.map(async (key, i) => {
      const hit = hits[i];
      if (hit) { this.stats.cacheHits++; this.stats.cacheBytes += hit.length; return hit; }
      const data = await load(i);
      fresh.push([key, data]);
      return data;
    }));
    if (fresh.length && this.options.cache) await this.options.cache.put(fresh).catch(() => { /* storage full or unavailable: just refetch next time */ });
    return out;
  }

  async get(url: string, range?: [number, number]): Promise<Uint8Array> {
    await this.slot();
    const t0 = performance.now();
    try {
      for (let attempt = 0; ; attempt++) {
        const response = await (this.options.fetch ?? fetch)(url, range ? { headers: { Range: `bytes=${range[0]}-${range[1] - 1}` } } : {});
        if ((response.status === 429 || response.status >= 500) && attempt < 3) {
          await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
          continue;
        }
        if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
        if (range && response.status !== 206) throw new Error(`${url}: the server ignored the Range header`);
        const data = new Uint8Array(await response.arrayBuffer());
        this.stats.bytes += data.length;
        return data;
      }
    } finally {
      this.stats.fetchMs += performance.now() - t0;
      this.active--;
      this.queue.shift()?.();
    }
  }

  /** Waits for a free connection and for room under the per-minute ceiling, then counts the request. */
  private async slot() {
    const concurrency = this.options.concurrency ?? 6, perMinute = this.options.perMinute ?? 300;
    if (this.active >= concurrency) await new Promise<void>((r) => this.queue.push(r));
    this.active++;
    for (;;) {
      const now = performance.now();
      while (this.started.length && this.started[0] <= now - 60_000) this.started.shift();
      if (this.started.length < perMinute) break;
      await new Promise((r) => setTimeout(r, this.started[0] + 60_000 - now));
    }
    this.started.push(performance.now());
    this.stats.requests++;
    this.stats.peakPerMinute = Math.max(this.stats.peakPerMinute, this.started.length);
  }
}

/** A remote file read in aligned blocks of `blockSize` bytes. */
class RangeFile {
  readonly blocks = new Map<number, Uint8Array>();
  private loading = new Map<number, Promise<void>>();
  constructor(private readonly url: string, private readonly key: string, readonly blockSize: number, private readonly fetcher: Fetcher) {}

  /** `length` bytes at `offset`, or null when a block they span isn't loaded (or lies past the end of the file). */
  bytes(offset: number, length: number): Uint8Array | null {
    const first = Math.floor(offset / this.blockSize), last = Math.floor((offset + length - 1) / this.blockSize);
    if (first === last) {
      const block = this.blocks.get(first), at = offset - first * this.blockSize;
      return block && at + length <= block.length ? block.subarray(at, at + length) : null;
    }
    const out = new Uint8Array(length);
    for (let b = first; b <= last; b++) {
      const block = this.blocks.get(b);
      if (!block) return null;
      const from = Math.max(offset, b * this.blockSize), to = Math.min(offset + length, (b + 1) * this.blockSize);
      if (to - b * this.blockSize > block.length) return null;
      out.set(block.subarray(from - b * this.blockSize, to - b * this.blockSize), from - offset);
    }
    return out;
  }

  blockOf(offset: number) { return Math.floor(offset / this.blockSize); }

  async load(blocks: Iterable<number>) {
    const wanted = [...new Set(blocks)].filter((b) => !this.blocks.has(b));
    const fresh = wanted.filter((b) => !this.loading.has(b));
    if (fresh.length) {
      const job = this.fetcher.cached(fresh.map((b) => `${this.key}#${this.blockSize}:${b}`), (i) => this.fetcher.get(this.url, [fresh[i] * this.blockSize, (fresh[i] + 1) * this.blockSize]))
        .then((data) => { fresh.forEach((b, i) => this.blocks.set(b, data[i])); })
        .finally(() => { for (const b of fresh) this.loading.delete(b); });
      for (const b of fresh) this.loading.set(b, job);
    }
    await Promise.all(wanted.map((b) => this.loading.get(b)));
  }

  get loadedBytes() { let n = 0; for (const b of this.blocks.values()) n += b.length; return n; }
}

export interface GroupRequest { archive: number; group: number; key?: Xtea }

export class HttpCacheStore extends Js5Store {
  private decoded = new Map<string, Uint8Array | null>();
  private dat: RangeFile;
  /** prefetch rounds that found a sector chain leaving the blocks its length predicted */
  chainMisses = 0;

  private constructor(readonly source: CacheSource, readonly fetcher: Fetcher, private idx: Map<number, Uint8Array>, blockSize: number) {
    super();
    this.dat = new RangeFile(source.cacheFile('main_file_cache.dat2'), `${source.id}/dat2`, blockSize, fetcher);
  }

  /** Opens the cache: fetches the index files of `archives` (and the master index 255) whole, then their reference tables. */
  static async open(source: CacheSource, fetcher: Fetcher, archives: number[], blockSize: number) {
    const names = [255, ...archives];
    const files = await fetcher.cached(names.map((a) => `${source.id}/idx${a}`), (i) => fetcher.get(source.cacheFile(`main_file_cache.idx${names[i]}`)));
    const store = new HttpCacheStore(source, fetcher, new Map(names.map((a, i) => [a, files[i]])), blockSize);
    await store.prefetch(archives.map((group) => ({ archive: 255, group })));
    return store;
  }

  has(archive: number, group: number) { return this.decoded.has(`${archive}:${group}`); }

  /** Fetches and decodes groups so the synchronous reads can use them. Groups already decoded are skipped. */
  async prefetch(requests: GroupRequest[]) {
    let pending = requests.filter((r, i) => !this.has(r.archive, r.group) && requests.findIndex((o) => o.archive === r.archive && o.group === r.group) === i);
    const raws: [GroupRequest, Uint8Array | null][] = [], stuck = new Map<GroupRequest, number>();
    while (pending.length) {
      const blocks = new Set<number>(), next: GroupRequest[] = [];
      for (const request of pending) {
        const entry = indexEntry(this.idx.get(request.archive), request.group);
        if (!entry) { raws.push([request, null]); continue; }
        let missing = -1;
        const raw = readChain(request.archive, request.group, entry, (sector) => {
          const bytes = this.dat.bytes(sector * SECTOR, SECTOR);
          if (!bytes) missing = sector;
          return bytes;
        });
        // a sector that is still missing although its blocks are loaded lies past the end of the file
        const loaded = missing >= 0 && this.dat.blocks.has(this.dat.blockOf(missing * SECTOR)) && this.dat.blocks.has(this.dat.blockOf(missing * SECTOR + SECTOR - 1));
        if (raw || missing < 0 || loaded || stuck.get(request) === missing) { raws.push([request, raw]); continue; }
        stuck.set(request, missing);
        // Chains are almost always contiguous: fetch from the missing sector to where the group's length says it
        // ends. When the chain jumps elsewhere, the next round finds the next missing sector.
        if (missing !== entry.sector) this.chainMisses++;
        const dataLen = request.group > 0xffff ? SECTOR - 10 : SECTOR - 8;
        const end = entry.sector * SECTOR + Math.ceil(entry.length / dataLen) * SECTOR;
        const last = Math.max(missing * SECTOR + SECTOR, end) - 1;
        for (let b = this.dat.blockOf(missing * SECTOR); b <= this.dat.blockOf(last); b++) blocks.add(b);
        next.push(request);
      }
      if (blocks.size) await this.dat.load(blocks);
      pending = next;
    }
    await Promise.all(raws.map(async ([request, raw]) => {
      let data: Uint8Array | null = null;
      if (raw) {
        try { data = await decompress(raw, request.key); } catch (e) { if (request.archive === 255) throw e; }
      }
      this.decoded.set(`${request.archive}:${request.group}`, data);
    }));
  }

  protected payload(archive: number, group: number): Uint8Array | null {
    const data = this.decoded.get(`${archive}:${group}`);
    if (data === undefined) throw new MissingGroupError(archive, group);
    return data;
  }

  /** Bytes held: fetched data-file blocks and decoded groups. */
  get memory() {
    let decoded = 0;
    for (const d of this.decoded.values()) decoded += d?.length ?? 0;
    return { blocks: this.dat.loadedBytes, blockCount: this.dat.blocks.size, decoded, groups: this.decoded.size };
  }
}

async function decompress(raw: Uint8Array, key?: Xtea): Promise<Uint8Array> {
  const { type, payload, uncompressedLength } = openContainer(raw, key);
  if (type === 0) return payload;
  if (type === 1) return bunzip2(payload, uncompressedLength);
  const stream = new Blob([payload as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new DecompressionStream('gzip'));
  const out = new Uint8Array(await new Response(stream).arrayBuffer());
  if (out.length !== uncompressedLength) throw new Error('gzip container has the wrong length');
  return out;
}

/** IndexedDB-backed BlockCache (null where IndexedDB isn't available, e.g. Node or a locked-down private window). */
export async function openIndexedDbCache(name = 'skate-scape-cache'): Promise<BlockCache | null> {
  if (typeof indexedDB === 'undefined') return null;
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(name, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('blocks');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  }).catch(() => null);
  if (!db) return null;
  const done = (tx: IDBTransaction) => new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = tx.onabort = () => reject(tx.error); });
  return {
    async get(keys) {
      const tx = db.transaction('blocks', 'readonly'), store = tx.objectStore('blocks');
      const values = keys.map((key) => new Promise<Uint8Array | undefined>((resolve) => {
        const request = store.get(key);
        request.onsuccess = () => resolve(request.result instanceof ArrayBuffer ? new Uint8Array(request.result) : undefined);
        request.onerror = () => resolve(undefined);
      }));
      return Promise.all(values);
    },
    async put(entries) {
      const tx = db.transaction('blocks', 'readwrite'), store = tx.objectStore('blocks');
      for (const [key, data] of entries) store.put(data.byteOffset === 0 && data.byteLength === data.buffer.byteLength ? data.buffer : data.slice().buffer, key);
      await done(tx);
    },
  };
}
