// Builds an area's world files in memory straight from a remote cache (see tools/cache/http-store.ts), with the
// same AreaExport the disk exporter runs. Node uses it to check the browser path against an export
// (tools/check-remote-world.ts); the browser builds region by region instead (src/world/remote/).
import { Defs } from '../cache/defs.ts';
import { DEFAULT_BLOCK, Fetcher, GroupStore, RemoteCache, type BlockCache, type CacheSource, type FetchStats } from '../cache/http-store.ts';
import type { Xtea } from '../cache/js5.ts';
import { encodePngWith } from '../png-core.ts';
import { LocBuilder } from './mesh.ts';
import { AREAS, AreaExport, type BlockOutput } from './area-export.ts';
import { AREA_ARCHIVES } from './area-prefetch.ts';

export interface RemoteBuildOptions {
  source: CacheSource;
  cache?: BlockCache | null;
  blockSize?: number;
  concurrency?: number;
  treeDensity?: number;
  progress?(step: string): void;
}

export interface RemoteBuildReport {
  fetch: FetchStats;
  timings: { open: number; download: number; build: number; total: number };
  memory: { blocks: number; output: number };
  textures: number[];
  log: string[];
}

/** Parses xteas.json into region id -> key. */
export function parseXteas(data: Uint8Array) {
  const xteas = new Map<number, Xtea>();
  for (const x of JSON.parse(new TextDecoder().decode(data)).xteas as { regionId: string; keys: string }[]) xteas.set(Number(x.regionId), x.keys.split(',').map(Number) as Xtea);
  return xteas;
}

export async function buildRemoteArea(name: string, options: RemoteBuildOptions): Promise<{ world: Map<string, Uint8Array>; report: RemoteBuildReport }> {
  const area = AREAS[name];
  if (!area) throw new Error(`unknown area "${name}", choose one of: ${Object.keys(AREAS).join(', ')}`);
  const progress = options.progress ?? (() => {}), log: string[] = [];
  const t0 = performance.now();
  const fetcher = new Fetcher({ concurrency: options.concurrency ?? 3, cache: options.cache });
  progress('Opening the 2009scape cache');
  const remote = await RemoteCache.open(options.source, fetcher, AREA_ARCHIVES, options.blockSize ?? DEFAULT_BLOCK);
  const xteas = parseXteas(await remote.file(options.source.xteas, 'xteas.json'));
  const t1 = performance.now();
  progress('Downloading the cache');
  await remote.loadAll();
  const t2 = performance.now();

  progress('Building the streets');
  const store = new GroupStore({ raws: (r) => remote.raws(r), rawSync: (a, g) => remote.raw(a, g) });
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
  for (let by = 0; by < exporter.blocksY; by++) for (let bx = 0; bx < exporter.blocksX; bx++) blocks.set(`${bx}_${by}`, exporter.exportBlock(bx, by));
  const { textures } = exporter.assemble((bx, by) => blocks.get(`${bx}_${by}`)!);
  const t3 = performance.now();
  let output = 0;
  for (const data of world.values()) output += data.length;
  return {
    world,
    report: { fetch: { ...fetcher.stats }, timings: { open: t1 - t0, download: t2 - t1, build: t3 - t2, total: t3 - t0 }, memory: { blocks: remote.loadedBytes, output }, textures, log },
  };
}
