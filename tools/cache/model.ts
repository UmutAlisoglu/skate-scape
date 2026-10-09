// 530 model decoder (port of rt4 RawModel.decodeNew / decodeOld) including texture spaces, plus the
// HD client's per-face texture coordinates (GlModel) and smooth vertex normals (RawModel.calculateNormals).
import { Reader } from './reader.ts';

/** Per textured-face "texture space": type 0 maps by three vertices (P, M, N); 1-3 are cylinder, cube, sphere. */
export interface TextureSpaces {
  count: number;
  types: Int8Array;
  p: Int16Array;
  m: Int16Array;
  n: Int16Array;
  scaleX: Int16Array;
  scaleY: Int16Array;
  scaleZ: Int16Array;
  rotation: Uint8Array;
  direction: Int8Array;
  speed: Int8Array;
  transU: Int8Array;
  transV: Int8Array;
}

function allocSpaces(count: number): TextureSpaces {
  return {
    count, types: new Int8Array(count), p: new Int16Array(count), m: new Int16Array(count), n: new Int16Array(count),
    scaleX: new Int16Array(count), scaleY: new Int16Array(count), scaleZ: new Int16Array(count), rotation: new Uint8Array(count),
    direction: new Int8Array(count), speed: new Int8Array(count), transU: new Int8Array(count), transV: new Int8Array(count),
  };
}

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
  /** Per triangle index into `spaces`, -1 = map the face onto its own vertices. */
  texIndex: Int8Array | null = null;
  spaces: TextureSpaces | null = null;
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
    m.texIndex = this.texIndex;
    m.spaces = this.spaces;
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

    const spaces = texturedCount > 0 ? allocSpaces(texturedCount) : null;
    const r = new Reader(src);
    let simple = 0;
    let complex = 0;
    let cube = 0;
    for (let i = 0; i < texturedCount; i++) {
      const type = (spaces!.types[i] = r.g1b());
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
    off += dzLen;
    const simplePmnOff = off;
    off += simple * 6;
    const complexPmnOff = off;
    off += complex * 6;
    const complexScaleOff = off;
    off += complex * 6;
    const rotationOff = off;
    off += complex;
    const directionOff = off;
    off += complex;
    const speedOff = off;
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
    if (hasTextures && texturedCount > 0) this.texIndex = new Int8Array(triangleCount);
    const colors = at(colorOff);
    const info = at(infoOff);
    const prio = at(prioOff);
    const alpha = at(alphaOff);
    const tex = at(texOff);
    const texIndex = at(texIndexOff);
    for (let t = 0; t < triangleCount; t++) {
      this.colors[t] = colors.g2();
      if (this.info) this.info[t] = info.g1b();
      if (this.priorities) this.priorities[t] = prio.g1b();
      if (this.alpha) this.alpha[t] = alpha.g1();
      if (this.textures) this.textures[t] = tex.g2() - 1;
      if (this.texIndex) this.texIndex[t] = this.textures![t] === -1 ? -1 : texIndex.g1() - 1;
    }
    this.readTriangles(at(indexOff), at(typeOff));

    if (spaces) {
      const simplePmn = at(simplePmnOff);
      const complexPmn = at(complexPmnOff);
      const scale = at(complexScaleOff);
      const rotation = at(rotationOff);
      const direction = at(directionOff);
      const speed = at(speedOff);
      for (let t = 0; t < texturedCount; t++) {
        const type = spaces.types[t] & 0xff;
        const pmn = type === 0 ? simplePmn : complexPmn;
        spaces.p[t] = pmn.g2();
        spaces.m[t] = pmn.g2();
        spaces.n[t] = pmn.g2();
        if (type >= 1 && type <= 3) {
          spaces.scaleX[t] = scale.g2();
          spaces.scaleY[t] = scale.g2();
          spaces.scaleZ[t] = scale.g2();
          spaces.rotation[t] = rotation.g1();
          spaces.direction[t] = direction.g1b();
          spaces.speed[t] = speed.g1b();
          if (type === 2) {
            spaces.transU[t] = speed.g1b();
            spaces.transV[t] = speed.g1b();
          }
        }
      }
      this.spaces = spaces;
    }
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
    const pmnOff = off;
    off += texturedCount * 6;
    const dxOff = off;
    off += dxLen;
    const dyOff = off;
    off += dyLen;
    const dzOff = off;

    this.alloc(vertexCount, triangleCount);
    if (hasVertexBones) this.vertexBones = new Uint8Array(vertexCount);
    const at = (o: number) => {
      const rr = new Reader(src);
      rr.pos = o;
      return rr;
    };
    this.readVertices(at(0), at(dxOff), at(dyOff), at(dzOff), hasVertexBones ? at(vertBonesOff) : null);

    let texIndex: Int8Array | null = null;
    if (hasInfo) {
      this.info = new Int8Array(triangleCount);
      this.textures = new Int16Array(triangleCount).fill(-1);
      texIndex = new Int8Array(triangleCount).fill(-1);
    }
    if (priority === 255) this.priorities = new Int8Array(triangleCount);
    else this.priority = priority;
    if (hasAlpha) this.alpha = new Uint8Array(triangleCount);
    const colors = at(colorOff);
    const info = at(infoOff);
    const prio = at(prioOff);
    const alpha = at(alphaOff);
    let anyTexture = false;
    for (let t = 0; t < triangleCount; t++) {
      this.colors[t] = colors.g2();
      if (hasInfo) {
        const f = info.g1();
        this.info![t] = f & 1;
        if (f & 2) {
          // old format: the color field holds a texture id
          texIndex![t] = f >> 2;
          this.textures![t] = (this.colors[t] << 16) >> 16;
          this.colors[t] = 127;
          if (this.textures![t] !== -1) anyTexture = true;
        }
      }
      if (this.priorities) this.priorities[t] = prio.g1b();
      if (this.alpha) this.alpha[t] = alpha.g1();
    }
    this.readTriangles(at(indexOff), at(typeOff));

    if (texturedCount > 0) {
      const spaces = allocSpaces(texturedCount);
      const pmn = at(pmnOff);
      for (let t = 0; t < texturedCount; t++) {
        spaces.p[t] = pmn.g2();
        spaces.m[t] = pmn.g2();
        spaces.n[t] = pmn.g2();
      }
      this.spaces = spaces;
    }
    if (texIndex) {
      // A space that is exactly the face's own vertices is the same as no space.
      let faceSpaces = false;
      for (let t = 0; t < triangleCount; t++) {
        const i = texIndex[t] & 0xff;
        if (i === 255) continue;
        const s = this.spaces;
        if (s && i < s.count && (s.p[i] & 0xffff) === this.ta[t] && (s.m[i] & 0xffff) === this.tb[t] && (s.n[i] & 0xffff) === this.tc[t]) texIndex[t] = -1;
        else faceSpaces = true;
      }
      this.texIndex = faceSpaces ? texIndex : null;
    }
    if (!anyTexture) this.textures = null;
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
    const sc = models.reduce((n, m) => n + (m.spaces?.count ?? 0), 0);
    out.alloc(vc, tc);
    if (models.some((m) => m.info)) out.info = new Int8Array(tc);
    if (models.some((m) => m.alpha)) out.alpha = new Uint8Array(tc);
    if (models.some((m) => m.textures)) out.textures = new Int16Array(tc).fill(-1);
    if (models.some((m) => m.texIndex)) out.texIndex = new Int8Array(tc).fill(-1);
    if (models.some((m) => m.vertexBones)) out.vertexBones = new Uint8Array(vc);
    if (sc > 0) out.spaces = allocSpaces(sc);
    let vo = 0;
    let to = 0;
    let so = 0;
    for (const m of models) {
      out.vx.set(m.vx, vo);
      out.vy.set(m.vy, vo);
      out.vz.set(m.vz, vo);
      if (m.vertexBones) out.vertexBones!.set(m.vertexBones, vo);
      for (let t = 0; t < m.triangleCount; t++) {
        out.ta[to + t] = m.ta[t] + vo;
        out.tb[to + t] = m.tb[t] + vo;
        out.tc[to + t] = m.tc[t] + vo;
        if (m.texIndex && m.texIndex[t] !== -1) out.texIndex![to + t] = (m.texIndex[t] & 0xff) + so;
      }
      out.colors.set(m.colors, to);
      if (m.info) out.info!.set(m.info, to);
      if (m.alpha) out.alpha!.set(m.alpha, to);
      if (m.textures) out.textures!.set(m.textures, to);
      const s = m.spaces;
      if (s) {
        const d = out.spaces!;
        for (let i = 0; i < s.count; i++) {
          const k = so + i;
          d.types[k] = s.types[i];
          const vertexSpace = s.types[i] === 0;
          d.p[k] = vertexSpace ? (s.p[i] & 0xffff) + vo : s.p[i];
          d.m[k] = vertexSpace ? (s.m[i] & 0xffff) + vo : s.m[i];
          d.n[k] = vertexSpace ? (s.n[i] & 0xffff) + vo : s.n[i];
          d.scaleX[k] = s.scaleX[i];
          d.scaleY[k] = s.scaleY[i];
          d.scaleZ[k] = s.scaleZ[i];
          d.rotation[k] = s.rotation[i];
          d.direction[k] = s.direction[i];
          d.speed[k] = s.speed[i];
          d.transU[k] = s.transU[i];
          d.transV[k] = s.transV[i];
        }
        so += s.count;
      }
      vo += m.vertexCount;
      to += m.triangleCount;
    }
    return out;
  }

  // ---- shading data for the HD-style renderer ----

  /** Smooth vertex normals summed from unit face normals of smooth (type 0) faces, in model space. */
  vertexNormals(): Float32Array {
    const out = new Float32Array(this.vertexCount * 3);
    for (let t = 0; t < this.triangleCount; t++) {
      if (this.info && this.info[t] !== 0) continue;
      const n = this.faceNormal(t);
      for (const v of [this.ta[t], this.tb[t], this.tc[t]]) {
        out[v * 3] += n[0];
        out[v * 3 + 1] += n[1];
        out[v * 3 + 2] += n[2];
      }
    }
    for (let v = 0; v < this.vertexCount; v++) {
      const l = Math.hypot(out[v * 3], out[v * 3 + 1], out[v * 3 + 2]);
      if (l > 0) for (let k = 0; k < 3; k++) out[v * 3 + k] /= l;
    }
    return out;
  }

  faceNormal(t: number): [number, number, number] {
    const a = this.ta[t], b = this.tb[t], c = this.tc[t];
    const abx = this.vx[b] - this.vx[a], aby = this.vy[b] - this.vy[a], abz = this.vz[b] - this.vz[a];
    const acx = this.vx[c] - this.vx[a], acy = this.vy[c] - this.vy[a], acz = this.vz[c] - this.vz[a];
    const nx = aby * acz - acy * abz, ny = abz * acx - acz * abx, nz = abx * acy - acx * aby;
    const l = Math.hypot(nx, ny, nz) || 1;
    return [nx / l, ny / l, nz / l];
  }

  /** Texture coordinates per face corner (u,v for a, b, c), port of the GlModel constructor. */
  uvs(): Float32Array {
    const out = new Float32Array(this.triangleCount * 6);
    if (!this.textures) return out;
    const s = this.spaces;
    // Bounding-box centers and transform matrices for cylinder / cube / sphere spaces.
    let center: Int32Array | null = null;
    let matrices: (Float32Array | null)[] = [];
    if (s && this.texIndex) {
      const min = new Int32Array(s.count * 3).fill(0x7fffffff);
      const max = new Int32Array(s.count * 3).fill(-0x7fffffff);
      for (let t = 0; t < this.triangleCount; t++) {
        const i = this.texIndex[t];
        if (i === -1) continue;
        const k = i & 0xff;
        for (const v of [this.ta[t], this.tb[t], this.tc[t]]) {
          const xyz = [this.vx[v], this.vy[v], this.vz[v]];
          for (let a = 0; a < 3; a++) {
            if (xyz[a] < min[k * 3 + a]) min[k * 3 + a] = xyz[a];
            if (xyz[a] > max[k * 3 + a]) max[k * 3 + a] = xyz[a];
          }
        }
      }
      center = new Int32Array(s.count * 3);
      matrices = new Array(s.count).fill(null);
      for (let k = 0; k < s.count; k++) {
        const type = s.types[k];
        if (type <= 0) continue;
        for (let a = 0; a < 3; a++) center[k * 3 + a] = Math.trunc((min[k * 3 + a] + max[k * 3 + a]) / 2);
        let su: number, sw: number, sv: number;
        if (type === 1) {
          const raw = s.scaleX[k];
          if (raw === 0) su = sv = 1;
          else if (raw > 0) { su = 1; sv = raw / 1024; }
          else { sv = 1; su = -raw / 1024; }
          sw = 64 / (s.scaleY[k] & 0xffff);
        } else if (type === 2) {
          su = 64 / (s.scaleX[k] & 0xffff);
          sw = 64 / (s.scaleY[k] & 0xffff);
          sv = 64 / (s.scaleZ[k] & 0xffff);
        } else {
          su = s.scaleX[k] / 1024;
          sw = s.scaleY[k] / 1024;
          sv = s.scaleZ[k] / 1024;
        }
        matrices[k] = textureMatrix(s.p[k], s.m[k], s.n[k], s.rotation[k], su, sw, sv);
      }
    }
    for (let t = 0; t < this.triangleCount; t++) {
      if (this.textures[t] === -1) continue;
      const o = t * 6;
      const idx = this.texIndex ? this.texIndex[t] : -1;
      if (idx === -1 || !s) {
        out.set([0, 1, 1, 1, 0, 0], o);
        continue;
      }
      const k = idx & 0xff;
      const type = s.types[k];
      const verts = [this.ta[t], this.tb[t], this.tc[t]];
      if (type === 0) {
        const P = s.p[k] & 0xffff, M = s.m[k] & 0xffff, N = s.n[k] & 0xffff;
        const px = this.vx[P], py = this.vy[P], pz = this.vz[P];
        const eax = this.vx[M] - px, eay = this.vy[M] - py, eaz = this.vz[M] - pz;
        const ebx = this.vx[N] - px, eby = this.vy[N] - py, ebz = this.vz[N] - pz;
        const cx = eay * ebz - eaz * eby, cy = eaz * ebx - eax * ebz, cz = eax * eby - eay * ebx;
        const r1x = eby * cz - ebz * cy, r1y = ebz * cx - ebx * cz, r1z = ebx * cy - eby * cx;
        const d1 = 1 / (r1x * eax + r1y * eay + r1z * eaz);
        const r2x = eay * cz - eaz * cy, r2y = eaz * cx - eax * cz, r2z = eax * cy - eay * cx;
        const d2 = 1 / (r2x * ebx + r2y * eby + r2z * ebz);
        verts.forEach((v, i) => {
          const dx = this.vx[v] - px, dy = this.vy[v] - py, dz = this.vz[v] - pz;
          out[o + i * 2] = (r1x * dx + r1y * dy + r1z * dz) * d1;
          out[o + i * 2 + 1] = (r2x * dx + r2y * dy + r2z * dz) * d2;
        });
        if (!Number.isFinite(out[o]) || !Number.isFinite(out[o + 1])) out.set([0, 1, 1, 1, 0, 0], o);
        continue;
      }
      const matrix = matrices[k];
      if (!matrix || !center) continue;
      const cx = center[k * 3], cy = center[k * 3 + 1], cz = center[k * 3 + 2];
      const direction = s.direction[k];
      const speed = s.speed[k] / 256;
      if (type === 1) {
        const scale = (s.scaleZ[k] & 0xffff) / 1024;
        verts.forEach((v, i) => {
          const [u, w] = cylindricalUV(this.vx[v] - cx, this.vy[v] - cy, this.vz[v] - cz, matrix, scale, direction, speed);
          out[o + i * 2] = u;
          out[o + i * 2 + 1] = w;
        });
        wrapSeam(out, o, (direction & 1) === 0, scale);
      } else if (type === 2) {
        const tu = s.transU[k] / 256, tv = s.transV[k] / 256;
        const [a, b, c] = verts;
        const abx = this.vx[b] - this.vx[a], aby = this.vy[b] - this.vy[a], abz = this.vz[b] - this.vz[a];
        const acx = this.vx[c] - this.vx[a], acy = this.vy[c] - this.vy[a], acz = this.vz[c] - this.vz[a];
        const nx = aby * acz - acy * abz, ny = abz * acx - acz * abx, nz = abx * acy - acx * aby;
        const fx = 64 / (s.scaleX[k] & 0xffff), fy = 64 / (s.scaleY[k] & 0xffff), fz = 64 / (s.scaleZ[k] & 0xffff);
        const axis = dominantAxis(
          (nx * matrix[0] + ny * matrix[1] + nz * matrix[2]) / fx,
          (nx * matrix[3] + ny * matrix[4] + nz * matrix[5]) / fy,
          (nx * matrix[6] + ny * matrix[7] + nz * matrix[8]) / fz,
        );
        verts.forEach((v, i) => {
          const [u, w] = planarUV(this.vx[v] - cx, this.vy[v] - cy, this.vz[v] - cz, axis, matrix, direction, speed, tu, tv);
          out[o + i * 2] = u;
          out[o + i * 2 + 1] = w;
        });
      } else if (type === 3) {
        verts.forEach((v, i) => {
          const [u, w] = sphericalUV(this.vx[v] - cx, this.vy[v] - cy, this.vz[v] - cz, matrix, direction, speed);
          out[o + i * 2] = u;
          out[o + i * 2 + 1] = w;
        });
        wrapSeam(out, o, (direction & 1) === 0, 1);
      }
    }
    // Zero-scale spaces divide by zero in the client too; the GPU then samples a single texel.
    for (let i = 0; i < out.length; i++) if (!Number.isFinite(out[i])) out[i] = 0;
    return out;
  }
}

