package rt4;

/** Minimal big-endian reader used by the client's texture ops (stands in for the full client Buffer). */
public final class Buffer {
	public byte[] data;
	public int offset;

	public Buffer(byte[] data) {
		this.data = data;
	}

	public int g1() {
		return this.data[this.offset++] & 0xFF;
	}

	public byte g1b() {
		return this.data[this.offset++];
	}

	public int g2() {
		this.offset += 2;
		return ((this.data[this.offset - 2] & 0xFF) << 8) | (this.data[this.offset - 1] & 0xFF);
	}

	public int g2b() {
		int value = this.g2();
		return value > 32767 ? value - 65536 : value;
	}

	public int g3() {
		this.offset += 3;
		return ((this.data[this.offset - 3] & 0xFF) << 16) | ((this.data[this.offset - 2] & 0xFF) << 8) | (this.data[this.offset - 1] & 0xFF);
	}

	public int g4() {
		this.offset += 4;
		return ((this.data[this.offset - 4] & 0xFF) << 24) | ((this.data[this.offset - 3] & 0xFF) << 16) | ((this.data[this.offset - 2] & 0xFF) << 8) | (this.data[this.offset - 1] & 0xFF);
	}
}
