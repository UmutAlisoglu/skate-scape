import type { SkateAbilities } from './skater.ts';

/**
 * Boards in RS metal tiers. Each drops the first time you bank a combo of its metal rating (Bronze 1,000 up to
 * Third-age 150,000) and, like RS gear, needs a Skateboarding level to ride. Better metal pops higher, pushes
 * faster and wobbles less; dragon and third-age leave a trail.
 */
export interface BoardTier {
  id: string; name: string; level: number; combo: number;
  /** plies, trucks and wheels (RGB) */
  color: number; trim: number; wheel: number;
  /** ollie height multiplier, push and top speed added (m/s), balance wobble multiplier */
  pop: number; push: number; steady: number;
  effect?: 'fire' | 'sparkle';
}
export const BOARD_TIERS: BoardTier[] = [
  { id: 'bronze', name: 'Bronze board', level: 1, combo: 1000, color: 0x8c5a2b, trim: 0x6a4420, wheel: 0xb07a40, pop: 1, push: 0, steady: 1 },
  { id: 'iron', name: 'Iron board', level: 1, combo: 2500, color: 0x6f6a64, trim: 0x4c4844, wheel: 0x8a8580, pop: 1.01, push: 0.2, steady: 0.97 },
  { id: 'steel', name: 'Steel board', level: 5, combo: 5000, color: 0x9aa0a4, trim: 0x6d7276, wheel: 0xc2c6c8, pop: 1.02, push: 0.4, steady: 0.94 },
  { id: 'mithril', name: 'Mithril board', level: 20, combo: 10000, color: 0x3f4f8a, trim: 0x2b365e, wheel: 0x6b7bb8, pop: 1.04, push: 0.6, steady: 0.91 },
  { id: 'adamant', name: 'Adamant board', level: 30, combo: 20000, color: 0x3f6b4a, trim: 0x2a4a33, wheel: 0x62946d, pop: 1.05, push: 0.8, steady: 0.88 },
  { id: 'rune', name: 'Rune board', level: 40, combo: 40000, color: 0x3e8fa8, trim: 0x286074, wheel: 0x7cc4d8, pop: 1.07, push: 1, steady: 0.85 },
  { id: 'dragon', name: 'Dragon board', level: 60, combo: 80000, color: 0x8c1c1c, trim: 0x5a1010, wheel: 0xd04a2a, pop: 1.09, push: 1.3, steady: 0.82, effect: 'fire' },
  { id: 'thirdage', name: 'Third-age board', level: 75, combo: 150000, color: 0xe8e2d0, trim: 0xc9a43a, wheel: 0xf2e6b8, pop: 1.12, push: 1.6, steady: 0.78, effect: 'sparkle' },
];
const RATING_NAMES: Record<string, string> = { bronze: 'Bronze combo', iron: 'Iron combo', steel: 'Steel combo', mithril: 'Mithril combo!', adamant: 'Adamant combo!', rune: 'Rune combo!!', dragon: 'Dragon combo!!!', thirdage: 'Third-age combo!!!' };

export const boardTier = (id: string) => BOARD_TIERS.find((t) => t.id === id) ?? BOARD_TIERS[0];
/** The best tier a banked combo earns (its metal rating), or null under 1,000. */
export function tierForCombo(score: number) {
  return [...BOARD_TIERS].reverse().find((t) => score >= t.combo) ?? null;
}
/** RS metal rating for a banked combo, Bronze (1,000) up to Third-age (150,000). */
export function comboRating(score: number) {
  const tier = tierForCombo(score);
  return tier ? { name: RATING_NAMES[tier.id], metal: tier.id } : undefined;
}
/** The rider's abilities on a board: its pop, push and balance on top of what their level gives. */
export function withBoard(abilities: SkateAbilities, tier: BoardTier): SkateAbilities {
  return { ...abilities, pop: abilities.pop * tier.pop, push: abilities.push + tier.push, steady: abilities.steady * tier.steady };
}
/** "Pop +7% · Speed +1.0 · Balance +15%" */
export function describeTier(tier: BoardTier) {
  return `Pop +${Math.round((tier.pop - 1) * 100)}% · Speed +${tier.push.toFixed(1)} · Balance +${Math.round((1 - tier.steady) * 100)}%`;
}
