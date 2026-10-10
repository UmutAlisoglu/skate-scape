import type { SkateEvent, Skater } from './skater.ts';
import { GRIND_NAMES } from './tricks.ts';
import { comboXp, levelForXp } from './skill.ts';
import { TIER_XP, type Challenge } from './challenges.ts';
import { DECKS } from './decks.ts';

export interface Profile {
  version: 1; bestRun: number; bestCombo: number; lifetime: number; tricks: string[]; completed: string[]; runes: string[]; grindCount: number; manualSeconds: number; board: number; sound: boolean;
  /** Skateboarding experience (RS curve, see skill.ts) and completed spot challenges (ids like varrock-2) */
  xp: number; challenges: string[];
}
export const GOALS = [
  { id: 'ollie', title: 'First flight', description: 'Land an ollie', reward: 'Rune deck' },
  { id: 'flips', title: 'Two of a kind', description: 'Land a kickflip and a pop shove-it', reward: 'New line' },
  { id: 'grind', title: 'Iron rider', description: 'Land a combo with a grind', reward: 'Dragon deck' },
  { id: 'manual', title: 'Steady hands', description: 'Ride a manual for 3 seconds', reward: 'Balance badge' },
  { id: 'combo', title: 'Rune combo', description: 'Bank 2,500 points in one combo', reward: 'Gold deck' },
  { id: 'runes', title: 'Rune collector', description: 'Collect all 5 training runes', reward: 'Explorer badge' },
  { id: 'run', title: 'Lumbridge legend', description: 'Score 10,000 in a two-minute run', reward: 'Legend badge' },
];
export const defaultProfile = (): Profile => ({ version: 1, bestRun: 0, bestCombo: 0, lifetime: 0, tricks: [], completed: [], runes: [], grindCount: 0, manualSeconds: 0, board: 0, sound: true, xp: 0, challenges: [] });
export function readProfile(value: string | null): Profile {
  try {
    const data = JSON.parse(value ?? 'null');
    if (!data || data.version !== 1) return defaultProfile();
    const profile = defaultProfile();
    for (const key of ['bestRun','bestCombo','lifetime','grindCount','manualSeconds','board','xp'] as const) if (Number.isFinite(data[key]) && data[key] >= 0) profile[key] = data[key];
    for (const key of ['tricks','completed','runes','challenges'] as const) if (Array.isArray(data[key])) profile[key] = data[key].filter((x: unknown) => typeof x === 'string');
    if (typeof data.sound === 'boolean') profile.sound = data.sound;
    profile.board = Math.min(DECKS.length - 1, Math.floor(profile.board)); return profile;
  } catch { return defaultProfile(); }
}
export class Career {
  profile: Profile;
  mode: 'free' | 'run' = 'free'; remaining = 120; runScore = 0; ended = false;
  overtime = false; private overtimeElapsed = 0;
  toast = ''; toastTime = 0;
  /** a fanfare to play (taken by the audio once) */
  cheer: 'challenge' | 'level' | null = null;
  constructor(private storage?: Pick<Storage, 'getItem' | 'setItem'>, private saveKey = 'scape-skate-career') {
    try { this.profile = readProfile(storage?.getItem(saveKey) ?? null); } catch { this.profile = defaultProfile(); }
  }
  save() { try { this.storage?.setItem(this.saveKey, JSON.stringify(this.profile)); } catch { /* still playable when storage is unavailable */ } }
  start(mode: 'free' | 'run') { this.mode = mode; this.remaining = 120; this.runScore = 0; this.ended = this.overtime = false; this.overtimeElapsed = 0; }
  tick(dt: number, skater: Skater) {
    this.toastTime = Math.max(0, this.toastTime - dt);
    if (this.mode === 'run' && !this.ended) {
      this.remaining = Math.max(0, this.remaining - dt);
      if (this.remaining === 0) {
        this.overtime = skater.comboCount > 0;
        this.overtimeElapsed += dt;
        if (!this.overtime || this.overtimeElapsed >= 8) { this.ended = true; this.profile.bestRun = Math.max(this.profile.bestRun, this.runScore); this.checkGoals(); this.save(); }
      }
    }
    if (skater.manual) { this.profile.manualSeconds += dt; this.checkGoals(); }
  }
  event(event: SkateEvent) {
    if (event.type !== 'land') return;
    this.profile.lifetime += event.score; this.profile.bestCombo = Math.max(this.profile.bestCombo, event.score);
    if (this.mode === 'run' && !this.ended) this.runScore += event.score;
    for (const name of event.names) if (!this.profile.tricks.includes(name)) this.profile.tricks.push(name);
    if (event.names.some((name) => GRIND_NAMES.has(name))) this.profile.grindCount++;
    this.award(comboXp(event.score));
    this.checkGoals(); this.save();
  }
  collect(id: string) { if (!this.profile.runes.includes(id)) { this.profile.runes.push(id); this.toast = `Rune found · ${this.profile.runes.length}/5`; this.toastTime = 3; this.checkGoals(); this.save(); } }
  private checkGoals() {
    const p = this.profile;
    const checks: Record<string, boolean> = { ollie: p.tricks.includes('Ollie'), flips: p.tricks.includes('Kickflip') && p.tricks.includes('Pop shove-it'), grind: p.grindCount > 0, manual: p.manualSeconds >= 3, combo: p.bestCombo >= 2500, runes: p.runes.length >= 5, run: Math.max(p.bestRun, this.runScore) >= 10000 };
    for (const goal of GOALS) if (checks[goal.id] && !p.completed.includes(goal.id)) { p.completed.push(goal.id); this.toast = `${goal.title} complete · ${goal.reward}`; this.toastTime = 4; this.save(); }
  }
  get level() { return levelForXp(this.profile.xp); }
  /** Adds Skateboarding experience; a level-up gets the RS congratulations. */
  award(xp: number) {
    if (xp <= 0) return;
    const before = this.level;
    this.profile.xp = Math.min(200_000_000, this.profile.xp + xp);
    const after = this.level;
    if (after > before) { this.toast = `Congratulations, you just advanced a Skateboarding level! You are now level ${after}.`; this.toastTime = 5; this.cheer = 'level'; }
  }
  completeChallenge(challenge: Challenge, placeName: string) {
    if (this.profile.challenges.includes(challenge.id)) return false;
    this.profile.challenges.push(challenge.id);
    const before = this.level;
    this.award(TIER_XP[challenge.tier]);
    const levelled = this.level > before ? ` · Skateboarding level ${this.level}!` : '';
    this.toast = `${placeName} ${challenge.tier} complete · ${challenge.text} · +${TIER_XP[challenge.tier].toLocaleString('en-GB')} XP${levelled}`; this.toastTime = 5;
    this.cheer = levelled ? 'level' : 'challenge';
    this.save(); return true;
  }
  /** The first four decks come from the training quests; each town deck from that town's Master challenge. */
  boardUnlocked(index: number) {
    const place = DECKS[index]?.place;
    if (place) return this.profile.challenges.includes(`${place}-3`);
    return index === 0 || this.profile.completed.includes(['', 'ollie', 'grind', 'combo'][index]);
  }
}
