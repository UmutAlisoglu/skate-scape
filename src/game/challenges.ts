import type { SkateEvent, Skater } from './skater.ts';

/** Achievement tiers for each spot, from the first interview: Easy, Medium, Hard, Master, Grandmaster. */
export type Tier = 'Easy' | 'Medium' | 'Hard' | 'Master' | 'Grandmaster';
export const TIERS: Tier[] = ['Easy', 'Medium', 'Hard', 'Master', 'Grandmaster'];
export const TIER_XP: Record<Tier, number> = { Easy: 2000, Medium: 6000, Hard: 15000, Master: 40000, Grandmaster: 120000 };

export type Goal =
  | { kind: 'combo'; points: number } | { kind: 'grind'; metres: number } | { kind: 'air'; seconds: number }
  | { kind: 'trick'; name: string } | { kind: 'manual'; seconds: number } | { kind: 'wallride'; seconds: number }
  | { kind: 'grab'; seconds: number };
export interface Challenge { id: string; place: string; tier: Tier; goal: Goal; text: string }

const combo = (points: number): Goal => ({ kind: 'combo', points }), grind = (metres: number): Goal => ({ kind: 'grind', metres });
const air = (seconds: number): Goal => ({ kind: 'air', seconds }), trick = (name: string): Goal => ({ kind: 'trick', name });
const manual = (seconds: number): Goal => ({ kind: 'manual', seconds }), wallride = (seconds: number): Goal => ({ kind: 'wallride', seconds });
const grab = (seconds: number): Goal => ({ kind: 'grab', seconds });

/** Five goals per place, Easy to Grandmaster, picked for what the spot offers. */
const SETS: Record<string, Goal[]> = {
  lumbridge: [combo(500), grind(10), wallride(1.2), combo(8000), grind(40)],
  varrock: [combo(800), air(1.1), trick('360 flip'), combo(12000), combo(35000)],
  draynor: [manual(3), grind(12), trick('Hardflip'), combo(9000), manual(12)],
  alkharid: [combo(600), wallride(1), grab(1.2), combo(10000), air(2)],
  barbarian: [grind(6), combo(2000), trick('Varial kickflip'), grind(25), combo(25000)],
  edgeville: [combo(700), wallride(1), trick('Double kickflip'), air(1.8), combo(30000)],
  grandexchange: [manual(4), combo(4000), trick('360 flip'), manual(15), combo(50000)],
  wizards: [combo(500), grind(8), trick('Impossible'), combo(8000), wallride(2.5)],
  duelarena: [combo(1000), grind(15), grab(1.5), combo(12000), combo(40000)],
  champions: [combo(600), air(1), trick('Heelflip'), combo(9000), grind(30)],
  lumberyard: [grind(5), combo(1500), trick('360 shove-it'), grind(20), combo(20000)],
  // the rest of Gielinor
  shantay: [combo(600), grab(1), trick('Pop shove-it'), combo(7000), air(1.8)],
  pollnivneach: [combo(800), wallride(1), trick('Varial heelflip'), combo(12000), combo(30000)],
  nardah: [manual(3), air(1), trick('Impossible'), combo(10000), wallride(2.5)],
  falador: [combo(1000), grind(12), trick('360 flip'), combo(15000), combo(45000)],
  portsarim: [grind(6), manual(4), trick('Hardflip'), grind(30), combo(25000)],
  rimmington: [combo(500), air(1), trick('Heelflip'), combo(6000), manual(12)],
  taverley: [grind(8), combo(2000), trick('Double kickflip'), wallride(2), combo(20000)],
  burthorpe: [combo(700), wallride(1.2), grab(1.5), combo(9000), grind(35)],
  catherby: [manual(3), combo(1500), trick('Varial kickflip'), manual(10), combo(20000)],
  camelot: [combo(1000), grind(15), trick('360 flip'), combo(14000), combo(40000)],
  seers: [grind(6), air(1.1), trick('360 shove-it'), grind(25), combo(25000)],
  fishingguild: [manual(4), grind(10), grab(1.5), manual(14), combo(18000)],
  ardougne: [combo(1000), manual(4), trick('Hardflip'), combo(15000), combo(50000)],
  westardougne: [grind(8), wallride(1.2), trick('Impossible'), grind(30), combo(30000)],
  yanille: [combo(800), wallride(1.5), trick('Varial heelflip'), combo(12000), wallride(3)],
  castlewars: [combo(1000), air(1.2), trick('Double kickflip'), combo(16000), air(2.2)],
  gnome: [grind(6), combo(2500), grab(1.5), grind(30), combo(30000)],
  barbarianoutpost: [combo(600), wallride(1), trick('Pop shove-it'), combo(9000), grind(25)],
  rellekka: [grind(8), combo(2000), trick('360 flip'), grind(35), combo(35000)],
  brimhaven: [manual(3), grind(10), trick('Kickflip'), combo(10000), manual(12)],
  musapoint: [combo(500), air(1), trick('Heelflip'), combo(7000), grind(20)],
  shilo: [grind(6), wallride(1.2), trick('Varial kickflip'), grind(25), combo(25000)],
  canifis: [combo(800), grind(10), trick('Impossible'), combo(13000), combo(40000)],
  portphasmatys: [grind(10), manual(4), trick('360 shove-it'), grind(40), combo(30000)],
  darkwarriors: [wallride(1), combo(3000), trick('Hardflip'), wallride(2.5), combo(45000)],
  graveyard: [combo(1000), air(1.2), grab(2), combo(15000), combo(60000)],
};

