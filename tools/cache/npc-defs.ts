// NPC configs (js5 archive 18) and base animation sets (config group 32), ported from the 530 client's
// NpcType.decode and BasType.decode.
import { Reader } from './reader.ts';
import type { Js5Store } from './js5.ts';

export const NPC_ARCHIVE = 18;
const BAS_GROUP = 32;

export interface NpcType {
  id: number; name: string; models: number[]; size: number;
  recolS: number[]; recolD: number[]; retexS: number[]; retexD: number[];
  resizeX: number; resizeY: number; ambient: number; contrast: number; combatLevel: number;
  bas: number; multiNpcs: number[] | null;
}

export function decodeNpc(id: number, data: Uint8Array): NpcType {
  const t: NpcType = { id, name: 'null', models: [], size: 1, recolS: [], recolD: [], retexS: [], retexD: [], resizeX: 128, resizeY: 128, ambient: 0, contrast: 0, combatLevel: -1, bas: -1, multiNpcs: null };
  const r = new Reader(data);
  for (;;) {
    const op = r.g1();
    if (op === 0) return t;
    if (op === 1) { const n = r.g1(); for (let i = 0; i < n; i++) { const m = r.g2(); t.models.push(m === 65535 ? -1 : m); } }
    else if (op === 2) t.name = r.gjstr();
    else if (op === 12) t.size = r.g1();
    else if (op >= 30 && op < 35) r.gjstr();
    else if (op === 40) { const n = r.g1(); for (let i = 0; i < n; i++) { t.recolS.push(r.g2()); t.recolD.push(r.g2()); } }
    else if (op === 41) { const n = r.g1(); for (let i = 0; i < n; i++) { t.retexS.push(r.g2()); t.retexD.push(r.g2()); } }
    else if (op === 42) { const n = r.g1(); for (let i = 0; i < n; i++) r.g1b(); }
    else if (op === 60) { const n = r.g1(); for (let i = 0; i < n; i++) r.g2(); }
    else if (op === 93 || op === 99 || op === 107 || op === 109 || op === 111) { /* flags */ }
    else if (op === 95) t.combatLevel = r.g2();
    else if (op === 97) t.resizeX = r.g2();
    else if (op === 98) t.resizeY = r.g2();
    else if (op === 100) t.ambient = r.g1b();
    else if (op === 101) t.contrast = r.g1b() * 5;
    else if (op === 102 || op === 103) r.g2();
    else if (op === 106 || op === 118) {
      let last = -1;
      const varbit = r.g2(), varp = r.g2(); void varbit; void varp;
      if (op === 118) { last = r.g2(); if (last === 65535) last = -1; }
      const n = r.g1(); t.multiNpcs = [];
      for (let i = 0; i <= n; i++) { const c = r.g2(); t.multiNpcs.push(c === 65535 ? -1 : c); }
      t.multiNpcs.push(last);
    }
    else if (op === 113) { r.g2(); r.g2(); }
    else if (op === 114) { r.g1b(); r.g1b(); }
    else if (op === 115) { r.g1(); r.g1(); }
    else if (op === 119) r.g1b();
    else if (op === 121) { const n = r.g1(); for (let i = 0; i < n; i++) { r.g1(); r.g1b(); r.g1b(); r.g1b(); } }
    else if (op === 122 || op === 123 || op === 126) r.g2();
    else if (op === 125) r.g1b();
    else if (op === 127) t.bas = r.g2();
    else if (op === 128) r.g1();
    else if (op === 134) { r.g2(); r.g2(); r.g2(); r.g2(); r.g1(); }
    else if (op === 135 || op === 136) { r.g1(); r.g2(); }
    else if (op === 137) r.g2();
    else if (op === 249) { const n = r.g1(); for (let i = 0; i < n; i++) { const string = r.g1() === 1; r.g3(); if (string) r.gjstr(); else r.g4(); } }
    else throw new Error(`npc ${id}: unknown opcode ${op}`);
  }
}

export interface BasType { idle: number; walk: number; run: number }

export function decodeBas(data: Uint8Array): BasType {
  const t: BasType = { idle: -1, walk: -1, run: -1 };
  const r = new Reader(data);
  const anim = () => { const v = r.g2(); return v === 65535 ? -1 : v; };
  for (;;) {
    const op = r.g1();
    if (op === 0) return t;
    if (op === 1) { t.idle = anim(); t.walk = anim(); }
    else if (op === 6) t.run = anim();
    else if ((op >= 2 && op <= 9) || op === 30 || op === 32 || op === 35 || (op >= 38 && op <= 45)) r.g2();
    else if (op === 26) { r.g1(); r.g1(); }
    else if (op === 27) { r.g1(); for (let i = 0; i < 6; i++) r.g2b(); }
    else if (op === 29 || op === 31 || op === 34 || op === 37) r.g1();
    else if (op === 33 || op === 36) r.g2b();
    else throw new Error(`bas: unknown opcode ${op}`);
  }
}

export class NpcDefs {
  private npcs = new Map<number, NpcType>();
  private byName: Map<string, number[]> | null = null;
  constructor(private cache: Js5Store) {}
  npc(id: number) {
    let t = this.npcs.get(id);
    if (!t) {
      const data = this.cache.file(NPC_ARCHIVE, id >>> 7, id & 0x7f);
      if (!data) throw new Error(`npc ${id} missing`);
      this.npcs.set(id, (t = decodeNpc(id, data)));
    }
    return t;
  }
  bas(id: number) {
    const data = this.cache.file(2, BAS_GROUP, id);
    return data ? decodeBas(data) : null;
  }
  /** NPC ids with this exact name (case-insensitive) that have models. */
  find(name: string) {
    if (!this.byName) {
      this.byName = new Map();
      for (const group of this.cache.index(NPC_ARCHIVE).groupIds) for (const file of this.cache.index(NPC_ARCHIVE).fileIds.get(group) ?? []) {
        const id = (group << 7) | file;
        try {
          const t = this.npc(id), key = t.name.toLowerCase();
          if (!t.models.length) continue;
          const list = this.byName.get(key); if (list) list.push(id); else this.byName.set(key, [id]);
        } catch { /* a few configs in this cache don't parse; skip them */ }
      }
    }
    return this.byName.get(name.toLowerCase()) ?? [];
  }
}
