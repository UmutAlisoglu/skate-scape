import type { SkatePose } from './skate-pose.ts';
import { SLOT } from '../shared/player-data.ts';
import { ease } from '../shared/motion.ts';
export interface Joint { x:number; y:number; z:number }
interface Segment { start:Joint; end:Joint; restStart:Joint; restEnd:Joint; side:Joint; forward:Joint }
interface Limb { upper:Segment; lower:Segment; tip:Joint; restTip:Joint }
export interface SkateRig { hips:Joint; lean:number; legs:[Limb,Limb]; arms:[Limb,Limb] }
const point=(x:number,y:number,z:number):Joint=>({x,y,z});

/** Two-bone IK keeps each limb's length constant while moving its planted end. */
export function solveLimb(start:Joint,target:Joint,upper:number,lower:number,pole:Joint) {
  let dx=target.x-start.x,dy=target.y-start.y,dz=target.z-start.z;
  const original=Math.hypot(dx,dy,dz)||1;
  dx/=original;dy/=original;dz/=original;
  const length=Math.max(Math.abs(upper-lower)+0.001,Math.min(upper+lower-0.001,original));
  const tip=point(start.x+dx*length,start.y+dy*length,start.z+dz*length);
  const projection=pole.x*dx+pole.y*dy+pole.z*dz;
  let px=pole.x-dx*projection,py=pole.y-dy*projection,pz=pole.z-dz*projection;
  let perpendicular=Math.hypot(px,py,pz);
  if(perpendicular<0.001){px=dy;py=-dx;pz=0;perpendicular=Math.hypot(px,py)||1;}
  px/=perpendicular;py/=perpendicular;pz/=perpendicular;
  const along=(upper*upper+length*length-lower*lower)/(2*length);
  const bend=Math.sqrt(Math.max(0,upper*upper-along*along));
  return {tip,joint:point(start.x+dx*along+px*bend,start.y+dy*along+py*bend,start.z+dz*along+pz*bend)};
}
function segment(start:Joint,end:Joint,restStart:Joint,restEnd:Joint):Segment {
  let dx=end.x-start.x,dy=end.y-start.y,dz=end.z-start.z,length=Math.hypot(dx,dy,dz)||1;
  dx/=length;dy/=length;dz/=length;
  let sx=1-dx*dx,sy=-dx*dy,sz=-dx*dz;length=Math.hypot(sx,sy,sz)||1;
  sx/=length;sy/=length;sz/=length;
  return {start,end,restStart,restEnd,side:point(sx,sy,sz),forward:point(dy*sz-dz*sy,dz*sx-dx*sz,dx*sy-dy*sx)};
}
export function rootVertex(x:number,y:number,z:number,rig:SkateRig):Joint {
  const height=y-0.84,c=Math.cos(rig.lean),s=Math.sin(rig.lean);
  return point(x+rig.hips.x,rig.hips.y+c*height-s*z,rig.hips.z+s*height+c*z);
}
export function prepareSkateRig(pose:SkatePose):SkateRig {
  const drop=Math.min(0.40,pose.crouch*0.25+pose.push*0.10);
  const rig:SkateRig={hips:point((pose.manual??0)*-0.035,0.84-drop,0),lean:0.08+pose.crouch*0.10,legs:[] as unknown as [Limb,Limb],arms:[] as unknown as [Limb,Limb]};
  for(let i=0;i<2;i++) {
    const sign=i===0?-1:1,restHip=point(sign*0.075,0.84,0.01),restKnee=point(sign*0.07,0.40,0.02),restAnkle=point(sign*0.075,0.09,0.01);
    const hip=rootVertex(restHip.x,restHip.y,restHip.z,rig);
    const rear=sign<0,manual=pose.manual??0;
    const ankle=point(sign*0.23-(rear?pose.push*0.22:0),0.09+pose.air*0.11+(rear?-pose.push*0.127+(pose.pushLift??0):0)+sign*manual*0.032,0.01+(rear?0:-pose.kick*0.12));
    const leg=solveLimb(hip,ankle,0.44,0.31,point(0,0,1));
    rig.legs[i]={upper:segment(hip,leg.joint,restHip,restKnee),lower:segment(leg.joint,leg.tip,restKnee,restAnkle),tip:leg.tip,restTip:restAnkle};
    const restShoulder=point(sign*0.18,1.21,-0.01),restElbow=point(sign*0.22,0.95,-0.01),restWrist=point(sign*0.25,0.72,0);
    const shoulder=rootVertex(restShoulder.x,restShoulder.y,restShoulder.z,rig);
    const wrist=point(sign*(0.40+pose.air*0.08),shoulder.y-0.26+pose.air*0.12+sign*pose.balance*0.10,shoulder.z+0.16+pose.push*0.045);
    const arm=solveLimb(shoulder,wrist,0.26,0.24,point(sign,0,-1));
    rig.arms[i]={upper:segment(shoulder,arm.joint,restShoulder,restElbow),lower:segment(arm.joint,arm.tip,restElbow,restWrist),tip:arm.tip,restTip:restWrist};
  }
  return rig;
}
function skin(x:number,y:number,z:number,bone:Segment):Joint {
  const t=(bone.restStart.y-y)/(bone.restStart.y-bone.restEnd.y);
  const rx=bone.restStart.x+(bone.restEnd.x-bone.restStart.x)*t,rz=bone.restStart.z+(bone.restEnd.z-bone.restStart.z)*t;
  const ox=x-rx,oz=z-rz;
  return point(bone.start.x+(bone.end.x-bone.start.x)*t+bone.side.x*ox+bone.forward.x*oz,
    bone.start.y+(bone.end.y-bone.start.y)*t+bone.side.y*ox+bone.forward.y*oz,
    bone.start.z+(bone.end.z-bone.start.z)*t+bone.side.z*ox+bone.forward.z*oz);
}
const legBones=new Set([31,32,34,35,37,38,40,42,43,44,45,46,47,48]);
const armBones=new Set([17,18,19,20,21,22,23,24,25,26,194,195,196,204,207,209]);
const negativeBones=new Set([17,18,19,20,21,31,32,34,42,44,45,48,196,207,209]);
const seams=new Set([1,2,3,8,29,39,41,59,60,86,91,92]);
export function rigVertex(x:number,y:number,z:number,slot:number,pose:SkatePose,rig:SkateRig,bone?:number):Joint {
  if(slot===SLOT.HEAD||slot===SLOT.HAIR||slot===SLOT.JAW||bone===1)return rootVertex(z+0.01,y,-x-0.01,rig);
  if(slot===SLOT.CAPE||seams.has(bone??-1))return rootVertex(x,y,z,rig);
  const side=bone!==undefined&&(legBones.has(bone)||armBones.has(bone))?(negativeBones.has(bone)?0:1):(x<0?0:1);
  if(slot===SLOT.FEET) {
    const leg=rig.legs[side];return point(leg.tip.x+x-leg.restTip.x,leg.tip.y+y-leg.restTip.y,leg.tip.z+z-leg.restTip.z);
  }
  if(legBones.has(bone??-1)||(slot===SLOT.LEGS&&y<0.74&&Math.abs(x)>0.02)) {
    const leg=rig.legs[side],a=skin(x,y,z,leg.upper),b=skin(x,y,z,leg.lower),weight=ease((y-0.35)/0.10);
    return point(b.x+(a.x-b.x)*weight,b.y+(a.y-b.y)*weight,b.z+(a.z-b.z)*weight);
  }
  if(armBones.has(bone??-1)||slot===SLOT.ARMS||slot===SLOT.HANDS||slot===SLOT.WEAPON||slot===SLOT.SHIELD) {
    const arm=rig.arms[side],a=skin(x,y,z,arm.upper),b=skin(x,y,z,arm.lower),weight=ease((y-0.91)/0.08);
    return point(b.x+(a.x-b.x)*weight,b.y+(a.y-b.y)*weight,b.z+(a.z-b.z)*weight);
  }
  return rootVertex(x,y,z,rig);
}