export function describe(goal: Goal) {
  switch (goal.kind) {
    case 'combo': return `Land a ${goal.points.toLocaleString('en-GB')}-point combo`;
    case 'grind': return `Grind ${goal.metres} m in one line`;
    case 'air': return `Land ${goal.seconds} s of air`;
    case 'trick': return `Land a ${goal.name}`;
    case 'manual': return `Manual for ${goal.seconds} s`;
    case 'wallride': return `Wallride for ${goal.seconds} s`;
    case 'grab': return `Hold a grab for ${goal.seconds} s`;
  }
}
export function challengesFor(place: string): Challenge[] {
  return (SETS[place] ?? []).map((goal, i) => ({ id: `${place}-${i}`, place, tier: TIERS[i], goal, text: describe(goal) }));
}
export const ALL_CHALLENGES = Object.keys(SETS).flatMap(challengesFor);

/**
 * Watches the rider for challenge goals: per-line grind distance, clean air time, manual / wallride / grab
 * durations, and banked combos (score and trick names). Reports goals met at the current spot.
 */
export class ChallengeTracker {
  private grindRun = 0; private airRun = 0; private manualRun = 0; private last: { x: number; z: number } | null = null;
  private airborne = false;
  /** best values reached since the spot was entered, for showing progress */
  best = { grind: 0, air: 0, manual: 0, wallride: 0, grab: 0, combo: 0 };

  /** Per-frame measurements; returns the goals met this frame. */
  update(skater: Skater, dt: number, open: Challenge[]): Challenge[] {
    const met: Challenge[] = [];
    const p = skater.position;
    if (skater.grinding && this.last) this.grindRun += Math.hypot(p.x - this.last.x, p.z - this.last.z);
    else if (!skater.grinding) this.grindRun = 0;
    this.manualRun = skater.manual ? this.manualRun + dt : 0;
    const flying = !skater.grounded && !skater.grinding && !skater.wallride;
    if (flying) this.airRun += dt;
    if (this.airborne && !flying) {
      // air only counts when it ends in a clean landing (or straight onto a rail)
      if (skater.stumbleTime === 0 && skater.bailTime === 0) met.push(...this.check(open, 'air', this.airRun));
      this.airRun = 0;
    }
    this.airborne = flying;
    met.push(...this.check(open, 'grind', this.grindRun), ...this.check(open, 'manual', this.manualRun),
      ...this.check(open, 'wallride', skater.wallride?.time ?? 0), ...this.check(open, 'grab', skater.grab?.time ?? 0));
    this.last = { x: p.x, z: p.z };
    return met;
  }
  /** A banked combo: its score and every trick in it (a trick only counts when the combo landed clean). */
  event(event: SkateEvent, open: Challenge[]): Challenge[] {
    if (event.type !== 'land') return [];
    this.best.combo = Math.max(this.best.combo, event.score);
    return open.filter((c) => (c.goal.kind === 'combo' && event.score >= c.goal.points) || (c.goal.kind === 'trick' && !event.sketchy && event.names.includes(c.goal.name)));
  }
  private check(open: Challenge[], kind: 'grind' | 'air' | 'manual' | 'wallride' | 'grab', value: number) {
    this.best[kind] = Math.max(this.best[kind], value);
    return open.filter((c) => c.goal.kind === kind && value >= ((c.goal as { metres?: number; seconds?: number }).metres ?? (c.goal as { seconds: number }).seconds));
  }
  reset() { this.best = { grind: 0, air: 0, manual: 0, wallride: 0, grab: 0, combo: 0 }; this.grindRun = this.airRun = this.manualRun = 0; }
}
