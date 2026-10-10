// Rides every race with a simple bot (push, steer at the next checkpoint, ollie when blocked) on the exported
// collision and reports how long each takes, or where the bot gets stuck: a check that courses are skateable
// and a guide for medal times. Usage: npx tsx tools/check-races.ts [raceId] [level=60]
import { existsSync, readFileSync } from 'node:fs';
import { type CollisionIndex } from '../src/world/load.ts';
import { decodeCell, WorldCollision } from '../src/world/collision.ts';
import { Skater, type Rail, type SkateInput } from '../src/game/skater.ts';
import { abilitiesFor } from '../src/game/skill.ts';
import { RACES } from '../src/game/races.ts';

const base = 'public/world/gielinor';
const buffer = (file: string) => { const b = readFileSync(`${base}/${file}`); return b.buffer.slice(b.byteOffset, b.byteOffset + b.length); };
const manifest = JSON.parse(readFileSync(`${base}/manifest.json`, 'utf8'));
const index = JSON.parse(readFileSync(`${base}/collision/index.json`, 'utf8')) as CollisionIndex;
const traversal = new Uint8Array(readFileSync(`${base}/traversal.bin`));
const [bx, by] = manifest.baseTile as [number, number];
const only = process.argv[2] && process.argv[2] !== 'all' ? process.argv[2] : null, level = Number(process.argv[3] ?? 60);
const local = ([x, y]: [number, number]) => ({ x: x - bx + 0.5, z: -(y - by + 0.5) });
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

for (const race of RACES.filter((r) => !only || r.id === only)) {
  const points = race.checkpoints.map(local);
  const world = new WorldCollision();
  for (const entry of index.cells) {
    const [cx, cy] = entry, key = `${cx}_${cy}`, file = (s: string) => `collision/${key}${s}`;
    const near = points.some((p) => Math.hypot((cx + 0.5) * 16 - p.x, (cy + 0.5) * 16 + p.z) < 60);
    if (!near) continue;
    world.setCell(key, decodeCell(index, entry, { locs: entry[2] ? buffer(file('.bin')) : undefined, terrain: entry[3] ? buffer(file('.t.bin')) : undefined, rails: entry[4] && existsSync(`${base}/${file('.rails.json')}`) ? JSON.parse(readFileSync(`${base}/${file('.rails.json')}`, 'utf8')) as Rail[] : undefined }));
  }
  world.setTraversal(manifest.sizeTiles[0], manifest.sizeTiles[1], traversal);
  const start = points[0], y = world.groundAt(start.x, start.z, 25) ?? 0;
  const s = new Skater(world, { x: start.x, y, z: start.z }); s.abilities = abilitiesFor(level);
  s.reset({ x: start.x, y, z: start.z }, Math.atan2(-(points[1].x - start.x), -(points[1].z - start.z)));
  let next = 1, time = 0, stuck = 0, popClock = 0, bails = 0, wiggle = 0, wiggleSide = 1;
  // with the router's tile path (work/routes), the bot follows it like a rider who knows the line
  const routeFile = `work/routes/${race.id}.json`;
  const dense = existsSync(routeFile) ? (JSON.parse(readFileSync(routeFile, 'utf8')).dense as [number, number][]).map(local) : null;
  let along = 0;
  const splits: string[] = [];
  const dt = 1 / 60;
  while (next < points.length && time < 240) {
    const target = points[next], p = s.position;
    let aim = target;
    if (dense) {
      // the nearest point of the path a little ahead of where we are, then look 2.5 m further along it
      for (let k = along; k < Math.min(dense.length, along + 4); k++) if (Math.hypot(dense[k].x - p.x, dense[k].z - p.z) < Math.hypot(dense[along].x - p.x, dense[along].z - p.z)) along = k;
      let k = along; while (k < dense.length - 1 && Math.hypot(dense[k].x - p.x, dense[k].z - p.z) < 2.5) k++;
      aim = dense[k];
    }
    const bearing = Math.atan2(-(aim.x - p.x), -(aim.z - p.z)), off = wrap(bearing - s.travelHeading);
    const input: SkateInput = { push: true, brake: Math.abs(off) > 1.2 && s.speed > 6, steer: Math.max(-1, Math.min(1, off * 2)), crouch: false, pop: false, flip: false, shove: false, grind: false };
    stuck = s.grounded && s.speed < 1 ? stuck + dt : 0;
    // like a player would: hop, then turn away from whatever it hit for a moment and try again
    if ((popClock -= dt) <= 0 && stuck > 0.4) { input.pop = true; popClock = 0.8; }
    if (stuck > 1) { wiggle = 0.7; wiggleSide = -Math.sign(off) || 1; }
    if (wiggle > 0) { wiggle -= dt; input.steer = wiggleSide; input.brake = false; }
    s.update(dt, input);
    for (const e of s.drainEvents()) if (e.type === 'bail') bails++;
    time += dt;
    if (Math.hypot(target.x - s.position.x, target.z - s.position.z) < 3.4) { splits.push(`${time.toFixed(1)}`); next++; }
    if (stuck > 8) break;
    if (process.env.DEBUG && stuck > 2 && stuck < 2 + dt * 1.5) console.log(`  stuck at ${(s.position.x + bx).toFixed(1)},${(-s.position.z + by).toFixed(1)} y ${s.position.y.toFixed(2)} ground ${world.groundAt(s.position.x, s.position.z, s.position.y + 0.5)?.toFixed(2)} terrain ${world.groundAt(s.position.x, s.position.z, s.position.y + 0.5, true)?.toFixed(2)} msg '${s.message}' phase ${s.phase} heading off ${off.toFixed(2)}`);
  }
  const done = next >= points.length;
  console.log(`${done ? 'ok   ' : 'STUCK'} ${race.id.padEnd(17)} ${done ? `${time.toFixed(1)} s` : `at checkpoint ${next} (${race.checkpoints[next].join(',')}) after ${time.toFixed(1)} s, rider at tile ${Math.floor(s.position.x + bx)},${Math.floor(-s.position.z + by)}`} · splits ${splits.join(' ')} · bails ${bails} · medals ${race.medals.join('/')}`);
}
