import { BASE_ABILITIES, type SkateAbilities } from './skater.ts';

/** The Skateboarding skill: RuneScape's own experience curve, levels 1-99. */
const TABLE: number[] = [0, 0];
{
  let points = 0;
  for (let level = 1; level < 99; level++) {
    points += Math.floor(level + 300 * 2 ** (level / 7));
    TABLE.push(Math.floor(points / 4));
  }
}
/** Experience needed for a level (level 2 = 83, level 99 = 13,034,431). */
export const xpForLevel = (level: number) => TABLE[Math.max(1, Math.min(99, Math.floor(level)))];
export function levelForXp(xp: number) {
  let level = 1;
  while (level < 99 && xp >= TABLE[level + 1]) level++;
  return level;
}
/** 0-1 progress from this level to the next (1 at 99). */
export function levelProgress(xp: number) {
  const level = levelForXp(xp);
  if (level >= 99) return 1;
  return (xp - TABLE[level]) / (TABLE[level + 1] - TABLE[level]);
}
/** Experience for banking a combo: a quarter of its score. */
export const comboXp = (score: number) => Math.floor(score / 4);

/** What a Skateboarding level unlocks (the RS skill guide): abilities that open up more of the world. */
export interface Unlock { level: number; name: string; text: string; apply(a: SkateAbilities): void }
export const UNLOCKS: Unlock[] = [
  { level: 5, name: 'Steady feet', text: 'Grinds and manuals wobble less', apply: (a) => { a.steady = 0.85; } },
  { level: 10, name: 'Strong pop', text: 'Ollies go about 15% higher', apply: (a) => { a.pop = 1.08; } },
  { level: 20, name: 'Wallplant', text: 'Space in the air beside a wall kicks you up and off it', apply: (a) => { a.wallplant = true; } },
  { level: 30, name: 'Agility leap', text: 'Space again in the air for a second jump: reach roofs and ledges', apply: (a) => { a.leaps = 1; } },
  { level: 40, name: 'Surge mastery', text: 'Surge (G) recharges in 5 seconds', apply: (a) => { a.surgeCooldown = 5; } },
  { level: 50, name: 'Steady feet II', text: 'Grinds and manuals wobble even less', apply: (a) => { a.steady = 0.7; } },
  { level: 60, name: 'Big pop', text: 'Ollies, wallplants and leaps go about 35% higher', apply: (a) => { a.pop = 1.16; } },
  { level: 70, name: 'Iron knees', text: 'Land from any height without bailing', apply: (a) => { a.ironKnees = true; } },
  { level: 80, name: 'Special focus', text: 'The special bar fills a third faster', apply: (a) => { a.specialFill = 1.35; } },
  { level: 90, name: 'Double leap', text: 'Two Agility leaps in every air', apply: (a) => { a.leaps = 2; } },
  { level: 99, name: 'Skateboarding mastery', text: 'Surge in the air lifts you as well', apply: (a) => { a.airSurge = true; } },
];
/** The rider's abilities at a Skateboarding level. */
export function abilitiesFor(level: number): SkateAbilities {
  const abilities = { ...BASE_ABILITIES };
  for (const unlock of UNLOCKS) if (level >= unlock.level) unlock.apply(abilities);
  return abilities;
}
/** Unlocks gained going from one level to another. */
export const unlocksBetween = (from: number, to: number) => UNLOCKS.filter((u) => u.level > from && u.level <= to);
