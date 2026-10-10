import { AIR_MOVES, OLLIE, type Rail, type Skater, type SkateWorld } from './skater.ts';

/** A hint line: plain text and key caps. */
export type HintPart = string | { key: string };
export interface Hint { id: string; parts: HintPart[] }
const k = (key: string) => ({ key });
/** Gravity in the air (skater.ts) for jump heights. */
const GRAVITY = 14;

/**
 * Live key hints: reads what the rider is doing and what's around (a ledge ahead, a wall beside you, an open
 * combo waiting for a link) and suggests the keys that matter right now. Basic hints retire once they've been
 * shown a few times; situational ones (link the combo, wallplant, leap, special) always come back.
 */
export class HintCoach {
  enabled = true;
  private current: Hint | null = null;
  private shownFor = 0;
  private seen = new Map<string, number>();
  private clock = 0;
  /** how many times each basic hint may appear per session */
  private static readonly BUDGET: Record<string, number> = { push: 3, tricks: 6, ledge: 10, wallride: 4, grind: 6, manual: 4, surge: 3 };

  constructor(private world: SkateWorld) {}

  /** Call every frame; returns the hint to show (or null). */
  update(dt: number, s: Skater): Hint | null {
    this.shownFor += dt; this.clock += dt;
    if (!this.enabled) return (this.current = null);
    if (this.clock < 0.1) return this.current;
    this.clock = 0;
    const next = this.pick(s);
    // stick with a hint briefly so the line doesn't flicker between suggestions
    if (this.current && next?.id !== this.current.id && this.shownFor < 1.2 && (!next || !URGENT.has(next.id))) return this.current;
    if (next && next.id !== this.current?.id) {
      const count = (this.seen.get(next.id) ?? 0) + 1, budget = HintCoach.BUDGET[next.id];
      if (budget !== undefined && count > budget) return (this.current = null);
      this.seen.set(next.id, count); this.shownFor = 0;
    }
    return (this.current = next);
  }

  private pick(s: Skater): Hint | null {
    if (s.bailTime > 0 || s.stumbleTime > 0) return null;
    const special = s.specialReady;
    if (s.linkWindow > 0 && s.comboCount > 0) return { id: 'link', parts: ['Keep it going: ', k('Space'), ' ollie · ', k('M'), ' manual · ', k('Shift'), ' revert'] };
    if (s.grinding) {
      if (special && !s.grindStyle?.special) return { id: 'godsword', parts: ['Special ready: ', k('Shift'), '+', k('Q'), ' Godsword grind'] };
      return { id: 'grind', parts: [k('A'), ' / ', k('D'), ' keep the balance meter centred · ', k('Space'), ' ollie out'] };
    }
    if (s.manual) return { id: 'manual', parts: [k('A'), ' / ', k('D'), ' balance · ', k('Space'), ' ollie to keep the combo'] };
    if (s.wallride) return { id: 'wallie', parts: [k('Space'), ' wallie off the wall'] };
    if (!s.grounded) {
      if (s.abilities.wallplant && this.wallAhead(s)) return { id: 'wallplant', parts: [k('Space'), ' wallplant: kick off the wall'] };
      if (s.leapsLeft > 0 && (s.verticalSpeed > -1 || s.heightAboveGround > AIR_MOVES.leapMinHeight + 0.4)) return { id: 'leap', parts: [k('Space'), ' Agility leap: jump again in the air'] };
      if (special) return { id: 'special', parts: ['Special ready: ', k('Shift'), '+', k('Q'), ' / ', k('E'), ' / ', k('C'), ' for a special trick'] };
      if (s.comboNames.length <= 1 && !s.trick && !s.grab) return { id: 'tricks', parts: [k('Q'), ' flip · ', k('E'), ' shove-it · ', k('C'), ' grab · ', k('A'), ' / ', k('D'), ' spin'] };
      return null;
    }
    const ledge = this.ledgeAhead(s);
    if (ledge) {
      const name = ledge.rail.name === 'null' ? 'ledge' : ledge.rail.name.toLowerCase();
      if (ledge.needsLeap) return { id: 'ledge-high', parts: ['Too high for one pop: ', k('Space'), ' then ', k('Space'), ' again to leap onto the ', name] };
      return { id: 'ledge', parts: ['Hold ', k('Space'), ' and release to ollie onto the ', name, ' · grinds catch on their own'] };
    }
    if (special) return { id: 'special', parts: ['Special ready: jump, then ', k('Shift'), '+', k('Q'), ' / ', k('E'), ' / ', k('C')] };
    if (s.speed > 4 && this.wallBeside(s)) return { id: 'wallride', parts: ['Ollie toward the wall at an angle to wallride it'] };
    if (s.speed < 0.5 && !s.pushing) return { id: 'push', parts: [k('W'), ' push · ', k('A'), ' / ', k('D'), ' steer'] };
    if (s.speed < 5 && s.surgeCooldown === 0) return { id: 'surge', parts: [k('G'), ' Surge for a burst of speed'] };
    return null;
  }

