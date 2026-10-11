// What the page and the remote-world workers send each other (see remote-world.ts).
import type { BlockResult } from '../../../tools/world/area-export.ts';
import type { Rail } from '../../game/skater.ts';

/** `eager`: start loading the whole cache now (a first visit); otherwise only what a build needs, when it needs it */
export interface CacheOpen { project?: string; ref?: string; blockSize?: number; cache: boolean; eager: boolean }
export interface CacheProgress { downloaded: number; total: number; cached: number }
export interface TextureLayer { id: number; rgba: Uint8Array; blend: number; opaque: boolean; material: number }

/** One built region: its files (render chunks, collision cells, minimap tile) and its per-tile layers. */
export interface BuiltRegion {
  bx: number; by: number;
  result: BlockResult;
  files: [string, Uint8Array][];
  traversal: Uint8Array; heights: Float32Array; overview: Uint8Array;
  /** grind lines of its cells (for the town runes) */
  rails: Rail[];
  ms: number;
}
