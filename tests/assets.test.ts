import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeSoup } from '../src/world/load.ts';
import { Avatar } from '../src/player/avatar.ts';
import type { AnimData, Wardrobe } from '../src/shared/player-data.ts';

test('triangle decoder rejects missing, truncated, oversized, and HTML asset responses', () => {
  assert.throws(() => decodeSoup(new ArrayBuffer(3)), /header/);
  const header = new ArrayBuffer(4);
  new DataView(header).setUint32(0, 1, true);
  assert.throws(() => decodeSoup(header), /invalid triangle/);
  assert.throws(() => decodeSoup(new ArrayBuffer(5)), /invalid triangle/);
  assert.throws(() => decodeSoup(new TextEncoder().encode('<!doctype html>').buffer), /invalid triangle/);
});

test('triangle decoder preserves meter scale and separates alpha geometry', () => {
  const buffer = new ArrayBuffer(4 + 2 * 22);
  new DataView(buffer).setUint32(0, 2, true);
  new Int16Array(buffer, 4, 18).set([0, 0, 0, 128, 0, 0, 0, 0, 128, 0, 128, 0, 128, 128, 0, 0, 128, 128]);
  new Uint8Array(buffer, 40, 8).set([255, 0, 0, 255, 0, 255, 0, 128]);
  const soup = decodeSoup(buffer);
  assert.equal(soup.opaque.getAttribute('position').count, 3);
  assert.equal(soup.opaque.getAttribute('position').getZ(2), -1, 'z is stored negated (north is -z)');
  assert.equal(soup.opaque.getAttribute('position').getX(1), 1);
  assert.equal(soup.translucent?.getAttribute('position').getY(0), 1);
  assert.ok(Math.abs(soup.translucent!.getAttribute('color').getW(0) - 128 / 255) < 0.00001);
  const collision = decodeSoup(buffer, 'collision', { positionsOnly: true });
  assert.equal(collision.opaque.getAttribute('position').getX(1), 1);
  assert.equal(collision.opaque.getAttribute('normal'), undefined);
  assert.equal(collision.opaque.getAttribute('color'), undefined);
});

const wardrobe: Wardrobe = { kits: [], items: [], sourceBody: [], destBody: [], sourceSkin: [], destSkin: [] };
test('one-shot avatar animations finish once, including missing animation assets', () => {
  const data: AnimData = { seqs: [{ id: 0, name: 'Test', frames: [0, 1], delays: [1, 1] }], framesets: {}, bases: {} };
  const avatar = new Avatar(wardrobe, data);
  avatar.setLook(avatar.defaultLook());
  let completed = 0;
  avatar.play('Test', { loop: false, onDone: () => completed++ });
  avatar.update(0.1);
  avatar.update(0.1);
  assert.equal(completed, 1);
  avatar.play('Missing', { loop: false, onDone: () => completed++ });
  assert.equal(completed, 2);
});

test('one-shot avatar animation applies the final pose before completion', () => {
  const w: Wardrobe = {
    ...wardrobe,
    kits: [{ id: 0, feature: 2, model: { v: [0, 0, 0, 128, 0, 0, 0, -128, 0], b: [0, 0, 0], t: [0, 1, 2], c: [100] } }],
    sourceBody: [0, 0, 0, 0, 0], destBody: [[], [], [], [], []],
    sourceSkin: [0, 0, 0, 0, 0], destSkin: [[], [], [], [], []],
  };
  const data: AnimData = {
    seqs: [{ id: 0, name: 'Test', frames: [0, 1], delays: [1, 1] }],
    framesets: { 0: { 0: { base: 0, ops: [[0, -1, 0, 0, 0]] }, 1: { base: 0, ops: [[0, -1, 128, 0, 0]] } } },
    bases: { 0: { types: [1], labels: [[0]] } },
  };
  const avatar = new Avatar(w, data);
  avatar.setLook(avatar.defaultLook());
  let finalX = -1;
  avatar.play('Test', { loop: false, onDone: () => { finalX = avatar.mesh.geometry.getAttribute('position').getX(0); } });
  avatar.update(0.1);
  assert.equal(finalX, 1);
});

test('action deadline releases a cache animation with a server-controlled hold frame', () => {
  const data: AnimData = { seqs: [{ id: 714, name: 'Teleport', frames: [0, 1], delays: [6, 20000] }], framesets: {}, bases: {} };
  const avatar = new Avatar(wardrobe, data);
  avatar.setLook(avatar.defaultLook());
  let completed = 0;
  avatar.play('Teleport', { loop: false, maxDuration: 1.6, onDone: () => completed++ });
  avatar.update(0.5);
  assert.equal(completed, 0);
  avatar.update(1.2);
  assert.equal(completed, 1);
  avatar.update(10);
  assert.equal(completed, 1);
});

test('soup positions reach 512 tiles: unsigned x and -z, signed y', async () => {
  const { writeSoupCorner, soupPositions } = await import('../src/shared/soup.ts');
  const buffer = new ArrayBuffer(4 + 22), view = new DataView(buffer);
  view.setUint32(0, 1, true);
  writeSoupCorner(view, 0, 320 * 128, -2 * 128, -383 * 128);
  writeSoupCorner(view, 1, -5, 40, 3);
  new Uint8Array(buffer, 22, 4).set([10, 20, 30, 255]);
  const p = soupPositions(buffer, 0, 1);
  assert.deepEqual([...p.slice(0, 6)], [320 * 128, -2 * 128, -383 * 128, 0, 40, 0], 'far corner kept; overhang past the edge clamped');
  assert.equal(decodeSoup(buffer).opaque.getAttribute('position').getX(0), 320);
});
