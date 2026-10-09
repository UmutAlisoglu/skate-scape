// Packs the exported world soups into compact, indexed render chunks on a 16-tile grid.
// Usage: npm run export:render [-- <area>]   (after export:world)
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { encodeRenderChunk, type RenderChunkRecord, type RenderManifest } from '../src/shared/render-chunk.ts';

const area = process.argv[2] ?? 'lumbridge';
if (!/^[a-z0-9_-]+$/i.test(area)) throw new Error('Invalid area name');
const base = `public/world/${area}`, directory = `${base}/render`, CELL = 16;
rmSync(directory, { recursive: true, force: true });
mkdirSync(directory, { recursive: true });
const chunks: RenderChunkRecord[] = [];

for (const name of ['terrain', 'locs']) {
  const data = readFileSync(`${base}/${name}.bin`), count = data.readUInt32LE(0);
  if (data.length !== 4 + count * 22) throw new Error('Invalid world soup');
  const material = readFileSync(`${base}/${name}.materials.bin`);
  if (material.length !== count * 2) throw new Error('Invalid material reference count');
  const shade = readFileSync(`${base}/${name}.shade.bin`);
  if (shade.readUInt32LE(0) !== count || shade.length !== 4 + count * 42) throw new Error('Invalid shading data. Run npm run export:world.');
  const pos = new Int16Array(data.buffer, data.byteOffset + 4, count * 9), col = new Uint8Array(data.buffer, data.byteOffset + 4 + count * 18, count * 4);
  const shadeCopy = new Uint8Array(shade.length);
  shadeCopy.set(shade);
  const uv = new Float32Array(shadeCopy.buffer, 4, count * 6);
  const rgb = new Uint8Array(shadeCopy.buffer, 4 + count * 24, count * 9);
  const nor = new Int8Array(shadeCopy.buffer, 4 + count * 33, count * 9);
  const groups = new Map<string, number[]>();
  for (let t = 0; t < count; t++) {
    const p = t * 9, x = Math.floor((pos[p] + pos[p + 3] + pos[p + 6]) / (384 * CELL)), z = Math.floor((pos[p + 2] + pos[p + 5] + pos[p + 8]) / (384 * CELL));
    const key = `${x}_${z}_${col[t * 4 + 3] === 255 ? 'opaque' : 'translucent'}`;
    let ids = groups.get(key);
    if (!ids) groups.set(key, (ids = []));
    ids.push(t);
  }
  let completed = 0;
  for (const [key, ids] of groups) {
    const P: number[] = [], N: number[] = [], C: number[] = [], S: number[] = [], U: number[] = [], I: number[] = [], lookup = new Map<string, number>();
    const bounds: [number, number, number, number, number, number] = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
    for (const t of ids) {
      const surface = material.readUInt16LE(t * 2), alpha = col[t * 4 + 3];
      for (let v = 0; v < 3; v++) {
        const c = t * 3 + v;
        const x = pos[c * 3], y = pos[c * 3 + 1], z = pos[c * 3 + 2];
        const u = surface ? uv[c * 2] : 0, w = surface ? uv[c * 2 + 1] : 0;
        const vertexKey = `${x},${y},${z},${nor[c * 3]},${nor[c * 3 + 1]},${nor[c * 3 + 2]},${rgb[c * 3]},${rgb[c * 3 + 1]},${rgb[c * 3 + 2]},${alpha},${surface},${u},${w}`;
        let index = lookup.get(vertexKey);
        if (index === undefined) {
          index = P.length / 3;
          lookup.set(vertexKey, index);
          P.push(x, y, z);
          N.push(nor[c * 3], nor[c * 3 + 1], nor[c * 3 + 2]);
          C.push(rgb[c * 3], rgb[c * 3 + 1], rgb[c * 3 + 2], alpha);
          S.push(surface);
          U.push(u, w);
          bounds[0] = Math.min(bounds[0], x / 128); bounds[1] = Math.min(bounds[1], y / 128); bounds[2] = Math.min(bounds[2], z / 128);
          bounds[3] = Math.max(bounds[3], x / 128); bounds[4] = Math.max(bounds[4], y / 128); bounds[5] = Math.max(bounds[5], z / 128);
        }
        I.push(index);
      }
    }
    const buffer = encodeRenderChunk({ positions: Int16Array.from(P), normals: Int8Array.from(N), colors: Uint8Array.from(C), surfaces: Uint16Array.from(S), uvs: Float32Array.from(U), indices: Uint32Array.from(I) });
    const id = `${name}_${key}`, file = `${id}.bin`;
    writeFileSync(`${directory}/${file}`, Buffer.from(buffer));
    chunks.push({ id, file, kind: key.endsWith('translucent') ? 'translucent' : 'opaque', triangles: ids.length, vertices: P.length / 3, bytes: buffer.byteLength, bounds });
    if (++completed % 30 === 0) console.log(`${name}: ${completed}/${groups.size} chunks`);
  }
}
const manifest: RenderManifest = { version: 2, cellSize: CELL, triangles: chunks.reduce((n, c) => n + c.triangles, 0), vertices: chunks.reduce((n, c) => n + c.vertices, 0), bytes: chunks.reduce((n, c) => n + c.bytes, 0), chunks };
writeFileSync(`${directory}/manifest.json`, JSON.stringify(manifest));
console.log(`Render world: ${chunks.length} spatial chunks, ${manifest.triangles.toLocaleString()} triangles, ${manifest.vertices.toLocaleString()} shared vertices (${(manifest.bytes / 1e6).toFixed(1)} MB total; only nearby chunks load)`);
