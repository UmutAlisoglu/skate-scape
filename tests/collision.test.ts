import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { WorldCollision } from '../src/world/collision.ts';
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
  const world = new WorldCollision([floor, roof]);
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
  const world = new WorldCollision([floor,bridge]);
  world.setTraversal(3,3,new Uint8Array(9).fill(1));
  assert.equal(world.canRideAt(0.5,-0.5,0),false);
  assert.equal(world.canRideAt(1.5,-0.5,1.05),true);
  assert.equal(world.canRideAt(-10,-10,0),true);
});
