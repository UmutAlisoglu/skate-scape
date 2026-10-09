import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Skater,type SkateWorld,type SkateInput } from '../src/game/skater.ts';
import { joinRails } from '../src/shared/rails.ts';
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
test('a crossing approach aligns to the top but rising and below-top approaches do not latch',()=>{
  const across=aboveFence(Math.PI/2);across.update(1/60,neutral);assert.ok(across.grinding);assert.ok(Math.abs(Math.sin(across.heading))<0.01);
  const rising=aboveFence();rising.verticalSpeed=3;rising.update(1/60,neutral);assert.equal(rising.grinding,null);
  const low=aboveFence();low.position.y=0.4;low.update(1/60,neutral);assert.equal(low.grinding,null);
});
test('braking drops off and an ollie out does not immediately snap back to the same fence',()=>{
  const s=aboveFence();s.update(1/60,neutral);s.update(1/60,{...neutral,brake:true});assert.equal(s.grinding,null);assert.ok(Math.abs(s.position.x)>0.3);
  const jump=aboveFence();jump.update(1/60,neutral);jump.update(1/60,{...neutral,pop:true});
  for(let i=0;i<66;i++)jump.update(1/60,neutral);
  assert.equal(jump.grinding,null);assert.ok(jump.totalScore>0);
});
test('adjacent wall pieces join into a continuous line but height gaps remain separate',()=>{
  const a={...rail,id:'a',a:{x:0,y:1,z:0.1},b:{x:0,y:1,z:0.9}};
  const b={...rail,id:'b',a:{x:0,y:1,z:1.1},b:{x:0,y:1,z:1.9}};
  const joined=joinRails([b,a]);assert.equal(joined.length,1);assert.equal(joined[0].a.z,0.1);assert.equal(joined[0].b.z,1.9);
  assert.equal(joinRails([a,{...b,a:{...b.a,y:1.4},b:{...b.b,y:1.4}}]).length,2);
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