function textureMatrix(faceP: number, faceM: number, faceN: number, rotation: number, sx: number, sy: number, sz: number): Float32Array {
  const cos = Math.cos(rotation * 0.024543693), sin = Math.sin(rotation * 0.024543693);
  const yaw = [cos, 0, sin, 0, 1, 0, -sin, 0, cos];
  let result: number[];
  const ny = faceM / 32767;
  const magnitude = Math.sqrt(faceP * faceP + faceN * faceN);
  if (magnitude === 0 && ny === 0) {
    result = yaw;
  } else {
    let nz = 1, nx = 0;
    if (magnitude !== 0) {
      nz = -faceN / magnitude;
      nx = faceP / magnitude;
    }
    const sinTilt = -Math.sqrt(1 - ny * ny), oneMinusCos = 1 - ny;
    const tilt = [
      ny + nz * nz * oneMinusCos, nx * sinTilt, nx * nz * oneMinusCos,
      -nx * sinTilt, ny, nz * sinTilt,
      nz * nx * oneMinusCos, -nz * sinTilt, ny + nx * nx * oneMinusCos,
    ];
    result = new Array(9);
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) result[r * 3 + c] = yaw[r * 3] * tilt[c] + yaw[r * 3 + 1] * tilt[3 + c] + yaw[r * 3 + 2] * tilt[6 + c];
  }
  const m = Float32Array.from(result);
  for (let i = 0; i < 3; i++) {
    m[i] *= sx;
    m[3 + i] *= sy;
    m[6 + i] *= sz;
  }
  return m;
}

