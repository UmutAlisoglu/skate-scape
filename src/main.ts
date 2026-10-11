import * as THREE from 'three';
import { ASSET_BASE, loadBytes, loadJson, type WorldManifest } from './world/load.ts';
import { loadSurfaces, rsMaterial, rsUniforms } from './world/rs-material.ts';
import { createSky } from './world/sky.ts';
import { CollisionStream, WorldCollision } from './world/collision.ts';
import { RenderWorld } from './world/render.ts';
import { Avatar } from './player/avatar.ts';
import { SkateAnimator } from './player/skate-pose.ts';
import { GRAB_LIFT } from './player/skate-rig.ts';
import { damp, dampAngle } from './shared/motion.ts';
import type { AnimData, Wardrobe } from './shared/player-data.ts';
import { GameInput } from './game/input.ts';
import { Skater } from './game/skater.ts';
import { Skateboard } from './game/board.ts';
import { ChaseCamera } from './game/camera.ts';
import { trainingGrounds } from './game/park.ts';
import { Career } from './game/career.ts';
import { GameUI } from './game/ui.ts';
import { SkateAudio } from './game/audio.ts';
import { PadInput } from './game/gamepad.ts';
import { PerformanceMonitor } from './game/performance.ts';
import { FIRE_COLORS, GOLD_COLORS, GrindSparks, RUNE_COLORS, SURGE_COLORS } from './game/sparks.ts';
import { placesIn, type LocalPlace } from './game/places.ts';
import { SessionMarker } from './game/marker.ts';
import { loadMapImage, Minimap, type MapMarker } from './game/minimap.ts';
import { PROP_KINDS, PropManager } from './game/props.ts';
import { ChallengeTracker, challengesFor } from './game/challenges.ts';
import { Replay } from './game/replay.ts';
import { DECKS } from './game/decks.ts';
import { Fireworks } from './game/fireworks.ts';
import { placeRunes, RuneTokens, RUNE_KINDS, type TownRune } from './game/runes.ts';
import { HintCoach } from './game/hints.ts';
import { abilitiesFor } from './game/skill.ts';
import { ChatLayer } from './game/chatter.ts';
import { Crowd } from './game/crowd.ts';
import { RandomEvents } from './game/events.ts';
import { BOARD_TIERS, withBoard } from './game/boards.ts';
import { PETS, PetFollower } from './game/pets.ts';
import { RaceManager } from './game/races.ts';
import { GhostRider, loadGhost, saveGhost } from './game/ghost.ts';
import { Landmarks, MEGA, type BuiltCatapult } from './game/landmarks.ts';
import { loadNpcs } from './player/npc-actor.ts';
import { RemoteWorld, SourceUnavailable } from './world/remote/remote-world.ts';
import type { RenderManifest } from './shared/render-chunk.ts';
import type { Rail } from './game/skater.ts';
import './style.css';

const requestedArea = new URLSearchParams(location.search).get('area');
/** The map: ?area=…, or else the biggest one exported (a fresh setup may only have exported Lumbridge). */
let AREA = requestedArea && /^[a-z0-9_-]+$/i.test(requestedArea) ? requestedArea : '';
const exported = async (area: string) => { try { return !!await loadJson<WorldManifest>(`${ASSET_BASE}world/${area}/manifest.json`); } catch { return false; } };
async function firstExportedArea() {
  for (const area of ['gielinor', 'misthalin', 'lumbridge']) if (await exported(area)) return area;
  return null;
}
/**
 * Where the world comes from: ?source=local plays the exports in public/ (npm run export:*), ?source=gitlab builds it
 * in this browser from the 2009scape cache on GitLab. Without ?source, local exports are used when there are any.
 */
const SOURCE = new URLSearchParams(location.search).get('source');
const AREA_NAMES: Record<string, string> = { gielinor: 'Gielinor', misthalin: 'Misthalin', lumbridge: 'Lumbridge' };
const loading = document.getElementById('hud')!;
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
const requestedRatio=Number(new URLSearchParams(location.search).get('dpr'));
renderer.setPixelRatio(requestedRatio>0?Math.max(0.75,Math.min(requestedRatio,2)):Math.min(devicePixelRatio,1)); renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.NoToneMapping; // RS materials write final client-space colors
renderer.domElement.tabIndex = 0; renderer.domElement.setAttribute('aria-label', 'Skate Scape game view');
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
const sky = createSky(rsUniforms.fogColor.value); scene.add(sky);
const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.1, 88);
const chase = new ChaseCamera(camera, renderer.domElement);
const keys = new GameInput(); const pad = new PadInput(); const audio = new SkateAudio();
const monitor = new PerformanceMonitor(renderer);
addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });

