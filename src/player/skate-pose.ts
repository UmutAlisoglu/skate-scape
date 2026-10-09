import type { Skater } from '../game/skater.ts';
import { damp, ease } from '../shared/motion.ts';
import { prepareSkateRig, rigVertex, type SkateRig } from './skate-rig.ts';
export interface SkatePose { crouch:number; push:number; air:number; kick:number; balance:number; time:number; phase:string; pushLift?:number; manual?:number }
export function poseFor(skater:Skater):SkatePose {
  const cycle=(skater.pushTime/0.72)%1;
  const push=skater.pushing?(1-Math.cos(cycle*Math.PI*2))*0.5:0;
  const lift=skater.pushing&&cycle>0.5?Math.sin((cycle-0.5)*Math.PI*2)*0.18:0;
  const air=!skater.grounded&&!skater.grinding?ease(skater.heightAboveGround/0.45):0;
  return {crouch:0.48+skater.charge*0.65+skater.landingCompression*0.40+air*0.18+(skater.grinding?0.15:0),push,pushLift:lift,air,
    kick:skater.trick?.kind==='flip'?Math.sin(Math.min(1,skater.trick.elapsed/skater.trick.duration)*Math.PI):0,
    balance:skater.balance,manual:skater.manual?1:0,time:skater.animationTime,phase:skater.phase};
}
/** Blend state changes independently of render/simulation frequency. */
export class SkateAnimator {
  private pose:SkatePose|null=null;
  reset(){this.pose=null;}
  update(skater:Skater,dt:number):SkatePose {
    const target=poseFor(skater);
    if(!this.pose)this.pose={...target};
    for(const key of ['crouch','push','pushLift','air','kick','balance','manual'] as const) {
      this.pose[key]=damp(this.pose[key]??0,target[key]??0,key==='air'?22:14,Math.min(dt,0.1));
    }
    this.pose.time=target.time;this.pose.phase=target.phase;
    return this.pose;
  }
}
export function deformSkater(x:number,y:number,z:number,slot:number,pose:SkatePose,bone?:number,rig?:SkateRig) {
  return rigVertex(x,y,z,slot,pose,rig??prepareSkateRig(pose),bone);
}
