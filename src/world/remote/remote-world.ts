// The world built in the visitor's browser from 2009scape's GitLab cache (?source=gitlab, the default without local
// exports). A cache worker downloads the cache (12 large Range requests, kept in IndexedDB) and builds the player,
// NPCs, textures and a quick world map; build workers turn map regions into the game's files on demand, nearest the
// rider (or a teleport's destination) first. Built regions are kept in IndexedDB too, so a second visit skips
// building them. The game's loaders read the built files through provideAssets (see load.ts).
import { gitlabSource } from '../../../tools/cache/http-store.ts';
import { AREAS, type Area } from '../../../tools/world/area-export.ts';
import { partTextures } from '../../../tools/player/build.ts';
import { placesIn, type LocalPlace } from '../../game/places.ts';
import type { MapImage } from '../../game/minimap.ts';
import { ASSET_BASE, assetUrl, forgetAssets, provideAssets, setAssetResolver, type WorldManifest } from '../load.ts';
import { Channel, RemoteError } from './channel.ts';
import { openBuiltStore, type BuiltStore } from './idb.ts';
import { growingSurfaces } from './surfaces.ts';
import type { BuiltRegion, CacheOpen, CacheProgress, TextureLayer } from './protocol.ts';

/** Bump when the exporters' output changes, so browsers rebuild instead of using regions they kept. */
export const BUILD_VERSION = 1;
/** textures the game's own props draw with (park.ts, props.ts, landmarks.ts) */
const FIXED_TEXTURES = [72, 160, 301];
/** regions within this many tiles of the rider are built */
const BUILD_RADIUS = 100;
/** built regions kept in memory; the rest reload from IndexedDB when needed again */
const KEEP_REGIONS = 40;

/** GitLab could not be reached or kept refusing (shown with a retry button). */
export class SourceUnavailable extends Error {}

export interface RemoteStats { downloaded: number; total: number; cachedBytes: number; requests: number; peakPerMinute: number; retries: number; regionsBuilt: number; regionsFromCache: number; buildMs: number }

const encode = (text: string) => new TextEncoder().encode(text);

export class RemoteWorld {
  readonly area: Area;
  readonly manifest: WorldManifest;
  readonly base: string;
  readonly traversal: Uint8Array;
  readonly heights: Float32Array;
  readonly surfaces = growingSurfaces();
  readonly places: LocalPlace[];
  readonly stats: RemoteStats = { downloaded: 0, total: 0, cachedBytes: 0, requests: 0, peakPerMinute: 0, retries: 0, regionsBuilt: 0, regionsFromCache: 0, buildMs: 0 };
  /** whole-map image the world map shows (1 px per tile, north up); built regions paint over the quick one */
  readonly overview = document.createElement('canvas');
  private readonly tiles = new Map<string, HTMLImageElement>();
  private readonly jobs = new Map<string, { promise: Promise<void>; resolve(): void; reject(e: unknown): void; started: boolean; priority: number }>();
  private readonly ready = new Map<string, { files: string[]; used: number }>();
  private readonly listeners: ((region: BuiltRegion) => void)[] = [];
  private builders: { channel: Channel; busy: boolean }[] = [];
  private focus: { x: number; z: number } = { x: 0, z: 0 };
  private lastUpdate = -Infinity;
  private prefix = '';
  private downloaded = false;
  private failure: Error | null = null;

  private constructor(readonly name: string, private readonly cache: Channel, private readonly store: BuiltStore, readonly progress: (text: string) => void) {
    const area = (this.area = AREAS[name]);
    const sizeX = area.w * 64, sizeY = area.h * 64;
    this.manifest = { name: name[0].toUpperCase() + name.slice(1), format: 2, baseTile: [area.regionX * 64, area.regionY * 64], sizeTiles: [sizeX, sizeY], spawn: [area.spawn[0] - area.regionX * 64, area.spawn[1] - area.regionY * 64] };
    this.base = `${ASSET_BASE}world/${name}`;
    // not built yet = no terrain: the skater can't roll there until it is
    this.traversal = new Uint8Array(sizeX * sizeY).fill(2);
    this.heights = new Float32Array(sizeX * sizeY);
    this.places = placesIn(this.manifest.baseTile, this.manifest.sizeTiles);
    this.overview.width = sizeX; this.overview.height = sizeY;
    const c = this.overview.getContext('2d')!; c.fillStyle = '#0b1a14'; c.fillRect(0, 0, sizeX, sizeY);
  }

