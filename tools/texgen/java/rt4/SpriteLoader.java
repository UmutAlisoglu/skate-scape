package rt4;

/** Decodes the first frame of an indexed cache sprite into RGB pixels (palette index 0 = transparent black). */
public final class SpriteLoader {
	private SpriteLoader() {
	}

	public static SoftwareSprite loadSoftwareSpriteAutoDetect(Js5 archive, int group) {
		byte[] data = archive.fetchFile(group);
		return data == null ? null : decode(data);
	}

	public static SoftwareSprite loadSoftwareSprite(int file, Js5 archive, int group) {
		byte[] data = archive.fetchFile(file, group);
		return data == null ? null : decode(data);
	}

	static SoftwareSprite decode(byte[] data) {
		Buffer b = new Buffer(data);
		b.offset = data.length - 2;
		int frames = b.g2();
		b.offset = data.length - frames * 8 - 7;
		int canvasWidth = b.g2();
		int canvasHeight = b.g2();
		int paletteSize = b.g1() + 1;
		int xOffset = b.g2();
		b.offset += (frames - 1) * 2;
		int yOffset = b.g2();
		b.offset += (frames - 1) * 2;
		int width = b.g2();
		b.offset += (frames - 1) * 2;
		int height = b.g2();
		b.offset = data.length - frames * 8 - 7 - (paletteSize - 1) * 3;
		int[] palette = new int[paletteSize];
		for (int i = 1; i < paletteSize; i++) {
			int color = b.g3();
			palette[i] = color == 0 ? 1 : color;
		}
		b.offset = 0;
		int flags = b.g1();
		int count = width * height;
		int[] pixels = new int[count];
		if ((flags & 1) == 0) {
			for (int i = 0; i < count; i++) {
				pixels[i] = palette[b.g1()];
			}
		} else {
			for (int x = 0; x < width; x++) {
				for (int y = 0; y < height; y++) {
					pixels[x + y * width] = palette[b.g1()];
				}
			}
		}
		return new SoftwareSprite(canvasWidth, canvasHeight, xOffset, yOffset, width, height, pixels);
	}
}
