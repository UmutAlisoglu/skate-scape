// Reads the JS5 cache straight from a remote copy (2009scape's GitLab repository) with HTTP Range requests, so the
// browser can build the world without anyone hosting converted assets.
//
// GitLab answers one client's requests roughly one after another (~0.3 s each) but streams large ranges fast, so the
// data file is read in a few large aligned blocks (32 MB: the whole 92 MB file is 3 requests), and every block is
// kept in a BlockCache (IndexedDB in the browser) so later visits download nothing.
//
// RemoteCache holds the index files and the fetched blocks and reads raw groups synchronously once their blocks are
// in. GroupStore is the Js5Store the world pipeline reads (synchronously): its groups are fetched ahead by
// prefetch(), from a RemoteCache in the same worker or over a message port from another worker.
import { decodeContainer, indexEntry, Js5Store, readChain, SECTOR, type Xtea } from './js5.ts';

/** Where the cache files are and how they're versioned. */
export interface CacheSource {
  /** stable for one version of the data (the commit), used as the cache key prefix */
  id: string;
  /** URL of a file of the cache folder (main_file_cache.dat2, main_file_cache.idx5, …) */
  cacheFile(name: string): string;
  /** URL of the region XTEA keys (xteas.json) */
  xteas: string;
  /** URL of the server's item data (item_configs.json: equipment slots for the player's wardrobe) */
  itemConfigs: string;
  /** size of main_file_cache.dat2 when known (it is for the pinned commit), so its blocks can load before the indexes */
  datSize?: number;
}

/**
 * Bytes per data-file request. Cold starts of the site in Chrome (start menu): 8 MB blocks 10.3 s (26 requests),
 * 16 MB 8.8 s (21), 32 MB 7.1 s (18). The spawn area alone needs 11 of the 12 8 MB blocks, so smaller ones don't help.
 */
export const DEFAULT_BLOCK = 32 << 20;

/** The commit the game is pinned to (2026-10-02); its cache is byte-identical to the one ASSET_SETUP.md downloads. */
export const GITLAB_REF = 'bea45a9e93592b567f9b9293b82a36c8773244be';

/** 2009scape's GitLab repository at a fixed commit. The API's raw endpoint sends CORS headers and honours Range. */
export function gitlabSource(project = '2009scape/2009scape', ref = GITLAB_REF, api = 'https://gitlab.com/api/v4'): CacheSource {
  const raw = (path: string) => `${api}/projects/${encodeURIComponent(project)}/repository/files/${encodeURIComponent(path)}/raw?ref=${ref}&lfs=true`;
  return {
    id: `gitlab:${project}@${ref}`, cacheFile: (name) => raw(`Server/data/cache/${name}`),
    xteas: raw('Server/data/configs/xteas.json'), itemConfigs: raw('Server/data/configs/item_configs.json'),
    datSize: project === '2009scape/2009scape' && ref === GITLAB_REF ? 91_702_293 : undefined,
  };
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
  /** answers that were 429 (rate limited) or 5xx and retried */
  retries: number;
}

/** The remote host refused or failed for good (offline, rate limited after retries, or an HTTP error). */
export class FetchError extends Error {
  override name = 'FetchError';
  constructor(message: string, readonly status?: number) { super(message); }
}

export class MissingGroupError extends Error {
  constructor(readonly archive: number, readonly group: number) { super(`cache group ${archive}:${group} was not prefetched`); }
}
export class MissingBlocksError extends Error {
  constructor(readonly blocks: number[]) { super(`data blocks ${blocks.join(', ')} are not loaded`); }
}

export interface FetcherOptions {
  concurrency?: number;
  /** most requests started per minute (default 300, well under GitLab's 500) */
  perMinute?: number;
  cache?: BlockCache | null;
  fetch?: typeof fetch;
  /** bytes received from the network so far (called as data streams in) */
  onBytes?(bytes: number): void;
}

/** Fetches whole files and byte ranges with a concurrency limit, a per-minute ceiling, retries and the block cache. */
export class Fetcher {
  readonly stats: FetchStats = { requests: 0, bytes: 0, cacheHits: 0, cacheBytes: 0, peakPerMinute: 0, retries: 0 };
  private active = 0;
  private queue: (() => void)[] = [];
  private started: number[] = [];

  constructor(private readonly options: FetcherOptions = {}) {}

