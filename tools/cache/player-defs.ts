// Decoders for player appearance + animation data (identity kits, items, sequences, frames, bases).
import { Reader } from './reader.ts';
import type { CacheStore } from './store.ts';

export const ANIM_ARCHIVE = { FRAMES: 0, BASES: 1, SEQS: 20 } as const;

export interface IdkType {
  id: number;
  feature: number;
  models: number[];
  disabled: boolean;
  recolS: number[];
  recolD: number[];
  retexS: number[];
  retexD: number[];
}

export function decodeIdk(id: number, data: Uint8Array): IdkType {
  const t: IdkType = { id, feature: -1, models: [], disabled: false, recolS: [], recolD: [], retexS: [], retexD: [] };
  const r = new Reader(data);
  for (;;) {
    const op = r.g1();
    if (op === 0) break;
    if (op === 1) t.feature = r.g1();
    else if (op === 2) {
      const n = r.g1();
      for (let i = 0; i < n; i++) t.models.push(r.g2());
    } else if (op === 3) t.disabled = true;
    else if (op === 40) {
      const n = r.g1();
      for (let i = 0; i < n; i++) {
        t.recolS.push(r.g2());
        t.recolD.push(r.g2());
      }
    } else if (op === 41) {
      const n = r.g1();
      for (let i = 0; i < n; i++) {
        t.retexS.push(r.g2());
        t.retexD.push(r.g2());
      }
    } else if (op >= 60 && op < 70) r.g2();
    else throw new Error(`idk ${id}: unknown opcode ${op}`);
  }
  return t;
}

export interface ObjType {
  id: number;
  name: string;
  manwear: number[];
  womanwear: number[];
  manOff: [number, number, number];
  womanOff: [number, number, number];
  recolS: number[];
  recolD: number[];
  retexS: number[];
  retexD: number[];
}

export function decodeObj(id: number, data: Uint8Array): ObjType {
  const t: ObjType = { id, name: 'null', manwear: [], womanwear: [], manOff: [0, 0, 0], womanOff: [0, 0, 0], recolS: [], recolD: [], retexS: [], retexD: [] };
  const wear = { m1: -1, m2: -1, m3: -1, w1: -1, w2: -1, w3: -1 };
  const r = new Reader(data);
  for (;;) {
    const op = r.g1();
    if (op === 0) break;
    if (op === 1 || op === 4 || op === 5 || op === 6 || op === 7 || op === 8) r.g2();
    else if (op === 2) t.name = r.gjstr();
    else if (op === 11 || op === 16 || op === 65) {
      // flags
    } else if (op === 12) r.g4();
    else if (op === 23) wear.m1 = r.g2();
    else if (op === 24) wear.m2 = r.g2();
    else if (op === 25) wear.w1 = r.g2();
    else if (op === 26) wear.w2 = r.g2();
    else if (op >= 30 && op <= 39) r.gjstr();
    else if (op === 40) {
      const n = r.g1();
      for (let i = 0; i < n; i++) {
        t.recolS.push(r.g2());
        t.recolD.push(r.g2());
      }
    } else if (op === 41) {
      const n = r.g1();
      for (let i = 0; i < n; i++) {
        t.retexS.push(r.g2());
        t.retexD.push(r.g2());
      }
    } else if (op === 42) {
      const n = r.g1();
      r.pos += n;
    } else if (op === 78) wear.m3 = r.g2();
    else if (op === 79) wear.w3 = r.g2();
    else if (op >= 90 && op <= 93) r.g2();
    else if (op === 95) r.g2();
    else if (op === 96) r.g1();
    else if (op === 97 || op === 98) r.g2();
    else if (op >= 100 && op <= 109) {
      r.g2();
      r.g2();
    } else if (op >= 110 && op <= 112) r.g2();
    else if (op === 113 || op === 114 || op === 115) r.g1();
    else if (op === 121 || op === 122) r.g2();
    else if (op === 125) t.manOff = [r.g1b(), r.g1b(), r.g1b()];
    else if (op === 126) t.womanOff = [r.g1b(), r.g1b(), r.g1b()];
    else if (op === 127 || op === 128 || op === 129 || op === 130) {
      r.g1();
      r.g2();
    } else if (op === 249) {
      const n = r.g1();
      for (let i = 0; i < n; i++) {
        const isString = r.g1() === 1;
        r.g3();
        if (isString) r.gjstr();
        else r.g4();
      }
    } else throw new Error(`obj ${id}: unknown opcode ${op}`);
  }
  t.manwear = [wear.m1, wear.m2, wear.m3].filter((m, i, a) => m >= 0 && (i === 0 || a[0] >= 0));
  t.womanwear = [wear.w1, wear.w2, wear.w3].filter((m, i, a) => m >= 0 && (i === 0 || a[0] >= 0));
  return t;
}