  /** The nearest grind line ahead that an ollie (or an ollie and a leap) can reach. */
  private ledgeAhead(s: Skater): { rail: Rail; needsLeap: boolean } | null {
    if (s.speed < 1.5) return null;
    const p = s.position, fx = -Math.sin(s.travelHeading), fz = -Math.cos(s.travelHeading);
    const pop = (OLLIE.base + OLLIE.charged) * s.abilities.pop, leap = AIR_MOVES.leap * s.abilities.pop;
    const reach = (pop * pop) / (2 * GRAVITY) - 0.15, leapReach = reach + s.abilities.leaps * ((leap * leap) / (2 * GRAVITY) - 0.2);
    let best: { rail: Rail; needsLeap: boolean; distance: number } | null = null;
    const rails = this.world.railsNear?.(p.x, p.z, 6) ?? this.world.rails ?? [];
    for (const rail of rails) {
      const dx = rail.b.x - rail.a.x, dz = rail.b.z - rail.a.z, l2 = dx * dx + dz * dz;
      if (l2 < 0.25) continue;
      const t = Math.max(0, Math.min(1, ((p.x - rail.a.x) * dx + (p.z - rail.a.z) * dz) / l2));
      const x = rail.a.x + dx * t - p.x, z = rail.a.z + dz * t - p.z, distance = Math.hypot(x, z);
      if (distance < 1.2 || distance > 6 || (x * fx + z * fz) / distance < 0.8) continue;
      const height = rail.a.y + (rail.b.y - rail.a.y) * t - p.y;
      if (height < 0.25 || height > leapReach) continue;
      if (!best || distance < best.distance) best = { rail, needsLeap: height > reach, distance };
    }
    return best;
  }
  /** a wall within half a metre ahead (for the wallplant hint) */
  private wallAhead(s: Skater) {
    const fx = -Math.sin(s.travelHeading), fz = -Math.cos(s.travelHeading);
    const probe = this.world.move(s.position, { x: fx * 0.5, y: 0, z: fz * 0.5 });
    return probe.blocked && !!probe.normal && probe.normal.x * fx + probe.normal.z * fz < -0.2;
  }
  /** a wall just to the left or right, along your line (for the wallride hint) */
  private wallBeside(s: Skater) {
    const fx = -Math.sin(s.travelHeading), fz = -Math.cos(s.travelHeading);
    for (const side of [1, -1]) {
      const probe = this.world.move({ x: s.position.x, y: s.position.y + 0.3, z: s.position.z }, { x: -fz * side * 0.7, y: 0, z: fx * side * 0.7 });
      if (probe.blocked && probe.normal && Math.abs(probe.normal.x * fx + probe.normal.z * fz) < 0.4) return true;
    }
    return false;
  }
}
/** hints that may cut in right away */
const URGENT = new Set(['link', 'wallplant', 'leap', 'godsword', 'ledge-high']);