  /** Cached copies of `keys`, then `load` for the rest (results in key order). */
  async cached(keys: string[], load: (i: number) => Promise<Uint8Array>): Promise<Uint8Array[]> {
    const hits = this.options.cache ? await this.options.cache.get(keys).catch(() => keys.map(() => undefined)) : keys.map(() => undefined);
    return Promise.all(keys.map(async (key, i) => {
      const hit = hits[i];
      if (hit) { this.stats.cacheHits++; this.stats.cacheBytes += hit.length; return hit; }
      const data = await load(i);
      // storage full or unavailable: just fetch it again next time
      if (this.options.cache) await this.options.cache.put([[key, data]]).catch(() => {});
      return data;
    }));
  }

  async get(url: string, range?: [number, number]): Promise<Uint8Array> {
    for (let attempt = 0; ; attempt++) {
      await this.slot();
      let response: Response;
      try {
        response = await (this.options.fetch ?? fetch)(url, range ? { headers: { Range: `bytes=${range[0]}-${range[1] - 1}` } } : {});
      } catch (e) {
        this.release();
        if (attempt < 2) { await sleep(1000 * 2 ** attempt); continue; }
        throw new FetchError(`Could not reach ${new URL(url).host} (${(e as Error).message})`);
      }
      try {
        if ((response.status === 429 || response.status >= 500) && attempt < 4) {
          // back off: honour Retry-After when the server sends one, else 2, 4, 8, 16 s
          this.stats.retries++;
          const after = Number(response.headers.get('Retry-After'));
          await response.body?.cancel();
          this.release();
          await sleep(after > 0 ? after * 1000 : 2000 * 2 ** attempt);
          continue;
        }
        if (!response.ok) throw new FetchError(`${new URL(url).host} answered HTTP ${response.status}`, response.status);
        if (range && response.status !== 206) throw new FetchError(`${new URL(url).host} ignored the Range header`);
        const data = await this.read(response);
        this.release();
        return data;
      } catch (e) {
        this.release();
        throw e;
      }
    }
  }

  /** Reads a body, reporting bytes as they arrive. */
  private async read(response: Response) {
    const reader = this.options.onBytes ? response.body?.getReader() : undefined;
    if (!reader || !this.options.onBytes) {
      const data = new Uint8Array(await response.arrayBuffer());
      this.stats.bytes += data.length; this.options.onBytes?.(this.stats.bytes);
      return data;
    }
    const parts: Uint8Array[] = [];
    let length = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value); length += value.length; this.stats.bytes += value.length;
      this.options.onBytes(this.stats.bytes);
    }
    const data = new Uint8Array(length);
    let at = 0;
    for (const part of parts) { data.set(part, at); at += part.length; }
    return data;
  }

  /** Waits for a free connection and for room under the per-minute ceiling, then counts the request. */
  private async slot() {
    const concurrency = this.options.concurrency ?? 3, perMinute = this.options.perMinute ?? 300;
    if (this.active >= concurrency) await new Promise<void>((r) => this.queue.push(r));
    this.active++;
    for (;;) {
      const now = performance.now();
      while (this.started.length && this.started[0] <= now - 60_000) this.started.shift();
      if (this.started.length < perMinute) break;
      await sleep(this.started[0] + 60_000 - now);
    }
    this.started.push(performance.now());
    this.stats.requests++;
    this.stats.peakPerMinute = Math.max(this.stats.peakPerMinute, this.started.length);
  }
  private release() { this.active--; this.queue.shift()?.(); }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface GroupRequest { archive: number; group: number; key?: Xtea }

/** The remote index files and data file. Raw groups are read synchronously from the blocks fetched so far. */
export class RemoteCache {
  readonly blocks = new Map<number, Uint8Array>();
  private loading = new Map<number, Promise<void>>();
  /** chains that left the blocks their length predicted */
  chainMisses = 0;

  private idx = new Map<number, Uint8Array>();
  private all: Promise<void> | null = null;
  private constructor(readonly source: CacheSource, readonly fetcher: Fetcher, readonly blockSize: number) {}

