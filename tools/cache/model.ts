// 530 model decoder (port of rt4 RawModel.decodeNew / decodeOld), geometry + colors only.
import { Reader } from './reader.ts';

export class Model {
  vertexCount = 0;
  triangleCount = 0;
  vx!: Int32Array;
  vy!: Int32Array;
  vz!: Int32Array;
  /** Per-vertex skin label used by animation frame bases. */
  vertexBones: Uint8Array | null = null;
  ta!: Int32Array;
  tb!: Int32Array;
  tc!: Int32Array;
  colors!: Uint16Array;
  /** Render type: 0 smooth, 1 flat, 2 hidden, 3 black. */
  info: Int8Array | null = null;
  alpha: Uint8Array | null = null;
  textures: Int16Array | null = null;
  priorities: Int8Array | null = null;
  priority = 0;

  static decode(src: Uint8Array): Model {
    const m = new Model();
    if (src[src.length - 1] === 0xff && src[src.length - 2] === 0xff) m.decodeNew(src);
    else m.decodeOld(src);
    return m;
  }

  clone(): Model {
    const m = new Model();
    m.vertexCount = this.vertexCount;
    m.triangleCount = this.triangleCount;
    m.vx = this.vx.slice();
    m.vy = this.vy.slice();
    m.vz = this.vz.slice();
    m.vertexBones = this.vertexBones;
    m.ta = this.ta.slice();
    m.tb = this.tb.slice();
    m.tc = this.tc.slice();
    m.colors = this.colors.slice();
    m.info = this.info;
    m.alpha = this.alpha;
    m.textures = this.textures ? this.textures.slice() : null;
    m.priorities = this.priorities;
    m.priority = this.priority;
    return m;
  }

  private alloc(vertexCount: number, triangleCount: number) {
    this.vertexCount = vertexCount;
    this.triangleCount = triangleCount;
    this.vx = new Int32Array(vertexCount);
    this.vy = new Int32Array(vertexCount);
    this.vz = new Int32Array(vertexCount);
    this.ta = new Int32Array(triangleCount);
    this.tb = new Int32Array(triangleCount);
    this.tc = new Int32Array(triangleCount);
    this.colors = new Uint16Array(triangleCount);
  }

  private readVertices(flags: Reader, dx: Reader, dy: Reader, dz: Reader, bones: Reader | null) {
    let x = 0;
    let y = 0;
    let z = 0;
    for (let v = 0; v < this.vertexCount; v++) {
      const f = flags.g1();
      if (f & 1) x += dx.gsmart();
      if (f & 2) y += dy.gsmart();
      if (f & 4) z += dz.gsmart();
      this.vx[v] = x;
      this.vy[v] = y;
      this.vz[v] = z;
      if (bones) this.vertexBones![v] = bones.g1();
    }
  }

  private readTriangles(indices: Reader, types: Reader) {
    let a = 0;
    let b = 0;
    let c = 0;
    let last = 0;
    for (let t = 0; t < this.triangleCount; t++) {
      const type = types.g1();
      if (type === 1) {
        a = indices.gsmart() + last;
        b = indices.gsmart() + a;
        c = indices.gsmart() + b;
        last = c;
      } else if (type === 2) {
        b = c;
        c = indices.gsmart() + last;
        last = c;
      } else if (type === 3) {
        a = c;
        c = indices.gsmart() + last;
        last = c;
      } else if (type === 4) {
        const t0 = a;
        a = b;
        b = t0;
        c = indices.gsmart() + last;
        last = c;
      }
      this.ta[t] = a;
      this.tb[t] = b;
      this.tc[t] = c;
    }
  }

