package rt4;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;

/** Sprite archive backed by files dumped from the cache: <dir>/<group>.bin holds file 0 of each group. */
public final class Js5 {
	private final Path dir;

	public Js5(Path dir) {
		this.dir = dir;
	}

	public byte[] fetchFile(int group) {
		try {
			Path file = this.dir.resolve(group + ".bin");
			return Files.exists(file) ? Files.readAllBytes(file) : null;
		} catch (IOException e) {
			return null;
		}
	}

	public byte[] fetchFile(int file, int group) {
		return file == 0 ? this.fetchFile(group) : null;
	}

	public boolean isFileReady(int group) {
		return Files.exists(this.dir.resolve(group + ".bin"));
	}

	public boolean isFileReady(int file, int group) {
		return file == 0 && this.isFileReady(group);
	}
}