  /**
   * Fetches the index files of `archives` (and the master index 255) whole. With `eager`, the whole data file starts
   * loading at once (alongside the indexes when its size is known), so streaming the map later never waits.
   */
  static async open(source: CacheSource, fetcher: Fetcher, archives: number[], blockSize = DEFAULT_BLOCK, eager = false) {
    const remote = new RemoteCache(source, fetcher, blockSize);
    const names = [...new Set([255, ...archives])];
    // the small index requests go first: GitLab answers one client's requests roughly in turn
    const indexes = fetcher.cached(names.map((a) => `${source.id}/idx${a}`), (i) => fetcher.get(source.cacheFile(`main_file_cache.idx${names[i]}`)));
    if (eager && source.datSize) void remote.load(Array.from({ length: Math.ceil(source.datSize / blockSize) }, (_, b) => b)).catch(() => {});
    const files = await indexes;
    names.forEach((a, i) => remote.idx.set(a, files[i]));
    if (eager) void remote.loadAll().catch(() => {});
    return remote;
  }

  /** A file outside the cache (xteas.json, item_configs.json), through the block cache. */
  async file(url: string, name: string) {
    const [data] = await this.fetcher.cached([`${this.source.id}/${name}`], () => this.fetcher.get(url));
    return data;
  }

  /** Every data block the opened archives' groups occupy (sector chains are almost always contiguous). */
  neededBlocks() {
    const blocks = new Set<number>();
    for (const index of this.idx.values()) for (let group = 0; group * 6 + 6 <= index.length; group++) {
      const entry = indexEntry(index, group);
      if (!entry) continue;
      const dataLen = group > 0xffff ? SECTOR - 10 : SECTOR - 8, start = entry.sector * SECTOR, end = start + Math.ceil(entry.length / dataLen) * SECTOR;
      for (let b = Math.floor(start / this.blockSize); b <= Math.floor((end - 1) / this.blockSize); b++) blocks.add(b);
    }
    return [...blocks].sort((a, b) => a - b);
  }

  private sector(sector: number): Uint8Array | null {
    const offset = sector * SECTOR, first = Math.floor(offset / this.blockSize), last = Math.floor((offset + SECTOR - 1) / this.blockSize);
    const block = this.blocks.get(first), at = offset - first * this.blockSize;
    if (!block) return null;
    if (first === last) return at + SECTOR <= block.length ? block.subarray(at, at + SECTOR) : block.subarray(at);
    const next = this.blocks.get(last);
    if (!next) return null;
    const out = new Uint8Array(SECTOR);
    out.set(block.subarray(at));
    out.set(next.subarray(0, SECTOR - (block.length - at)), block.length - at);
    return out;
  }

  /**
   * A group's raw container bytes, or null when the group doesn't exist; throws MissingBlocksError naming the
   * blocks to load when its chain runs into one that isn't loaded yet.
   */
  raw(archive: number, group: number): Uint8Array | null {
    const entry = indexEntry(this.idx.get(archive), group);
    if (!entry) return null;
    let missing = -1;
    const raw = readChain(archive, group, entry, (sector) => {
      const bytes = this.sector(sector);
      if (!bytes) missing = sector;
      return bytes;
    });
    if (raw || missing < 0) return raw;
    // fetch from the missing sector to where the group's length says it ends (when the chain jumps elsewhere,
    // the next read finds the next missing sector)
    if (missing !== entry.sector) this.chainMisses++;
    const dataLen = group > 0xffff ? SECTOR - 10 : SECTOR - 8;
    const end = Math.max(missing * SECTOR + SECTOR, entry.sector * SECTOR + Math.ceil(entry.length / dataLen) * SECTOR) - 1;
    const blocks: number[] = [];
    for (let b = Math.floor((missing * SECTOR) / this.blockSize); b <= Math.floor(end / this.blockSize); b++) if (!this.blocks.has(b)) blocks.push(b);
    // a missing sector whose blocks are all loaded lies past the end of the file
    if (!blocks.length) return null;
    throw new MissingBlocksError(blocks);
  }

  /** Raw container bytes for each request, loading blocks as needed. */
  async raws(requests: GroupRequest[]): Promise<(Uint8Array | null)[]> {
    for (;;) {
      const missing = new Set<number>(), out: (Uint8Array | null)[] = [];
      for (const r of requests) {
        try { out.push(this.raw(r.archive, r.group)); } catch (e) {
          if (!(e instanceof MissingBlocksError)) throw e;
          for (const b of e.blocks) missing.add(b);
        }
      }
      if (!missing.size) return out;
      await this.load(missing);
    }
  }

