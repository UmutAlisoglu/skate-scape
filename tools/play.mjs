// Starts the game for playing: checks dependencies and exported assets, then serves the game locally and
// opens it in the default browser. Used by play.bat; `npm run play` does the same.
import { existsSync, readFileSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);

// Commands go through the shell as one string (npm and npx are .cmd scripts on Windows).
function run(command) {
  // the full Misthalin export holds ~10 million triangles in memory at once
  const env = { ...process.env, NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --max-old-space-size=12288`.trim() };
  const result = spawnSync(command, { stdio: 'inherit', shell: true, env });
  if (result.status !== 0) {
    console.error(`\n"${command}" failed.`);
    process.exit(result.status ?? 1);
  }
}

if (!existsSync('node_modules')) {
  console.log('First start: installing dependencies (one time)...');
  run('npm install');
}

// Everything the game loads at runtime (the default map is greater Misthalin).
const AREA = 'misthalin';
const required = [
  `public/world/${AREA}/manifest.json`,
  `public/world/${AREA}/terrain.bin`,
  `public/world/${AREA}/collision/index.json`,
  `public/world/${AREA}/traversal.bin`,
  `public/world/${AREA}/rails.json`,
  `public/world/${AREA}/render/manifest.json`,
  `public/world/${AREA}/minimap.png`,
  'public/player/wardrobe.json',
  'public/player/anims.json',
  'public/surfaces/manifest.json',
  'public/surfaces/textures.png',
];
const missing = required.filter((file) => !existsSync(file));
// render chunks from before the large-map format (version 3) need re-exporting too
const renderManifest = `public/world/${AREA}/render/manifest.json`;
if (existsSync(renderManifest) && JSON.parse(readFileSync(renderManifest, 'utf8')).version !== 3) missing.push(`${renderManifest} (old format)`);
if (missing.length) {
  console.log(`Game assets are missing (${missing.join(', ')}).`);
  if (!existsSync('vendor/2009scape-cache/main_file_cache.dat2')) {
    console.error('The 2009scape cache is needed to build them: see "Setup" in README.md.');
    process.exit(1);
  }
  console.log('Building them from the 2009scape cache (takes a few minutes)...');
  for (const step of ['export:world', 'export:player', 'export:render', 'export:collision', 'export:minimap']) run(`npm run ${step} -- ${AREA}`);
  run('npm run export:surfaces');
}

console.log('\nStarting Scape Skate. Your browser opens by itself; keep this window open while you play.\n');
const server = spawn('npx vite --open --clearScreen false', { stdio: 'inherit', shell: true });
server.on('exit', (code) => process.exit(code ?? 0));
