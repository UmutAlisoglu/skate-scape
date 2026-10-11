// Works out which cache groups an area export reads and prefetches them in a few large rounds, so a remote cache
// (a GroupStore over tools/cache/http-store.ts) is fetched in parallel instead of one group at a time: configs, then the map regions, then the
// definitions of every object they place, then those objects' models. It follows the same reads the exporter makes
// (TileGrid.load, Defs, LocBuilder.resolve) and errs on the side of fetching a little more; anything it misses is
// fetched on demand when the export hits a MissingGroupError.
import { ARCHIVE, Defs } from '../cache/defs.ts';
import type { GroupRequest, GroupStore } from '../cache/http-store.ts';
import type { Xtea } from '../cache/js5.ts';
import { TileGrid } from './region.ts';
import { blockRegions, type Area } from './area-export.ts';

/** Archives the world export reads; RemoteCache.open needs their index files. */
export const AREA_ARCHIVES = [ARCHIVE.CONFIG, ARCHIVE.MAPS, ARCHIVE.MODELS, ARCHIVE.LOCS, ARCHIVE.TEXTURE_CONFIG];

/** The groups the world, player, NPC and texture builds read the reference tables of. */
export const BROWSER_ARCHIVES = [0, 1, ...AREA_ARCHIVES, 8, 9, 18, 19, 20];

/** Prefetches what exporting blocks `blocks` ([bx, by] in `block`-region units) of `area` reads. */
export async function prefetchArea(store: GroupStore, area: Area, xteas: Map<number, Xtea>, progress: (step: string) => void = () => {}, block = 4, blocks?: [number, number][]) {
  progress('Reading the map index');
  await store.prefetch(AREA_ARCHIVES.map((group) => ({ archive: 255, group })));
  await store.prefetch([{ archive: ARCHIVE.TEXTURE_CONFIG, group: 0 }, { archive: ARCHIVE.CONFIG, group: 1 }, { archive: ARCHIVE.CONFIG, group: 4 }]);
  const defs = new Defs(store);

  // the regions of every block, with their one-region borders
  const grids: TileGrid[] = [], maps: GroupRequest[] = [];
  const all: [number, number][] = [];
  for (let by = 0; by < Math.ceil(area.h / block); by++) for (let bx = 0; bx < Math.ceil(area.w / block); bx++) all.push([bx, by]);
  for (const [bx, by] of blocks ?? all) {
    const { grid } = blockRegions(area, bx, by, block);
    grids.push(new TileGrid(grid.regionX0, grid.regionY0, grid.regionsW, grid.regionsH));
    for (let ry = grid.regionY0; ry < grid.regionY0 + grid.regionsH; ry++) for (let rx = grid.regionX0; rx < grid.regionX0 + grid.regionsW; rx++) {
      const m = store.groupId(ARCHIVE.MAPS, `m${rx}_${ry}`), l = store.groupId(ARCHIVE.MAPS, `l${rx}_${ry}`);
      if (m !== undefined) maps.push({ archive: ARCHIVE.MAPS, group: m });
      if (l !== undefined) maps.push({ archive: ARCHIVE.MAPS, group: l, key: xteas.get((rx << 8) | ry) });
    }
  }
  progress(`Downloading ${maps.length} map files`);
  await store.prefetch(maps);

  const locIds = new Set<number>();
  for (const grid of grids) {
    grid.load(store, xteas, () => {});
    for (const spawn of grid.locs) locIds.add(spawn.id);
  }
  const locGroup = (id: number): GroupRequest => ({ archive: ARCHIVE.LOCS, group: id >>> 8 });
  progress(`Reading ${locIds.size} object definitions`);
  await store.prefetch([...locIds].map(locGroup));
  // objects without models of their own show their first defined variant (LocBuilder.resolve)
  const resolved = new Set<number>();
  for (const id of locIds) {
    const loc = defs.loc(id);
    const child = loc.models || !loc.multiLocs ? -1 : loc.multiLocs.find((c) => c >= 0) ?? -1;
    resolved.add(child >= 0 ? child : id);
  }
  await store.prefetch([...resolved].map(locGroup));

  const models = new Set<number>();
  for (const id of resolved) for (const model of defs.loc(id).models ?? []) models.add(model);
  progress(`Downloading ${models.size} models`);
  await store.prefetch([...models].map((group) => ({ archive: ARCHIVE.MODELS, group })));
}