  private decodeNew(src: Uint8Array) {
    const h = new Reader(src);
    h.pos = src.length - 23;
    const vertexCount = h.g2();
    const triangleCount = h.g2();
    const texturedCount = h.g1();
    const hasInfo = (h.g1() & 1) === 1;
    const priority = h.g1();
    const hasAlpha = h.g1() === 1;
    const hasTriangleBones = h.g1() === 1;
    const hasTextures = h.g1() === 1;
    const hasVertexBones = h.g1() === 1;
    const dxLen = h.g2();
    const dyLen = h.g2();
    const dzLen = h.g2();
    const indexLen = h.g2();
    const texIndexLen = h.g2();

    const r = new Reader(src);
    let simple = 0;
    let complex = 0;
    let cube = 0;
    for (let i = 0; i < texturedCount; i++) {
      const type = r.g1b();
      if (type === 0) simple++;
      if (type >= 1 && type <= 3) complex++;
      if (type === 2) cube++;
    }

    let off = texturedCount + vertexCount;
    const infoOff = off;
    if (hasInfo) off += triangleCount;
    const typeOff = off;
    off += triangleCount;
    const prioOff = off;
    if (priority === 255) off += triangleCount;
    const triBonesOff = off;
    if (hasTriangleBones) off += triangleCount;
    const vertBonesOff = off;
    if (hasVertexBones) off += vertexCount;
    const alphaOff = off;
    if (hasAlpha) off += triangleCount;
    const indexOff = off;
    off += indexLen;
    const texOff = off;
    if (hasTextures) off += triangleCount * 2;
    const texIndexOff = off;
    off += texIndexLen;
    const colorOff = off;
    off += triangleCount * 2;
    const dxOff = off;
    off += dxLen;
    const dyOff = off;
    off += dyLen;
    const dzOff = off;
    void simple;
    void complex;
    void cube;

    this.alloc(vertexCount, triangleCount);
    if (hasVertexBones) this.vertexBones = new Uint8Array(vertexCount);
    const at = (o: number) => {
      const rr = new Reader(src);
      rr.pos = o;
      return rr;
    };
    this.readVertices(at(texturedCount), at(dxOff), at(dyOff), at(dzOff), hasVertexBones ? at(vertBonesOff) : null);

    if (hasInfo) this.info = new Int8Array(triangleCount);
    if (priority === 255) this.priorities = new Int8Array(triangleCount);
    else this.priority = priority;
    if (hasAlpha) this.alpha = new Uint8Array(triangleCount);
    if (hasTextures) this.textures = new Int16Array(triangleCount);
    const colors = at(colorOff);
    const info = at(infoOff);
    const prio = at(prioOff);
    const alpha = at(alphaOff);
    const tex = at(texOff);
    for (let t = 0; t < triangleCount; t++) {
      this.colors[t] = colors.g2();
      if (this.info) this.info[t] = info.g1b();
      if (this.priorities) this.priorities[t] = prio.g1b();
      if (this.alpha) this.alpha[t] = alpha.g1();
      if (this.textures) this.textures[t] = tex.g2() - 1;
    }
    void triBonesOff;
    this.readTriangles(at(indexOff), at(typeOff));
  }

  private decodeOld(src: Uint8Array) {
    const h = new Reader(src);
    h.pos = src.length - 18;
    const vertexCount = h.g2();
    const triangleCount = h.g2();
    const texturedCount = h.g1();
    const hasInfo = h.g1() === 1;
    const priority = h.g1();
    const hasAlpha = h.g1() === 1;
    const hasTriangleBones = h.g1() === 1;
    const hasVertexBones = h.g1() === 1;
    const dxLen = h.g2();
    const dyLen = h.g2();
    h.g2(); // dzLen
    const indexLen = h.g2();

    let off = vertexCount;
    const typeOff = off;
    off += triangleCount;
    const prioOff = off;
    if (priority === 255) off += triangleCount;
    const triBonesOff = off;
    if (hasTriangleBones) off += triangleCount;
    const infoOff = off;
    if (hasInfo) off += triangleCount;
    const vertBonesOff = off;
    if (hasVertexBones) off += vertexCount;
    const alphaOff = off;
    if (hasAlpha) off += triangleCount;
    const indexOff = off;
    off += indexLen;
    const colorOff = off;
    off += triangleCount * 2;
    off += texturedCount * 6;
    const dxOff = off;
    off += dxLen;
    const dyOff = off;
    off += dyLen;
    const dzOff = off;
    void triBonesOff;

    this.alloc(vertexCount, triangleCount);
    if (hasVertexBones) this.vertexBones = new Uint8Array(vertexCount);
    const at = (o: number) => {
      const rr = new Reader(src);
      rr.pos = o;
      return rr;
    };
    this.readVertices(at(0), at(dxOff), at(dyOff), at(dzOff), hasVertexBones ? at(vertBonesOff) : null);

    if (hasInfo) {
      this.info = new Int8Array(triangleCount);
      this.textures = new Int16Array(triangleCount).fill(-1);
    }
    if (priority === 255) this.priorities = new Int8Array(triangleCount);
    else this.priority = priority;
    if (hasAlpha) this.alpha = new Uint8Array(triangleCount);
    const colors = at(colorOff);
    const info = at(infoOff);
    const prio = at(prioOff);
    const alpha = at(alphaOff);
    for (let t = 0; t < triangleCount; t++) {
      this.colors[t] = colors.g2();
      if (hasInfo) {
        const f = info.g1();
        this.info![t] = f & 1;
        if (f & 2) {
          // old format: the color field holds a texture id
          this.textures![t] = (this.colors[t] << 16) >> 16;
          this.colors[t] = 127;
        }
      }
      if (this.priorities) this.priorities[t] = prio.g1b();
      if (this.alpha) this.alpha[t] = alpha.g1();
    }
    this.readTriangles(at(indexOff), at(typeOff));
  }

