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
