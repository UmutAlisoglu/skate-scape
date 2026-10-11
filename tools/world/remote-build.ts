// Builds an area's world files in memory straight from a remote cache (see tools/cache/http-store.ts): the same
// AreaExport the disk exporter runs, fed by an HttpCacheStore instead of the vendor folder. Runs in the browser's
// world worker (src/world/gitlab/worker.ts) and in Node (tools/check-remote-world.ts, to compare with the export).
import { Defs } from '../cache/defs.ts';
import { Fetcher, HttpCacheStore, MissingGroupError, type BlockCache, type CacheSource, type FetchStats } from '../cache/http-store.ts';
import type { Xtea } from '../cache/js5.ts';
import { encodePngWith } from '../png-core.ts';
import { hslToRgb } from '../../src/shared/color.ts';
import type { SurfaceManifest } from '../../src/shared/surfaces.ts';
import { LocBuilder } from './mesh.ts';
import { AREAS, AreaExport, type BlockOutput } from './area-export.ts';
import { AREA_ARCHIVES, prefetchArea } from './area-prefetch.ts';

/**
 * Bytes per Range request. Lumbridge's models are spread over most of the 91 MB data file, and each request to
 * GitLab's API costs about a second however small, so a few large blocks beat many small ones. Cold builds of
 * Lumbridge in Chrome: 2 MB blocks 65 MB in 38 requests (first frame 20 s), 1 MB 59 MB in 63 (26 s),
 * 512 KB 47 MB in 95 (38 s), 256 KB 34 MB in 134 (41 s), 128 KB 25 MB in 195 (72 s). GitLab allows 500 a minute.
 */
export const DEFAULT_BLOCK = 1 << 20;

export interface RemoteBuildOptions {
  source: CacheSource;
  cache?: BlockCache | null;
  /** bytes per Range request into the data file (DEFAULT_BLOCK) */
  blockSize?: number;
  /** parallel requests (6) */
  concurrency?: number;
  treeDensity?: number;
  progress?(step: string): void;
}

export interface RemoteBuildReport {
  fetch: FetchStats;
  /** ms spent opening the cache, prefetching, building and assembling */
  timings: { open: number; prefetch: number; build: number; total: number };
  /** groups the prefetch missed and the export fetched on demand */
  onDemand: number;
  /** chains that left the blocks their length predicted */
  chainMisses: number;
  memory: HttpCacheStore['memory'] & { output: number };
  textures: number[];
  log: string[];
}

export interface RemoteBuild {
  /** files by path relative to public/world/<area>/ */
  world: Map<string, Uint8Array>;
  /** surfaces/manifest.json and surfaces/textures.png, flat colours for now (see flatSurfaces) */
  surfaces: Map<string, Uint8Array>;
  report: RemoteBuildReport;
}

export async function buildRemoteArea(name: string, options: RemoteBuildOptions): Promise<RemoteBuild> {
  const area = AREAS[name];
  if (!area) throw new Error(`unknown area "${name}", choose one of: ${Object.keys(AREAS).join(', ')}`);
  const progress = options.progress ?? (() => {}), log: string[] = [];
  const t0 = performance.now();
  const fetcher = new Fetcher({ concurrency: options.concurrency ?? 6, cache: options.cache });
  progress('Opening the 2009scape cache');
  const [store, keys] = await Promise.all([
    HttpCacheStore.open(options.source, fetcher, AREA_ARCHIVES, options.blockSize ?? DEFAULT_BLOCK),
    fetcher.cached([`${options.source.id}/xteas.json`], () => fetcher.get(options.source.xteas)),
  ]);
  const xteas = new Map<number, Xtea>();
  for (const x of JSON.parse(new TextDecoder().decode(keys[0])).xteas as { regionId: string; keys: string }[]) xteas.set(Number(x.regionId), x.keys.split(',').map(Number) as Xtea);
  const t1 = performance.now();
  await prefetchArea(store, area, xteas, progress);
  const t2 = performance.now();

  progress('Building the streets');
  const defs = new Defs(store), world = new Map<string, Uint8Array>(), text = new TextEncoder();
  const warned = new Set<string>();
  const exporter = new AreaExport({
    name, area, cache: store, defs, builder: new LocBuilder(store, defs), xteas, treeDensity: options.treeDensity ?? 0.35,
    encodePng: (w, h, rgba) => encodePngWith(w, h, rgba),
    log: (message) => log.push(message), warn: (message) => { if (!warned.has(message)) { warned.add(message); log.push(message); } },
    files: {
      write: (path, data) => world.set(path, typeof data === 'string' ? text.encode(data) : data),
      read: (path) => { const data = world.get(path); if (!data) throw new Error(`${path} was not built`); return data; },
    },
  });
  const blocks = new Map<string, BlockOutput>();
  let onDemand = 0;
  for (let by = 0; by < exporter.blocksY; by++) for (let bx = 0; bx < exporter.blocksX; bx++) {
    for (;;) {
      try { blocks.set(`${bx}_${by}`, exporter.exportBlock(bx, by)); break; }
      catch (e) {
        if (!(e instanceof MissingGroupError)) throw e;
        onDemand++;
        await store.prefetch([{ archive: e.archive, group: e.group }]);
      }
    }
  }
  const { textures } = exporter.assemble((bx, by) => blocks.get(`${bx}_${by}`)!);
  const surfaces = flatSurfaces(defs, textures);
  const t3 = performance.now();
  let output = 0;
  for (const data of [...world.values(), ...surfaces.values()]) output += data.length;
  return {
    world, surfaces,
    report: {
      fetch: { ...fetcher.stats }, timings: { open: t1 - t0, prefetch: t2 - t1, build: t3 - t2, total: t3 - t0 },
      onDemand, chainMisses: store.chainMisses, memory: { ...store.memory, output }, textures, log,
    },
  };
}

/**
 * Stand-in surface textures until the client's texture generator is ported: every texture the area uses becomes its
 * cache-defined average colour. Textures that cut holes (leaves, fences) get a dithered alpha so foliage stays
 * see-through instead of turning into solid cards.
 */
export function flatSurfaces(defs: Defs, textures: number[]): Map<string, Uint8Array> {
  const SIZE = 8, layers = textures.filter((id) => defs.textures.defined[id]);
  const pixels = new Uint8Array(SIZE * SIZE * 4 * layers.length);
  layers.forEach((id, layer) => {
    const rgb = hslToRgb(defs.textures.averageColor[id]), opaque = defs.textures.opaque[id] ?? true;
    for (let p = 0; p < SIZE * SIZE; p++) {
      const x = p % SIZE, y = Math.floor(p / SIZE), hole = !opaque && ((x * 3 + y * 5) % 4 === 0 || (x + y) % 3 === 0);
      pixels.set([(rgb >> 16) & 0xff, (rgb >> 8) & 0xff, rgb & 0xff, hole ? 0 : 255], (layer * SIZE * SIZE + p) * 4);
    }
  });
  const manifest: SurfaceManifest = {
    version: 2, size: SIZE, layers, blend: layers.map(() => 0),
    opaque: layers.map((id) => defs.textures.opaque[id] ?? true), material: layers.map((id) => defs.textures.materialType[id] ?? 0),
  };
  return new Map([
    ['manifest.json', new TextEncoder().encode(JSON.stringify(manifest))],
    ['textures.png', encodePngWith(SIZE, SIZE * Math.max(1, layers.length), layers.length ? pixels : new Uint8Array(SIZE * SIZE * 4))],
  ]);
}
