import * as THREE from 'three';
import { loadBytes, loadJson, loadSoup, type WorldManifest } from './world/load.ts';
import { worldMaterials } from './world/material.ts';
import { WorldCollision } from './world/collision.ts';
import { RenderWorld } from './world/render.ts';
import { Avatar } from './player/avatar.ts';
import { SkateAnimator } from './player/skate-pose.ts';
import { damp, dampAngle } from './shared/motion.ts';
import type { AnimData, Wardrobe } from './shared/player-data.ts';
import { GameInput } from './game/input.ts';
import { Skater, type Rail } from './game/skater.ts';
import { Skateboard } from './game/board.ts';
import { ChaseCamera } from './game/camera.ts';
import { trainingGrounds } from './game/park.ts';
import { Career } from './game/career.ts';
import { GameUI } from './game/ui.ts';
import { SkateAudio } from './game/audio.ts';
import { PadInput } from './game/gamepad.ts';
import { PerformanceMonitor } from './game/performance.ts';
import './style.css';

const requestedArea = new URLSearchParams(location.search).get('area') ?? 'lumbridge';
const AREA = /^[a-z0-9_-]+$/i.test(requestedArea) ? requestedArea : 'lumbridge';
const loading = document.getElementById('hud')!;
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
const requestedRatio=Number(new URLSearchParams(location.search).get('dpr'));
renderer.setPixelRatio(requestedRatio>0?Math.max(0.75,Math.min(requestedRatio,2)):Math.min(devicePixelRatio,1)); renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0;
renderer.domElement.tabIndex = 0; renderer.domElement.setAttribute('aria-label', 'Scape Skate game view');
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
const sky = new THREE.Color(0x8da6aa); scene.background = sky; scene.fog = new THREE.Fog(sky, 38, 64);
scene.add(new THREE.HemisphereLight(0xdbe7da, 0x4d4331, 1.0));
const sun = new THREE.DirectionalLight(0xffe3b6, 1.4); sun.position.set(-0.5, 1, 0.35); scene.add(sun);
const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.1, 88);
const chase = new ChaseCamera(camera, renderer.domElement);
const keys = new GameInput(); const pad = new PadInput(); const audio = new SkateAudio();
const monitor = new PerformanceMonitor(renderer);
addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });

