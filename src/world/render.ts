import * as THREE from 'three';
import { decodeRenderChunk, distanceToChunkSquared, type RenderChunkRecord, type RenderManifest } from '../shared/render-chunk.ts';
import { loadJson } from './load.ts';
import type { Point } from '../game/skater.ts';

export function chunkGeometry(record: RenderChunkRecord, buffer: ArrayBuffer) {
  const data=decodeRenderChunk(buffer), geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.BufferAttribute(data.positions,3));
  geometry.setAttribute('normal',new THREE.BufferAttribute(data.normals,3,true));
  geometry.setAttribute('color',new THREE.BufferAttribute(data.colors,4,true));
  geometry.setAttribute('surface',new THREE.BufferAttribute(data.surfaces,1));
  geometry.setIndex(new THREE.BufferAttribute(data.indices,1));
  const b=record.bounds;
  geometry.boundingBox=new THREE.Box3(new THREE.Vector3(b[0]*128,b[1]*128,b[2]*128),new THREE.Vector3(b[3]*128,b[4]*128,b[5]*128));
  geometry.boundingSphere=geometry.boundingBox.getBoundingSphere(new THREE.Sphere());
  return geometry;
}

interface Loaded { record: RenderChunkRecord; mesh: THREE.Mesh; bytes: number }
interface Job { record: RenderChunkRecord; resolve: () => void; reject: (reason: unknown) => void }
/** Stream compact world geometry independently of gameplay collision. */
export class RenderWorld {
  readonly group=new THREE.Group();
  readonly viewDistance=64;
  revision=0;
  private loaded=new Map<string,Loaded>();
  private pending=new Map<string,Promise<void>>();
  private jobs: Job[]=[];
  private active=0;
  private position:Point={x:0,y:0,z:0};
  private lastRefresh=-Infinity;
  private disposed=false;
  private controllers=new Set<AbortController>();
  constructor(private base:string,private manifest:RenderManifest,private materials:{opaque:THREE.Material;translucent:THREE.Material}) {
    if(manifest.version!==1) throw new Error('Unsupported render world. Run npm run export:render.');
    this.group.name='Streamed world';
  }
  static async load(base:string,materials:{opaque:THREE.Material;translucent:THREE.Material}) {
    return new RenderWorld(base,await loadJson<RenderManifest>(`${base}/manifest.json`),materials);
  }
  private wanted() {
    const radius=this.viewDistance+this.manifest.cellSize;
    return this.manifest.chunks.filter(c=>distanceToChunkSquared(c,this.position.x,this.position.z)<=radius*radius)
      .sort((a,b)=>distanceToChunkSquared(a,this.position.x,this.position.z)-distanceToChunkSquared(b,this.position.x,this.position.z));
  }
  async preload(position:Point) {
    this.position={...position};
    await Promise.all(this.wanted().map(record=>this.request(record)));
    this.update(position,performance.now());
  }
  update(position:Point,time:number) {
    this.position={...position};
    for(const [id,entry] of this.loaded) {
      const distance=distanceToChunkSquared(entry.record,position.x,position.z);
      if(distance>(this.viewDistance+32)**2) { this.group.remove(entry.mesh);entry.mesh.geometry.dispose();this.loaded.delete(id);this.revision++; }
      else entry.mesh.visible=distance<=this.viewDistance**2;
    }
    if(time-this.lastRefresh<250) return;
    this.lastRefresh=time;
    // Retire queued requests after a teleport; in-flight responses are also checked before adding meshes.
    this.jobs=this.jobs.filter(job=>{
      if(distanceToChunkSquared(job.record,position.x,position.z)<=(this.viewDistance+32)**2) return true;
      this.pending.delete(job.record.id);job.resolve();return false;
    });
    for(const record of this.wanted()) if(!this.loaded.has(record.id)&&!this.pending.has(record.id)) {
      void this.request(record).catch(error=>{ if(!this.disposed) console.error('Could not stream world geometry',error); });
    }
  }
  private request(record:RenderChunkRecord):Promise<void> {
    if(this.loaded.has(record.id)) return Promise.resolve();
    const pending=this.pending.get(record.id);if(pending)return pending;
    let resolve!:()=>void,reject!:(reason:unknown)=>void;
    const promise=new Promise<void>((yes,no)=>{resolve=yes;reject=no;});
    this.pending.set(record.id,promise);this.jobs.push({record,resolve,reject});this.pump();return promise;
  }
  private pump() {
    while(!this.disposed&&this.active<2&&this.jobs.length) {
      const job=this.jobs.shift()!;this.active++;
      const controller=new AbortController();this.controllers.add(controller);
      void this.loadChunk(job.record,controller.signal).then(job.resolve,job.reject).finally(()=>{
        this.controllers.delete(controller);this.pending.delete(job.record.id);this.active--;this.pump();
      });
    }
  }
  private async loadChunk(record:RenderChunkRecord,signal:AbortSignal) {
    const response=await fetch(`${this.base}/${record.file}`,{signal});
    if(!response.ok) throw new Error(`${record.file}: HTTP ${response.status}`);
    const buffer=await response.arrayBuffer();
    if(this.disposed||distanceToChunkSquared(record,this.position.x,this.position.z)>(this.viewDistance+32)**2)return;
    if(buffer.byteLength!==record.bytes)throw new Error(`Incorrect render chunk size: ${record.file}`);
    const geometry=chunkGeometry(record,buffer),mesh=new THREE.Mesh(geometry,this.materials[record.kind]);
    mesh.name=record.id;mesh.scale.setScalar(1/128);mesh.updateMatrix();mesh.matrixAutoUpdate=false;
    mesh.visible=distanceToChunkSquared(record,this.position.x,this.position.z)<=this.viewDistance**2;
    this.loaded.set(record.id,{record,mesh,bytes:buffer.byteLength});this.group.add(mesh);this.revision++;
  }
  get stats() { return {loadedChunks:this.loaded.size,pendingChunks:this.pending.size,renderDataMB:+([...this.loaded.values()].reduce((n,c)=>n+c.bytes,0)/1e6).toFixed(2)}; }
  dispose() {
    this.disposed=true;for(const c of this.controllers)c.abort();for(const job of this.jobs)job.resolve();this.jobs=[];
    for(const entry of this.loaded.values())entry.mesh.geometry.dispose();this.loaded.clear();this.pending.clear();this.group.clear();
  }
}
