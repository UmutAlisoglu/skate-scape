// Big-endian byte reader mirroring the rt4 client's Buffer (g1/g2/gsmart etc.).
export class Reader {
  pos = 0;
  constructor(public data: Uint8Array) {}

  get remaining() {
    return this.data.length - this.pos;
  }
  g1() {
    return this.data[this.pos++];
  }
  g1b() {
    return (this.data[this.pos++] << 24) >> 24;
  }
  g2() {
    const d = this.data;
    const v = (d[this.pos] << 8) | d[this.pos + 1];
    this.pos += 2;
    return v;
  }
  g2b() {
    return (this.g2() << 16) >> 16;
  }
  g3() {
    const d = this.data;
    const v = (d[this.pos] << 16) | (d[this.pos + 1] << 8) | d[this.pos + 2];
    this.pos += 3;
    return v;
  }
  g4() {
    const d = this.data;
    const v = (d[this.pos] << 24) | (d[this.pos + 1] << 16) | (d[this.pos + 2] << 8) | d[this.pos + 3];
    this.pos += 4;
    return v | 0;
  }
  // signed smart: -64..63 in one byte, -16384..16383 in two
  gsmart() {
    return this.data[this.pos] < 128 ? this.g1() - 64 : this.g2() - 0xc000;
  }
  // unsigned smart: 0..127 in one byte, 0..32767 in two
  gsmarts() {
    return this.data[this.pos] < 128 ? this.g1() : this.g2() - 0x8000;
  }
  gVarSmart() {
    let value = this.gsmarts();
    let acc = 0;
    while (value === 32767) {
      acc += 32767;
      value = this.gsmarts();
    }
    return acc + value;
  }
  // null-terminated cp1252-ish string
  gjstr() {
    const start = this.pos;
    while (this.data[this.pos++] !== 0);
    let s = '';
    for (let i = start; i < this.pos - 1; i++) s += String.fromCharCode(this.data[i]);
    return s;
  }
  bytes(n: number) {
    const out = this.data.subarray(this.pos, this.pos + n);
    this.pos += n;
    return out;
  }
}
