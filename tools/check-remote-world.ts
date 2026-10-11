// Builds an area straight from 2009scape's GitLab (the browser's ?source=gitlab path, minus IndexedDB) and compares
// every file with an export on disk. Minimap PNGs are encoded differently (stored instead of deflated), so they
// are compared by size only.
// Usage: npx tsx tools/check-remote-world.ts [area] [export folder, default public/world/<area>] [--block=<bytes>]
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { gitlabSource } from './cache/http-store.ts';
import { buildRemoteArea } from './world/remote-build.ts';

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const name = args[0] ?? 'lumbridge', dir = args[1] ?? `public/world/${name}`;
const blockSize = Number(process.argv.find((a) => a.startsWith('--block='))?.slice(8)) || undefined;
const { world, report } = await buildRemoteArea(name, { source: gitlabSource(), blockSize, progress: (step) => console.log(`  ${step}`) });
for (const line of report.log) console.log(line);
const mb = (n: number) => `${(n / 1e6).toFixed(1)} MB`;
console.log(`Fetched ${mb(report.fetch.bytes)} in ${report.fetch.requests} requests (peak ${report.fetch.peakPerMinute} per minute, ${report.fetch.retries} retried)`);
console.log(`Time: open ${(report.timings.open / 1000).toFixed(1)} s, download ${(report.timings.download / 1000).toFixed(1)} s, build ${(report.timings.build / 1000).toFixed(1)} s, total ${(report.timings.total / 1000).toFixed(1)} s`);
console.log(`Memory: cache blocks ${mb(report.memory.blocks)}, output ${mb(report.memory.output)}; heap ${mb(process.memoryUsage().heapUsed)}`);

if (!existsSync(dir)) { console.log(`No export at ${dir} to compare with.`); process.exit(0); }
const onDisk = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? onDisk(join(d, e.name)) : [relative(dir, join(d, e.name)).split(sep).join('/')]);
let same = 0, pngs = 0;
const differ: string[] = [], missing: string[] = [], extra = [...world.keys()].filter((p) => !existsSync(join(dir, p)));
for (const path of onDisk(dir)) {
  const built = world.get(path);
  if (!built) { missing.push(path); continue; }
  if (path.endsWith('.png')) { pngs++; continue; }
  if (Buffer.compare(Buffer.from(built), readFileSync(join(dir, path))) === 0) same++; else differ.push(path);
}
console.log(`Compared with ${dir}: ${same} identical, ${pngs} PNGs not compared, ${differ.length} different, ${missing.length} missing, ${extra.length} extra`);
for (const [label, list] of [['different', differ], ['missing', missing], ['extra', extra]] as const) if (list.length) console.log(`  ${label}: ${list.slice(0, 10).join(', ')}${list.length > 10 ? ', …' : ''}`);
if (differ.length || missing.length || extra.length) process.exit(1);
