import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Skater,type SkateWorld,type SkateInput } from '../src/game/skater.ts';
import { connectRails } from '../src/shared/rails.ts';
import { retainTree } from '../tools/world/tree-policy.ts';
import { SkateAnimator } from '../src/player/skate-pose.ts';
import { dampAngle } from '../src/shared/motion.ts';

const neutral:SkateInput={push:false,brake:false,steer:0,crouch:false,pop:false,flip:false,shove:false};
const flat:SkateWorld={groundAt:()=>0,move:(p,d)=>({x:p.x+d.x,y:p.y+d.y,z:p.z+d.z,blocked:false})};
const rail={id:'fence',name:'Fence',width:0.08,a:{x:0,y:0.6,z:2},b:{x:0,y:0.6,z:-8}};
function aboveFence(heading=0){const s=new Skater({...flat,rails:[rail]},{x:0,y:0.7,z:0});s.heading=heading;s.speed=4;if(heading!==0)s.update(1/60,{...neutral,pop:true});s.grounded=false;s.verticalSpeed=-1;return s;}
test('landing on a fence automatically attaches and remains attached without holding a key',()=>{
  const s=aboveFence();s.update(1/60,neutral);assert.ok(s.grinding);
  for(let i=0;i<30;i++)s.update(1/60,neutral);
  assert.ok(s.grinding);assert.ok(s.position.z < -1);assert.equal(s.totalScore,0);
});
test('the magnetic catch: crossings align, slow rises and lip catches latch, fast rises and far-below misses do not',()=>{
  const across=aboveFence(Math.PI/2);across.update(1/60,neutral);assert.ok(across.grinding);assert.ok(Math.abs(Math.sin(across.heading))<0.01);
  const fast=aboveFence();fast.verticalSpeed=3;fast.update(1/60,neutral);assert.equal(fast.grinding,null);
  const slow=aboveFence();slow.verticalSpeed=1.5;slow.update(1/60,neutral);assert.ok(slow.grinding,'still rising slowly past the top');
  const lip=aboveFence();lip.position.y=0.4;lip.update(1/60,neutral);assert.ok(lip.grinding,'catches the lip from just below');assert.equal(lip.position.y,0.6);
  const under=aboveFence();under.position.y=0.25;under.update(1/60,neutral);assert.equal(under.grinding,null);
});
test('the catch reaches a rail beside the board, Shift reaches further, and a tuck (Space held) skips it',()=>{
  const near=aboveFence();near.position.x=0.4;near.update(1/60,neutral);assert.ok(near.grinding);assert.equal(near.position.x,0);
  const far=aboveFence();far.position.x=0.7;far.update(1/60,neutral);assert.equal(far.grinding,null);
  const assisted=aboveFence();assisted.position.x=0.7;assisted.update(1/60,{...neutral,grind:true});assert.ok(assisted.grinding);
  const skip=aboveFence();skip.update(1/60,{...neutral,crouch:true});assert.equal(skip.grinding,null);
});
test('a fresh grind starts calm: no balance loss in the first two seconds without steering',()=>{
  const s=aboveFence();s.update(1/60,neutral);assert.ok(s.grinding);
  for(let i=0;i<120;i++)s.update(1/60,neutral);
  assert.ok(s.grinding,'still grinding after 2 s');assert.ok(Math.abs(s.balance)<1);
});
test('braking drops off and an ollie out does not immediately snap back to the same fence',()=>{
  const s=aboveFence();s.update(1/60,neutral);s.update(1/60,{...neutral,brake:true});assert.equal(s.grinding,null);assert.ok(Math.abs(s.position.x)>0.3);
  const jump=aboveFence();jump.update(1/60,neutral);jump.update(1/60,{...neutral,pop:true});
  for(let i=0;i<66;i++)jump.update(1/60,neutral);
  assert.equal(jump.grinding,null);assert.ok(jump.totalScore>0);
});
test('fence pieces on a slope weld into one sloped line; corners share a point; real height gaps stay apart',()=>{
  const piece=(id:string,points:[number,number,number][])=>({id,name:'Fence',width:0.1,points:points.map(([x,y,z])=>({x,y,z}))});
  // three tiles of fence climbing 0.2 m per tile, each measured 5 cm short of the tile boundary
  const slope=connectRails([piece('a',[[0,1,-0.05],[0,1.2,-0.95]]),piece('b',[[0,1.2,-1.05],[0,1.4,-1.95]]),piece('c',[[0,1.4,-2.05],[0,1.6,-2.95]])]);
  assert.equal(slope.length,1,'one straight, steady slope');
  const [line]=slope,top=line.a.y>line.b.y?line.a:line.b,bottom=line.a.y>line.b.y?line.b:line.a;
  assert.ok(Math.abs(bottom.y-1)<1e-9&&Math.abs(top.y-1.6)<1e-9);
  // an arch (slope changes) keeps its bend; the shared ends are welded so the grind can hand off
  const arch=connectRails([piece('up',[[0,1,0],[0,1.3,-0.95]]),piece('down',[[0,1.3,-1.05],[0,1.1,-2]])]);
  assert.equal(arch.length,2);
  const shared=(r:typeof arch[0])=>[r.a,r.b].find((p)=>Math.abs(p.z+1)<1e-9);
  assert.ok(shared(arch[0])&&shared(arch[1])&&shared(arch[0])!.y===shared(arch[1])!.y,'welded at the tile boundary');
  // an L corner: both runs end at one corner point
  const corner=connectRails([piece('west',[[0.05,1,-0.1],[0.05,1,-0.95]]),piece('north',[[0.1,1,-1.05],[0.95,1,-1.05]])]);
  const ends=corner.flatMap((r)=>[r.a,r.b]);
  assert.equal(new Set(ends.map((p)=>`${p.x},${p.y},${p.z}`)).size,3,'two segments meeting at one corner');
  // a wall top 0.8 m above the next one is a different ledge, not a step to grind up
  assert.equal(connectRails([piece('low',[[0,1,0],[0,1,-0.95]]),piece('high',[[0,1.8,-1.05],[0,1.8,-2]])]).length,2);
  const separate=connectRails([piece('low',[[0,1,0],[0,1,-0.95]]),piece('high',[[0,1.8,-1.05],[0,1.8,-2]])]).flatMap((r)=>[r.a,r.b]);
  assert.equal(new Set(separate.map((p)=>`${p.x},${p.y},${p.z}`)).size,4);
});
test('a grind follows a welded fence up a slope and round a corner, tilting the board',()=>{
  const fence=connectRails([
    {id:'climb',name:'Fence',width:0.1,points:[{x:0,y:0.6,z:2},{x:0,y:1,z:-2}]},
    {id:'turn',name:'Fence',width:0.1,points:[{x:0.05,y:1,z:-2.05},{x:-4,y:1,z:-2.05}]},
  ]);
  const s=new Skater({...flat,rails:fence},{x:0,y:0.8,z:1.5});s.grounded=false;s.verticalSpeed=-1;s.speed=5;
  s.update(1/60,neutral);assert.ok(s.grinding,'caught');
  let pitch=0;for(let i=0;i<30;i++){s.update(1/60,neutral);pitch=Math.max(pitch,s.pitch);}
  assert.ok(pitch>0.05,'board tilts up the slope');
  for(let i=0;i<60&&s.position.x>-3;i++)s.update(1/60,neutral);
  assert.ok(s.grinding,'still grinding after the corner');assert.ok(s.position.x<-1,'turned the corner');
});
test('a grind continues onto a connected segment without dropping the combo',()=>{
  const next={...rail,id:'next',a:{x:0,y:0.6,z:-0.2},b:{x:0,y:0.6,z:-4}};
  const first={...rail,id:'first',a:{x:0,y:0.6,z:2},b:{x:0,y:0.6,z:0}};
  const s=new Skater({...flat,rails:[first,next]},{x:0,y:0.7,z:0.05});s.grounded=false;s.speed=4;s.verticalSpeed=-1;
  for(let i=0;i<15;i++)s.update(1/60,neutral);
  assert.equal(s.grinding?.rail.id,'next');assert.ok(s.position.z < -0.5);assert.equal(s.comboCount,1);assert.equal(s.totalScore,0);
});
test('pose transitions blend instead of snapping and angular smoothing takes the short path',()=>{
  const s=new Skater(flat,{x:0,y:0,z:0}),animator=new SkateAnimator();
  const before=animator.update(s,1/60).crouch;s.charge=1;const after=animator.update(s,1/60).crouch;
  assert.ok(after>before&&after-before<0.2);
  const yaw=dampAngle(Math.PI-0.01,-Math.PI+0.01,28,1/60);assert.ok(Math.abs(yaw-(Math.PI-0.01))<0.02);
});
test('tree thinning is deterministic and preserves non-tree landmarks',()=>{
  let kept=0;
  for(let x=0;x<100;x++)for(let y=0;y<100;y++) {
    const keep=retainTree('Tree',1276,x,y,0.35);assert.equal(keep,retainTree('Tree',1276,x,y,0.35));if(keep)kept++;
  }
  assert.ok(kept>2500&&kept<4500);assert.equal(retainTree('Lumbridge castle',1,2,3,0),true);assert.equal(retainTree('Tree',1,2,3,1),true);
});
test('riding off the end of a solid rail lands on the floor, not on the rail it just left',()=>{
  // the rail's collision box top sits at the grind height
  const boxed:SkateWorld={...flat,groundAt:(x,z,fromY)=>Math.abs(x)<0.06&&z>-0.02&&z<2.02&&fromY>=0.6?0.6:0,rails:[{...rail,id:'short',a:{x:0,y:0.6,z:2},b:{x:0,y:0.6,z:0}}]};
  const s=new Skater(boxed,{x:0,y:0.7,z:1.9});s.grounded=false;s.speed=4;s.verticalSpeed=-1;
  s.update(1/60,neutral);assert.ok(s.grinding);
  const landings:number[]=[];
  for(let i=0;i<90;i++){s.update(1/60,neutral);for(const e of s.drainEvents())if(e.type==='land')landings.push(s.position.y);}
  assert.equal(landings.length,1,`landed ${landings.length} times`);assert.ok(landings[0]<0.1,`landed at y=${landings[0]}`);
});
test('the direction held at the catch picks the grind; S held for a 5-0 does not drop you off',()=>{
  const styles:[Partial<SkateInput>,string][]=[[{},'50-50 grind'],[{push:true},'Nosegrind'],[{brake:true},'5-0 grind'],[{steer:1},'Boardslide'],[{push:true,steer:-1},'Crooked grind'],[{brake:true,steer:1},'Smith grind']];
  for(const [input,name] of styles){const s=aboveFence();s.update(1/60,{...neutral,...input});assert.equal(s.grindStyle?.name,name);}
  const tail=aboveFence();tail.update(1/60,{...neutral,brake:true});
  for(let i=0;i<30;i++)tail.update(1/60,{...neutral,brake:true});
  assert.ok(tail.grinding,'still on the rail while S stays held');
  tail.update(1/60,neutral);tail.update(1/60,{...neutral,brake:true});
  assert.equal(tail.grinding,null,'a fresh S press drops off');
});
test('Shift + a flip key mid-grind with a full special bar: a Godsword grind with locked balance',()=>{
  const s=aboveFence();s.update(1/60,neutral);assert.ok(s.grinding);
  s.special=1;s.update(1/60,{...neutral,flip:true,grind:true});
  assert.equal(s.grindStyle?.name,'Godsword grind');
  for(let i=0;i<60;i++)s.update(1/60,neutral);
  assert.ok(Math.abs(s.balance)<0.05,'no wobble');
});
