import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Point, Rail } from './skater.ts';

export interface RuneToken { id: string; position: THREE.Vector3; mesh: THREE.Group; collected: boolean }
export function trainingGrounds(scene: THREE.Scene) {
  const center = new THREE.Vector3(-28, 2, -90);
  const surfaces: THREE.BufferGeometry[] = [];
  function pattern(kind: 'stone' | 'wood') {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 128;
    const context = canvas.getContext('2d')!;
    context.fillStyle = kind === 'stone' ? '#a69c83' : '#9b7048'; context.fillRect(0,0,128,128);
    for (let y=0;y<128;y++) for(let x=0;x<128;x++) {
      const noise = (Math.imul(x+7,374761393)^Math.imul(y+11,668265263)) >>> 16 & 255;
      context.fillStyle = `rgba(30,22,12,${noise/255*0.15})`; context.fillRect(x,y,1,1);
    }
    context.strokeStyle = kind === 'stone' ? '#686858' : '#634b35'; context.lineWidth = 2;
    for(let row=0;row<4;row++) {
      const y = row*32; context.beginPath(); context.moveTo(0,y); context.lineTo(128,y); context.stroke();
      if(kind==='stone') for(let x=(row%2)*32;x<128;x+=64) { context.beginPath();context.moveTo(x,y);context.lineTo(x,y+32);context.stroke(); }
      else for(let y2=y+4;y2<y+30;y2+=6) { context.beginPath();context.moveTo(0,y2);context.bezierCurveTo(35,y2-4,80,y2+5,128,y2);context.stroke(); }
    }
    const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    return texture;
  }
  const stoneTexture = pattern('stone'), woodTexture = pattern('wood');
  const stone = new THREE.MeshLambertMaterial({ color: 0xd6cbaa, map: stoneTexture });
  const wood = new THREE.MeshLambertMaterial({ color: 0xf1d2a1, map: woodTexture });
  const metal = new THREE.MeshLambertMaterial({ color: 0x6b8b91 });
  const trim = new THREE.MeshLambertMaterial({ color: 0x355449 });
  const add = (geometry: THREE.BufferGeometry, material: THREE.Material, solid = true) => {
    geometry.translate(center.x, center.y, center.z);
    if (material === stone || material === wood) {
      const positions = geometry.getAttribute('position'), normals = geometry.getAttribute('normal'), uv = new Float32Array(positions.count*2);
      for(let i=0;i<positions.count;i++) {
        const ny = Math.abs(normals.getY(i)), nx = Math.abs(normals.getX(i));
        uv[i*2] = nx > 0.5 ? positions.getZ(i) : positions.getX(i);
        uv[i*2+1] = ny > 0.5 ? positions.getZ(i) : positions.getY(i);
      }
      geometry.setAttribute('uv',new THREE.BufferAttribute(uv,2));
    }
    const mesh = new THREE.Mesh(geometry, material); scene.add(mesh);
    if (solid) {
      const copy = geometry.clone().deleteAttribute('normal').deleteAttribute('uv');
      surfaces.push(copy.index ? copy.toNonIndexed() : copy);
    }
    return mesh;
  };
  const box = (x: number, y: number, z: number, w: number, h: number, d: number, material = stone, solid = true) => add(new THREE.BoxGeometry(w, h, d).translate(x, y, z), material, solid);
  box(0, -0.25, 0, 36, 0.5, 32);
  const tiles=new THREE.InstancedMesh(new THREE.BoxGeometry(1.97,0.005,1.97),new THREE.MeshLambertMaterial({color:0xffffff,map:stoneTexture}),17*15);
  const matrix=new THREE.Matrix4();let tile=0;
  for (let x = -16; x <= 16; x += 2) for (let z = -14; z <= 14; z += 2) {
    matrix.makeTranslation(center.x+x,center.y+0.003,center.z+z);tiles.setMatrixAt(tile,matrix);
    tiles.setColorAt(tile,new THREE.Color(((x+z)%4)?0xcfc7aa:0xbcb396));tile++;
  }
  tiles.instanceMatrix.needsUpdate=true;tiles.instanceColor!.needsUpdate=true;tiles.computeBoundingSphere();scene.add(tiles);
  box(-18, 0.65, 0, 0.35, 1.3, 32); box(18, 0.65, 0, 0.35, 1.3, 32);
  box(0, 0.65, -16, 36, 1.3, 0.35); box(0, 0.65, 16, 36, 1.3, 0.35);
  box(7, 0.18, -1, 1.5, 0.36, 9);
  box(7, 0.365, -1, 1.65, 0.025, 9.1, metal, false);
  const rails: Rail[] = [];
  const wallTop=center.y+1.3;
  for(const x of [-18,18])rails.push({id:`training-wall-${x}`,name:'Training wall',width:0.35,a:{x:center.x+x,y:wallTop,z:center.z+15.8},b:{x:center.x+x,y:wallTop,z:center.z-15.8}});
  for(const z of [-16,16])rails.push({id:`training-wall-z${z}`,name:'Training wall',width:0.35,a:{x:center.x-17.8,y:wallTop,z:center.z+z},b:{x:center.x+17.8,y:wallTop,z:center.z+z}});
  for(const x of [6.25,7.75])rails.push({id:`training-ledge-${x}`,name:'Stone ledge',width:0.08,a:{x:center.x+x,y:center.y+0.3775,z:center.z+3.4},b:{x:center.x+x,y:center.y+0.3775,z:center.z-5.4}});
  for (const [x, z, length] of [[0, -1, 9], [-10, 6, 6]]) {
    const height = 0.62;
    box(x, height, z, 0.075, 0.075, length, metal);
    for (const end of [-length / 2 + 0.2, length / 2 - 0.2]) box(x, height / 2, z + end, 0.08, height, 0.08, metal);
    rails.push({ id: `rail-${x}`, name: x === 0 ? 'Courtyard rail' : 'West rail',width:0.075, a: { x: center.x + x, y: center.y + height + 0.04, z: center.z + z + length / 2 }, b: { x: center.x + x, y: center.y + height + 0.04, z: center.z + z - length / 2 } });
  }
  function ramp(x: number, z: number, width: number, length: number, height: number) {
    const a = -width / 2, b = width / 2;
    const points = [a,0,length/2,b,0,length/2,b,height,-length/2, a,0,length/2,b,height,-length/2,a,height,-length/2,
      a,0,length/2,a,height,-length/2,a,0,-length/2, b,0,length/2,b,0,-length/2,b,height,-length/2,
      a,height,-length/2,b,height,-length/2,b,0,-length/2,a,height,-length/2,b,0,-length/2,a,0,-length/2];
    const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3)); geometry.computeVertexNormals();
    geometry.translate(x, 0, z); add(geometry, wood);
    box(x, height + 0.03, z - length / 2, width + 0.1, 0.06, 0.08, metal);
  }
  ramp(-8, -6, 5, 7, 1.7); ramp(11, -10, 4, 6, 1.4);
  for (let x = -16; x <= 16; x += 8) box(x, 1.42, -16, 0.7, 0.35, 0.8, trim);
  const bannerCanvas = document.createElement('canvas'); bannerCanvas.width = 1024; bannerCanvas.height = 256;
  const ctx = bannerCanvas.getContext('2d')!; ctx.fillStyle = '#193e35'; ctx.fillRect(0, 0, 1024, 256); ctx.strokeStyle = '#cfb678'; ctx.lineWidth = 14; ctx.strokeRect(12,12,1000,232);
  ctx.fillStyle = '#f2e4b7'; ctx.font = 'bold 70px Georgia'; ctx.textAlign = 'center'; ctx.fillText('LUMBRIDGE', 512, 112); ctx.font = '40px Georgia'; ctx.fillText('TRAINING GROUNDS', 512, 178);
  const bannerTexture = new THREE.CanvasTexture(bannerCanvas); bannerTexture.colorSpace = THREE.SRGBColorSpace;
  const banner = new THREE.Mesh(new THREE.PlaneGeometry(9, 2.25), new THREE.MeshBasicMaterial({ map: bannerTexture, side: THREE.DoubleSide })); banner.position.copy(center).add(new THREE.Vector3(0, 3, -15.7)); scene.add(banner);
  const tokens: RuneToken[] = [];
  const locations = [[-12, 1, 10], [7, 1.1, 1], [-8, 2.5, -8], [11, 2.2, -11], [0, 1.35, -4]];
  locations.forEach(([x, y, z], i) => {
    const mesh = new THREE.Group();
    mesh.add(new THREE.Mesh(new THREE.TorusGeometry(0.30, 0.06, 8, 16), new THREE.MeshBasicMaterial({ color: 0xf4ca5b })));
    const diamond = new THREE.Mesh(new THREE.OctahedronGeometry(0.16), new THREE.MeshBasicMaterial({ color: 0x63e4d2 })); mesh.add(diamond);
    mesh.position.copy(center).add(new THREE.Vector3(x, y, z)); scene.add(mesh);
    tokens.push({ id: `rune-${i}`, position: mesh.position.clone(), mesh, collected: false });
  });
  const collisionGeometry = mergeGeometries(surfaces)!;
  return { center, spawn: { x: center.x, y: center.y, z: center.z + 12 } satisfies Point, collisionGeometry, rails, tokens };
}
