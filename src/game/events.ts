import * as THREE from 'three';
import { NpcActor } from '../player/npc-actor.ts';
import type { NpcSet } from '../shared/npc-data.ts';
import type { WorldCollision } from '../world/collision.ts';
import type { Surfaces } from '../world/rs-material.ts';
import { Skateboard } from './board.ts';
import { pick, type ChatLayer } from './chatter.ts';
import { DECKS } from './decks.ts';
import type { SkateEvent, Skater } from './skater.ts';

export type EventKind = 'evilchicken' | 'genie' | 'sandwichlady' | 'drunkendwarf' | 'rickturpentine' | 'oldman';
export const EVENT_KINDS: EventKind[] = ['evilchicken', 'genie', 'sandwichlady', 'drunkendwarf', 'rickturpentine', 'oldman'];
/** What a random event can do to the game. */
export interface EventHooks {
  /** Skateboarding XP with a message */
  reward(xp: number, text: string): void;
  toast(text: string): void;
  level(): number;
  /** opens the Mysterious Old Man's box; returns what was inside */
  mysteryBox(): string;
  /** an event was beaten (the Evil Chicken outskated...) */
  success(kind: EventKind): void;
}
/** Seconds of skating before the first random event, then between events. */
export const EVENT_TIMING = { first: [75, 150], next: [120, 240] } as const;

interface Active { kind: EventKind; actor: NpcActor; board: Skateboard | null; time: number; state: number; anchor: () => THREE.Vector3; chatClock: number }

/**
 * RS random events, out on the streets: the Evil Chicken chases you on its own skateboard, the Genie hands you
 * an XP lamp, the Sandwich Lady's baguette gives you perfect balance, the Drunken Dwarf trades a kebab (a full
 * special bar) for a combo, Rick Turpentine bets you can't land one in time, and the Mysterious Old Man leaves
 * a box. One at a time, every few minutes of skating.
 */
export class RandomEvents {
  private active: Active | null = null;
  private clock = EVENT_TIMING.first[0] + Math.random() * (EVENT_TIMING.first[1] - EVENT_TIMING.first[0]);
  private head = new THREE.Vector3();
  enabled = true;
  constructor(private scene: THREE.Scene, private world: WorldCollision, private set: NpcSet | null, private surfaces: Surfaces | null, private chat: ChatLayer, private hooks: EventHooks) {}
  get current() { return this.active?.kind ?? null; }

  /** Starts an event now (or a random one); false when it can't (no NPC models exported, one already running). */
  trigger(rider: Skater, kind: EventKind = pick(EVENT_KINDS)) {
    const data = this.set?.npcs[kind];
    if (!data || this.active) return false;
    const actor = new NpcActor(data, this.set!, this.surfaces);
    const h = rider.travelHeading, fx = -Math.sin(h), fz = -Math.cos(h), p = rider.position;
    // the chicken comes from behind, the lady waits ahead, the rest appear beside you
    const [ahead, side] = kind === 'evilchicken' ? [-12, 0] : kind === 'sandwichlady' ? [9, 0] : [2.5, 2.5];
    const x = p.x + fx * ahead - fz * side, z = p.z + fz * ahead + fx * side;
    actor.mesh.position.set(x, this.ground(x, z, p.y), z);
    if (kind === 'evilchicken') actor.mesh.scale.setScalar(2.2);
    let board: Skateboard | null = null;
    if (kind === 'evilchicken') { board = new Skateboard(); board.setDesign(pick(DECKS)); this.scene.add(board.root); }
    this.scene.add(actor.mesh);
    const anchor = () => this.head.set(actor.mesh.position.x, actor.mesh.position.y + actor.height * actor.mesh.scale.y + 0.5, actor.mesh.position.z);
    this.active = { kind, actor, board, time: 0, state: 0, anchor, chatClock: 0 };
    const opening: Record<EventKind, string> = {
      evilchicken: 'flash1:Bwuk bwuk bwuk!!', genie: 'Greetings, adventurer! Here, a lamp for you.', sandwichlady: 'You look hungry! Have a baguette, dear.',
      drunkendwarf: "Oi! Are you lookin' at me?! Hic!", rickturpentine: "Stand and deliver! Bet you can't land a 3,000-point combo in 30 seconds!", oldman: 'Ah, there you are. This is for you.',
    };
    this.chat.say(data.name, opening[kind], anchor);
    if (kind === 'evilchicken') this.hooks.toast('The Evil Chicken is after you! Outskate it for 20 seconds');
    return true;
  }

  /** The rider's skate events (combos for the dwarf and the highwayman). */
  notice(event: SkateEvent) {
    const a = this.active;
    if (!a || event.type !== 'land') return;
    if (a.kind === 'drunkendwarf' && event.score >= 1000 && a.state === 0) a.state = 1;
    if (a.kind === 'rickturpentine' && event.score >= 3000 && a.state === 0) a.state = 1;
  }