  async load(blocks: Iterable<number>) {
    const wanted = [...new Set(blocks)].filter((b) => !this.blocks.has(b));
    for (const b of wanted) {
      if (this.loading.has(b)) continue;
      const job = this.fetcher.cached([`${this.source.id}/dat2#${this.blockSize}:${b}`], () => this.fetcher.get(this.source.cacheFile('main_file_cache.dat2'), [b * this.blockSize, (b + 1) * this.blockSize]))
        .then(([data]) => { this.blocks.set(b, data); })
        .finally(() => this.loading.delete(b));
      this.loading.set(b, job);
    }
    await Promise.all(wanted.map((b) => this.loading.get(b) ?? Promise.resolve()));
  }

  /**
   * Loads every block the opened archives use, then follows the file to its end (groups rewritten by cache updates
   * are appended there). The response headers that would give the file size aren't exposed cross-origin, so the end
   * is the first short block (or a 416 past it).
   */
  loadAll() { return (this.all ??= this.loadEverything()); }
  private async loadEverything() {
    const needed = this.neededBlocks();
    await this.load(needed);
    let last = needed.length ? needed[needed.length - 1] : -1;
    while (last < 0 || this.blocks.get(last)?.length === this.blockSize) {
      last++;
      try { await this.load([last]); } catch (e) { if (e instanceof FetchError && e.status === 416) break; throw e; }
    }
  }

  /** Runs `read` (a synchronous build over this cache), loading any block it runs into and starting over. */
  async whileLoading<T>(read: () => T): Promise<T> {
    for (;;) {
      try { return read(); } catch (e) {
        if (!(e instanceof MissingBlocksError)) throw e;
        await this.load(e.blocks);
      }
    }
  }

  get loadedBytes() { let n = 0; for (const b of this.blocks.values()) n += b.length; return n; }
}

/**
 * A Js5Store over raw groups fetched ahead with prefetch(). Payloads are decoded synchronously when first read.
 * `rawSync` (a RemoteCache in the same worker) also serves groups that weren't prefetched.
 */
export class GroupStore extends Js5Store {
  private raw = new Map<string, Uint8Array | null>();
  private decoded = new Map<string, Uint8Array | null>();
  constructor(private readonly source: { raws(requests: GroupRequest[]): Promise<(Uint8Array | null)[]>; rawSync?(archive: number, group: number): Uint8Array | null }) { super(); }

  has(archive: number, group: number) { return this.raw.has(`${archive}:${group}`); }

  async prefetch(requests: GroupRequest[]) {
    const seen = new Set<string>(), wanted = requests.filter((r) => {
      const k = `${r.archive}:${r.group}`;
      if (this.raw.has(k) || seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    if (!wanted.length) return;
    const raws = await this.source.raws(wanted);
    wanted.forEach((r, i) => this.raw.set(`${r.archive}:${r.group}`, raws[i]));
  }

  protected payload(archive: number, group: number, key?: Xtea): Uint8Array | null {
    const k = `${archive}:${group}`;
    if (this.decoded.has(k)) return this.decoded.get(k)!;
    let raw = this.raw.get(k);
    if (raw === undefined) {
      if (!this.source.rawSync) throw new MissingGroupError(archive, group);
      raw = this.source.rawSync(archive, group);
      this.raw.set(k, raw);
    }
    let data: Uint8Array | null = null;
    if (raw) {
      try { data = decodeContainer(raw, key); } catch (e) { if (archive === 255) throw e; }
    }
    this.decoded.set(k, data);
    return data;
  }

  /** Drops raw and decoded groups (keeping the reference tables) once a build is done with them. */
  forget() {
    for (const k of [...this.raw.keys()]) if (!k.startsWith('255:')) { this.raw.delete(k); this.decoded.delete(k); }
    this.forgetGroups();
  }
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
      return Promise.all(keys.map((key) => new Promise<Uint8Array | undefined>((resolve) => {
        const request = store.get(key);
        request.onsuccess = () => resolve(request.result instanceof ArrayBuffer ? new Uint8Array(request.result) : undefined);
        request.onerror = () => resolve(undefined);
      })));
    },
    async put(entries) {
      const tx = db.transaction('blocks', 'readwrite'), store = tx.objectStore('blocks');
      for (const [key, data] of entries) store.put(data.byteOffset === 0 && data.byteLength === data.buffer.byteLength ? data.buffer : data.slice().buffer, key);
      await done(tx);
    },
  };
}
