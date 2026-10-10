import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { encodeRenderChunk, decodeRenderChunk, distanceToChunkSquared, type RenderChunkData, type RenderChunkRecord } from '../src/shared/render-chunk.ts';
import { chunkGeometry } from '../src/world/render.ts';

const triangle=():RenderChunkData=>({positions:new Int16Array([0,0,0,128,0,0,0,0,128]),normals:new Int8Array([0,127,0,0,127,0,0,127,0]),colors:new Uint8Array([20,40,60,255,20,40,60,255,20,40,60,255]),surfaces:new Uint16Array([6,6,6]),uvs:new Float32Array([0,1,1.5,1,0,-2.25]),indices:new Uint32Array([0,1,2])});
const record:RenderChunkRecord={id:'test',file:'test.bin',kind:'opaque',vertices:3,triangles:1,bytes:0,bounds:[0,0,0,1,0,1],origin:[0,0,0]};

test('compact render data retains positions, normals, alpha, materials, and vertex indices',()=>{
  const original=triangle(),buffer=encodeRenderChunk(original),decoded=decodeRenderChunk(buffer);
  assert.deepEqual(decoded.positions,original.positions);assert.deepEqual(decoded.normals,original.normals);assert.deepEqual(decoded.colors,original.colors);assert.deepEqual(decoded.surfaces,original.surfaces);assert.deepEqual(decoded.uvs,original.uvs);
  assert.deepEqual([...decoded.indices],[0,1,2]);assert.ok(decoded.indices instanceof Uint16Array);
  assert.equal(decoded.positions.buffer,buffer); // zero-copy render attributes
});
test('invalid or stale chunks fail before creating GPU geometry',()=>{
  assert.throws(()=>decodeRenderChunk(new ArrayBuffer(2)),/header/);
  const invalid=encodeRenderChunk(triangle());new DataView(invalid).setUint32(0,0,true);assert.throws(()=>decodeRenderChunk(invalid),/format/);
  const valid=encodeRenderChunk(triangle());assert.throws(()=>decodeRenderChunk(valid.slice(0,-1)),/length/);
  assert.throws(()=>encodeRenderChunk({...triangle(),indices:new Uint32Array([0,1,9])}),/outside/);
  const badIndex=encodeRenderChunk(triangle()),view=new DataView(badIndex);view.setUint16(badIndex.byteLength-2,9,true);assert.throws(()=>decodeRenderChunk(badIndex),/outside/);
});
test('render chunks preserve world-space size and correct normalized GPU attributes',()=>{
  const geometry=chunkGeometry(record,encodeRenderChunk(triangle())),mesh=new THREE.Mesh(geometry);mesh.scale.setScalar(1/128);mesh.updateMatrixWorld();
  const vertex=new THREE.Vector3().fromBufferAttribute(geometry.getAttribute('position'),1);mesh.localToWorld(vertex);
  assert.equal(vertex.x,1);assert.equal(geometry.getAttribute('normal').getY(0),1);
  assert.ok(Math.abs(geometry.getAttribute('color').getX(0)-20/255)<0.000001);assert.equal(geometry.getAttribute('color').getW(0),1);
  assert.equal(geometry.getAttribute('surface').getX(0),6);assert.ok(geometry.boundingSphere!.radius/128>=Math.sqrt(0.5));
  assert.equal(geometry.getAttribute('uv').getX(1),1.5);assert.equal(geometry.getAttribute('uv').getY(2),-2.25);
});
test('render chunks remap cache texture ids to texture-array layers and drop unknown textures',()=>{
  const lookup=new Uint16Array(8);lookup[6]=3; // texture id 5 (+1 = 6) lives in layer 2 (+1 = 3)
  assert.equal(chunkGeometry(record,encodeRenderChunk(triangle()),lookup).getAttribute('surface').getX(0),3);
  const unknown={...triangle(),surfaces:new Uint16Array([40,40,40])};
  assert.equal(chunkGeometry(record,encodeRenderChunk(unknown),lookup).getAttribute('surface').getX(0),0);
});
test('spatial selection uses geometry bounds and remains correct across teleport and tile edges',()=>{
  assert.equal(distanceToChunkSquared(record,0.5,0.5),0);assert.equal(distanceToChunkSquared(record,2,1),1);
  assert.equal(distanceToChunkSquared(record,-2,-3),13);assert.ok(distanceToChunkSquared(record,-28,-90)>64**2);
});
