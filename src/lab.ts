// Dev-only pose lab (open /lab.html): a row of riders, each frozen in a skate pose or push phase, so the
// rig can be judged in one screenshot. ?view=side|back|top|nose and ?look=random pick the camera and outfit;
// ?only=a,b limits it to named poses and ?distance=n moves the camera.
import * as THREE from 'three';
import { loadJson } from './world/load.ts';
import { loadSurfaces, rsMaterial } from './world/rs-material.ts';
import { Avatar } from './player/avatar.ts';
import { Skateboard, deckAttitude } from './game/board.ts';
import { DECKS } from './game/decks.ts';
import { GRAB_LIFT } from './player/skate-rig.ts';
import type { SkatePose } from './player/skate-pose.ts';
import type { AnimData, Wardrobe } from './shared/player-data.ts';

const params = new URLSearchParams(location.search);
const ride: SkatePose = { crouch: 0.25, push: 0, air: 0, kick: 0, balance: 0, time: 0, phase: 'ride' };
const allPoses: [string, Partial<SkatePose>][] = [
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
  ['fakie', { fakie: 1 }],
  ['fakie push', { fakie: 1, push: 1, pushPhase: 0.3 }],
  ['nose manual', { manual: 1, nose: 1 }],
  ['indy', { air: 1, crouch: 0.4, grab: 1, grabKind: 'indy' }],
  ['melon', { air: 1, crouch: 0.4, grab: 1, grabKind: 'melon' }],
  ['method', { air: 1, crouch: 0.4, grab: 1, grabKind: 'method' }],
  ['nosegrab', { air: 1, crouch: 0.4, grab: 1, grabKind: 'nosegrab' }],
  ['tailgrab', { air: 1, crouch: 0.4, grab: 1, grabKind: 'tailgrab' }],
];
// ?only=indy,melon shows just those poses (bigger)
const only = params.get('only')?.split(',');
const poses = only ? allPoses.filter(([name]) => only.includes(name)) : allPoses;

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
const columns = Math.min(4, poses.length), rows = Math.ceil(poses.length / columns), rowHeight = 2.3;
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
  // the deck tweak a real skater state would give (grabs, manuals)
  const grabbing = values.grab && values.grabKind ? { kind: values.grabKind } : null;
  if (grabbing) board.root.position.y += GRAB_LIFT / 128;
  board.setDeck(deckAttitude({ trick: null, manual: !!values.manual, noseManual: !!values.nose, charge: 0, grab: grabbing as never, speed: 0 }));
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
else if (view === 'nose') camera.position.set(0.01, middle, -distance); // profile, looking along the board
else camera.position.set(distance, middle, 0); // in front of the riders (their toe side)
camera.lookAt(0, middle, 0);
function layout() {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / Math.max(1, innerHeight);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
  for (const label of labels.children as HTMLCollectionOf<HTMLElement>) {
    const [y, z] = label.dataset.anchor!.split(',').map(Number);
    const p = new THREE.Vector3(0, y, z).project(camera);
    label.style.left = `${((p.x + 1) / 2) * innerWidth}px`;
    label.style.top = `${((1 - p.y) / 2) * innerHeight}px`;
  }
}
layout();
addEventListener('resize', layout);
// ?decks shows every deck graphic: boards upside down in a row, seen from above
if (params.has('decks')) {
  scene.clear(); scene.background = new THREE.Color(0x30302a);
  DECKS.forEach((design, i) => {
    const board = new Skateboard(); board.setDesign(design);
    board.root.rotation.set(0, 0, Math.PI); board.root.position.set((i - (DECKS.length - 1) / 2) * 0.34, 0.3, 0);
    scene.add(board.root);
  });
  camera.position.set(0, 3.4, 0.01); camera.lookAt(0, 0, 0);
}
renderer.setAnimationLoop(() => renderer.render(scene, camera));