  // ---- transforms (same semantics as the client) ----
  rotate90() {
    for (let v = 0; v < this.vertexCount; v++) {
      const t = this.vx[v];
      this.vx[v] = this.vz[v];
      this.vz[v] = -t;
    }
  }
  rotate180() {
    for (let v = 0; v < this.vertexCount; v++) {
      this.vx[v] = -this.vx[v];
      this.vz[v] = -this.vz[v];
    }
  }
  rotate270() {
    for (let v = 0; v < this.vertexCount; v++) {
      const t = this.vz[v];
      this.vz[v] = this.vx[v];
      this.vx[v] = -t;
    }
  }
  /** 45 degree turn used by diagonal locs (client rotate256). */
  rotate45() {
    const sin = Math.trunc(65536 * Math.sin((256 * 2 * Math.PI) / 2048));
    const cos = Math.trunc(65536 * Math.cos((256 * 2 * Math.PI) / 2048));
    for (let v = 0; v < this.vertexCount; v++) {
      const x = (this.vz[v] * sin + this.vx[v] * cos) >> 16;
      this.vz[v] = (this.vz[v] * cos - this.vx[v] * sin) >> 16;
      this.vx[v] = x;
    }
  }
  mirrorZ() {
    for (let v = 0; v < this.vertexCount; v++) this.vz[v] = -this.vz[v];
    for (let t = 0; t < this.triangleCount; t++) {
      const a = this.ta[t];
      this.ta[t] = this.tc[t];
      this.tc[t] = a;
    }
  }
  translate(x: number, y: number, z: number) {
    for (let v = 0; v < this.vertexCount; v++) {
      this.vx[v] += x;
      this.vy[v] += y;
      this.vz[v] += z;
    }
  }
  resize(x: number, y: number, z: number) {
    for (let v = 0; v < this.vertexCount; v++) {
      this.vx[v] = Math.trunc((this.vx[v] * x) / 128);
      this.vy[v] = Math.trunc((this.vy[v] * y) / 128);
      this.vz[v] = Math.trunc((this.vz[v] * z) / 128);
    }
  }
  recolor(src: number, dst: number) {
    for (let t = 0; t < this.triangleCount; t++) if (this.colors[t] === src) this.colors[t] = dst;
  }
  retexture(src: number, dst: number) {
    if (!this.textures) return;
    for (let t = 0; t < this.triangleCount; t++) if (this.textures[t] === src) this.textures[t] = dst;
  }

  static merge(models: Model[]): Model {
    const out = new Model();
    const vc = models.reduce((n, m) => n + m.vertexCount, 0);
    const tc = models.reduce((n, m) => n + m.triangleCount, 0);
    out.alloc(vc, tc);
    const anyInfo = models.some((m) => m.info);
    const anyAlpha = models.some((m) => m.alpha);
    const anyTex = models.some((m) => m.textures);
    const anyBones = models.some((m) => m.vertexBones);
    if (anyInfo) out.info = new Int8Array(tc);
    if (anyAlpha) out.alpha = new Uint8Array(tc);
    if (anyTex) out.textures = new Int16Array(tc).fill(-1);
    if (anyBones) out.vertexBones = new Uint8Array(vc);
    let vo = 0;
    let to = 0;
    for (const m of models) {
      out.vx.set(m.vx, vo);
      out.vy.set(m.vy, vo);
      out.vz.set(m.vz, vo);
      if (m.vertexBones) out.vertexBones!.set(m.vertexBones, vo);
      for (let t = 0; t < m.triangleCount; t++) {
        out.ta[to + t] = m.ta[t] + vo;
        out.tb[to + t] = m.tb[t] + vo;
        out.tc[to + t] = m.tc[t] + vo;
      }
      out.colors.set(m.colors, to);
      if (m.info) out.info!.set(m.info, to);
      if (m.alpha) out.alpha!.set(m.alpha, to);
      if (m.textures) out.textures!.set(m.textures, to);
      vo += m.vertexCount;
      to += m.triangleCount;
    }
    return out;
  }
}
