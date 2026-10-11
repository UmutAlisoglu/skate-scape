import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync, inflateSync } from 'node:zlib';
import { CacheStore } from '../tools/cache/store.ts';
import { Fetcher, HttpCacheStore, MissingGroupError, type BlockCache, type CacheSource } from '../tools/cache/http-store.ts';
import { encodePngWith } from '../tools/png-core.ts';

const SECTOR = 520;

/** A tiny JS5 cache: archive 7 with three single-file groups, group 0's sector chain jumping across the file. */
function syntheticCache() {
  const payloads = [Uint8Array.from({ length: 1500 }, (_, i) => Math.imul(i + 1, 2654435761) >>> 24), Uint8Array.from([1, 2, 3, 4, 5]), Uint8Array.from([9, 9])];
  const container = (data: Uint8Array, gzip: boolean) => {
    const body = gzip ? gzipSync(data) : data, out = Buffer.alloc((gzip ? 9 : 5) + body.length + 2);
    out[0] = gzip ? 2 : 0; out.writeInt32BE(body.length, 1);
    if (gzip) out.writeInt32BE(data.length, 5);
    out.set(body, gzip ? 9 : 5);
    return out; // ends with the 2-byte version trailer
  };
  // reference table for archive 7: protocol 5, no names, groups 0..2 of one file each
  const ref = Buffer.alloc(1 + 1 + 2 + 3 * 2 + 3 * 4 + 3 * 4 + 3 * 2 + 3 * 2);
  let o = 0;
  ref[o++] = 5; ref[o++] = 0; ref.writeUInt16BE(3, o); o += 2;
  for (const delta of [0, 1, 1]) { ref.writeUInt16BE(delta, o); o += 2; }
  o += 24; // checksums, versions
  for (let i = 0; i < 3; i++) { ref.writeUInt16BE(1, o); o += 2; }
  const dat = Buffer.alloc(SECTOR * 16), idx = new Map<number, Buffer>();
  const place = (archive: number, group: number, data: Uint8Array, sectors: number[]) => {
    const index = idx.get(archive) ?? Buffer.alloc(0), entry = Buffer.alloc(Math.max(index.length, group * 6 + 6));
    index.copy(entry);
    entry.writeUIntBE(data.length, group * 6, 3); entry.writeUIntBE(sectors[0], group * 6 + 3, 3);
    idx.set(archive, entry);
    sectors.forEach((sector, chunk) => {
      const p = sector * SECTOR;
      dat.writeUInt16BE(group, p); dat.writeUInt16BE(chunk, p + 2); dat.writeUIntBE(sectors[chunk + 1] ?? 0, p + 4, 3); dat[p + 7] = archive;
      dat.set(data.subarray(chunk * 512, (chunk + 1) * 512), p + 8);
    });
  };
  const c0 = container(payloads[0], true);
  place(255, 7, container(ref, false), [1]);
  // group 0 starts at sector 2 and jumps to 13: sectors straddle 1000-byte blocks
  place(7, 0, c0, Array.from({ length: Math.ceil(c0.length / 512) }, (_, i) => (i === 0 ? 2 : 12 + i)));
  place(7, 1, container(payloads[1], false), [5]);
  place(7, 2, container(payloads[2], true), [6]);
  const files = new Map<string, Uint8Array>([['main_file_cache.dat2', dat], ...[...idx].map(([a, data]) => [`main_file_cache.idx${a}`, data] as [string, Uint8Array])]);
  return { payloads, files };
}

function server(files: Map<string, Uint8Array>) {
  const requests: string[] = [];
  const fetch = (async (url: string, init?: RequestInit) => {
    const data = files.get(url.slice('test://'.length));
    if (!data) return new Response(null, { status: 404 });
    const range = new Headers(init?.headers).get('Range')?.match(/bytes=(\d+)-(\d+)/);
    requests.push(range ? `${url}#${range[1]}` : url);
    if (!range) return new Response(data as Uint8Array<ArrayBuffer>);
    return new Response(data.slice(Number(range[1]), Number(range[2]) + 1), { status: 206 });
  }) as typeof globalThis.fetch;
  return { requests, fetch };
}