  /** Starts the workers and opens the cache (index files and keys: a few small requests). */
  static async open(name: string, progress: (text: string) => void): Promise<RemoteWorld> {
    if (!AREAS[name]) throw new Error(`unknown area "${name}"`);
    const params = new URLSearchParams(location.search);
    const worker = new Worker(new URL('./cache-worker.ts', import.meta.url), { type: 'module' });
    const cache = new Channel(worker);
    const world = new RemoteWorld(name, cache, await openBuiltStore(), progress);
    const project = params.get('project') ?? undefined, ref = params.get('ref') ?? undefined;
    world.prefix = `${BUILD_VERSION}|${gitlabSource(project, ref).id}`;
    // a first visit loads the whole cache straight away; later ones only when they need a region they haven't built
    const spawn = world.regionAt(world.manifest.spawn[0], -world.manifest.spawn[1])!;
    const kept = await Promise.all([world.store.get(`${world.prefix}|player`), world.store.get(`${world.prefix}|region|${name}|${spawn[0]}_${spawn[1]}`)]);
    const eager = kept.some((v) => v === undefined);
    worker.onerror = (event) => world.fail(new Error(event.message || 'the cache worker stopped'));
    cache.on<CacheProgress>('progress', (p) => {
      world.stats.downloaded = p.downloaded; world.stats.total = p.total; world.stats.cachedBytes = p.cached;
      if (!world.downloaded) progress(`Downloading the world… ${(p.downloaded / 1e6).toFixed(0)} / ${(p.total / 1e6).toFixed(0)} MB`);
    });
    cache.on<{ stats: { requests: number; peakPerMinute: number; retries: number } }>('loaded', ({ stats }) => {
      world.downloaded = true; performance.mark('world-cache-loaded');
      Object.assign(world.stats, { requests: stats.requests, peakPerMinute: stats.peakPerMinute, retries: stats.retries });
    });
    cache.on<{ message: string }>('failed', ({ message }) => world.fail(new SourceUnavailable(message)));
    progress('Opening the 2009scape cache…');
    try {
      await cache.call('open', { cache: params.get('cache') !== 'off', project, ref, blockSize: Number(params.get('block')) || undefined, eager } satisfies CacheOpen);
    } catch (e) {
      worker.terminate();
      throw e instanceof RemoteError && e.remoteName === 'FetchError' ? new SourceUnavailable(e.message) : e;
    }
    performance.mark('world-cache-open');
    const count = Math.max(1, Math.min(3, (navigator.hardwareConcurrency || 4) - 2));
    for (let i = 0; i < count; i++) {
      const builder = new Worker(new URL('./build-worker.ts', import.meta.url), { type: 'module' }), channel = new Channel(builder), link = new MessageChannel();
      builder.onerror = (event) => world.fail(new Error(event.message || 'a build worker stopped'));
      await cache.callWith('connect', [link.port1], link.port1);
      await channel.callWith('init', [link.port2], { port: link.port2, area: name });
      world.builders.push({ channel, busy: false });
    }
    setAssetResolver((url) => world.resolve(url));
    void world.loadOverview();
    return world;
  }

  private fail(error: Error) {
    this.failure ??= error;
    for (const job of this.jobs.values()) job.reject(error);
  }

