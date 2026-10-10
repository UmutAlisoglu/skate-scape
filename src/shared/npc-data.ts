// JSON written by tools/export-npcs.ts and read by the browser.
import type { AnimData, PartModel } from './player-data.ts';

export interface NpcData {
  /** the cache NPC's name and id */
  name: string; id: number;
  /** footprint in tiles */
  size: number;
  /** lighting offset added to the client's 64 */
  ambient: number;
  model: PartModel;
  /** stand and walk sequence ids (in the set's anims) */
  idle?: number; walk?: number;
}
export interface NpcSet { npcs: Record<string, NpcData>; anims: AnimData; textureBrightness: Record<number, number> }