async function main() {
  const local = SOURCE === 'gitlab' ? null : AREA ? (SOURCE === 'local' || await exported(AREA) ? AREA : null) : await firstExportedArea();
  if (SOURCE === 'local' && !local) throw new Error('No exported map in public/world. Run the exporters (docs/ASSET_SETUP.md) or drop ?source=local to build the world from GitLab.');
  let remote: RemoteWorld | null = null;
  if (local) AREA = local;
  else { AREA ||= 'gielinor'; remote = await RemoteWorld.open(AREA, (text) => { loading.textContent = text; }); }
  const base = remote ? remote.base : `${ASSET_BASE}world/${AREA}`, playerBase = `${ASSET_BASE}player`;
  const manifest = remote ? remote.manifest : await loadJson<WorldManifest>(`${base}/manifest.json`);
  loading.textContent = `Opening ${manifest.name}…`;
  if (manifest.format !== 2) throw new Error('This map was exported in an older format. Run npm run export:world.');
  if (remote) {
    // the player, the NPCs and the streets at the spawn point; the rest of the map builds in the background
    const [sx, sy] = manifest.spawn, status = setInterval(() => { loading.textContent = remote!.status(AREA === 'gielinor' ? 'Lumbridge' : manifest.name); }, 150);
    try { await Promise.all([remote.player(), remote.npcs(), remote.ensureAround(sx + 0.5, -(sy + 0.5), 8).then(() => performance.mark('world-spawn'))]); } finally { clearInterval(status); }
  }
  const [wardrobe, anims, surfaces, traversal, runeSpots, npcs] = await Promise.all([
    loadJson<Wardrobe>(`${playerBase}/wardrobe.json`), loadJson<AnimData>(`${playerBase}/anims.json`), remote ? remote.surfaces : loadSurfaces(`${ASSET_BASE}surfaces`),
    remote ? remote.traversal : loadBytes(`${base}/traversal.bin`),
    remote ? [] : loadJson<{ id: string; place: string; kind: number; position: [number, number, number] }[]>(`${base}/runes.json`),
    loadNpcs(`${ASSET_BASE}npcs/npcs.json`),
  ]);
  loading.textContent = 'Preparing the streets and training grounds…';
  const park = trainingGrounds(scene, surfaces);
  // the training park is always solid; the map's terrain, objects and grind lines stream in cells around the rider
  const collision = new WorldCollision([park.collisionGeometry]); collision.rails = [...park.rails];
  collision.setTraversal(manifest.sizeTiles[0],manifest.sizeTiles[1],traversal);
  const stream = remote ? CollisionStream.empty(base, collision, 16, 64) : await CollisionStream.load(base, collision);
  // browser-built regions hand their collision cells over from the start, so the spawn's ground is there before we look for it
  remote?.onRegion((region) => stream.addCells(region.result.cells));
  /** Ground under a map point once its collision is loaded: the floor nearest the terrain, not a roof. */
  const groundPoint = async (x: number, z: number) => {
    // (a browser-built world builds the streets there first)
    if (remote) await remote.ensureAround(x, z);
    await stream.preload({ x, y: 0, z });
    const terrainY = collision.groundAt(x, z, 25, true) ?? 0;
    return new THREE.Vector3(x, collision.groundAt(x, z, terrainY + 1.2) ?? terrainY, z);
  };
  const [sx, sy] = manifest.spawn;
  const home = await groundPoint(sx + 0.5, -(sy + 0.5));
  const places = placesIn(manifest.baseTile, manifest.sizeTiles), areaName = AREA_NAMES[AREA] ?? manifest.name;
  /** A world tile on this map, as a local position (null off the map). */
  const localTile = ([tx, ty]: [number, number]) => { const x = tx - manifest.baseTile[0], y = ty - manifest.baseTile[1]; return x >= 0 && y >= 0 && x < manifest.sizeTiles[0] && y < manifest.sizeTiles[1] ? new THREE.Vector3(x + 0.5, 0, -(y + 0.5)) : null; };
  // races: RS agility courses and downhill bombs, with the ghost of your best run
  const races = new RaceManager(scene, localTile, (x, z) => { const t = collision.groundAt(x, z, 25, true); return t === null ? null : collision.groundAt(x, z, t + 1.2) ?? t; });
  const raceSpots = races.available.map((race) => ({ id: `race-${race.id}`, name: race.name, spell: race.name, tile: race.checkpoints[0], blurb: race.blurb, region: 'Races', ...localTile(race.checkpoints[0])!, y: undefined }));
  // mega ramps and catapults (before quick drop, so dropped props keep their grind lines and quarter pipes)
  const landmarks = new Landmarks(scene, collision, surfaces, localTile);
  let catapultFlight = false, catapultLoad: { c: BuiltCatapult; name: string; target: THREE.Vector3 | null; wind: number } | null = null;
  const aimAt = (to: string) => { const place = places.find((p) => p.id === to); return place ? new THREE.Vector3(place.x, 0, place.z) : null; };
  landmarks.update(0, aimAt);
  const landmarkSpots = landmarks.spots(places).map((spot) => ({ ...spot, spell: spot.name, tile: [0, 0] as [number, number], region: 'Landmarks', y: undefined }));
  const ghostKey = (id: string) => `scape-skate-ghost-${id}${new URLSearchParams(location.search).has('test') ? '-test' : ''}`;
  loading.textContent='Opening nearby streets…';
  const worldMaterials={opaque:rsMaterial({surfaces,vertexColors:true,cutout:true}),translucent:rsMaterial({surfaces,vertexColors:true,transparent:true,cutout:true})};
  const emptyWorld:RenderManifest={version:3,cellSize:16,triangles:0,vertices:0,bytes:0,chunks:[]};
  const world=remote?new RenderWorld(`${base}/render`,emptyWorld,worldMaterials,surfaces.lookup):await RenderWorld.load(`${base}/render`,worldMaterials,surfaces.lookup);scene.add(world.group);
  const avatar = new Avatar(wardrobe, anims, surfaces); let look = avatar.defaultLook(false);
  look.colors = [1, 4, 2, 1, 0]; avatar.setLook(look); avatar.play('Idle'); scene.add(avatar.mesh);
  const player = avatar.mesh; player.position.copy(home);
  chase.controls.target.copy(home).add(new THREE.Vector3(0, 0.85, 0)); camera.position.copy(home).add(new THREE.Vector3(0, 2.6, 5)); chase.controls.update();
  const skater = new Skater(collision, home); const board = new Skateboard(); scene.add(board.root);
  const sparks = new GrindSparks(); scene.add(sparks.points);
  const surgeTrail = new GrindSparks(SURGE_COLORS, 11, 2.6); scene.add(surgeTrail.points);
  // special attack effects, one emitter per special
  const specialFx = { rune: new GrindSparks(RUNE_COLORS, 10, 1.8), teleport: new GrindSparks(SURGE_COLORS, 12, 2.2), dragon: new GrindSparks(FIRE_COLORS, 13, 2), godsword: new GrindSparks(GOLD_COLORS, 10, 1.2) };
  for (const fx of Object.values(specialFx)) scene.add(fx.points);
  // RS level-up fireworks for challenges and levels, and a little camera shake on bonks and slams
  const fireworks = new Fireworks(); scene.add(fireworks.points); let shake = 0;
  // Agility leaps and wallplants leave a short trail of RS-green agility sparks
  const leapTrail = new GrindSparks({ hot: new THREE.Color(0.85, 1, 0.6), cool: new THREE.Color(0.2, 0.7, 0.15) }, 12, 2.2); scene.add(leapTrail.points); let leapGlow = 0;
  const hints = new HintCoach(collision); let abilityLevel = -1, ridingBoard = '';
  // dragon boards trail fire, third-age ones sparkle
  const boardTrails = { fire: new GrindSparks(FIRE_COLORS, 9, 1.6), sparkle: new GrindSparks(GOLD_COLORS, 9, 1.3) };
  for (const trail of Object.values(boardTrails)) scene.add(trail.points);
  // other players out skating, with RS public chat over their heads and in the chatbox
  const chat = new ChatLayer(), crowd = new Crowd(scene, collision, wardrobe, anims, surfaces, chat);
  const pet = new PetFollower(scene, collision, npcs, surfaces, chat);
  const animator=new SkateAnimator(),renderPosition=home.clone(),renderTarget=new THREE.Vector3();
  let renderHeading=0,renderPitch=0,renderTilt=0,grindOffset=0,renderRoll=0,renderSlide=0,grindYaw=0,grindPitch=0,grindRoll=0,grabLift=0;
  const wallOffset=new THREE.Vector3(),wallTarget=new THREE.Vector3(),deckUp=new THREE.Vector3();
  /** the board's own flight while the rider is down after a bail */
  let bailBoard: { velocity: THREE.Vector3; spin: THREE.Vector3 } | null = null;
  // skate.-style replay of the last 20 seconds of skating (Backspace, or the pause menu)
  const replay = new Replay();
  const career = new Career(localStorage, new URLSearchParams(location.search).has('test') ? 'scape-skate-test' : 'scape-skate-career'); let skating = true; let busy = false; let ui: GameUI;
  // five RS runes hidden above grind lines in every town (THPS letters)
  const townRunes: TownRune[] = runeSpots.map((r) => ({ ...r, position: new THREE.Vector3(...r.position) }));
  const runes = new RuneTokens(scene, townRunes, (id) => career.profile.townRunes.includes(id));
  if (remote) {
    // regions built in the browser join the world as they arrive; a town gets its runes once its streets are all in
    const rails = new Map<string, Rail>(), runed = new Set<string>();
    remote.onRegion((region) => {
      world.addChunks(region.result.chunks);
      for (const rail of region.rails) rails.set(rail.id, rail);
      for (const place of places) if (!runed.has(place.id) && remote!.builtAround(place.x, place.z, 60)) {
        runed.add(place.id);
        const near = [...rails.values()].filter((r) => Math.hypot((r.a.x + r.b.x) / 2 - place.x, (r.a.z + r.b.z) / 2 - place.z) < 60);
        runes.add(placeRunes(place, near, remote!.terrainAt));
      }
    });
  }
  await world.preload(home,48);
  board.setDesign(DECKS[career.profile.board] ?? DECKS[0]);
  // RS random events (Evil Chicken, Genie, Sandwich Lady...) every few minutes of skating
  const randomEvents = new RandomEvents(scene, collision, npcs, surfaces, chat, {
    reward: (xp, text) => { const before = career.level; career.award(xp); career.toast = `${text} · +${xp.toLocaleString('en-GB')} XP${career.level > before ? ` · Skateboarding level ${career.level}!` : ''}`; career.toastTime = 4; career.cheer ??= 'challenge'; },
    toast: (text) => { career.toast = text; career.toastTime = 4; },
    level: () => career.level,
    success: (kind) => { if (kind === 'evilchicken') career.grantPet('chicken', 'Chicken', 'A little chicken followed the Evil Chicken home'); },
    mysteryBox: () => {
      const board = BOARD_TIERS.filter((t) => t.combo <= 40000 && !career.profile.boards.includes(t.id))[0];
      if (board && Math.random() < 0.5) { career.grantBoard(board.id, 'A board in the box'); return `a ${board.name}!`; }
      if (!career.profile.pets.includes('cat') && Math.random() < 0.35) { career.grantPet('cat', 'Cat', 'A cat jumps out of the box'); return 'a cat!'; }
      const xp = career.level * 250; career.award(xp); return `${xp.toLocaleString('en-GB')} Skateboarding XP`;
    },
  });
  const relocate = (position: { x: number; y: number; z: number }, message = position === park.spawn ? 'Training grounds · collect the five runes' : `${areaName} · roll out and find a line`) => { catapultLoad = null; catapultFlight = false; crowd.clear(); randomEvents.end(); races.cancel(); ghost.show(null); pet.snap(new THREE.Vector3(position.x, position.y, position.z)); skater.message = message; skating = true; busy = false; avatar.setSkatePose(null); skater.reset(position, 0); player.position.set(position.x, position.y, position.z);renderPosition.copy(player.position);renderHeading=renderPitch=renderTilt=grindOffset=renderRoll=renderSlide=grindYaw=grindPitch=grindRoll=0;wallOffset.set(0,0,0);animator.reset();board.root.visible = true; chase.snap(position,0); };
  /** RS teleport: the spell animation plays while the destination's streets and collision load. */
  let focus: THREE.Vector3 | null = null;
  const teleport = (to: () => Promise<THREE.Vector3>, message?: string) => {
    if (busy) return; busy = true; skater.speed = 0; renderTilt = 0; player.rotation.set(0, player.rotation.y, 0, 'YXZ'); avatar.setSkatePose(null);
    const cast = new Promise<void>((done) => avatar.play('Teleport', { loop: false, maxDuration: 1.6, onDone: done }));
    // the destination loads (pinned, so the rider's current spot can't cancel it) while the spell plays;
    // collision streaming follows the destination meanwhile
    void Promise.all([cast, to().then(async (target) => { focus = target; await world.preload(target, 40, true); return target; })])
      .then(([, target]) => relocate(target, message)).catch((error) => { busy = false; console.error('Teleport failed', error); })
      .finally(() => { focus = null; world.unpin(); });
  };
  const teleportTo = (place: LocalPlace) => teleport(() => groundPoint(place.x, place.z), `${place.name} · ${place.blurb}`);
  ui = new GameUI(career, {
    start: (mode, training) => { career.start(mode); skater.totalScore = 0; skater.drainEvents(); relocate(training ? park.spawn : home); },
    practice: () => relocate(park.spawn), board: (index) => board.setDesign(DECKS[index] ?? DECKS[0]), pause: () => keys.clear(), teleport: teleportTo,
    replay: () => { if (skating && replay.begin()) chase.follow = true; },
  }, [...places, ...raceSpots, ...landmarkSpots], areaName);
  const ghost = new GhostRider(scene, wardrobe, anims, surfaces); let ghostPosition: THREE.Vector3 | null = null;
  // skate.-style session marker: Z drops it where you are (with your speed and direction), X takes you back
  const marker = new SessionMarker(scene);
  const mapImage = remote ? remote.mapImage() : await loadMapImage(base), minimap = mapImage ? new Minimap(mapImage, places, teleportTo) : null;
  // skate.-style quick drop: B opens it; props save per map on this browser
  const props = new PropManager(scene, collision, collision.rails, surfaces, `scape-skate-props-${AREA}`); props.load();
  // spot challenges: the nearest teleport destination within 60 m is the spot you're skating
  const tracker = new ChallengeTracker(); let spot: LocalPlace | null = null;
  let drop: { kind: number; distance: number; side: number; turn: number; note: string; noteTime: number } | null = null;
  const boardBasis = new THREE.Matrix4(), surfaceUp = new THREE.Vector3(), surfaceNose = new THREE.Vector3(), surfaceSide = new THREE.Vector3(), riderTurn = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
  loading.hidden = true; performance.mark('scape-ready');
  const testing = new URLSearchParams(location.search).has('test');
  if (testing) Object.assign(window, { __scape: { avatar, skater, board, camera, chase, scene, world, collision, stream, places, teleportTo, marker, props, runes, career, hints, crowd, chat, randomEvents, pet, races, ghost, landmarks } });
  document.addEventListener('visibilitychange', () => { if (document.hidden) ui.pause(); }); addEventListener('beforeunload', () => career.save());
  for (const token of park.tokens) if (career.profile.runes.includes(token.id)) { token.collected = true; token.mesh.visible = false; }
  const shadowCanvas = document.createElement('canvas'); shadowCanvas.width = shadowCanvas.height = 64;
  const shadowContext = shadowCanvas.getContext('2d')!; const gradient = shadowContext.createRadialGradient(32,32,2,32,32,30); gradient.addColorStop(0,'rgba(0,0,0,.4)'); gradient.addColorStop(1,'rgba(0,0,0,0)'); shadowContext.fillStyle = gradient; shadowContext.fillRect(0,0,64,64);
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(1.2,1.2), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(shadowCanvas), transparent: true, depthWrite: false })); shadow.rotation.x = -Math.PI / 2; scene.add(shadow);
  const emotes = ['Jig','Headbang','Spin','Zombie dance','Dance','Cheer','Jump for joy','Air guitar','Rabbit hop','Glass box'].filter((n) => avatar.seqNames().includes(n));
  const forward = new THREE.Vector3(), right = new THREE.Vector3(), move = new THREE.Vector3();
  let previousTime = performance.now(), hudTime = 0;
  /** world geometry between the camera and the rider turns see-through (the RS shader's cutout) */
  const aimCutout = () => { rsUniforms.cutCamera.value.copy(camera.position); rsUniforms.cutTarget.value.set(player.position.x, player.position.y + 1, player.position.z); rsUniforms.cutRadius.value = 1.1; };
  const frame = (time: number) => {
    const frameStart = performance.now(); let physicsMs = 0, animationMs = 0;
    const dt = Math.min(Math.max((time - previousTime) / 1000, 0), 0.1); previousTime = time;
    const gamepad = pad.read();
    if (replay.active) {
      // replay: play the buffer back with a free orbit camera (drag); the live game waits
      if (keys.takePress('Backspace') || keys.takePress('Escape') || gamepad.pause) { replay.stop(); ui.setReplay(null); keys.clear(); chase.snap(skater.position, skater.cameraHeading); }
      else {
        if (keys.takePress('Space')) replay.playing = !replay.playing;
        if (keys.takePress('KeyW')) replay.faster(); if (keys.takePress('KeyS')) replay.slower();
        replay.advance(dt, (Number(keys.has('KeyD')) - Number(keys.has('KeyA'))) * dt * 2.5);
        const frame = replay.apply(player, board.root);
        board.setDeck(frame.deck); board.root.visible = frame.boardVisible;
        if (frame.pose) { avatar.setSkatePose(frame.pose); avatar.update(replay.playing ? dt * replay.speed : 0); }
        else if (frame.sequence) avatar.showSequence(frame.sequence, frame.sequenceTime);
        chase.update(player.position, renderHeading, 0, false, dt, collision);
        world.update(player.position, time); stream.update(player.position);
        aimCutout(); renderer.render(scene, camera); chase.restore();
        ui.setReplay({ at: replay.cursor - replay.start, length: replay.length, speed: replay.speed, playing: replay.playing, tricks: frame.tricks, combo: frame.combo });
        return;
      }
    }
    if (keys.takePress('Escape') || gamepad.pause) ui.togglePause();
    if (keys.takePress('KeyH')) ui.show('help');
    if (!ui.paused) {
      if (keys.takePress('KeyV')) chase.follow = !chase.follow;
      if (keys.takePress('Tab')) minimap?.toggle();
      if (keys.takePress('KeyP')) relocate(park.spawn);
      if (keys.takePress('KeyR')) { look = avatar.randomLook(look.female); avatar.setLook(look); }
      // G: Surge while skating, a different body type on foot
      if (!skating && keys.takePress('KeyG')) { look = avatar.randomLook(!look.female); avatar.setLook(look); }
      if (keys.takePress('KeyF') && !busy && skater.grounded && !skater.bailTime) {
        const feet = skating ? skater.position : player.position;
        const heading = skating ? skater.travelHeading : player.rotation.y - Math.PI;
        skater.reset(feet,heading); player.position.set(feet.x,feet.y,feet.z);
        renderPosition.copy(player.position);renderHeading=heading;renderPitch=renderTilt=grindOffset=0;animator.reset();
        keys.takePress('ShiftLeft'); keys.takePress('ShiftRight'); // a run-key press while walking isn't a revert
        skating = !skating; board.root.visible = skating; player.rotation.set(0,skating?heading+Math.PI/2:heading+Math.PI,0); avatar.setSkatePose(null);
      }
      if (keys.takePress('KeyT') && !busy) { if (places.length > 1) ui.show('teleport'); else teleport(async () => home); }
      if (keys.takePress('KeyZ') && skating && !busy) skater.message = marker.set(skater);
      if (keys.takePress('KeyX') && skating && !busy && marker.saved) {
        const saved = marker.saved; relocate(saved.position, 'Session marker · run it again');
        skater.heading = renderHeading = saved.heading; skater.speed = saved.speed; chase.snap(saved.position, saved.heading);
      }
      if (!drop && skating && !busy && keys.takePress('Backspace')) { if (!replay.begin()) skater.message = 'Skate a little first · the replay keeps your last 20 seconds'; }
      // races: Enter in a start ring begins one (the countdown holds the rider on the line)
      const startable = !drop && skating && !busy ? races.startAt(player.position) : null;
      if (startable && keys.takePress('Enter')) {
        races.begin(startable); crowd.clear(); randomEvents.end();
        ghost.setLook(look); ghost.show(loadGhost(ghostKey(startable.id)));
        const start = races.startOf(startable); chase.snap(start.position, start.heading);
      }
      if (races.running && races.running.countdown > 0) { const start = races.startOf(races.running.race); skater.reset(start.position, start.heading); }
      // mega ramps: Enter at the ladder climbs the tower; on the ramps you go faster than anywhere else
      const ladder = !drop && skating && !busy && !startable ? landmarks.ladderAt(player.position) : null;
      if (ladder && keys.takePress('Enter')) {
        const top = landmarks.towerTop(ladder); relocate(top.position, `You climb to the top of the ${ladder.site.name} · push off and drop in!`);
        skater.heading = renderHeading = top.heading; chase.snap(top.position, top.heading);
      }
      const mega = landmarks.megaAt(skater.position); skater.boostCap = mega ? MEGA.boostCap : 0; skater.slopeBoost = mega ? MEGA.slopeBoost : 1;
      // catapults: roll onto the pad and the arm winds back while the destination's ground loads (streaming
      // follows the destination from then until you land), then you're lobbed across the map
      const catapult = !catapultLoad && !catapultFlight && skating && !busy && !drop && skater.grounded && skater.bailTime === 0 ? landmarks.catapultAt(skater.position) : null;
      const destination = catapult ? places.find((place) => place.id === catapult.site.to) : null;
      if (catapult && destination) {
        const load = { c: catapult, name: destination.name, target: null as THREE.Vector3 | null, wind: 0 };
        catapultLoad = load; landmarks.windUp(catapult); focus = new THREE.Vector3(destination.x, 0, destination.z);
        void groundPoint(destination.x, destination.z).then((target) => { load.target = target; return world.preload(target, 40, true); }).catch((error) => console.error('Catapult target failed', error));
        skater.message = `The catapult winds up · next stop ${destination.name}`;
      }
      if (catapultLoad) {
        const load = catapultLoad; skater.reset(load.c.pad, load.c.group.rotation.y); load.wind += dt;
        if (load.wind > 1.2 && load.target) {
          const v = landmarks.fire(load.c, load.target); catapultLoad = null; catapultFlight = true;
          skater.launch(v.vx, v.vy, v.vz, ['Catapult', 1500]); skater.message = `Catapulted to ${load.name}!`; audio.fanfare('challenge');
        }
      }
      if (catapultFlight && !skater.soaring) { catapultFlight = false; focus = null; world.unpin(); }
      if (keys.takePress('KeyB') && skating && !busy) {
        if (drop) { drop = null; props.preview(null); skater.message = `Quick drop closed · ${props.props.length} obstacle${props.props.length === 1 ? '' : 's'} placed`; }
        else if (skater.grounded && !skater.transition && !skater.grinding && !skater.bailTime) { drop = { kind: 0, distance: 4.5, side: 0, turn: 0, note: '', noteTime: 0 }; skater.speed = 0; }
      }
      if (drop) {
        for (let i = 0; i < PROP_KINDS.length; i++) if (keys.takePress(`Digit${i + 1}`)) drop.kind = i;
        const step = 3.5 * dt, heading = skater.travelHeading, fx = -Math.sin(heading), fz = -Math.cos(heading), rx = Math.cos(heading), rz = -Math.sin(heading);
        if (keys.has('KeyW')) drop.distance = Math.min(14, drop.distance + step); if (keys.has('KeyS')) drop.distance = Math.max(1.5, drop.distance - step);
        if (keys.has('KeyD')) drop.side += step; if (keys.has('KeyA')) drop.side -= step;
        if (keys.takePress('KeyQ')) drop.turn += Math.PI / 12; if (keys.takePress('KeyE')) drop.turn -= Math.PI / 12;
        const x = skater.position.x + fx * drop.distance + rx * drop.side, z = skater.position.z + fz * drop.distance + rz * drop.side;
        const terrainY = collision.groundAt(x, z, 25, true) ?? skater.position.y, y = collision.groundAt(x, z, Math.max(terrainY, skater.position.y) + 1.2) ?? terrainY;
        const kind = PROP_KINDS[drop.kind], placed = { kind: kind.kind, x, y, z, yaw: heading + drop.turn };
        props.preview(placed);
        if (keys.takeRelease('Space') || keys.takePress('Enter')) { drop.note = props.add({ id: `prop-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e4)}`, ...placed }) ? `${kind.label} dropped · B to ride it` : 'That\'s plenty of obstacles · remove some with Backspace'; drop.noteTime = 2; }
        if (keys.takePress('Backspace') || keys.takePress('Delete')) { const near = props.nearest(x, z, 3.5); drop.note = near ? 'Removed' : 'Nothing to remove here'; drop.noteTime = 1.5; if (near) props.remove(near.id); }
        // confirmations linger for a moment, then the menu line comes back
        drop.noteTime = Math.max(0, drop.noteTime - dt);
        skater.message = drop.noteTime > 0 ? drop.note : `Quick drop · ${drop.kind + 1} ${kind.label} · 1–6 choose · Q/E rotate · WASD move · Space place · Backspace remove · B done`;
      }
      for (let i = 0; i < 10; i++) if (!drop && keys.takePress(`Digit${(i+1)%10}`) && !busy && emotes[i] && (!skating || (skater.grounded && skater.speed < 0.1))) {
        busy = true; avatar.setSkatePose(null); avatar.play(emotes[i], { loop: false, onDone: () => { busy = false; } });
      }
      const pop = !drop && (keys.takeRelease('Space') || gamepad.pop), flip = !drop && (keys.takePress('KeyQ') || gamepad.flip), shove = !drop && (keys.takePress('KeyE') || gamepad.shove);
      const steer = Math.max(-1, Math.min(1, Number(keys.has('KeyA')) - Number(keys.has('KeyD')) + gamepad.steer));
      // runs every frame so sparks keep fading after a grind, a dismount or a teleport
      sparks.update(dt,skating&&!busy&&skater.grinding?renderPosition:null,-Math.sin(skater.travelHeading),-Math.cos(skater.travelHeading),skater.speed);
      surgeTrail.update(dt,skating&&!busy&&skater.surgeTime<0.45?renderPosition:null,-Math.sin(skater.travelHeading),-Math.cos(skater.travelHeading),skater.speed);
      leapGlow = Math.max(0, leapGlow - dt); leapTrail.update(dt, skating && !busy && leapGlow > 0 ? renderPosition : null, -Math.sin(skater.travelHeading), -Math.cos(skater.travelHeading), skater.speed);
      for (const [effect, trail] of Object.entries(boardTrails)) trail.update(dt, skating && !busy && skater.bailTime === 0 && skater.speed > 3 && career.board.effect === effect ? renderPosition : null, -Math.sin(skater.travelHeading), -Math.cos(skater.travelHeading), skater.speed);
      const specialKind = !skating || busy ? null : skater.trick && skater.trick.elapsed < skater.trick.duration ? skater.trick.special : skater.grab?.special ?? (skater.grindStyle?.special ? 'godsword' : null);
      for (const [kind, fx] of Object.entries(specialFx)) fx.update(dt, kind === specialKind ? board.root.position : null, -Math.sin(skater.travelHeading), -Math.cos(skater.travelHeading), skater.speed);
      // Teleport shove: the board blinks out mid-spin and reappears under the feet
      const teleporting = skater.trick?.special === 'teleport' && skater.trick.elapsed / skater.trick.duration > 0.2 && skater.trick.elapsed / skater.trick.duration < 0.8;
      board.root.visible = skating && !teleporting;
      // Skateboarding levels unlock abilities (skill.ts): wallplant, Agility leap, bigger pops...
      if (career.level !== abilityLevel || career.board.id !== ridingBoard) {
        abilityLevel = career.level; ridingBoard = career.board.id;
        for (const def of PETS) if (def.level && career.level >= def.level && !career.profile.pets.includes(def.id)) career.grantPet(def.id, def.name, `Skateboarding level ${def.level}`);
        skater.abilities = withBoard(abilitiesFor(abilityLevel), career.board); board.setTier(career.board);
      }
      if (skating && !busy) {
        const physicsStart = performance.now();
        // Shift / RB: wider grind catch while held in the air, a revert when tapped on the ground
        const revert = keys.takePress('ShiftLeft') || keys.takePress('ShiftRight') || !!gamepad.revert;
        // the quick-drop menu freezes the rider in place (still drawn on the board)
        if (!drop) skater.update(dt, { revert, push: keys.has('KeyW') || gamepad.push, brake: keys.has('KeyS') || gamepad.brake, steer, crouch: keys.has('Space') || gamepad.crouch, pop, flip, shove, manual: keys.has('KeyM') || gamepad.manual, grind: keys.has('ShiftLeft') || keys.has('ShiftRight') || gamepad.grind, grab: keys.has('KeyC') || gamepad.grab, surge: keys.takePress('KeyG') || !!gamepad.surge });
        physicsMs = performance.now()-physicsStart; const animationStart = performance.now();
        renderTarget.set(skater.position.x,skater.position.y,skater.position.z);
        renderPosition.lerp(renderTarget,1-Math.exp(-28*dt));
        renderHeading=dampAngle(renderHeading,skater.heading,28,dt);
        renderPitch=dampAngle(renderPitch,skater.pitch,24,dt);
        grindOffset=damp(grindOffset,skater.grinding?0.08:0,28,dt);
        // powerslide: board and rider swing sideways to the line of travel
        renderSlide=damp(renderSlide,skater.powerslide*Math.PI*0.45,12,dt);
        // a grab pulls the board up to the hand while the rider's body stays on its arc (same rate as the pose)
        grabLift=damp(grabLift,skater.grab?GRAB_LIFT/128:0,16,dt);
        // grind attitude (boardslide across the rail, nose / tail down for nosegrinds, 5-0s, crooks and smiths)
        const style=skater.grindStyle;grindYaw=damp(grindYaw,style?.yaw??0,18,dt);grindPitch=damp(grindPitch,style?.pitch??0,18,dt);grindRoll=damp(grindRoll,style?.roll??0,18,dt);
        // wallrides: the board rolls almost onto its side (wheels against the wall) and both slide in to meet it;
        // the rider leans in about half as far, like THPS, instead of lying flat out of the wall
        const wall=skater.wallride;let rollTarget=0;wallTarget.set(0,0,0);
        if(wall){const tx=-Math.sin(skater.travelHeading),tz=-Math.cos(skater.travelHeading);rollTarget=(-tz*wall.nx+tx*wall.nz<0?1:-1)*Math.PI*0.44;wallTarget.set(-wall.nx*0.2,0,-wall.nz*0.2);}
        renderRoll=damp(renderRoll,rollTarget,14,dt);wallOffset.lerp(wallTarget,1-Math.exp(-14*dt));
        renderTilt=dampAngle(renderTilt,renderPitch + (skater.stumbleTime > 0 ? Math.sin(skater.animationTime*24)*0.12 : -steer*Math.min(skater.speed/9,1)*0.07),24,dt);
        const pose = animator.update(skater,dt);
        if (skater.bailTime > 0) {
          // bail: the rider goes down with RS's own death animation while the board flies off and tumbles
          if (!bailBoard) {
            const h = skater.bailHeading, launch = 1.5 + skater.bailSlide * 1.3;
            bailBoard = { velocity: new THREE.Vector3(-Math.sin(h) * launch, 2.6, -Math.cos(h) * launch), spin: new THREE.Vector3((Math.random() - 0.5) * 16, (Math.random() - 0.5) * 9, 6 + Math.random() * 10) };
            avatar.setSkatePose(null); avatar.play('Death', { loop: false, speed: 2.1, maxDuration: 2.6 });
          }
          const b = bailBoard, p = board.root.position;
          b.velocity.y -= 14 * dt; p.addScaledVector(b.velocity, dt);
          const floor = collision.groundAt(p.x, p.z, p.y + 0.5);
          if (floor !== null && p.y < floor + 0.06) { p.y = floor + 0.06; if (b.velocity.y < 0) b.velocity.y *= -0.35; b.velocity.x *= 0.72; b.velocity.z *= 0.72; b.spin.multiplyScalar(0.55); }
          board.root.rotation.x += b.spin.x * dt; board.root.rotation.y += b.spin.y * dt; board.root.rotation.z += b.spin.z * dt;
          if (skater.bailTime < 0.45) {
            // getting up: the board slides back under the feet and settles
            p.lerp(renderPosition, 1 - Math.exp(-9 * dt));
            board.root.rotation.set(damp(board.root.rotation.x, 0, 9, dt), dampAngle(board.root.rotation.y, skater.bailHeading, 9, dt), damp(board.root.rotation.z, 0, 9, dt), 'YXZ');
          }
          player.position.copy(renderPosition); player.rotation.set(0, skater.bailHeading, 0);
          renderHeading = skater.bailHeading; renderTilt = renderPitch = 0;
          animationMs = performance.now()-animationStart;
        } else {
        if (bailBoard) bailBoard = null;
        avatar.setSkatePose(pose); board.update(skater,dt,steer);
        board.root.position.copy(renderPosition).add(wallOffset);board.root.position.y+=grabLift-grindOffset;
        const face = skater.surfaceFrame;
        if (face) {
          // on a quarter pipe the deck lies on the face: up out of it, nose along the board's line
          surfaceUp.set(face.normal.x, face.normal.y, face.normal.z); surfaceNose.set(-face.forward.x, -face.forward.y, -face.forward.z);
          surfaceSide.crossVectors(surfaceUp, surfaceNose).normalize(); surfaceNose.crossVectors(surfaceSide, surfaceUp).normalize();
          board.root.quaternion.setFromRotationMatrix(boardBasis.makeBasis(surfaceSide, surfaceUp, surfaceNose));
          renderHeading = skater.heading; renderPitch = skater.pitch;
        } else board.root.rotation.set(renderPitch+grindPitch,renderHeading+renderSlide+grindYaw,renderRoll+grindRoll,'YXZ');
        // the rider stands on the deck, whichever way the deck faces
        deckUp.set(0,1,0).applyQuaternion(board.root.quaternion);
        player.position.copy(board.root.position).addScaledVector(deckUp,avatar.skateSoleOffset);player.position.y-=grabLift;
        if (face) player.quaternion.copy(board.root.quaternion).multiply(riderTurn);
        else player.rotation.set(-renderRoll*0.57,renderHeading+renderSlide+grindYaw+Math.PI/2,renderTilt-Math.abs(renderSlide)*0.25+grindPitch*0.5,'YXZ');
        animationMs = performance.now()-animationStart;
        }
        if (!drop) replay.record(dt, {
          player, board: board.root, deck: board.deckAngles, boardVisible: board.root.visible,
          pose: avatar.skatePose, sequence: avatar.skatePose ? null : avatar.playing, sequenceTime: avatar.sequenceTime,
          tricks: skater.comboCount ? skater.comboNames.slice(-6).join(' + ') : '', combo: skater.comboCount ? `${Math.round(skater.comboPoints).toLocaleString('en-GB')} × ${skater.comboCount}` : '',
        });
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
      if (!busy) { crowd.update(dt, player.position); randomEvents.update(dt, skater, skating && !drop && !replay.active && !races.running); }
      if (skating && !busy) {
        const state = races.update(dt, skater, { player, board: board.root, deck: board.deckAngles, pose: avatar.skatePose });
        if (state === 'finished') {
          const result = races.finish(); ghost.show(null);
          if (career.finishRace(result.race.id, result.race.name, result.time, result.medal)) saveGhost(ghostKey(result.race.id), result.run);
        } else if (races.running && ghost.active) ghostPosition = ghost.update(races.running.time);
        if (races.running && races.nextCheckpoint && Math.hypot(races.nextCheckpoint.x - player.position.x, races.nextCheckpoint.z - player.position.z) > 150) { races.cancel(); ghost.show(null); skater.message = 'Race abandoned · too far from the course'; }
      }
      pet.setPet(career.profile.pet, player.position); if (!busy) pet.update(dt, skater, player.position, skating);
      // spots only count on the map (the training grounds sit just off its west edge, near Draynor's coordinates)
      const onMap = player.position.x >= 0 && player.position.z <= 0;
      const nearest = !onMap ? null : places.reduce<LocalPlace | null>((best, place) => {
        const d = Math.hypot(place.x - player.position.x, place.z - player.position.z);
        return d < 60 && (!best || d < Math.hypot(best.x - player.position.x, best.z - player.position.z)) ? place : best;
      }, null);
      if (nearest !== spot) { spot = nearest; tracker.reset(); }
      const open = spot ? challengesFor(spot.id).filter((c) => !career.profile.challenges.includes(c.id)) : [];
      if (spot && skating && !busy) for (const challenge of tracker.update(skater, dt, open)) career.completeChallenge(challenge, spot.name);
      for (const event of skater.drainEvents()) {
        career.event(event); audio.cue(event); crowd.react(event, player.position); randomEvents.notice(event); pet.react(event);
        if (event.type === 'bonk') shake = Math.max(shake, 0.3); else if (event.type === 'bail') shake = Math.max(shake, 0.7); else if (event.type === 'sketchy') shake = Math.max(shake, 0.15);
        if (event.type === 'leap' || (event.type === 'trick' && event.names[0] === 'Wallplant')) leapGlow = 0.35;
        if (spot) for (const challenge of tracker.event(event, open)) career.completeChallenge(challenge, spot.name);
      }
      ui.setSpot(spot?.name ?? null, spot ? challengesFor(spot.id) : [], tracker.best, spot ? { found: runes.runes.filter((r) => r.place === spot!.id && career.profile.townRunes.includes(r.id)).length, total: runes.runes.filter((r) => r.place === spot!.id).length } : null);
      if (skating) for (const rune of runes.update(time, player.position)) {
        const town = runes.runes.filter((r) => r.place === rune.place), place = places.find((p) => p.id === rune.place);
        career.collectTownRune(rune.id, RUNE_KINDS[rune.kind].name, place?.name ?? rune.place, town.filter((r) => career.profile.townRunes.includes(r.id)).length + 1, town.length);
      }
      if (career.cheer) { audio.fanfare(career.cheer); fireworks.burst(player.position, career.cheer); career.cheer = null; }
      career.tick(dt, skater);
      for (const token of park.tokens) if (!token.collected) {
        token.mesh.rotation.y += dt*1.4; token.mesh.position.y = token.position.y + Math.sin(time/700)*0.08;
        if (Math.hypot(player.position.x-token.position.x, player.position.y+0.5-token.position.y, player.position.z-token.position.z) < 0.85) { token.collected = true; token.mesh.visible = false; career.collect(token.id); }
      }
    } else keys.clear();
    audio.enabled = career.profile.sound; audio.update(skater,ui.paused || !skating);
    chase.controls.enabled = !ui.paused;
    chase.update(player.position, skater.cameraHeading, skating ? skater.speed : 0, skating, dt, collision);
    const ground = collision.groundAt(player.position.x,player.position.z,player.position.y+0.1);
    shadow.visible = ground !== null; if (ground !== null) { shadow.position.set(player.position.x,ground+0.015,player.position.z); shadow.scale.setScalar(Math.max(0.5,1-(player.position.y-ground)*0.15)); }
    if (shake > 0) { camera.position.x += (Math.random() - 0.5) * shake * 0.25; camera.position.y += (Math.random() - 0.5) * shake * 0.25; shake = Math.max(0, shake - dt * 2.5); }
    hints.enabled = career.profile.hints;
    const free = !ui.paused && skating && !busy && !drop && !races.running;
    const raceHere = free ? races.startAt(player.position) : null, ladderHere = free && !raceHere ? landmarks.ladderAt(player.position) : null;
    const catapultHere = free && !ladderHere && !catapultFlight ? landmarks.catapultNear(player.position) : null, flyTo = catapultHere ? places.find((p) => p.id === catapultHere.site.to)?.name : null;
    const hint = raceHere ? { id: 'race', parts: ['Press ', { key: 'Enter' }, ` to start the ${raceHere.name}`] } : ladderHere ? { id: 'ladder', parts: ['Press ', { key: 'Enter' }, ` to climb the ${ladderHere.site.name}`] }
      : flyTo ? { id: 'catapult', parts: [`Roll onto the catapult's pad to fly to ${flyTo}`] } : skating && !busy && !drop && !ui.paused ? hints.update(dt, skater) : null;
    chat.hidden = ui.paused; chat.update(dt, camera);
    fireworks.update(dt); landmarks.update(dt, aimAt);
    world.update(player.position,time); stream.update(focus ?? player.position); remote?.update(focus ?? player.position, time); marker.update(time);
    const renderStart = performance.now();
    aimCutout(); renderer.render(scene,camera);
    const renderMs = performance.now()-renderStart; chase.restore();
    hudTime += dt; if (hudTime > 0.05) {
      hudTime = 0; ui.update(skater,skating); ui.setHint(hint);
      const run = races.running, ghostAt = run && ghost.active ? ghostPosition : null, next = races.nextCheckpoint;
      ui.setRace(run ? { name: run.race.name, time: run.time, checkpoint: run.next, total: run.race.checkpoints.length - 1, best: career.profile.raceBest[run.race.id], medals: run.race.medals, countdown: run.countdown,
        ghost: ghostAt && next ? Math.hypot(next.x - ghostAt.x, next.z - ghostAt.z) - Math.hypot(next.x - player.position.x, next.z - player.position.z) : undefined } : null);
      if (minimap) {
        camera.getWorldDirection(forward);
        const markers: MapMarker[] = marker.position ? [{ ...marker.position, kind: 'marker' }] : [];
        for (const rune of runes.runes) if (!career.profile.townRunes.includes(rune.id)) markers.push({ x: rune.position.x, z: rune.position.z, kind: 'rune' });
        for (const spot of raceSpots) markers.push({ x: spot.x, z: spot.z, kind: 'spot' });
        for (const r of landmarks.ramps) markers.push({ x: r.group.position.x, z: r.group.position.z, kind: 'done' });
        for (const c of landmarks.catapults) markers.push({ x: c.group.position.x, z: c.group.position.z, kind: 'marker' });
        minimap.update(player.position.x, player.position.z, skating ? skater.travelHeading : player.rotation.y - Math.PI, -Math.atan2(forward.x, -forward.z), markers);
      }
    }
    monitor.sample(time,{physics:physicsMs,animation:animationMs,render:renderMs,total:performance.now()-frameStart},{paused:ui.paused,area:player.position.x<0?'training':'lumbridge',...world.stats});
  };
  let firstFrame = true;
  renderer.setAnimationLoop((time) => {
    frame(time);
    if (!firstFrame) return;
    firstFrame = false; performance.mark('scape-first-frame');
    if (remote) void reportRemoteWorld(remote);
  });
  // tests drive frames by hand (the desktop preview throttles animation frames while it's hidden)
  if (testing) Object.assign((window as unknown as { __scape: object }).__scape, { frames: async (count: number, step = 1000 / 60) => { for (let i = 0; i < count; i++) { frame(previousTime + step); if (i % 15 === 14) await new Promise((r) => setTimeout(r)); } } });
}
main().catch((error) => {
  console.error(error);
  loading.hidden = false;
  if (!(error instanceof SourceUnavailable)) { loading.textContent = `Could not open the game: ${error}`; return; }
  // GitLab unreachable or rate-limiting: say so, and offer to try again
  const message = document.createElement('p'), retry = document.createElement('button');
  message.textContent = `Couldn't download the world from the 2009scape GitLab (${error.message}). It may be busy or unreachable; try again in a minute.`;
  retry.type = 'button'; retry.className = 'retry'; retry.textContent = 'Try again'; retry.onclick = () => location.reload();
  loading.replaceChildren(message, retry);
});