function transformed(dx: number, dy: number, dz: number, m: Float32Array) {
  return [dx * m[0] + dy * m[1] + dz * m[2], dx * m[3] + dy * m[4] + dz * m[5], dx * m[6] + dy * m[7] + dz * m[8]];
}

function orient(u: number, v: number, direction: number): [number, number] {
  if (direction === 1) return [-v, u];
  if (direction === 2) return [-u, -v];
  if (direction === 3) return [v, -u];
  return [u, v];
}

function cylindricalUV(dx: number, dy: number, dz: number, m: Float32Array, scale: number, direction: number, speed: number) {
  const [tx, ty, tz] = transformed(dx, dy, dz, m);
  let u = Math.atan2(tx, tz) / 6.2831855 + 0.5;
  if (scale !== 1) u *= scale;
  return orient(u, ty + speed + 0.5, direction);
}

function sphericalUV(dx: number, dy: number, dz: number, m: Float32Array, direction: number, speed: number) {
  const [tx, ty, tz] = transformed(dx, dy, dz, m);
  const magnitude = Math.sqrt(tx * tx + ty * ty + tz * tz) || 1;
  const u = Math.atan2(tx, tz) / 6.2831855 + 0.5;
  const v = Math.asin(ty / magnitude) / Math.PI + speed + 0.5;
  return orient(u, v, direction);
}

