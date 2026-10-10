import * as THREE from 'three';
import { Avatar } from '../player/avatar.ts';
import { SkateAnimator } from '../player/skate-pose.ts';
import type { AnimData, Wardrobe } from '../shared/player-data.ts';
import type { WorldCollision } from '../world/collision.ts';
import type { Surfaces } from '../world/rs-material.ts';
import { Skateboard } from './board.ts';
import { CHAT, pick, type ChatLayer } from './chatter.ts';
import { DECKS } from './decks.ts';
import { Skater, type Rail, type SkateEvent, type SkateInput } from './skater.ts';
import { abilitiesFor } from './skill.ts';

const FIRST = ['Sk8r', 'Grind', 'Lumby', 'Fally', 'Iron', 'Noob', 'Pro', 'Kick', 'Flip', 'Rune', 'Bronze', 'Dragon', 'Gnome', 'Cabbage', 'Party', 'Wise', 'Lil', 'Big', 'Zammy', 'Sara', 'Guthix', 'Lobster'];
const SECOND = ['Boi', 'Lord', 'King', 'Queen', 'Master', 'Kid', 'Pker', 'Noob', 'Rider', 'Sk8r', 'Fan', 'Hero', 'Grl', 'Dude', 'Man', 'Wizz'];
/** An RS-style display name: "Rune Boi342", "xX FlipKing Xx", "Lumby_Sk8r". */
export function randomName() {
  const a = pick(FIRST), b = pick(SECOND), style = Math.random();
  return style < 0.3 ? `xX ${a}${b} Xx` : style < 0.65 ? `${a} ${b}${Math.floor(Math.random() * 999)}` : `${a}_${b}`;
}
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const neutral: SkateInput = { push: false, brake: false, steer: 0, crouch: false, pop: false, flip: false, shove: false };

/** One other player out skating: real skate physics, a random fashionscape outfit and deck, and a simple brain. */
class CrowdSkater {
  readonly skater: Skater;
  readonly avatar: Avatar;
  readonly board = new Skateboard();
  private animator = new SkateAnimator();
  private target: { x: number; z: number; rail: boolean } | null = null;
  private retarget = 0; private stuck = 0; private grindFor = 0; private chatClock = 4 + Math.random() * 8; private bailed = false;
  steer = 0;
  private head = new THREE.Vector3();
  constructor(readonly name: string, world: WorldCollision, wardrobe: Wardrobe, anims: AnimData, surfaces: Surfaces | null, spawn: THREE.Vector3, heading: number) {
    this.skater = new Skater(world, spawn); this.skater.reset(spawn, heading);
    this.skater.abilities = abilitiesFor(30 + Math.floor(Math.random() * 60));
    this.avatar = new Avatar(wardrobe, anims, surfaces);
    this.avatar.setLook(this.avatar.randomLook());
    this.board.setDesign(pick(DECKS));
  }
  /** Over the speaker's head, for chat. */
  readonly anchor = () => this.head.set(this.skater.position.x, this.skater.position.y + 2.3, this.skater.position.z);
  get position() { return this.skater.position; }

  think(dt: number, world: WorldCollision, chat: ChatLayer): SkateInput {
    const s = this.skater, input: SkateInput = { ...neutral };
    if (s.bailTime > 0) return input;
    this.retarget -= dt; this.chatClock -= dt;
    if (this.chatClock <= 0) { this.chatClock = 9 + Math.random() * 14; chat.say(this.name, pick(CHAT.idle), this.anchor); }
    if (s.grinding) {
      // ride the line a moment, then ollie out of it
      this.grindFor -= dt; input.steer = s.balance > 0.15 ? 0.6 : s.balance < -0.15 ? -0.6 : 0;
      if (this.grindFor <= 0) { input.pop = true; this.target = null; }
      return input;
    }
    this.grindFor = 0.8 + Math.random() * 2;
    const p = s.position;
    if (!this.target || this.retarget <= 0 || Math.hypot(this.target.x - p.x, this.target.z - p.z) < 1.5) this.pickTarget(world);
    const t = this.target!, bearing = Math.atan2(-(t.x - p.x), -(t.z - p.z)), off = wrap(bearing - s.travelHeading);
    this.steer = Math.max(-1, Math.min(1, off * 1.6)); input.steer = this.steer;
    input.push = s.grounded && s.speed < 6.5;
    const distance = Math.hypot(t.x - p.x, t.z - p.z);
    // pop onto the ledge they're heading for; now and then just for fun
    if (s.grounded && s.speed > 2.5 && ((t.rail && distance < 2.4 && Math.abs(off) < 0.5) || Math.random() < dt * 0.15)) input.pop = true;
    if (!s.grounded && s.verticalSpeed > 1 && Math.random() < dt * 3) {
      if (Math.random() < 0.6) input.flip = true; else input.shove = true;
      if (Math.random() < 0.1) chat.say(this.name, pick(CHAT.trick), this.anchor);
    }
    // stuck against something: turn round and find somewhere else
    this.stuck = s.grounded && s.speed < 0.5 ? this.stuck + dt : 0;
    if (this.stuck > 2.5) { this.target = { x: p.x + Math.sin(s.travelHeading) * 12, z: p.z + Math.cos(s.travelHeading) * 12, rail: false }; this.retarget = 3; this.stuck = 0; }
    return input;
  }
  /** Heads for a low ledge nearby (to grind it) or just somewhere open. */
  private pickTarget(world: WorldCollision) {
    const p = this.skater.position;
    this.retarget = 4 + Math.random() * 5;
    if (Math.random() < 0.6) {
      const ground = world.groundAt(p.x, p.z, p.y + 0.5) ?? p.y;
      const ledges = world.railsNear(p.x, p.z, 18).filter((r: Rail) => {
        const y = (r.a.y + r.b.y) / 2 - ground, d = Math.hypot((r.a.x + r.b.x) / 2 - p.x, (r.a.z + r.b.z) / 2 - p.z);
        return y > 0.2 && y < 0.75 && d > 4 && Math.hypot(r.b.x - r.a.x, r.b.z - r.a.z) > 2;
      });
      if (ledges.length) {
        const r = pick(ledges), t = 0.3 + Math.random() * 0.4;
        this.target = { x: r.a.x + (r.b.x - r.a.x) * t, z: r.a.z + (r.b.z - r.a.z) * t, rail: true };
        return;
      }
    }
    const a = Math.random() * Math.PI * 2, d = 8 + Math.random() * 14;
    this.target = { x: p.x + Math.cos(a) * d, z: p.z + Math.sin(a) * d, rail: false };
  }
  render(dt: number) {
    const s = this.skater, player = this.avatar.mesh, board = this.board.root;
    if (s.bailTime > 0) {
      if (!this.bailed) { this.bailed = true; this.avatar.setSkatePose(null); this.avatar.play('Death', { loop: false, speed: 2.1, maxDuration: 2.6 }); }
      board.visible = false;
      player.position.set(s.position.x, s.position.y, s.position.z); player.rotation.set(0, s.bailHeading, 0);
    } else {
      if (this.bailed) { this.bailed = false; this.animator.reset(); }
      board.visible = true;
      this.avatar.setSkatePose(this.animator.update(s, dt)); this.board.update(s, dt, this.steer);
      const style = s.grindStyle;
      board.position.set(s.position.x, s.position.y - (s.grinding ? 0.08 : 0), s.position.z);
      board.rotation.set(s.pitch + (style?.pitch ?? 0), s.heading + (style?.yaw ?? 0), style?.roll ?? 0, 'YXZ');
      player.position.copy(board.position); player.position.y += this.avatar.skateSoleOffset;
      player.rotation.set(0, s.heading + (style?.yaw ?? 0) + Math.PI / 2, s.pitch * 0.5, 'YXZ');
    }
    this.avatar.update(dt);
  }
  dispose(scene: THREE.Scene) { scene.remove(this.avatar.mesh, this.board.root); this.avatar.mesh.geometry.dispose(); }
}

