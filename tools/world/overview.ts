// A quick world map: one pixel per tile coloured by its ground (underlay, overlay or its texture, water blue), read
// straight from the map files without building any geometry. The browser shows it until the regions around are
// built, which then paint their exact minimap colours over it (see AreaExport's overview).
import { ARCHIVE, type Defs } from '../cache/defs.ts';
import type { Js5Store, Xtea } from '../cache/js5.ts';
import { hslToRgb } from '../../src/shared/color.ts';
import { TileGrid } from './region.ts';
import type { Area } from './area-export.ts';

const WATER_TEXTURES = new Set([669, 651]);
const NO_KEYS = new Map<number, Xtea>();

/** RGBA, north up (image rows top-down), area.w * 64 by area.h * 64 pixels. */
export function quickOverview(cache: Js5Store, defs: Defs, area: Area): Uint8Array {
  const width = area.w * 64, height = area.h * 64, image = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) image.set([11, 26, 20, 255], i * 4);
  const colour = (rgb: number, i: number) => { image[i] = (rgb >> 16) & 0xff; image[i + 1] = (rgb >> 8) & 0xff; image[i + 2] = rgb & 0xff; };
  for (let ry = 0; ry < area.h; ry++) for (let rx = 0; rx < area.w; rx++) {
    if (cache.groupId(ARCHIVE.MAPS, `m${area.regionX + rx}_${area.regionY + ry}`) === undefined) continue;
    const grid = new TileGrid(area.regionX + rx, area.regionY + ry, 1, 1);
    grid.load(cache, NO_KEYS, () => {}, false);
    for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
      const t = grid.ti(x, y), u = grid.underlays[0][t], o = grid.overlays[0][t];
      const i = ((height - 1 - (ry * 64 + y)) * width + rx * 64 + x) * 4;
      if (o > 0) {
        const flo = defs.overlay(o - 1);
        if (WATER_TEXTURES.has(flo.texture)) colour(0x2e4e84, i);
        else if (flo.texture >= 0 && defs.textures.defined[flo.texture]) colour(hslToRgb(defs.textures.averageColor[flo.texture]), i);
        else if (flo.color >= 0) colour(hslToRgb(flo.color), i);
        else if (u > 0) colour(defs.underlay(u - 1).rgb, i);
      } else if (u > 0) colour(defs.underlay(u - 1).rgb, i);
    }
  }
  return image;
}
