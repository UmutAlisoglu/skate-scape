// Turns decoded cache models into the PartModel JSON the browser composes and animates (players and NPCs).
import { ARCHIVE, type Defs } from './defs.ts';
import { Model } from './model.ts';
import type { CacheStore } from './store.ts';
import type { PartModel } from '../../src/shared/player-data.ts';

export class PartBuilder {
  private models = new Map<number, Model | null>();
  /** brightness (0-255) of every texture the exported parts use, for hdFaceColor */
  readonly textureBrightness: Record<number, number> = {};
  constructor(private cache: CacheStore, private defs: Defs) {}

  /** A fresh copy of a cache model (null when it's missing). */
  model(id: number): Model | null {
    if (!this.models.has(id)) {
      const data = this.cache.file(ARCHIVE.MODELS, id);
      this.models.set(id, data ? Model.decode(data) : null);
    }
    const m = this.models.get(id);
    return m ? m.clone() : null;
  }

  /** Merges models, applies an offset, recolours and retextures; null when any model is missing. */
  part(ids: number[], recolS: number[], recolD: number[], retexS: number[], retexD: number[], off?: [number, number, number], resize?: [number, number, number]): PartModel | null {
    const parts = ids.map((id) => this.model(id));
    if (parts.length === 0 || parts.some((p) => !p)) return null;
    const m = parts.length === 1 ? parts[0]! : Model.merge(parts as Model[]);
    if (off && (off[0] || off[1] || off[2])) m.translate(off[0], off[1], off[2]);
    for (let i = 0; i < recolS.length; i++) m.recolor(recolS[i], recolD[i]);
    for (let i = 0; i < retexS.length; i++) m.retexture(retexS[i], retexD[i]);
    if (resize && (resize[0] !== 128 || resize[1] !== 128 || resize[2] !== 128)) m.resize(resize[0], resize[1], resize[2]);
    return this.toPart(m);
  }

  toPart(m: Model): PartModel {
    const v: number[] = [];
    for (let i = 0; i < m.vertexCount; i++) v.push(m.vx[i], m.vy[i], m.vz[i]);
    const t: number[] = [];
    for (let i = 0; i < m.triangleCount; i++) t.push(m.ta[i], m.tb[i], m.tc[i]);
    const c = Array.from(m.colors);
    const p: PartModel = { v, b: m.vertexBones ? Array.from(m.vertexBones) : new Array(m.vertexCount).fill(0), t, c };
    if (m.info) p.i = Array.from(m.info, (x) => x & 3);
    if (m.alpha) p.a = Array.from(m.alpha);
    if (m.textures) {
      // Keep real textures (drawn by the RS shader) with the client's per-face texture coordinates.
      const cfg = this.defs.textures;
      const x = Array.from(m.textures, (tex) => (tex >= 0 && tex < cfg.count && cfg.defined[tex] ? tex : -1));
      if (x.some((tex) => tex >= 0)) {
        const uvs = m.uvs();
        p.x = x;
        p.u = Array.from(uvs, (value) => Math.round(value * 1000) / 1000);
        for (const tex of x) if (tex >= 0) this.textureBrightness[tex] = cfg.brightness[tex];
      }
    }
    return p;
  }
}