/** Logs what building the world in this browser cost (and leaves it on window.__remoteWorld for measurements). */
async function reportRemoteWorld(remote: RemoteWorld) {
  const firstFrameMs = Math.round(performance.now()), ready = performance.getEntriesByName('scape-ready')[0]?.startTime;
  const cache = await remote.cacheStats().catch(() => null);
  const mainHeap = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize;
  const marks = Object.fromEntries(performance.getEntriesByType('mark').filter((m) => m.name.startsWith('world-')).map((m) => [m.name, Math.round(m.startTime)]));
  const summary = { firstFrameMs, readyMs: ready && Math.round(ready), marks, ...remote.stats, cache, mainHeap };
  Object.assign(window, { __remoteWorld: summary });
  const mb = (n?: number) => (n === undefined ? '?' : `${(n / 1e6).toFixed(1)} MB`);
  console.info(`[world] first playable frame at ${(firstFrameMs / 1000).toFixed(1)} s: ${mb(cache?.fetch.bytes)} downloaded in ${cache?.fetch.requests} requests (peak ${cache?.fetch.peakPerMinute}/min), `
    + `${mb(cache?.fetch.cacheBytes)} from IndexedDB; regions built ${remote.stats.regionsBuilt}, from IndexedDB ${remote.stats.regionsFromCache}`);
}
