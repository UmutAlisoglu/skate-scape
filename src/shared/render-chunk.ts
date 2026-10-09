export interface RenderChunkData {
  positions: Int16Array;
  normals: Int8Array;
  /** sRGB vertex color before lighting + alpha */
  colors: Uint8Array;
  /** cache texture id + 1 (0 = untextured) */
  surfaces: Uint16Array;
  uvs: Float32Array;
  indices: Uint16Array | Uint32Array;
}
const MAGIC = 0x324b4353; // SCK2, little endian
const HEADER = 16;
// Layout after the header: uv f32x2 | position i16x3 | surface u16 | normal i8x3 | color u8x4 | (pad) | indices
const BYTES_PER_VERTEX = 8 + 6 + 2 + 3 + 4;
const indexOffset = (vertices: number) => Math.ceil((HEADER + vertices * BYTES_PER_VERTEX) / 4) * 4;

/** Compact, indexed render data; collision stays in a separate world-space mesh. */
export function encodeRenderChunk(data: RenderChunkData): ArrayBuffer {
  const vertices = data.positions.length / 3;
  if (!Number.isInteger(vertices) || data.normals.length !== vertices * 3 || data.colors.length !== vertices * 4 || data.surfaces.length !== vertices || data.uvs.length !== vertices * 2 || data.indices.length % 3) throw new Error('Invalid render chunk attributes');
  for (const index of data.indices) if (index >= vertices) throw new Error('Render index outside vertex array');
  const indexBytes = vertices <= 65535 ? 2 : 4, offset = indexOffset(vertices);
  const buffer = new ArrayBuffer(offset + data.indices.length * indexBytes), view = new DataView(buffer);
  view.setUint32(0, MAGIC, true);
  view.setUint32(4, vertices, true);
  view.setUint32(8, data.indices.length, true);
  view.setUint32(12, indexBytes, true);
  const at = attributeOffsets(vertices);
  new Float32Array(buffer, at.uvs, vertices * 2).set(data.uvs);
  new Int16Array(buffer, at.positions, vertices * 3).set(data.positions);
  new Uint16Array(buffer, at.surfaces, vertices).set(data.surfaces);
  new Int8Array(buffer, at.normals, vertices * 3).set(data.normals);
  new Uint8Array(buffer, at.colors, vertices * 4).set(data.colors);
  if (indexBytes === 2) new Uint16Array(buffer, offset, data.indices.length).set(data.indices);
  else new Uint32Array(buffer, offset, data.indices.length).set(data.indices);
  return buffer;
}

function attributeOffsets(vertices: number) {
  const uvs = HEADER, positions = uvs + vertices * 8, surfaces = positions + vertices * 6, normals = surfaces + vertices * 2, colors = normals + vertices * 3;
  return { uvs, positions, surfaces, normals, colors };
}

export function decodeRenderChunk(buffer: ArrayBuffer): RenderChunkData {
  if (buffer.byteLength < HEADER) throw new Error('Missing render chunk header');
  const view = new DataView(buffer);
  if (view.getUint32(0, true) !== MAGIC) throw new Error('Unsupported render chunk format. Run npm run export:render.');
  const vertices = view.getUint32(4, true), count = view.getUint32(8, true), bytes = view.getUint32(12, true), offset = indexOffset(vertices);
  if ((bytes !== 2 && bytes !== 4) || count % 3 || buffer.byteLength !== offset + count * bytes) throw new Error('Invalid render chunk length');
  const indices = bytes === 2 ? new Uint16Array(buffer, offset, count) : new Uint32Array(buffer, offset, count);
  for (const index of indices) if (index >= vertices) throw new Error('Render index outside vertex array');
  const at = attributeOffsets(vertices);
  return {
    uvs: new Float32Array(buffer, at.uvs, vertices * 2),
    positions: new Int16Array(buffer, at.positions, vertices * 3),
    surfaces: new Uint16Array(buffer, at.surfaces, vertices),
    normals: new Int8Array(buffer, at.normals, vertices * 3),
    colors: new Uint8Array(buffer, at.colors, vertices * 4),
    indices,
  };
}

export interface RenderChunkRecord {
  id: string; file: string; kind: 'opaque' | 'translucent'; triangles: number; vertices: number; bytes: number;
  bounds: [number, number, number, number, number, number];
}
export interface RenderManifest { version: 2; cellSize: number; triangles: number; vertices: number; bytes: number; chunks: RenderChunkRecord[] }

export function distanceToChunkSquared(record: RenderChunkRecord, x: number, z: number) {
  const b = record.bounds, dx = Math.max(b[0] - x, 0, x - b[3]), dz = Math.max(b[2] - z, 0, z - b[5]);
  return dx * dx + dz * dz;
}
