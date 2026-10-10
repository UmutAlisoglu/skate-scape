import type { SkateEvent, Skater } from './skater.ts';
import { GRIND_NAMES } from './tricks.ts';
import { comboXp, levelForXp, unlocksBetween, type Unlock } from './skill.ts';
import { TIER_XP, type Challenge } from './challenges.ts';
import { DECKS } from './decks.ts';
import { RUNE_XP } from './runes.ts';
import { BOARD_TIERS, boardTier, tierForCombo } from './boards.ts';
import { MEDALS, RACE_XP } from './races.ts';

export interface Profile {
  version: 1; bestRun: number; bestCombo: number; lifetime: number; tricks: string[]; completed: string[]; runes: string[]; grindCount: number; manualSeconds: number; board: number; sound: boolean;
  /** Skateboarding experience (RS curve, see skill.ts) and completed spot challenges (ids like varrock-2) */
  xp: number; challenges: string[];
  /** town runes found (ids like varrock-rune-2) */
  townRunes: string[];
  /** live key hints on screen */
  hints: boolean;
  /** boards found (tier ids, see boards.ts) and the one being ridden */
  boards: string[]; boardTier: string;
  /** pets found and the one skating along ('' for none) */
  pets: string[]; pet: string;
  /** best race times (seconds) and medals (1 bronze, 2 silver, 3 gold) by race id */
  raceBest: Record<string, number>; raceMedal: Record<string, number>;
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
export const defaultProfile = (): Profile => ({ version: 1, bestRun: 0, bestCombo: 0, lifetime: 0, tricks: [], completed: [], runes: [], grindCount: 0, manualSeconds: 0, board: 0, sound: true, xp: 0, challenges: [], townRunes: [], hints: true, boards: ['bronze'], boardTier: 'bronze', pets: [], pet: '', raceBest: {}, raceMedal: {} });
export function readProfile(value: string | null): Profile {
  try {
    const data = JSON.parse(value ?? 'null');
    if (!data || data.version !== 1) return defaultProfile();
    const profile = defaultProfile();
    for (const key of ['bestRun','bestCombo','lifetime','grindCount','manualSeconds','board','xp'] as const) if (Number.isFinite(data[key]) && data[key] >= 0) profile[key] = data[key];
    for (const key of ['tricks','completed','runes','challenges','townRunes','boards','pets'] as const) if (Array.isArray(data[key])) profile[key] = data[key].filter((x: unknown) => typeof x === 'string');
    for (const key of ['boardTier','pet'] as const) if (typeof data[key] === 'string') profile[key] = data[key];
    for (const key of ['raceBest','raceMedal'] as const) if (data[key] && typeof data[key] === 'object') for (const [id, value] of Object.entries(data[key])) if (Number.isFinite(value) && (value as number) > 0) profile[key][id] = value as number;
    if (!profile.boards.includes('bronze')) profile.boards.unshift('bronze');
    if (!profile.boards.includes(profile.boardTier)) profile.boardTier = 'bronze';
    if (profile.pet && !profile.pets.includes(profile.pet)) profile.pet = '';
    if (typeof data.sound === 'boolean') profile.sound = data.sound;
    if (typeof data.hints === 'boolean') profile.hints = data.hints;
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
  /** abilities a level-up just unlocked (the UI shows them, then clears the list) */
  unlocked: Unlock[] = [];
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
    // loot: the first combo of each metal rating drops that board
    const tier = tierForCombo(event.score);
    if (tier && !this.profile.boards.includes(tier.id)) this.grantBoard(tier.id, `Loot! Your ${tier.name.replace(' board', '').toLowerCase()} combo dropped a ${tier.name}`);
    this.checkGoals(); this.save();
  }
  /** Adds a board to the collection (with an RS loot toast); true when it was new. */
  grantBoard(id: string, why: string) {
    if (this.profile.boards.includes(id)) return false;
    const tier = boardTier(id);
    this.profile.boards.push(id);
    this.profile.boards.sort((a, b) => BOARD_TIERS.findIndex((t) => t.id === a) - BOARD_TIERS.findIndex((t) => t.id === b));
    this.toast = `${why} · ${this.level >= tier.level ? 'equip it from the pause menu' : `ride it at Skateboarding level ${tier.level}`}`; this.toastTime = 5; this.cheer = 'level';
    this.save(); return true;
  }
  /** The board being ridden (falls back to bronze if the level isn't there). */
  get board() { const tier = boardTier(this.profile.boardTier); return this.level >= tier.level ? tier : BOARD_TIERS[0]; }
  /**
   * A finished race: keeps the best time, and pays XP the first time each medal is reached. Returns whether
   * this run is a new best (its ghost should be saved).
   */
  finishRace(id: string, name: string, time: number, medal: number) {
    const best = this.profile.raceBest[id], previous = this.profile.raceMedal[id] ?? 0, isBest = best === undefined || time < best;
    if (isBest) this.profile.raceBest[id] = time;
    let xp = 1000;
    if (medal > previous) { this.profile.raceMedal[id] = medal; xp = RACE_XP[medal - 1]; }
    const before = this.level;
    this.award(xp);
    const medalName = medal ? `${MEDALS[medal - 1]} medal!` : 'No medal this time';
    this.toast = `${name} · ${time.toFixed(2)} s · ${medalName}${isBest && best !== undefined ? ' · New best!' : ''} · +${xp.toLocaleString('en-GB')} XP${this.level > before ? ` · Skateboarding level ${this.level}!` : ''}`;
    this.toastTime = 6; this.cheer = medal >= 2 ? 'level' : 'challenge';
    this.save(); return isBest;
  }
  /** Adds a pet; true when it was new. */
  grantPet(id: string, name: string, why: string) {
    if (this.profile.pets.includes(id)) return false;
    this.profile.pets.push(id); if (!this.profile.pet) this.profile.pet = id;
    this.toast = `${why} · ${name} joins you!`; this.toastTime = 5; this.cheer = 'level';
    this.save(); return true;
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
    if (after > before) {
      this.toast = `Congratulations, you just advanced a Skateboarding level! You are now level ${after}.`; this.toastTime = 5; this.cheer = 'level';
      this.unlocked.push(...unlocksBetween(before, after));
    }
  }
  /** A town rune: XP for each, a bigger bonus for the whole set of five. */
  collectTownRune(id: string, runeName: string, placeName: string, found: number, total: number) {
    if (this.profile.townRunes.includes(id)) return;
    this.profile.townRunes.push(id);
    const set = found >= total, before = this.level;
    this.award(RUNE_XP.each + (set ? RUNE_XP.set : 0));
    const levelled = this.level > before ? ` · Skateboarding level ${this.level}!` : '';
    this.toast = set ? `All ${total} ${placeName} runes found · +${(RUNE_XP.each + RUNE_XP.set).toLocaleString('en-GB')} XP${levelled}` : `${runeName} found · ${placeName} runes ${found}/${total} · +${RUNE_XP.each.toLocaleString('en-GB')} XP${levelled}`;
    this.toastTime = 4; this.cheer = set || levelled ? 'level' : 'challenge';
    this.save();
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