/**
 * Other players skating around wherever you are: a few at a time, spawned on open ground out of sight-ish and
 * dropped again when you leave them behind. They chat RS nonsense, cheer your big combos and laugh at bails.
 */
export class Crowd {
  readonly members: CrowdSkater[] = [];
  /** how many skaters to keep around the rider */
  size = 4;
  private spawnClock = 0;
  private replies: { at: number; name: string; line: string; anchor: () => THREE.Vector3 }[] = [];
  private clock = 0;
  constructor(private scene: THREE.Scene, private world: WorldCollision, private wardrobe: Wardrobe, private anims: AnimData, private surfaces: Surfaces | null, private chat: ChatLayer) {}

  update(dt: number, rider: THREE.Vector3) {
    this.clock += dt;
    for (const m of [...this.members]) {
      const d = Math.hypot(m.position.x - rider.x, m.position.z - rider.z);
      if (d > 65 || m.position.y < rider.y - 30) { m.dispose(this.scene); this.members.splice(this.members.indexOf(m), 1); }
    }
    if ((this.spawnClock -= dt) <= 0 && this.members.length < this.size) { this.spawnClock = 1.5; this.spawn(rider); }
    for (const m of this.members) {
      m.skater.update(dt, m.think(dt, this.world, this.chat));
      m.skater.drainEvents();
      m.render(dt);
    }
    for (const reply of [...this.replies]) if (this.clock >= reply.at) { this.chat.say(reply.name, reply.line, reply.anchor); this.replies.splice(this.replies.indexOf(reply), 1); }
  }
  /** The crowd notices the rider: cheers for big combos, laughs at bails. */
  react(event: SkateEvent, rider: THREE.Vector3) {
    const kind = event.type === 'land' && event.score >= 2500 ? 'combo' : event.type === 'bail' ? 'bail' : null;
    if (!kind) return;
    const near = this.members.filter((m) => Math.hypot(m.position.x - rider.x, m.position.z - rider.z) < 30);
    for (const m of near) if (Math.random() < (kind === 'combo' ? 0.7 : 0.45)) this.replies.push({ at: this.clock + 0.4 + Math.random() * 1.4, name: m.name, line: pick(CHAT[kind]), anchor: m.anchor });
  }
  clear() { for (const m of this.members) m.dispose(this.scene); this.members.length = 0; this.replies = []; }

  /** A new skater on open ground 14-32 m from the rider (not on a roof, not in water, not inside a wall). */
  private spawn(rider: THREE.Vector3) {
    for (let attempt = 0; attempt < 12; attempt++) {
      const a = Math.random() * Math.PI * 2, d = 14 + Math.random() * 18, x = rider.x + Math.cos(a) * d, z = rider.z + Math.sin(a) * d;
      const terrain = this.world.groundAt(x, z, rider.y + 12, true);
      if (terrain === null) continue;
      const y = this.world.groundAt(x, z, terrain + 1.2) ?? terrain;
      if (y - terrain > 0.5 || !this.world.canRideAt(x, z, y) || !this.world.inBounds(x, z)) continue;
      if (this.world.move({ x, y, z }, { x: 0.05, y: 0, z: 0.05 }).blocked) continue;
      const m = new CrowdSkater(randomName(), this.world, this.wardrobe, this.anims, this.surfaces, new THREE.Vector3(x, y, z), Math.random() * Math.PI * 2);
      m.skater.speed = 3;
      this.scene.add(m.avatar.mesh, m.board.root); this.members.push(m);
      return;
    }
  }
}
