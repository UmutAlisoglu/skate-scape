package rt4;

/** Just the sprite fields the texture ops read; the client's full class also handles drawing. */
public final class SoftwareSprite {
	/** Full canvas size. */
	public int innerWidth;
	public int innerHeight;
	public int xOffset;
	public int yOffset;
	/** Size of the stored pixel block. */
	public int width;
	public int height;
	public int[] pixels;

	public SoftwareSprite(int innerWidth, int innerHeight, int xOffset, int yOffset, int width, int height, int[] pixels) {
		this.innerWidth = innerWidth;
		this.innerHeight = innerHeight;
		this.xOffset = xOffset;
		this.yOffset = yOffset;
		this.width = width;
		this.height = height;
		this.pixels = pixels;
	}

	/** Expands the stored block onto the full canvas. */
	public void trim() {
		if (this.width == this.innerWidth && this.height == this.innerHeight) {
			return;
		}
		int[] full = new int[this.innerWidth * this.innerHeight];
		for (int y = 0; y < this.height; y++) {
			System.arraycopy(this.pixels, y * this.width, full, (y + this.yOffset) * this.innerWidth + this.xOffset, this.width);
		}
		this.pixels = full;
		this.width = this.innerWidth;
		this.height = this.innerHeight;
		this.xOffset = 0;
		this.yOffset = 0;
	}
}