const source: CacheSource = { id: 'test', cacheFile: (name) => `test://${name}`, xteas: 'test://xteas.json' };

test('the HTTP cache store reads groups over Range requests, including chains that jump across blocks', async () => {
  const { payloads, files } = syntheticCache(), { requests, fetch } = server(files);
  const store = await HttpCacheStore.open(source, new Fetcher({ fetch }), [7], 1000);
  await store.prefetch([{ archive: 7, group: 0 }, { archive: 7, group: 1 }]);
  assert.deepEqual(store.file(7, 0), payloads[0]);
  assert.deepEqual(store.file(7, 1), payloads[1]);
  assert.throws(() => store.file(7, 2), MissingGroupError);
  assert.ok(store.chainMisses > 0, 'the jump was found by a second round');
  assert.ok(requests.every((r, i) => requests.indexOf(r) === i), 'no block is fetched twice');
});

test('the disk store and the HTTP store read the same cache identically', async () => {
  const { payloads, files } = syntheticCache(), dir = mkdtempSync(join(tmpdir(), 'js5-'));
  for (const [name, data] of files) writeFileSync(join(dir, name), data);
  const disk = new CacheStore(dir);
  for (let g = 0; g < 3; g++) assert.deepEqual(disk.file(7, g), payloads[g]);
  const store = await HttpCacheStore.open(source, new Fetcher({ fetch: server(files).fetch }), [7], 4096);
  await store.prefetch([0, 1, 2].map((group) => ({ archive: 7, group })));
  for (let g = 0; g < 3; g++) assert.deepEqual(store.file(7, g), disk.file(7, g));
});

test('fetched blocks come from the block cache on the next visit', async () => {
  const { files } = syntheticCache(), saved = new Map<string, Uint8Array>();
  const cache: BlockCache = { get: async (keys) => keys.map((k) => saved.get(k)), put: async (entries) => { for (const [k, v] of entries) saved.set(k, v); } };
  for (const visit of [1, 2]) {
    const { requests, fetch } = server(files), fetcher = new Fetcher({ fetch, cache });
    const store = await HttpCacheStore.open(source, fetcher, [7], 1000);
    await store.prefetch([0, 1, 2].map((group) => ({ archive: 7, group })));
    if (visit === 1) assert.ok(requests.length > 0);
    else { assert.equal(requests.length, 0); assert.ok(fetcher.stats.cacheHits > 0); }
  }
});

test('the request limiter keeps under its per-minute ceiling and concurrency', async () => {
  let active = 0, peak = 0;
  const fetch = (async () => { active++; peak = Math.max(peak, active); await new Promise((r) => setTimeout(r, 5)); active--; return new Response(new Uint8Array(4)); }) as unknown as typeof globalThis.fetch;
  const fetcher = new Fetcher({ fetch, concurrency: 3 });
  await Promise.all(Array.from({ length: 20 }, () => fetcher.get('test://x')));
  assert.ok(peak <= 3);
  assert.equal(fetcher.stats.requests, 20);
  assert.equal(fetcher.stats.peakPerMinute, 20);
});

test('PNGs encoded without zlib are valid stored deflate streams', () => {
  const rgba = Uint8Array.from({ length: 300 * 300 * 4 }, (_, i) => i % 251);
  const png = encodePngWith(300, 300, rgba), view = new DataView(png.buffer);
  const idatLength = view.getUint32(33), rows = inflateSync(png.subarray(41, 41 + idatLength));
  assert.equal(rows.length, 300 * (300 * 4 + 1));
  assert.deepEqual(rows.subarray(1, 1201), Buffer.from(rgba.subarray(0, 1200)));
});
