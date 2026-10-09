// Starts the game for playing: checks dependencies and exported assets, then serves the game locally and
// opens it in the default browser. Used by play.bat; `npm run play` does the same.
import { existsSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);

// Commands go through the shell as one string (npm and npx are .cmd scripts on Windows).
function run(command) {
  const result = spawnSync(command, { stdio: 'inherit', shell: true });
  if (result.status !== 0) {
    console.error(`\n"${command}" failed.`);
    process.exit(result.status ?? 1);
  }
}

if (!existsSync('node_modules')) {
  console.log('First start: installing dependencies (one time)...');
  run('npm install');
}

// Everything the game loads at runtime.
const required = [
  'public/world/lumbridge/manifest.json',
  'public/world/lumbridge/terrain.bin',
  'public/world/lumbridge/collision.bin',
  'public/world/lumbridge/traversal.bin',
  'public/world/lumbridge/rails.json',
  'public/world/lumbridge/render/manifest.json',
  'public/player/wardrobe.json',
  'public/player/anims.json',
  'public/surfaces/manifest.json',
  'public/surfaces/textures.png',
];
const missing = required.filter((file) => !existsSync(file));
if (missing.length) {
  console.log(`Game assets are missing (${missing.join(', ')}).`);
  if (!existsSync('vendor/2009scape-cache/main_file_cache.dat2')) {
    console.error('The 2009scape cache is needed to build them: see "Setup" in README.md.');
    process.exit(1);
  }
  console.log('Building them from the 2009scape cache (takes a minute)...');
  for (const step of ['export:world', 'export:player', 'export:render', 'export:collision', 'export:surfaces']) run(`npm run ${step}`);
}

console.log('\nStarting Scape Skate. Your browser opens by itself; keep this window open while you play.\n');
const server = spawn('npx vite --open --clearScreen false', { stdio: 'inherit', shell: true });
server.on('exit', (code) => process.exit(code ?? 0));