function planarUV(dx: number, dy: number, dz: number, axis: number, m: Float32Array, direction: number, speed: number, tu: number, tv: number) {
  const [tx, ty, tz] = transformed(dx, dy, dz, m);
  let u: number, v: number;
  if (axis === 0) { u = tx + speed + 0.5; v = tv + 0.5 - tz; }
  else if (axis === 1) { u = tx + speed + 0.5; v = tz + tv + 0.5; }
  else if (axis === 2) { u = speed + 0.5 - tx; v = tu + 0.5 - ty; }
  else if (axis === 3) { u = tx + speed + 0.5; v = tu + 0.5 - ty; }
  else if (axis === 4) { u = tz + tv + 0.5; v = tu + 0.5 - ty; }
  else { u = tv + 0.5 - tz; v = tu + 0.5 - ty; }
  return orient(u, v, direction);
}

function dominantAxis(x: number, y: number, z: number) {
  const ax = Math.abs(x), ay = Math.abs(y), az = Math.abs(z);
  if (ay > ax && ay > az) return y > 0 ? 0 : 1;
  if (az > ax && az > ay) return z > 0 ? 2 : 3;
  return x > 0 ? 4 : 5;
}

/** Keeps a wrapped (cylinder/sphere) face from spanning the whole texture across the seam. */
function wrapSeam(out: Float32Array, o: number, alongU: boolean, period: number) {
  const k = alongU ? 0 : 1;
  const half = period / 2;
  for (const i of [1, 2]) {
    const d = out[o + i * 2 + k] - out[o + k];
    if (d > half) out[o + i * 2 + k] -= period;
    else if (d < -half) out[o + i * 2 + k] += period;
  }
}
