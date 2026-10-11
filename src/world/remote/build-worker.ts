// A build worker: turns one map region (with its one-region border) into the game's world files, with the same
// AreaExport the disk exporter runs. The cache groups it needs come from the cache worker over a message port.
import { Defs } from '../../../tools/cache/defs.ts';
import { GroupStore, MissingGroupError, type GroupRequest } from '../../../tools/cache/http-store.ts';
import { LocBuilder } from '../../../tools/world/mesh.ts';
import { AREAS, AreaExport, type Area } from '../../../tools/world/area-export.ts';
import { prefetchArea } from '../../../tools/world/area-prefetch.ts';
import { parseXteas } from '../../../tools/world/remote-build.ts';
import { encodePngWith } from '../../../tools/png-core.ts';
import type { Xtea } from '../../../tools/cache/js5.ts';
import type { Rail } from '../../game/skater.ts';
import { buffersOf, Channel, Transfer } from './channel.ts';
import type { BuiltRegion } from './protocol.ts';

const main = new Channel(self as unknown as Worker);
let cache: Channel, store: GroupStore, xteas: Map<number, Xtea>, area: Area, name: string, treeDensity = 0.35;

main.serve({
  async init(options: { port: MessagePort; area: string; treeDensity?: number }) {
    cache = new Channel(options.port);
    store = new GroupStore({ raws: (requests: GroupRequest[]) => cache.call('raws', requests) });
    xteas = parseXteas(await cache.call<Uint8Array>('xteas'));
    name = options.area; area = AREAS[name]; treeDensity = options.treeDensity ?? treeDensity;
  },

  /** Builds region (bx, by) of the area (region units: bx = 0 is the area's westmost region). */
  async region(bx: number, by: number) {
    const t0 = performance.now();
    await prefetchArea(store, area, xteas, undefined, 1, [[bx, by]]);
    const files = new Map<string, Uint8Array>(), text = new TextEncoder();
    for (;;) {
      files.clear();
      const defs = new Defs(store);
      const exporter = new AreaExport({
        name, area, cache: store, defs, builder: new LocBuilder(store, defs), xteas, treeDensity, block: 1,
        encodePng: (w, h, rgba) => encodePngWith(w, h, rgba), log() {}, warn() {},
        files: {
          write: (path, data) => files.set(path, typeof data === 'string' ? text.encode(data) : data),
          read: (path) => { const data = files.get(path); if (!data) throw new Error(`${path} was not built`); return data; },
        },
      });
      try {
        const { result, traversal, heights, overview } = exporter.exportBlock(bx, by);
        const rails: Rail[] = [];
        for (const [path, data] of files) if (path.endsWith('.rails.json')) rails.push(...JSON.parse(new TextDecoder().decode(data)) as Rail[]);
        const built: BuiltRegion = { bx, by, result, files: [...files], traversal, heights, overview, rails, ms: performance.now() - t0 };
        store.forget();
        return new Transfer(built, buffersOf([...files.values(), traversal, heights, overview]));
      } catch (e) {
        // the prefetch walk missed a group: fetch it and build again
        if (!(e instanceof MissingGroupError)) throw e;
        await store.prefetch([{ archive: e.archive, group: e.group }]);
      }
    }
  },
});
