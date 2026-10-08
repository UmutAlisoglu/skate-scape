import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { MeshBVH, acceleratedRaycast } from 'three-mesh-bvh';
import { loadSoup, type WorldManifest } from './world/load.ts';
import { Avatar } from './player/avatar.ts';
import type { AnimData, Wardrobe } from './shared/player-data.ts';

THREE.Mesh.prototype.raycast = acceleratedRaycast;

const AREA = new URLSearchParams(location.search).get('area') ?? 'lumbridge';
const hud = document.getElementById('hud')!;

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const sky = new THREE.Color(0x87a8c8);
scene.background = sky;
scene.fog = new THREE.Fog(sky, 60, 180);

scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x4a4030, 1.6));
const sun = new THREE.DirectionalLight(0xfff2dd, 2.2);
sun.position.set(-0.5, 1, 0.35);
scene.add(sun);

const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 500);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.enablePan = false;
controls.maxPolarAngle = Math.PI * 0.49;
controls.minDistance = 2;
controls.maxDistance = 60;

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

const keys = new Set<string>();
addEventListener('keydown', (e) => keys.add(e.code));
addEventListener('keyup', (e) => keys.delete(e.code));

const material = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.FrontSide });
const translucentMaterial = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, transparent: true, depthWrite: false });

async function main() {
  const base = `${import.meta.env.BASE_URL}world/${AREA}`;
  const playerBase = `${import.meta.env.BASE_URL}player`;
  const manifest: WorldManifest = await (await fetch(`${base}/manifest.json`)).json();
  hud.textContent = `Loading ${manifest.name}…`;
  const [terrain, locs, wardrobe, anims] = await Promise.all([
    loadSoup(`${base}/terrain.bin`),
    loadSoup(`${base}/locs.bin`),
    fetch(`${playerBase}/wardrobe.json`).then((r) => r.json() as Promise<Wardrobe>),
    fetch(`${playerBase}/anims.json`).then((r) => r.json() as Promise<AnimData>),
  ]);
  let tris = 0;
  let terrainMesh: THREE.Mesh | null = null;
  for (const part of [terrain, locs]) {
    const mesh = new THREE.Mesh(part.opaque, material);
    scene.add(mesh);
    if (part === terrain) terrainMesh = mesh;
    tris += part.opaque.attributes.position.count / 3;
    if (part.translucent) {
      scene.add(new THREE.Mesh(part.translucent, translucentMaterial));
      tris += part.translucent.attributes.position.count / 3;
    }
  }
  terrain.opaque.boundsTree = new MeshBVH(terrain.opaque);

  const ray = new THREE.Raycaster();
  ray.firstHitOnly = true;
  const down = new THREE.Vector3(0, -1, 0);
  const groundAt = (x: number, z: number, fromY = 200): number | null => {
    ray.set(new THREE.Vector3(x, fromY, z), down);
    const hit = ray.intersectObject(terrainMesh!)[0];
    return hit ? hit.point.y : null;
  };

  // ---- player ----
  const avatar = new Avatar(wardrobe, anims);
  let look = avatar.randomLook(false);
  avatar.setLook(look);
  avatar.play('Idle');
  scene.add(avatar.mesh);

  const [sx, sy] = manifest.spawn;
  const spawn = new THREE.Vector3(sx + 0.5, 0, -(sy + 0.5));
  spawn.y = groundAt(spawn.x, spawn.z) ?? 0;
  const player = avatar.mesh;
  player.position.copy(spawn);
  controls.target.copy(spawn).add(new THREE.Vector3(0, 1, 0));
  camera.position.copy(spawn).add(new THREE.Vector3(5, 4, 7));
  controls.update();

  const emotes = ['Jig', 'Headbang', 'Spin', 'Zombie dance', 'Dance', 'Cheer', 'Jump for joy', 'Air guitar', 'Rabbit hop', 'Glass box'].filter((n) => avatar.seqNames().includes(n));
  let busy = false; // emote / teleport in progress
  const doEmote = (name: string) => {
    busy = true;
    avatar.play(name, { loop: false, onDone: () => (busy = false) });
  };
  addEventListener('keydown', (e) => {
    if (e.repeat) return;
    if (e.code === 'KeyR') {
      look = avatar.randomLook(look.female);
      avatar.setLook(look);
    } else if (e.code === 'KeyG') {
      look = avatar.randomLook(!look.female);
      avatar.setLook(look);
    } else if (e.code === 'KeyT' && !busy) {
      busy = true;
      avatar.play('Teleport', {
        loop: false,
        onDone: () => {
          player.position.copy(spawn);
          controls.target.copy(spawn).add(new THREE.Vector3(0, 1, 0));
          camera.position.copy(controls.target).add(new THREE.Vector3(5, 3, 7));
          busy = false;
        },
      });
    } else if (/^Digit\d$/.test(e.code)) {
      const i = (Number(e.code.slice(5)) + 9) % 10;
      if (emotes[i]) doEmote(emotes[i]);
    }
  });

  const info = `${manifest.name}  ${(tris / 1e6).toFixed(2)}M tris  ${wardrobe.items.length} fashion items`;
  const help = `WASD walk (Shift run) · drag to orbit · R random fashionscape · G swap gender · T teleport home\n${emotes
    .map((n, i) => `${(i + 1) % 10}:${n}`)
    .join('  ')}`;
  const clock = new THREE.Clock();
  const forward = new THREE.Vector3();
  const right = new THREE.Vector3();
  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.1);
    camera.getWorldDirection(forward);
    forward.y = 0;
    forward.normalize();
    right.crossVectors(forward, camera.up);
    const move = new THREE.Vector3();
    if (keys.has('KeyW')) move.add(forward);
    if (keys.has('KeyS')) move.sub(forward);
    if (keys.has('KeyD')) move.add(right);
    if (keys.has('KeyA')) move.sub(right);
    const running = keys.has('ShiftLeft') || keys.has('ShiftRight');
    if (move.lengthSq() > 0 && !busy) {
      move.normalize().multiplyScalar((running ? 4 : 2) * dt);
      const nx = player.position.x + move.x;
      const nz = player.position.z + move.z;
      const y = groundAt(nx, nz, player.position.y + 1.5);
      if (y !== null) {
        player.position.set(nx, y, nz);
        camera.position.add(move);
        // RS models face -z (south) at rotation 0; turn the model toward the walk direction
        player.rotation.y = Math.atan2(-move.x, -move.z);
      }
      avatar.play(running ? 'Run' : 'Walk');
    } else if (!busy) {
      avatar.play('Idle');
    }
    avatar.update(dt);
    controls.target.lerp(player.position.clone().add(new THREE.Vector3(0, 1, 0)), 0.3);
    controls.update();
    renderer.render(scene, camera);
    const tileX = manifest.baseTile[0] + Math.floor(player.position.x);
    const tileY = manifest.baseTile[1] + Math.floor(-player.position.z);
    hud.textContent = `${info}\ntile ${tileX}, ${tileY}  ·  ${avatar.describe(look)}\n${help}`;
  });
}

main().catch((e) => {
  hud.textContent = `Failed to load: ${e}`;
  console.error(e);
});
