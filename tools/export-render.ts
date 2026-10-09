import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { encodeRenderChunk, type RenderChunkRecord, type RenderManifest } from '../src/shared/render-chunk.ts';

const area=process.argv[2]??'lumbridge';
if(!/^[a-z0-9_-]+$/i.test(area)) throw new Error('Invalid area name');
const base=`public/world/${area}`, directory=`${base}/render`, CELL=16;
mkdirSync(directory,{recursive:true});
const chunks: RenderChunkRecord[]=[];
const linear=new Uint8Array(256);
for(let i=0;i<256;i++) { const c=i/255; linear[i]=Math.round((c<=0.04045?c/12.92:Math.pow((c+0.055)/1.055,2.4))*255); }

for(const name of ['terrain','locs']) {
  const data=readFileSync(`${base}/${name}.bin`), count=data.readUInt32LE(0);
  if(data.length!==4+count*22) throw new Error('Invalid world soup');
  const material=readFileSync(`${base}/${name}.materials.bin`);
  if(material.length!==count*2) throw new Error('Invalid material reference count');
  const pos=new Int16Array(data.buffer,data.byteOffset+4,count*9), col=new Uint8Array(data.buffer,data.byteOffset+4+count*18,count*4);
  const groups=new Map<string,number[]>();
  for(let t=0;t<count;t++) {
    const p=t*9, x=Math.floor((pos[p]+pos[p+3]+pos[p+6])/(384*CELL)), z=Math.floor((pos[p+2]+pos[p+5]+pos[p+8])/(384*CELL));
    const key=`${x}_${z}_${col[t*4+3]===255?'opaque':'translucent'}`;
    let ids=groups.get(key); if(!ids) groups.set(key,ids=[]); ids.push(t);
  }
  let completed=0;
  for(const [key,ids] of groups) {
    const P:number[]=[],N:number[]=[],C:number[]=[],S:number[]=[],I:number[]=[], lookup=new Map<string,number>();
    const bounds:[number,number,number,number,number,number]=[Infinity,Infinity,Infinity,-Infinity,-Infinity,-Infinity];
    for(const t of ids) {
      const p=t*9, c=t*4, surface=material.readUInt16LE(t*2);
      const abx=pos[p+3]-pos[p], aby=pos[p+4]-pos[p+1], abz=pos[p+5]-pos[p+2];
      const acx=pos[p+6]-pos[p], acy=pos[p+7]-pos[p+1], acz=pos[p+8]-pos[p+2];
      const nx=aby*acz-abz*acy, ny=abz*acx-abx*acz, nz=abx*acy-aby*acx, length=Math.hypot(nx,ny,nz)||1;
      const normal=[Math.round(nx/length*127),Math.round(ny/length*127),Math.round(nz/length*127)];
      const rgba=((col[c]<<24)|(col[c+1]<<16)|(col[c+2]<<8)|col[c+3])>>>0;
      for(let v=0;v<3;v++) {
        const x=pos[p+v*3], y=pos[p+v*3+1], z=pos[p+v*3+2];
        const vertexKey=`${x},${y},${z},${normal[0]},${normal[1]},${normal[2]},${rgba},${surface}`;
        let index=lookup.get(vertexKey);
        if(index===undefined) {
          index=P.length/3; lookup.set(vertexKey,index); P.push(x,y,z); N.push(...normal); C.push(linear[col[c]],linear[col[c+1]],linear[col[c+2]],col[c+3]); S.push(surface);
          bounds[0]=Math.min(bounds[0],x/128); bounds[1]=Math.min(bounds[1],y/128); bounds[2]=Math.min(bounds[2],z/128);
          bounds[3]=Math.max(bounds[3],x/128); bounds[4]=Math.max(bounds[4],y/128); bounds[5]=Math.max(bounds[5],z/128);
        }
        I.push(index);
      }
    }
    const buffer=encodeRenderChunk({positions:Int16Array.from(P),normals:Int8Array.from(N),colors:Uint8Array.from(C),surfaces:Uint16Array.from(S),indices:Uint32Array.from(I)});
    const id=`${name}_${key}`, file=`${id}.bin`;
    writeFileSync(`${directory}/${file}`,Buffer.from(buffer));
    chunks.push({id,file,kind:key.endsWith('translucent')?'translucent':'opaque',triangles:ids.length,vertices:P.length/3,bytes:buffer.byteLength,bounds});
    if(++completed%30===0) console.log(`${name}: ${completed}/${groups.size} chunks`);
  }
}
const manifest:RenderManifest={version:1,cellSize:CELL,triangles:chunks.reduce((n,c)=>n+c.triangles,0),vertices:chunks.reduce((n,c)=>n+c.vertices,0),bytes:chunks.reduce((n,c)=>n+c.bytes,0),chunks};
writeFileSync(`${directory}/manifest.json`,JSON.stringify(manifest));
console.log(`Render world: ${chunks.length} spatial chunks, ${manifest.triangles.toLocaleString()} triangles, ${manifest.vertices.toLocaleString()} shared vertices (${(manifest.bytes/1e6).toFixed(1)} MB total; only nearby chunks load)`);
