// Export only solid loc faces. Grass and wall decorations must not trap the skater.
import { readFileSync, writeFileSync } from 'node:fs';
import { CacheStore } from './cache/store.ts';
import { Defs } from './cache/defs.ts';
import type { WorldManifest } from '../src/world/load.ts';
import type { Rail } from '../src/game/skater.ts';
import { joinRails } from '../src/shared/rails.ts';

const area = process.argv[2] ?? 'lumbridge';
if (!/^[a-z0-9_-]+$/i.test(area)) throw new Error('Invalid area name');
const base = `public/world/${area}`;
const manifest = JSON.parse(readFileSync(`${base}/manifest.json`, 'utf8')) as WorldManifest;
const data = readFileSync(`${base}/locs.bin`);
const count = data.readUInt32LE(0);
if (data.length !== 4 + count * 22) throw new Error('Invalid locs.bin length');
const solid = new Uint8Array(count);
const defs = new Defs(new CacheStore('vendor/2009scape-cache'));
const rails: Rail[] = [];
for (const placed of manifest.locs) {
  const decorativePlant = /grass|flower|daisies|bush|reeds|fern|nettle|thistle|mushroom|lily|seaweed|wheat|cabbage|potato|onion|flax|fire|smoke/i.test(placed.name);
  if (decorativePlant || (placed.type >= 4 && placed.type <= 8)) continue;
  if (placed.type === 22 && defs.loc(placed.id).blockwalk !== 1 && !/rock|boulder|fence|barrier|crate|statue/i.test(placed.name)) continue;
  const [first, length] = placed.t;
  if (first < 0 || length < 0 || first + length > count) throw new Error(`Invalid triangle range for loc ${placed.id}`);
  solid.fill(1, first, first + length);
  if ((placed.type <= 3 && placed.type !== 2) || /fence|railing|bench/i.test(placed.name)) {
    const min = [Infinity,Infinity,Infinity], max = [-Infinity,-Infinity,-Infinity];
    let samples=0,sumX=0,sumZ=0,sumXX=0,sumZZ=0,sumXZ=0;
    for (let t = first; t < first + length; t++) for (let v = 0; v < 3; v++) for (let axis = 0; axis < 3; axis++) {
      const value = data.readInt16LE(4+t*18+v*6+axis*2)/128;
      min[axis] = Math.min(min[axis],value); max[axis] = Math.max(max[axis],value);
      if(axis===0){const z=data.readInt16LE(4+t*18+v*6+4)/128;samples++;sumX+=value;sumZ+=z;sumXX+=value*value;sumZZ+=z*z;sumXZ+=value*z;}
    }
    const height=max[1]-min[1],cx=sumX/samples,cz=sumZ/samples;
    const angle=0.5*Math.atan2(2*(sumXZ/samples-cx*cz),(sumXX/samples-cx*cx)-(sumZZ/samples-cz*cz));
    const ax=Math.cos(angle),az=Math.sin(angle);
    let lo=Infinity,hi=-Infinity,acrossLo=Infinity,acrossHi=-Infinity;
    for(let t=first;t<first+length;t++)for(let v=0;v<3;v++) {
      const x=data.readInt16LE(4+t*18+v*6)/128-cx,z=data.readInt16LE(4+t*18+v*6+4)/128-cz;
      const along=x*ax+z*az,across=-x*az+z*ax;lo=Math.min(lo,along);hi=Math.max(hi,along);acrossLo=Math.min(acrossLo,across);acrossHi=Math.max(acrossHi,across);
    }
    const width=acrossHi-acrossLo,middle=(acrossLo+acrossHi)/2;
    if (height > 0.3 && height < 4.5 && hi-lo > 0.8 && hi-lo < 24 && width < 1.1) {
      rails.push({ id: `loc-${placed.id}-${placed.plane}-${placed.type}-${placed.rot}-${placed.x}-${placed.y}`, name: placed.name === 'null' ? 'Stone ledge' : placed.name,width:Math.max(0.08,width),
        a:{x:cx+ax*(lo+0.1)-az*middle,y:max[1],z:cz+az*(lo+0.1)+ax*middle},
        b:{x:cx+ax*(hi-0.1)-az*middle,y:max[1],z:cz+az*(hi-0.1)+ax*middle} });
    }
  }
}
const solidCount = solid.reduce((sum, value) => sum + value, 0);
const output = Buffer.alloc(4 + solidCount * 22);
output.writeUInt32LE(solidCount);
let destination = 0;
for (let i = 0; i < count; i++) {
  if (!solid[i]) continue;
  data.copy(output, 4 + destination * 18, 4 + i * 18, 4 + (i + 1) * 18);
  // Collision is independent of visual transparency.
  output.fill(255, 4 + solidCount * 18 + destination * 4, 4 + solidCount * 18 + (destination + 1) * 4);
  destination++;
}
writeFileSync(`${base}/collision.bin`, output);
const connectedRails=joinRails(rails);
writeFileSync(`${base}/rails.json`, JSON.stringify(connectedRails));
console.log(`Wrote ${base}/collision.bin: ${solidCount} solid triangles (${count} visual triangles)`);
console.log(`Joined ${rails.length} wall/fence pieces into ${connectedRails.length} grind lines`);