  /** Calls `listener` for every region in the game so far, then for each one as it arrives. */
  onRegion(listener: (region: BuiltRegion) => void) {
    this.listeners.push(listener);
    for (const region of this.applied) listener(region);
  }
  /** the regions in the game so far, without their files */
  private readonly applied: BuiltRegion[] = [];

  /** The player's wardrobe and animations (built, or kept from an earlier visit), served as public/player files. */
  async player() {
    const key = `${this.prefix}|player`;
    let built = await this.store.get<{ wardrobe: string; anims: string }>(key);
    if (!built) { built = await this.cache.call<{ wardrobe: string; anims: string }>('player'); void this.store.put(key, built); }
    await this.addTextures([...partTextures(built.wardrobe), ...FIXED_TEXTURES]);
    provideAssets(`${ASSET_BASE}player`, new Map([['wardrobe.json', encode(built.wardrobe)], ['anims.json', encode(built.anims)]]));
    performance.mark('world-player');
  }

  /** The NPCs (random events, pets, crews), served as public/npcs/npcs.json. */
  async npcs() {
    const key = `${this.prefix}|npcs`;
    let built = await this.store.get<string>(key);
    if (!built) { built = await this.cache.call<string>('npcs'); void this.store.put(key, built); }
    await this.addTextures(partTextures(built));
    provideAssets(`${ASSET_BASE}npcs`, new Map([['npcs.json', encode(built)]]));
    performance.mark('world-npcs');
  }

  private async addTextures(ids: number[]) {
    const missing = this.surfaces.missing(ids);
    if (!missing.length) return;
    const layers: TextureLayer[] = [], render: number[] = [];
    const kept = await Promise.all(missing.map((id) => this.store.get<TextureLayer>(`${this.prefix}|texture|${id}`)));
    missing.forEach((id, i) => { if (kept[i]) layers.push(kept[i]!); else render.push(id); });
    if (render.length) for (const layer of await this.cache.call<TextureLayer[]>('textures', render)) { layers.push(layer); void this.store.put(`${this.prefix}|texture|${layer.id}`, layer); }
    this.surfaces.add(layers);
  }

  private async loadOverview() {
    const key = `${this.prefix}|overview|${this.name}`;
    let image = await this.store.get<Uint8Array>(key);
    if (!image) { image = await this.cache.call<Uint8Array>('overview', this.name).catch(() => undefined); if (image) void this.store.put(key, image); }
    if (!image) return;
    const { width, height } = this.overview, c = this.overview.getContext('2d')!;
    // keep what built regions already painted
    const painted = c.getImageData(0, 0, width, height);
    const quick = new ImageData(new Uint8ClampedArray(image), width, height);
    for (const [k] of this.ready) {
      const [bx, by] = k.split('_').map(Number);
      for (let y = 0; y < 64; y++) {
        const row = (height - 1 - (by * 64 + y)) * width + bx * 64;
        quick.data.set(painted.data.subarray(row * 4, (row + 64) * 4), row * 4);
      }
    }
    c.putImageData(quick, 0, 0);
  }

  /** The region (bx, by) covering local tile (x, -z), or null off the map. */
  regionAt(x: number, z: number): [number, number] | null {
    const bx = Math.floor(x / 64), by = Math.floor(-z / 64);
    return bx >= 0 && by >= 0 && bx < this.area.w && by < this.area.h ? [bx, by] : null;
  }

  /** Regions within `radius` tiles of a local point, nearest first. */
  private around(x: number, z: number, radius: number): [number, number][] {
    const out: [number, number, number][] = [];
    for (let by = Math.floor((-z - radius) / 64); by <= Math.floor((-z + radius) / 64); by++) for (let bx = Math.floor((x - radius) / 64); bx <= Math.floor((x + radius) / 64); bx++) {
      if (bx < 0 || by < 0 || bx >= this.area.w || by >= this.area.h) continue;
      const dx = Math.max(bx * 64 - x, 0, x - (bx + 1) * 64), dy = Math.max(by * 64 + z, 0, -z - (by + 1) * 64);
      if (dx * dx + dy * dy <= radius * radius) out.push([bx, by, dx * dx + dy * dy]);
    }
    return out.sort((a, b) => a[2] - b[2]).map(([bx, by]) => [bx, by]);
  }

