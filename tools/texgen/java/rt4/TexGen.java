package rt4;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.HashMap;
import java.util.Map;

/**
 * Renders every cache texture with the client's own procedural texture graph.
 * Usage: java rt4.TexGen <dumpDir> <outDir> <size>
 *   dumpDir/textures/<id>.bin  archive 9 texture definitions
 *   dumpDir/sprites/<id>.bin   archive 8 sprites (file 0 of each group)
 * Writes outDir/<id>.rgba (size*size RGBA, as uploaded by the GL client) and outDir/flags.txt.
 */
public final class TexGen implements TextureProvider {
	private final Path textureDir;
	private final Js5 sprites;
	private final int size;
	private final Map<Integer, Texture> textures = new HashMap<>();
	private final Map<Integer, Boolean> mirrored = new HashMap<>();

	private TexGen(Path dump, int size) {
		this.textureDir = dump.resolve("textures");
		this.sprites = new Js5(dump.resolve("sprites"));
		this.size = size;
	}

	public static void main(String[] args) throws IOException {
		Path dump = Paths.get(args[0]);
		Path out = Paths.get(args[1]);
		int size = args.length > 2 ? Integer.parseInt(args[2]) : 128;
		Files.createDirectories(out);
		TexGen gen = new TexGen(dump, size);
		StringBuilder flags = new StringBuilder();
		int ok = 0;
		int failed = 0;
		try (var files = Files.list(gen.textureDir)) {
			for (Path file : (Iterable<Path>) files::iterator) {
				String name = file.getFileName().toString();
				int id = Integer.parseInt(name.substring(0, name.length() - 4));
				try {
					byte[] def = Files.readAllBytes(file);
					Buffer buf = new Buffer(def);
					Texture texture = new Texture(buf);
					boolean blurred = buf.g1() == 1;
					boolean mirror = buf.g1() == 1;
					boolean wrapS = buf.g1() == 1;
					boolean wrapT = buf.g1() == 1;
					int blend = buf.g1() & 0x3;
					int scrollU = buf.g1b();
					int scrollV = buf.g1b();
					gen.textures.put(id, texture);
					gen.mirrored.put(id, mirror);
					byte[] rgba = texture.generateRgbaBytes(size, size, mirror, gen, 0.7D, gen.sprites);
					Files.write(out.resolve(id + ".rgba"), rgba);
					flags.append(id).append(' ').append(blurred ? 1 : 0).append(' ').append(mirror ? 1 : 0).append(' ')
						.append(wrapS ? 1 : 0).append(' ').append(wrapT ? 1 : 0).append(' ').append(blend).append(' ')
						.append(scrollU).append(' ').append(scrollV).append('\n');
					ok++;
				} catch (RuntimeException e) {
					System.err.println("texture " + id + ": " + e);
					failed++;
				}
			}
		}
		Files.write(out.resolve("flags.txt"), flags.toString().getBytes());
		System.out.println("Rendered " + ok + " textures at " + size + "px, " + failed + " failed");
	}

	private Texture texture(int id) {
		Texture texture = this.textures.get(id);
		if (texture != null) {
			return texture;
		}
		try {
			Buffer buf = new Buffer(Files.readAllBytes(this.textureDir.resolve(id + ".bin")));
			texture = new Texture(buf);
			buf.g1();
			this.mirrored.put(id, buf.g1() == 1);
			this.textures.put(id, texture);
			return texture;
		} catch (IOException e) {
			return null;
		}
	}

	// ---- TextureProvider: only what nested texture ops need ----

	@Override
	public int[] getPixels(int textureId) {
		Texture texture = this.texture(textureId);
		// Matches GlTexture.getPixels: ARGB at full brightness, transposed when mirrored.
		return texture == null ? null : texture.generateArgbPixels(this.size, this.mirrored.get(textureId), this.size, 1.0D, this.sprites, this, false);
	}

	@Override
	public boolean isLowDetail(int textureId) {
		return this.size == 64;
	}

	@Override
	public boolean isTextureLoaded(int textureId) {
		return this.texture(textureId) != null;
	}

	@Override
	public boolean isOpaque(int textureId) {
		return true;
	}

	@Override
	public void bindTexture(int textureId) {
	}

	@Override
	public int getAnimationType(int textureId) {
		return 0;
	}

	@Override
	public int getTextureSpeed(int textureId) {
		return 0;
	}

	@Override
	public boolean isTextureFlipped(int textureId) {
		return false;
	}

	@Override
	public int[] getAnimatedPixels(int textureId, float progress) {
		return this.getPixels(textureId);
	}

	@Override
	public int getAverageColor(int textureId) {
		return 0;
	}

	@Override
	public boolean isTextureRepeating(int textureId) {
		return true;
	}

	@Override
	public int getMaterialType(int textureId) {
		return 0;
	}

	@Override
	public int getTextureBrightness(int textureId) {
		return 0;
	}
}