async function main() {
  const base = `${import.meta.env.BASE_URL}world/${AREA}`, playerBase = `${import.meta.env.BASE_URL}player`;
  const manifest = await loadJson<WorldManifest>(`${base}/manifest.json`);
  loading.textContent = `Opening ${manifest.name}…`;
  const [terrain, solids, wardrobe, anims, materials, traversal, rails] = await Promise.all([
    loadSoup(`${base}/terrain.bin`, { positionsOnly: true }), loadSoup(`${base}/collision.bin`, { positionsOnly: true }),
    loadJson<Wardrobe>(`${playerBase}/wardrobe.json`), loadJson<AnimData>(`${playerBase}/anims.json`), worldMaterials(`${import.meta.env.BASE_URL}surfaces`),
    loadBytes(`${base}/traversal.bin`),
    loadJson<Rail[]>(`${base}/rails.json`),
  ]);
  loading.textContent = 'Preparing the streets and training grounds…';
  const park = trainingGrounds(scene);
  const collision = new WorldCollision([terrain.opaque, solids.opaque, park.collisionGeometry]); collision.rails = [...rails,...park.rails];
  collision.setTraversal(manifest.sizeTiles[0],manifest.sizeTiles[1],traversal);
  const [sx, sy] = manifest.spawn;
  const home = new THREE.Vector3(sx + 0.5, 0, -(sy + 0.5)); home.y = collision.groundAt(home.x, home.z, 30, true) ?? 0;
  loading.textContent='Opening nearby streets…';
  const world=await RenderWorld.load(`${base}/render`,materials);scene.add(world.group);await world.preload(home);
  const avatar = new Avatar(wardrobe, anims); let look = avatar.defaultLook(false);
  look.colors = [1, 4, 2, 1, 0]; avatar.setLook(look); avatar.play('Idle'); scene.add(avatar.mesh);
  const player = avatar.mesh; player.position.copy(home);
  chase.controls.target.copy(home).add(new THREE.Vector3(0, 0.85, 0)); camera.position.copy(home).add(new THREE.Vector3(0, 2.6, 5)); chase.controls.update();
  const skater = new Skater(collision, home); const board = new Skateboard(); scene.add(board.root);
  const animator=new SkateAnimator(),renderPosition=home.clone(),renderTarget=new THREE.Vector3();
  let renderHeading=0,renderPitch=0,renderTilt=0,grindOffset=0;
  const career = new Career(localStorage, new URLSearchParams(location.search).has('test') ? 'scape-skate-test' : 'scape-skate-career'); let skating = true; let busy = false; let ui: GameUI;
  const colors = [0x74513a, 0x4b97ba, 0xa23f35, 0xd9b55d]; board.setColor(colors[career.profile.board]);
  const relocate = (position: { x: number; y: number; z: number }) => { skating = true; busy = false; avatar.setSkatePose(null); skater.reset(position, 0); player.position.set(position.x, position.y, position.z);renderPosition.copy(player.position);renderHeading=renderPitch=renderTilt=grindOffset=0;animator.reset();board.root.visible = true; chase.snap(position,0); };
  ui = new GameUI(career, {
    start: (mode, training) => { career.start(mode); skater.totalScore = 0; skater.drainEvents(); relocate(training ? park.spawn : home); },
    practice: () => relocate(park.spawn), board: (index) => board.setColor(colors[index]), pause: () => keys.clear(),
  });
  loading.hidden = true;
  document.addEventListener('visibilitychange', () => { if (document.hidden) ui.pause(); }); addEventListener('beforeunload', () => career.save());
  for (const token of park.tokens) if (career.profile.runes.includes(token.id)) { token.collected = true; token.mesh.visible = false; }
  const shadowCanvas = document.createElement('canvas'); shadowCanvas.width = shadowCanvas.height = 64;
  const shadowContext = shadowCanvas.getContext('2d')!; const gradient = shadowContext.createRadialGradient(32,32,2,32,32,30); gradient.addColorStop(0,'rgba(0,0,0,.4)'); gradient.addColorStop(1,'rgba(0,0,0,0)'); shadowContext.fillStyle = gradient; shadowContext.fillRect(0,0,64,64);
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(1.2,1.2), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(shadowCanvas), transparent: true, depthWrite: false })); shadow.rotation.x = -Math.PI / 2; scene.add(shadow);
  const emotes = ['Jig','Headbang','Spin','Zombie dance','Dance','Cheer','Jump for joy','Air guitar','Rabbit hop','Glass box'].filter((n) => avatar.seqNames().includes(n));
  const forward = new THREE.Vector3(), right = new THREE.Vector3(), move = new THREE.Vector3();
  let previousTime = performance.now(), hudTime = 0;
  renderer.setAnimationLoop((time) => {
    const frameStart = performance.now(); let physicsMs = 0, animationMs = 0;
    const dt = Math.min(Math.max((time - previousTime) / 1000, 0), 0.1); previousTime = time;
    const gamepad = pad.read();
    if (keys.takePress('Escape') || gamepad.pause) ui.togglePause();
    if (keys.takePress('KeyH')) ui.show('help');
    if (!ui.paused) {
      if (keys.takePress('KeyV')) chase.follow = !chase.follow;
      if (keys.takePress('KeyP')) relocate(park.spawn);
      if (keys.takePress('KeyR')) { look = avatar.randomLook(look.female); avatar.setLook(look); }
      if (keys.takePress('KeyG')) { look = avatar.randomLook(!look.female); avatar.setLook(look); }
      if (keys.takePress('KeyF') && !busy && skater.grounded && !skater.bailTime) {
        const feet = skating ? skater.position : player.position;
        const heading = skating ? skater.travelHeading : player.rotation.y - Math.PI;
        skater.reset(feet,heading); player.position.set(feet.x,feet.y,feet.z);
        renderPosition.copy(player.position);renderHeading=heading;renderPitch=renderTilt=grindOffset=0;animator.reset();
        skating = !skating; board.root.visible = skating; player.rotation.set(0,skating?heading+Math.PI/2:heading+Math.PI,0); avatar.setSkatePose(null);
      }
      if (keys.takePress('KeyT') && !busy) { busy = true; skater.speed = 0; avatar.setSkatePose(null); avatar.play('Teleport', { loop: false, maxDuration: 1.6, onDone: () => relocate(home) }); }
      for (let i = 0; i < 10; i++) if (keys.takePress(`Digit${(i+1)%10}`) && !busy && emotes[i] && (!skating || (skater.grounded && skater.speed < 0.1))) {
        busy = true; avatar.setSkatePose(null); avatar.play(emotes[i], { loop: false, onDone: () => { busy = false; } });
      }
      const pop = keys.takeRelease('Space') || gamepad.pop, flip = keys.takePress('KeyQ') || gamepad.flip, shove = keys.takePress('KeyE') || gamepad.shove;
      const steer = Math.max(-1, Math.min(1, Number(keys.has('KeyA')) - Number(keys.has('KeyD')) + gamepad.steer));
      if (skating && !busy) {
        const physicsStart = performance.now();
        skater.update(dt, { push: keys.has('KeyW') || gamepad.push, brake: keys.has('KeyS') || gamepad.brake, steer, crouch: keys.has('Space') || gamepad.crouch, pop, flip, shove, manual: keys.has('KeyM') || gamepad.manual, grind: keys.has('ShiftLeft') || keys.has('ShiftRight') || gamepad.grind });
        physicsMs = performance.now()-physicsStart; const animationStart = performance.now();
        renderTarget.set(skater.position.x,skater.position.y,skater.position.z);
        renderPosition.lerp(renderTarget,1-Math.exp(-28*dt));
        renderHeading=dampAngle(renderHeading,skater.heading,28,dt);
        renderPitch=dampAngle(renderPitch,skater.pitch,24,dt);
        grindOffset=damp(grindOffset,skater.grinding?0.08:0,28,dt);
        player.position.copy(renderPosition);player.position.y+=avatar.skateSoleOffset-grindOffset;
        const fallAngle = skater.bailTime > 0.45 ? Math.min(1, (1.05-skater.bailTime)/0.2) * Math.PI * 0.48 : skater.bailTime / 0.45 * Math.PI * 0.48;
        renderTilt=dampAngle(renderTilt,fallAngle || renderPitch + (skater.stumbleTime > 0 ? Math.sin(skater.animationTime*24)*0.12 : -steer*Math.min(skater.speed/9,1)*0.07),24,dt);
        player.rotation.set(0,renderHeading+Math.PI/2,renderTilt,'YXZ');
        avatar.setSkatePose(animator.update(skater,dt)); board.update(skater,dt,steer);
        board.root.position.copy(renderPosition);board.root.position.y-=grindOffset;
        board.root.rotation.y=renderHeading;board.root.rotation.x=renderPitch;
        animationMs = performance.now()-animationStart;
      } else if (!skating && !busy) {
        camera.getWorldDirection(forward); forward.y = 0; forward.normalize(); right.crossVectors(forward,camera.up); move.set(0,0,0);
        if (keys.has('KeyW')) move.add(forward); if (keys.has('KeyS')) move.sub(forward); if (keys.has('KeyD')) move.add(right); if (keys.has('KeyA')) move.sub(right);
        if (move.lengthSq()) {
          const running = keys.has('ShiftLeft') || keys.has('ShiftRight'); move.normalize().multiplyScalar((running?4:2)*dt);
          const ground = collision.groundAt(player.position.x+move.x,player.position.z+move.z,player.position.y+0.46);
          if (ground !== null && ground >= player.position.y-0.5 && collision.canRideAt(player.position.x+move.x,player.position.z+move.z,player.position.y)) { const next = collision.move(player.position,{x:move.x,y:ground-player.position.y,z:move.z}); player.position.set(next.x,next.y,next.z); player.rotation.y = Math.atan2(move.x,move.z); }
          avatar.play(running?'Run':'Walk');
        } else avatar.play('Idle');
      }
      avatar.update(dt);
      for (const event of skater.drainEvents()) { career.event(event); audio.cue(event); }
      career.tick(dt, skater);
      for (const token of park.tokens) if (!token.collected) {
        token.mesh.rotation.y += dt*1.4; token.mesh.position.y = token.position.y + Math.sin(time/700)*0.08;
        if (Math.hypot(player.position.x-token.position.x, player.position.y+0.5-token.position.y, player.position.z-token.position.z) < 0.85) { token.collected = true; token.mesh.visible = false; career.collect(token.id); }
      }
    } else keys.clear();
    audio.enabled = career.profile.sound; audio.update(skater,ui.paused || !skating);
    chase.controls.enabled = !ui.paused;
    chase.update(player.position, skater.travelHeading, skating ? skater.speed : 0, skating, dt, collision);
    const ground = collision.groundAt(player.position.x,player.position.z,player.position.y+0.1);
    shadow.visible = ground !== null; if (ground !== null) { shadow.position.set(player.position.x,ground+0.015,player.position.z); shadow.scale.setScalar(Math.max(0.5,1-(player.position.y-ground)*0.15)); }
    world.update(player.position,time);
    const renderStart = performance.now();
    renderer.render(scene,camera);
    const renderMs = performance.now()-renderStart; chase.restore();
    hudTime += dt; if (hudTime > 0.08) { hudTime = 0; ui.update(skater,skating); }
    monitor.sample(time,{physics:physicsMs,animation:animationMs,render:renderMs,total:performance.now()-frameStart},{paused:ui.paused,area:player.position.x<0?'training':'lumbridge',...world.stats});
  });
}
main().catch((error) => { loading.textContent = `Could not open the game: ${error}`; console.error(error); });
