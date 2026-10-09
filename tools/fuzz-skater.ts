// Drives the real skater physics against the exported Lumbridge collision with random inputs and reports
// anything suspicious: non-finite state, sinking below the ground, sudden vertical jumps, runaway speed,
// grinds far from their rail, and skaters stuck while pushing.
// Usage: npx tsx tools/fuzz-skater.ts [episodes=40] [seconds=40] [seed=1]
import { readFileSync } from 'node:fs';
import { decodeSoup } from '../src/world/load.ts';
import { WorldCollision } from '../src/world/collision.ts';
import { Skater, type Rail, type SkateInput } from '../src/game/skater.ts';

const [episodes = 40, seconds = 40, seed = 1] = process.argv.slice(2).map(Number);
// TRACE="episode,from,to" prints every frame of one episode between two times
const trace = process.env.TRACE?.split(',').map(Number);
const base = 'public/world/lumbridge';
const buffer = (file: string) => { const b = readFileSync(`${base}/${file}`); return b.buffer.slice(b.byteOffset, b.byteOffset + b.length); };
const manifest = JSON.parse(readFileSync(`${base}/manifest.json`, 'utf8'));
const terrain = decodeSoup(buffer('terrain.bin'), 'terrain', { positionsOnly: true });
const solids = decodeSoup(buffer('collision.bin'), 'collision', { positionsOnly: true });
const world = new WorldCollision([terrain.opaque, solids.opaque]);
world.rails = JSON.parse(readFileSync(`${base}/rails.json`, 'utf8')) as Rail[];
world.setTraversal(manifest.sizeTiles[0], manifest.sizeTiles[1], new Uint8Array(readFileSync(`${base}/traversal.bin`)));

let state = seed >>> 0 || 1;
const random = () => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return (state >>> 0) / 4294967296; };

const issues = new Map<string, { count: number; samples: string[] }>();
const report = (kind: string, detail: string) => {
  const entry = issues.get(kind) ?? { count: 0, samples: [] };
  entry.count++;
  if (entry.samples.length < 5) entry.samples.push(detail);
  issues.set(kind, entry);
};
const tile = (p: { x: number; z: number }) => `tile ${manifest.baseTile[0] + Math.floor(p.x)},${manifest.baseTile[1] + Math.floor(-p.z)}`;

const [sx, sy] = manifest.spawn;
const spawns: { x: number; y: number; z: number }[] = [];
const home = { x: sx + 0.5, y: world.groundAt(sx + 0.5, -(sy + 0.5), 30, true) ?? 0, z: -(sy + 0.5) };
spawns.push(home);
while (spawns.length < episodes) {
  // random ground near the castle, where most skating happens
  const x = home.x + (random() - 0.5) * 60, z = home.z + (random() - 0.5) * 60;
  // ground level only: the topmost surface can be an unreachable roof
  const y = world.groundAt(x, z, 40), ground = world.groundAt(x, z, 40, true);
  if (y !== null && ground !== null && y - ground < 0.5 && world.canRideAt(x, z, y)) spawns.push({ x, y, z });
}

const dt = 1 / 60;
let frames = 0, bails = 0, grinds = 0, landed = 0;
for (const [episode, spawn] of spawns.entries()) {
  const skater = new Skater(world, spawn);
  skater.reset(spawn, random() * Math.PI * 2);
  let steer = 0, push = true, hold = 0, stuck = 0, crouch = 0, manualTime = 0;
  let previousY = skater.position.y, previousPhase = skater.phase;
  for (let f = 0; f < seconds * 60; f++, frames++) {
    if (f % 30 === 0) { steer = random() < 0.4 ? 0 : random() * 2 - 1; push = random() < 0.65; hold = random() < 0.25 ? 0.2 + random() * 0.5 : 0; manualTime = random() < 0.1 ? 1 + random() * 2 : 0; }
    let pop = false;
    if (hold > 0) { crouch += dt; if (crouch >= hold) { pop = true; hold = 0; crouch = 0; } }
    manualTime = Math.max(0, manualTime - dt);
    const input: SkateInput = {
      push, brake: random() < 0.01, steer, crouch: hold > 0, pop,
      flip: !skater.grounded && random() < 0.05, shove: !skater.grounded && random() < 0.03,
      manual: manualTime > 0, grind: random() < 0.3,
    };
    skater.update(dt, input);
    for (const event of skater.drainEvents()) { if (event.type === 'bail') bails++; if (event.type === 'grind') grinds++; if (event.type === 'land') landed++; }
    const p = skater.position;
    if (trace && episode === trace[0] && f * dt >= trace[1] && f * dt <= trace[2]) console.log(`t=${(f * dt).toFixed(3)} ${skater.phase} p=(${p.x.toFixed(3)}, ${p.y.toFixed(3)}, ${p.z.toFixed(3)}) speed ${skater.speed.toFixed(2)} vy ${skater.verticalSpeed.toFixed(2)} heading ${skater.heading.toFixed(2)} grounded ${skater.grounded} input push=${input.push} steer=${input.steer.toFixed(2)} pop=${input.pop}`);
    const where = `episode ${episode} t=${(f * dt).toFixed(2)} ${tile(p)} (${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)}) ${skater.phase}`;
    if (![p.x, p.y, p.z, skater.speed, skater.heading, skater.verticalSpeed].every(Number.isFinite)) { report('non-finite state', where); break; }
    if (skater.speed > 12) report('speed above 12 m/s', `${where} speed ${skater.speed.toFixed(1)}`);
    const ground = world.groundAt(p.x, p.z, p.y + 0.3, true);
    if (ground !== null && p.y < ground - 0.5) report('below the terrain', `${where} terrain ${ground.toFixed(2)}`);
    // a bail that ends in water / out of bounds returns to the last safe spot on purpose
    if (Math.abs(p.y - previousY) > 1.2 && skater.bailTime === 0 && previousPhase !== 'recover') report('vertical jump in one frame', `${where} from y ${previousY.toFixed(2)}`);
    previousY = p.y;
    previousPhase = skater.phase;
    if (skater.grinding) {
      const r = skater.grinding.rail, dx = r.b.x - r.a.x, dz = r.b.z - r.a.z, l2 = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((p.x - r.a.x) * dx + (p.z - r.a.z) * dz) / l2));
      const off = Math.hypot(r.a.x + dx * t - p.x, r.a.z + dz * t - p.z);
      if (off > 0.05) report('grinding off the rail line', `${where} rail ${r.id} off ${off.toFixed(2)}`);
    }
    if (push && skater.grounded && !skater.grinding && skater.bailTime === 0 && skater.speed < 0.15) stuck += dt; else stuck = 0;
    if (stuck > 3) { report('stuck while pushing for 3 s', where); stuck = -1e9; }
  }
}

console.log(`${spawns.length} episodes, ${(frames / 60 / 60).toFixed(1)} minutes simulated: ${grinds} grinds, ${landed} banked combos, ${bails} bails/stumbles`);
if (!issues.size) console.log('No issues found.');
for (const [kind, { count, samples }] of issues) {
  console.log(`\n${kind}: ${count}`);
  for (const s of samples) console.log(`  ${s}`);
}
