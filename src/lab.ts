// Dev-only pose lab (open /lab.html): a row of riders, each frozen in a skate pose or push phase, so the
// rig can be judged in one screenshot. ?view=side|back|top and ?look=random pick the camera and outfit.
import * as THREE from 'three';
import { loadJson } from './world/load.ts';
import { loadSurfaces, rsMaterial } from './world/rs-material.ts';
import { Avatar } from './player/avatar.ts';
import { Skateboard } from './game/board.ts';
import type { SkatePose } from './player/skate-pose.ts';
import type { AnimData, Wardrobe } from './shared/player-data.ts';

const params = new URLSearchParams(location.search);
const ride: SkatePose = { crouch: 0.25, push: 0, air: 0, kick: 0, balance: 0, time: 0, phase: 'ride' };
const poses: [string, Partial<SkatePose>][] = [
  ['ride', {}],
  ['crouch', { crouch: 1 }],
  ['push 0.0', { push: 1, pushPhase: 0 }],
  ['push 0.3', { push: 1, pushPhase: 0.3 }],
  ['push 0.55', { push: 1, pushPhase: 0.55 }],
  ['push 0.75', { push: 1, pushPhase: 0.75, pushLift: 0.18 }],
  ['push 0.9', { push: 1, pushPhase: 0.9, pushLift: 0.1 }],
  ['air', { air: 1, crouch: 0.4 }],
  ['kickflip', { air: 1, kick: 1, crouch: 0.4 }],
  ['manual', { manual: 1 }],
  ['grind', { grind: 1, crouch: 0.5 }],
  ['grind tilt', { grind: 1, crouch: 0.5, balance: 0.8 }],
];

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.NoToneMapping;
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xc8c0a8);
const camera = new THREE.PerspectiveCamera(30, innerWidth / innerHeight, 0.1, 200);

const [wardrobe, anims, surfaces] = await Promise.all([
  loadJson<Wardrobe>('/player/wardrobe.json'),
  loadJson<AnimData>('/player/anims.json'),
  loadSurfaces('/surfaces'),
]);
const spacing = 1.4;
const labels = document.getElementById('labels')!;
const columns = 4, rows = Math.ceil(poses.length / columns), rowHeight = 2.3;
poses.forEach(([name, values], i) => {
  const avatar = new Avatar(wardrobe, anims, surfaces);
  avatar.setLook(params.get('look') === 'random' ? avatar.randomLook(false) : avatar.defaultLook(false));
  avatar.setSkatePose({ ...ride, ...values });
  avatar.update(1);
  // a grid of riders along z (screen left to right from the default camera on +x), rows stacked upward
  const z = ((columns - 1) / 2 - (i % columns)) * spacing;
  const y = (rows - 1 - Math.floor(i / columns)) * rowHeight;
  // same placement as the game: travel along -z (heading 0), rider turned sideways, facing +x
  avatar.mesh.position.set(0, y + avatar.skateSoleOffset, z);
  avatar.mesh.rotation.set(0, Math.PI / 2, 0, 'YXZ');
  scene.add(avatar.mesh);
  const board = new Skateboard();
  board.root.position.set(0, y, z);
  const tile = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.04, 1.3), rsMaterial({ color: 0x8a8a70 }));
  tile.position.set(0, y - 0.03, z);
  scene.add(tile);
  scene.add(board.root);
  const label = document.createElement('div');
  label.textContent = name;
  label.style.cssText = 'position:fixed;transform:translate(-50%,0)';
  label.dataset.anchor = `${y + 2},${z}`;
  labels.appendChild(label);
});
const view = params.get('view') ?? 'side';
const middle = ((rows - 1) * rowHeight) / 2 + 0.9, distance = Number(params.get('distance') ?? 13);
if (view === 'back') camera.position.set(-distance, middle, 0);
else if (view === 'top') camera.position.set(0.01, middle + distance, 0);
else camera.position.set(distance, middle, 0); // in front of the riders (their toe side)
camera.lookAt(0, middle, 0);
camera.updateMatrixWorld();
for (const label of labels.children as HTMLCollectionOf<HTMLElement>) {
  const [y, z] = label.dataset.anchor!.split(',').map(Number);
  const p = new THREE.Vector3(0, y, z).project(camera);
  label.style.left = `${((p.x + 1) / 2) * innerWidth}px`;
  label.style.top = `${((1 - p.y) / 2) * innerHeight}px`;
}
renderer.setAnimationLoop(() => renderer.render(scene, camera));
