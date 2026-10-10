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
  // the world export builds a block of 16 regions (a few million triangles) at a time
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

// Everything the game loads at runtime (the default map is the whole of Gielinor).
const AREA = 'gielinor';
const required = [
  `public/world/${AREA}/manifest.json`,
  `public/world/${AREA}/collision/index.json`,
  `public/world/${AREA}/traversal.bin`,
  `public/world/${AREA}/runes.json`,
  `public/world/${AREA}/render/manifest.json`,
  `public/world/${AREA}/minimap.json`,
  'public/player/wardrobe.json',
  'public/player/anims.json',
  'public/surfaces/manifest.json',
  'public/surfaces/textures.png',
];
const missing = required.filter((file) => !existsSync(file));
// maps from before the streamed world format (2) need re-exporting too
const worldManifest = `public/world/${AREA}/manifest.json`;
if (existsSync(worldManifest) && JSON.parse(readFileSync(worldManifest, 'utf8')).format !== 2) missing.push(`${worldManifest} (old format)`);
if (missing.length) {
  console.log(`Game assets are missing (${missing.join(', ')}).`);
  if (!existsSync('vendor/2009scape-cache/main_file_cache.dat2')) {
    console.error('The 2009scape cache is needed to build them: see "Setup" in README.md.');
    process.exit(1);
  }
  console.log('Building them from the 2009scape cache (the whole world takes 10-20 minutes; it resumes if interrupted)...');
  run(`npm run export:world -- ${AREA}`);
  run('npm run export:player');
  run('npm run export:surfaces');
}

console.log('\nStarting Scape Skate. Your browser opens by itself; keep this window open while you play.\n');
const server = spawn('npx vite --open --clearScreen false', { stdio: 'inherit', shell: true });
server.on('exit', (code) => process.exit(code ?? 0));
