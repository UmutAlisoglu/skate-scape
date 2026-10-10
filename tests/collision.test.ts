import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { decodeCell, WorldCollision } from '../src/world/collision.ts';
import { writeSoupCorner } from '../src/shared/soup.ts';
import type { CollisionIndex } from '../src/world/load.ts';
import { Skater } from '../src/game/skater.ts';

function geometryWorld() {
  const floor = new THREE.PlaneGeometry(30, 30);
  floor.rotateX(-Math.PI / 2);
  const wall = new THREE.BoxGeometry(0.05, 3, 20);
  wall.translate(0, 1.5, 0);
  return new WorldCollision([floor, wall]);
}

test('capsule sweep cannot tunnel through a thin wall at skating speed', () => {
  const world = geometryWorld();
  const next = world.move({ x: -2, y: 0, z: 0 }, { x: 4, y: 0, z: 0 });
  assert.equal(next.blocked, true);
  assert.ok(next.x <= -0.24, `wall crossed: ${next.x}`);
});

test('diagonal movement slides along walls while remaining outside them', () => {
  const world = geometryWorld();
  const next = world.move({ x: -0.5, y: 0, z: 0 }, { x: 1, y: 0, z: -1 });
  assert.equal(next.blocked, true);
  assert.ok(next.x <= -0.24);
  assert.ok(next.z < -0.9);
});

test('ground sampling stays below roofs and handles edges of loaded geometry', () => {
  const floor = new THREE.PlaneGeometry(10, 10).rotateX(-Math.PI / 2);
  const roof = new THREE.BoxGeometry(4, 0.1, 4).translate(0, 3, 0);
  const world = new WorldCollision(); world.setCell('0_0', { terrain: floor, locs: roof, rails: [] });
  assert.equal(world.groundAt(0, 0, 0.36), 0);
  assert.ok(Math.abs(world.groundAt(0, 0, 4)! - 3.05) < 0.001);
  assert.equal(world.groundAt(20, 20, 4), null);
  assert.equal(world.groundAt(0, 0, 4, true), 0);
});

test('camera stays in front of a blocking wall and ground queries still point down', () => {
  const world = geometryWorld();
  const target = new THREE.Vector3(-2, 1, 0);
  const desired = new THREE.Vector3(2, 1, 0);
  const result = world.placeCamera(target, desired, new THREE.Vector3());
  assert.ok(result.x < -0.2);
  assert.equal(desired.x, 2);
  assert.equal(world.groundAt(-2, 0, 0.36), 0);
});

test('a rolling skater clears a small curb without a bail or abrupt stop', () => {
  const floor = new THREE.PlaneGeometry(20,20).rotateX(-Math.PI/2);
  const curb = new THREE.BoxGeometry(3,0.12,0.3).translate(0,0.06,-1);
  const world = new WorldCollision([floor,curb]);
  const skater = new Skater(world,{ x: 0,y: 0,z: 0 }); skater.speed = 6;
  for(let i=0;i<60;i++) skater.update(1/120,{ push: false,brake: false,steer: 0,crouch: false,pop: false,flip: false,shove: false });
  assert.equal(skater.bailTime,0); assert.ok(skater.position.z < -2.5); assert.ok(skater.speed > 5);
});

test('traversal blocks water but permits a solid bridge above it', () => {
  const floor = new THREE.PlaneGeometry(6,6).rotateX(-Math.PI/2);
  const bridge = new THREE.BoxGeometry(0.8,0.1,1).translate(1.5,1,-0.5);
  const world = new WorldCollision(); world.setCell('0_0', { terrain: floor, locs: bridge, rails: [] });
  world.setTraversal(3,3,new Uint8Array(9).fill(1));
  assert.equal(world.canRideAt(0.5,-0.5,0),false);
  assert.equal(world.canRideAt(1.5,-0.5,1.05),true);
  assert.equal(world.canRideAt(-10,-10,0),true);
});

test('streamed cells bring their grind lines and take them away again; static rails stay', () => {
  const world = new WorldCollision();
  world.rails = [{ id: 'park', name: 'Park rail', a: { x: -50, y: 0.5, z: 0 }, b: { x: -48, y: 0.5, z: 0 } }];
  const fence = { id: 'fence', name: 'Fence', a: { x: 1, y: 1, z: -1 }, b: { x: 6, y: 1, z: -1 } };
  world.setCell('0_0', { terrain: new THREE.PlaneGeometry(16, 16).rotateX(-Math.PI / 2).translate(8, 0, -8), locs: null, rails: [fence] });
  assert.deepEqual(world.railsNear(3, -1).map((r) => r.id), ['fence']);
  assert.ok(Math.abs(world.groundAt(4, -4, 1, true)!) < 1e-9, 'the cell carries the terrain');
  world.setCell('0_0', null);
  assert.deepEqual(world.railsNear(3, -1), []);
  assert.equal(world.groundAt(4, -4, 1, true), null);
  assert.deepEqual(world.railsNear(-49, 0).map((r) => r.id), ['park']);
});

test('collision cells far out on a big map are stored relative to their own corner', () => {
  const index: CollisionIndex = { version: 2, cell: 16, margin: 64, cells: [] };
  const [cx, cy] = [100, 90], ox = (cx * 16 - 64) * 128, on = (cy * 16 - 64) * 128;
  // one triangle around tile (1605, 1445), 1,600 tiles from the corner: too far for an absolute 16-bit soup
  const corners = [[1605, 1445], [1606, 1445], [1605, 1446]];
  const buffer = new ArrayBuffer(4 + 22), view = new DataView(buffer);
  view.setUint32(0, 1, true); new Uint8Array(buffer, 4 + 18, 4).fill(255); // opaque
  corners.forEach(([x, y], i) => writeSoupCorner(view, i, x * 128 - ox, 256, -(y * 128 - on)));
  const cell = decodeCell(index, [cx, cy, 1, 0, 0], { locs: buffer });
  const p = cell.locs!.getAttribute('position');
  assert.deepEqual([p.getX(0), p.getY(0), p.getZ(0)], [1605, 2, -1445]);
  assert.deepEqual([p.getX(2), p.getZ(2)], [1605, -1446]);
});
