import type { Skater } from '../game/skater.ts';
import { damp, ease } from '../shared/motion.ts';

/** Skate pose parameters (0-1 unless noted); skate-rig.ts turns them into RS joint values. */
export interface SkatePose {
  crouch: number; push: number; air: number; kick: number; balance: number; time: number; phase: string;
  /** 0-1 position in the push cycle: contact (foot sliding back on the ground) then recovery */
  pushPhase?: number;
  pushLift?: number;
  manual?: number;
  grind?: number;
  bail?: number;
}

export const PUSH_CYCLE = 0.72;

export function poseFor(skater: Skater): SkatePose {
  const pushPhase = (skater.pushTime / PUSH_CYCLE) % 1;
  const push = skater.pushing || skater.pushTime > 0 ? 1 : 0;
  const lift = pushPhase > 0.6 ? Math.sin(((pushPhase - 0.6) / 0.4) * Math.PI) * 0.18 : 0;
  const air = !skater.grounded && !skater.grinding ? ease(skater.heightAboveGround / 0.45) : 0;
  return {
    crouch: 0.25 + skater.charge * 0.75 + skater.landingCompression * 0.45 + (skater.grinding ? 0.25 : 0) + air * 0.15,
    push, pushPhase, pushLift: lift, air,
    kick: skater.trick?.kind === 'flip' ? Math.sin(Math.min(1, skater.trick.elapsed / skater.trick.duration) * Math.PI) : 0,
    balance: Math.max(-1, Math.min(1, skater.balance)),
    manual: skater.manual ? 1 : 0,
    grind: skater.grinding ? 1 : 0,
    bail: skater.bailTime > 0 ? 1 : 0,
    time: skater.animationTime, phase: skater.phase,
  };
}

/** Smooths pose parameters so state changes blend instead of popping (frame-rate independent). */
export class SkateAnimator {
  private pose: SkatePose | null = null;
  reset() { this.pose = null; }
  update(skater: Skater, dt: number): SkatePose {
    const target = poseFor(skater);
    if (!this.pose) this.pose = { ...target };
    const step = Math.min(dt, 0.1);
    const rates: Record<string, number> = { crouch: 12, push: 9, pushLift: 20, air: 14, kick: 30, balance: 10, manual: 10, grind: 12, bail: 8 };
    for (const key of Object.keys(rates) as (keyof SkatePose)[]) {
      (this.pose as unknown as Record<string, number>)[key] = damp((this.pose[key] as number) ?? 0, (target[key] as number) ?? 0, rates[key], step);
    }
    // the push phase keeps cycling while the foot eases back onto the board
    if (target.push > 0) this.pose.pushPhase = target.pushPhase;
    this.pose.time = target.time;
    this.pose.phase = target.phase;
    return this.pose;
  }
}