export interface SeqType {
  id: number;
  /** packed: frameset id << 16 | frame id */
  frames: number[];
  /** in client cycles (20 ms) */
  delays: number[];
}

export function decodeSeq(id: number, data: Uint8Array): SeqType {
  const t: SeqType = { id, frames: [], delays: [] };
  const r = new Reader(data);
  for (;;) {
    const op = r.g1();
    if (op === 0) break;
    if (op === 1) {
      const n = r.g2();
      for (let i = 0; i < n; i++) t.delays.push(r.g2());
      for (let i = 0; i < n; i++) t.frames.push(r.g2());
      for (let i = 0; i < n; i++) t.frames[i] += r.g2() << 16;
    } else if (op === 2) r.g2();
    else if (op === 3) {
      const n = r.g1();
      r.pos += n;
    } else if (op === 4 || op === 14 || op === 15 || op === 16) {
      // flags
    } else if (op === 5 || op === 8 || op === 9 || op === 10 || op === 11) r.g1();
    else if (op === 6 || op === 7) r.g2();
    else if (op === 12) {
      const n = r.g1();
      r.pos += n * 4;
    } else if (op === 13) {
      const n = r.g2();
      for (let i = 0; i < n; i++) {
        const sounds = r.g1();
        if (sounds > 0) {
          r.g3();
          r.pos += (sounds - 1) * 2;
        }
      }
    } else throw new Error(`seq ${id}: unknown opcode ${op}`);
  }
  return t;
}

export interface AnimBase {
  types: number[];
  /** vertex labels each transform acts on */
  labels: number[][];
}

export function decodeBase(data: Uint8Array): AnimBase {
  const r = new Reader(data);
  const n = r.g1();
  const types: number[] = [];
  for (let i = 0; i < n; i++) types.push(r.g1());
  r.pos += n; // shadow flags
  r.pos += n * 2; // part masks
  const counts: number[] = [];
  for (let i = 0; i < n; i++) counts.push(r.g1());
  const labels = counts.map((c) => {
    const l: number[] = [];
    for (let j = 0; j < c; j++) l.push(r.g1());
    return l;
  });
  return { types, labels };
}

export interface AnimFrame {
  base: number;
  /** transforms applied in order: [transformIndex, prevOriginIndex (-1 if none), x, y, z] */
  ops: number[][];
}

export function decodeFrame(data: Uint8Array, base: AnimBase, baseId: number): AnimFrame {
  const header = new Reader(data);
  header.pos = 2;
  const count = header.g1();
  const body = new Reader(data);
  body.pos = 3 + count;
  const ops: number[][] = [];
  let prevOrigin = -1;
  let prevUsedOrigin = -1;
  for (let i = 0; i < count; i++) {
    const type = base.types[i];
    if (type === 0) prevOrigin = i;
    const attrs = header.g1();
    if (attrs <= 0) continue;
    if (type === 0) prevUsedOrigin = i;
    const def = type === 3 ? 128 : 0;
    let x = attrs & 1 ? body.gsmart() : def;
    let y = attrs & 2 ? body.gsmart() : def;
    let z = attrs & 4 ? body.gsmart() : def;
    if (type === 2) {
      // rotations are stored as 11-bit angles split across the smart value
      const fix = (v: number) => (((v & 0xff) << 3) + ((v >> 8) & 7)) & 0x7ff;
      x = fix(x);
      y = fix(y);
      z = fix(z);
    }
    let origin = -1;
    if ((type === 1 || type === 2 || type === 3) && prevOrigin > prevUsedOrigin) {
      origin = prevOrigin;
      prevUsedOrigin = prevOrigin;
    }
    ops.push([i, origin, x, y, z]);
  }
  return { base: baseId, ops };
}

export class PlayerDefs {
  constructor(private cache: CacheStore) {}
  idkIds() {
    return this.cache.index(2).fileIds.get(3) ?? [];
  }
  idk(id: number) {
    return decodeIdk(id, this.cache.file(2, 3, id)!);
  }
  obj(id: number) {
    return decodeObj(id, this.cache.file(19, id >>> 8, id & 0xff)!);
  }
  seq(id: number) {
    return decodeSeq(id, this.cache.file(ANIM_ARCHIVE.SEQS, id >>> 7, id & 0x7f)!);
  }
  base(id: number) {
    return decodeBase(this.cache.file(ANIM_ARCHIVE.BASES, id, 0)!);
  }
  frameset(id: number) {
    return this.cache.group(ANIM_ARCHIVE.FRAMES, id);
  }
}