  update(dt: number, rider: Skater, skating: boolean) {
    if (!this.active) {
      if (skating && this.enabled && rider.position.x >= 0 && (this.clock -= dt) <= 0) {
        this.clock = EVENT_TIMING.next[0] + Math.random() * (EVENT_TIMING.next[1] - EVENT_TIMING.next[0]);
        this.trigger(rider);
      }
      return;
    }
    const a = this.active, m = a.actor.mesh, p = rider.position;
    a.time += dt; a.chatClock -= dt;
    const dx = p.x - m.position.x, dz = p.z - m.position.z, distance = Math.hypot(dx, dz);
    const face = () => { m.rotation.y = Math.atan2(dx, dz); };
    const moveToward = (speed: number) => {
      if (distance < 0.01) return;
      const step = Math.min(distance, speed * dt), x = m.position.x + (dx / distance) * step, z = m.position.z + (dz / distance) * step;
      m.position.set(x, THREE.MathUtils.damp(m.position.y, this.ground(x, z, m.position.y), 12, dt), z);
    };
    const say = (line: string) => this.chat.say(a.actor.data.name, line, a.anchor);
    let done = false;
    switch (a.kind) {
      case 'evilchicken': {
        // two seconds' warning, then it skates after you a little slower than a pushing rider: keep moving
        a.actor.play('idle'); face(); if (a.time > 2) moveToward(7.6);
        const b = a.board!.root;
        b.position.set(m.position.x, m.position.y, m.position.z); b.rotation.set(0, Math.atan2(-dx, -dz), 0);
        m.position.y = b.position.y + 0.13;
        if (a.chatClock <= 0) { a.chatClock = 3; say(pick(['BWUK!', 'flash2:Bwuk bwuk!', 'shake:BWUUUK', "You can't escape the chicken!"])); }
        if (distance < 1.3 && rider.bailTime === 0) { rider.knockDown('The Evil Chicken got you! · Bwuk!'); say('glow1:BWUK BWUK BWUK!'); done = true; }
        else if (a.time > 20) { say('Bwuk... (it gives up)'); this.hooks.reward(this.hooks.level() * 150, 'You outskated the Evil Chicken!'); this.hooks.success('evilchicken'); done = true; }
        break;
      }
      case 'genie': {
        a.actor.play('idle'); face();
        m.position.y = this.ground(m.position.x, m.position.z, p.y) + 0.4 + Math.sin(a.time * 3) * 0.12;
        if (distance > 3) moveToward(Math.max(4, rider.speed + 1));
        if (a.state === 0 && a.time > 1.5) { a.state = 1; this.hooks.reward(this.hooks.level() * 120, 'You rub the lamp...'); say('May your grinds be long!'); }
        if (a.time > 5) done = true;
        break;
      }
      case 'sandwichlady': {
        a.actor.play('idle'); face();
        if (a.state === 0 && (distance < 3.5 || a.time > 6)) { a.state = 1; rider.perfectBalance = 20; this.hooks.toast('Baguette! Perfect balance on grinds and manuals for 20 s'); say('Enjoy, dear!'); }
        if (a.time > 9) done = true;
        break;
      }
      case 'drunkendwarf': {
        face();
        if (distance > 2.5) { a.actor.play('walk'); moveToward(3.4); } else a.actor.play('idle');
        if (a.chatClock <= 0 && a.state === 0) { a.chatClock = 3.5; say(pick(["I love you man! Hic!", 'Land me a combo and you get a kebab!', "Oi! Where're you goin'?", 'Hic! Nice board...'])); }
        if (a.state === 1) { a.state = 2; rider.special = 1; this.hooks.toast('A kebab! Your special bar is full'); say('Have a kebab, mate! Hic!'); a.time = 26; }
        if (a.time > 30) done = true;
        break;
      }
      case 'rickturpentine': {
        face();
        if (distance > 5) { a.actor.play('walk'); moveToward(Math.max(4, rider.speed)); } else a.actor.play('idle');
        if (a.state === 1) { a.state = 2; this.hooks.reward(this.hooks.level() * 200, 'Rick Turpentine pays up'); say('Curses! Fine, take the loot.'); a.time = 27; }
        if (a.state === 0 && a.time > 30) { a.state = 3; say('Ha! Too slow, too slow!'); a.time = 27; }
        if (a.time > 30) done = true;
        break;
      }
      case 'oldman': {
        a.actor.play('idle'); face();
        if (distance > 4) moveToward(Math.max(3, rider.speed));
        if (a.state === 0 && a.time > 2) { a.state = 1; this.hooks.toast(`You open the box: ${this.hooks.mysteryBox()}`); say('Use it wisely.'); }
        if (a.time > 5) done = true;
        break;
      }
    }
    a.actor.update(dt);
    if (done || distance > 80) this.end();
  }
  /** Removes the event's NPC (a teleport, a finished event). */
  end() {
    const a = this.active;
    if (!a) return;
    this.scene.remove(a.actor.mesh); a.actor.mesh.geometry.dispose();
    if (a.board) this.scene.remove(a.board.root);
    this.active = null;
  }
  private ground(x: number, z: number, y: number) { return this.world.groundAt(x, z, y + 3) ?? y; }
}