  /** Builds (or loads) every region within `radius` tiles of a local point; resolves once they're in the game. */
  ensureAround(x: number, z: number, radius = 8) {
    return Promise.all(this.around(x, z, radius).map(([bx, by]) => this.request(bx, by, -1)));
  }

  /** Keeps the regions around the rider (or a teleport's destination) coming. Call every frame. */
  update(position: { x: number; z: number }, time = performance.now()) {
    if (time - this.lastUpdate < 500) return;
    this.lastUpdate = time;
    this.focus = { x: position.x, z: position.z };
    for (const [bx, by] of this.around(position.x, position.z, BUILD_RADIUS)) void this.request(bx, by, 0).catch(() => {});
    // when the neighbourhood is done, the teleport destinations (their own region) build in the background
    if (![...this.jobs.values()].some((j) => !j.started)) for (const place of this.places) {
      const r = this.regionAt(place.x, place.z);
      if (r && !this.jobs.has(`${r[0]}_${r[1]}`)) { void this.request(r[0], r[1], 1).catch(() => {}); break; }
    }
    this.evict();
  }

  private request(bx: number, by: number, priority: number): Promise<void> {
    if (this.failure) return Promise.reject(this.failure);
    const key = `${bx}_${by}`;
    const ready = this.ready.get(key);
    if (ready) { ready.used = performance.now(); return Promise.resolve(); }
    let job = this.jobs.get(key);
    if (job) { job.priority = Math.min(job.priority, priority); this.pump(); return job.promise; }
    let resolve!: () => void, reject!: (e: unknown) => void;
    const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
    job = { promise, resolve, reject, started: false, priority };
    this.jobs.set(key, job);
    this.pump();
    return promise;
  }

  /** Starts queued regions on idle build workers: urgent ones (teleports, start) first, then nearest the focus. */
  private pump() {
    for (const builder of this.builders) {
      if (builder.busy) continue;
      const next = [...this.jobs.entries()].filter(([, j]) => !j.started).sort(([a, ja], [b, jb]) => ja.priority - jb.priority || this.distance(a) - this.distance(b))[0];
      if (!next) return;
      const [key, job] = next, [bx, by] = key.split('_').map(Number);
      job.started = true; builder.busy = true;
      void this.load(bx, by, builder.channel).then(job.resolve, (e) => { this.jobs.delete(key); job.reject(e); console.error(`Could not build region ${key}`, e); })
        .finally(() => { builder.busy = false; this.pump(); });
    }
  }
  private distance(key: string) {
    const [bx, by] = key.split('_').map(Number);
    return Math.hypot((bx + 0.5) * 64 - this.focus.x, (by + 0.5) * 64 + this.focus.z);
  }

  /** A region from IndexedDB, or built by a worker (then kept there). */
  private async load(bx: number, by: number, builder: Channel) {
    const key = `${this.prefix}|region|${this.name}|${bx}_${by}`;
    let region = await this.store.get<BuiltRegion>(key);
    if (region) this.stats.regionsFromCache++;
    else {
      region = await builder.call<BuiltRegion>('region', bx, by);
      this.stats.regionsBuilt++; this.stats.buildMs += region.ms;
      void this.store.put(key, region);
    }
    await this.apply(region);
  }

