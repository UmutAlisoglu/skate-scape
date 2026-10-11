// The cache worker: downloads the 2009scape cache from GitLab (a few large Range requests, kept in IndexedDB), serves
// raw groups to the build workers over message ports, and builds what needs the whole cache: the player, the NPCs,
// textures (the client's own texture generator, ported) and the quick world map.
import { Fetcher, GroupStore, RemoteCache, gitlabSource, openIndexedDbCache, type GroupRequest } from '../../../tools/cache/http-store.ts';
import { Defs } from '../../../tools/cache/defs.ts';
import { TextureGenerator } from '../../../tools/texgen/texture.ts';
import { buildNpcs, buildPlayer, type ItemConfig } from '../../../tools/player/build.ts';
import { quickOverview } from '../../../tools/world/overview.ts';
import { AREAS } from '../../../tools/world/area-export.ts';
import { BROWSER_ARCHIVES } from '../../../tools/world/area-prefetch.ts';
import { buffersOf, Channel, Transfer } from './channel.ts';
import type { CacheOpen, CacheProgress, TextureLayer } from './protocol.ts';

const quiet = { log() {}, warn() {} };
const main = new Channel(self as unknown as Worker);
let remote: RemoteCache;
let fetcher: Fetcher;
let store: GroupStore;
let xteas: Uint8Array, itemConfigs: Uint8Array;
let textures: TextureGenerator;
let defs: Defs;

main.serve({
  async open(options: CacheOpen) {
    const t0 = performance.now(), cache = options.cache ? await openIndexedDbCache() : null;
    let total = 0;
    fetcher = new Fetcher({
      cache, concurrency: 3,
      onBytes: (bytes) => main.emit('progress', { downloaded: Math.min(bytes, total || bytes), total: Math.max(total, bytes), cached: fetcher.stats.cacheBytes } satisfies CacheProgress),
    });
    const source = gitlabSource(options.project, options.ref);
    [remote, xteas, itemConfigs] = await Promise.all([
      RemoteCache.open(source, fetcher, BROWSER_ARCHIVES, options.blockSize, options.eager),
      fetcher.cached([`${source.id}/xteas.json`], () => fetcher.get(source.xteas)).then(([d]) => d),
      fetcher.cached([`${source.id}/item_configs.json`], () => fetcher.get(source.itemConfigs)).then(([d]) => d),
    ]);
    // (the index files, keys and item data add about 3.7 MB to the data file)
    total = (source.datSize ?? remote.neededBlocks().length * remote.blockSize) + 3_700_000;
    store = new GroupStore({ raws: (r) => remote.raws(r), rawSync: (a, g) => remote.raw(a, g) });
    if (options.eager) void loadAll();
    return { sourceId: source.id, openMs: performance.now() - t0 };
  },

  /** A port a build worker reads raw groups through. */
  connect(port: MessagePort) {
    new Channel(port).serve({
      async raws(requests: GroupRequest[]) {
        // a region to build: bring the rest of the cache in too, so streaming the map never waits on GitLab
        void loadAll();
        // copies: the groups are views into 8 MB blocks that stay here
        const raws: (Uint8Array | null)[] = (await remote.raws(requests)).map((r) => (r ? r.slice() : null));
        return new Transfer(raws, buffersOf(raws.filter((r): r is Uint8Array => r !== null)));
      },
      xteas: () => xteas,
    });
  },

  async player() {
    await loadAll();
    const configs = JSON.parse(new TextDecoder().decode(itemConfigs)) as ItemConfig[];
    const { wardrobe, anims } = await remote.whileLoading(() => buildPlayer(store, configs, quiet));
    store.forget();
    return { wardrobe: JSON.stringify(wardrobe), anims: JSON.stringify(anims) };
  },

  async npcs() {
    // (NpcDefs.find skips configs it can't read, so it needs every block first)
    await loadAll();
    const npcs = await remote.whileLoading(() => buildNpcs(store, quiet));
    store.forget();
    return JSON.stringify(npcs);
  },

  /** Renders textures at 128 px as export:surfaces does, with their GL blend mode and the cache's flags. */
  async textures(ids: number[]) {
    return remote.whileLoading(() => {
      defs ??= new Defs(store);
      textures ??= new TextureGenerator(128, (id) => store.file(9, id), (id) => store.file(8, id));
      const layers: TextureLayer[] = [];
      for (const id of ids) {
        let rendered = null;
        try { rendered = textures.render(id); } catch { /* a texture the client couldn't draw either: stays untextured */ }
        if (rendered) layers.push({ id, rgba: rendered.rgba, blend: rendered.flags.blend, opaque: defs.textures.opaque[id] ?? true, material: defs.textures.materialType[id] ?? 0 });
      }
      return new Transfer(layers, buffersOf(layers.map((l) => l.rgba)));
    });
  },

  /** The quick world map for an area (RGBA, north up). */
  async overview(name: string) {
    await loadAll();
    const image = await remote.whileLoading(() => quickOverview(store, defs ??= new Defs(store), AREAS[name]));
    store.forget();
    return new Transfer(image, [image.buffer]);
  },

  stats: () => ({ fetch: fetcher.stats, loadedBytes: remote.loadedBytes, chainMisses: remote.chainMisses }),
});

let loading: Promise<void> | null = null;
/** The whole data file (from IndexedDB or GitLab); reports when it's in, or why it failed. */
function loadAll() {
  return (loading ??= (async () => {
    const t0 = performance.now();
    try { await remote.loadAll(); } catch (e) { main.emit('failed', { message: (e as Error).message, name: (e as Error).name }); throw e; }
    main.emit('loaded', { ms: performance.now() - t0, stats: fetcher.stats });
  })());
}