  private async apply(region: BuiltRegion) {
    const { bx, by, result } = region, sizeX = this.area.w * 64;
    await this.addTextures(result.textures);
    provideAssets(this.base, new Map(region.files));
    // per-tile layers (rows bottom-up, like the tile grid)
    for (let y = 0; y < 64; y++) {
      const at = bx * 64 + (by * 64 + y) * sizeX;
      this.traversal.set(region.traversal.subarray(y * 64, (y + 1) * 64), at);
      this.heights.set(region.heights.subarray(y * 64, (y + 1) * 64), at);
    }
    if (region.result.minimap) {
      const c = this.overview.getContext('2d')!, image = c.createImageData(64, 64);
      for (let y = 0; y < 64; y++) image.data.set(region.overview.subarray(y * 256, (y + 1) * 256), (63 - y) * 256);
      c.putImageData(image, bx * 64, this.overview.height - (by + 1) * 64);
      const tile = new Image(); tile.src = assetUrl(`${this.base}/minimap/${bx}_${by}.png`);
      this.tiles.set(`${bx}_${by}`, tile);
    }
    this.ready.set(`${bx}_${by}`, { files: region.files.map(([path]) => path), used: performance.now() });
    this.jobs.delete(`${bx}_${by}`);
    const summary = { ...region, files: [] };
    this.applied.push(summary);
    for (const listener of this.listeners) listener(summary);
  }

  /** Drops the files of the regions farthest from the rider once too many are in memory (they stay in IndexedDB). */
  private evict() {
    if (this.ready.size <= KEEP_REGIONS) return;
    const far = [...this.ready.entries()].sort(([a], [b]) => this.distance(b) - this.distance(a));
    for (const [key, entry] of far.slice(0, this.ready.size - KEEP_REGIONS)) {
      if (this.distance(key) < BUILD_RADIUS + 64) break;
      forgetAssets(entry.files.map((path) => `${this.base}/${path}`));
      this.evicted.set(key, entry.files);
      this.ready.delete(key);
    }
  }
  private readonly evicted = new Map<string, string[]>();

  /** Brings an evicted region's files back when a loader asks for one of them. */
  private async resolve(url: string) {
    if (!url.startsWith(`${this.base}/`)) return false;
    const path = url.slice(this.base.length + 1);
    for (const [key, files] of this.evicted) if (files.includes(path)) {
      this.evicted.delete(key);
      const region = await this.store.get<BuiltRegion>(`${this.prefix}|region|${this.name}|${key}`);
      if (region) { provideAssets(this.base, new Map(region.files)); this.ready.set(key, { files, used: performance.now() }); return true; }
      const [bx, by] = key.split('_').map(Number);
      await this.request(bx, by, -1);
      return true;
    }
    return false;
  }

  /** Ground height and whether there's terrain, for the town runes (like the exporter's terrainAt). */
  terrainAt = (x: number, z: number) => {
    const tx = Math.floor(x), ty = Math.floor(-z), w = this.area.w * 64, h = this.area.h * 64;
    return tx >= 0 && ty >= 0 && tx < w && ty < h && this.traversal[tx + ty * w] !== 2 ? this.heights[tx + ty * w] : null;
  };

  /** Whether every region within `radius` tiles of a point is in. */
  builtAround(x: number, z: number, radius: number) { return this.around(x, z, radius).every(([bx, by]) => this.ready.has(`${bx}_${by}`) || this.evicted.has(`${bx}_${by}`)); }

  /** The minimap's image source: built regions' tiles over the overview. */
  mapImage(): MapImage {
    return {
      scale: 4, width: this.area.w * 64 * 4, height: this.area.h * 64 * 4, block: 64, overview: this.overview,
      tile: (bx, by) => { const t = this.tiles.get(`${bx}_${by}`); return t && t.complete && t.naturalWidth ? t : null; },
    };
  }

  /** What's happening, for the loading screen. */
  status(building: string) {
    return this.downloaded || !this.stats.total ? `Building ${building}…` : `Downloading the world… ${(this.stats.downloaded / 1e6).toFixed(0)} / ${(this.stats.total / 1e6).toFixed(0)} MB`;
  }

  async cacheStats() { return this.cache.call<{ fetch: { requests: number; bytes: number; cacheHits: number; cacheBytes: number; peakPerMinute: number; retries: number }; loadedBytes: number }>('stats'); }
}

