import * as THREE from 'three';
import { NpcActor } from '../player/npc-actor.ts';
import type { NpcSet } from '../shared/npc-data.ts';
import type { WorldCollision } from '../world/collision.ts';
import type { Surfaces } from '../world/rs-material.ts';
import { Skateboard } from './board.ts';
import { pick, type ChatLayer } from './chatter.ts';
import { DECKS } from './decks.ts';
import type { SkateEvent, Skater } from './skater.ts';

/** Pets (real RS NPC models) that ride along on their own little board. Most come with Skateboarding levels. */
export interface PetDef { id: string; npc: string; name: string; level?: number; how: string; says: string[] }
export const PETS: PetDef[] = [
  { id: 'kitten', npc: 'kitten', name: 'Kitten', level: 5, how: 'Skateboarding level 5', says: ['Meow!', 'Purr...', 'Mew?'] },
  { id: 'duck', npc: 'duck', name: 'Duck', level: 15, how: 'Skateboarding level 15', says: ['Quack!', 'Quack quack!'] },
  { id: 'penguin', npc: 'penguin', name: 'Penguin', level: 25, how: 'Skateboarding level 25', says: ['Noot noot!', 'Squawk!'] },
  { id: 'squirrel', npc: 'squirrel', name: 'Squirrel', level: 35, how: 'Skateboarding level 35', says: ['Chitter chitter!', '*nibbles a nut*'] },
  { id: 'monkey', npc: 'monkey', name: 'Monkey', level: 45, how: 'Skateboarding level 45', says: ['Ook ook!', 'Eeek eek!'] },
  { id: 'raccoon', npc: 'raccoon', name: 'Raccoon', level: 55, how: 'Skateboarding level 55', says: ['*rustle rustle*', 'Chrr!'] },
  { id: 'imp', npc: 'imp', name: 'Imp', level: 65, how: 'Skateboarding level 65', says: ['Hehehe!', 'Gimme gp!'] },
  { id: 'babyreddragon', npc: 'babyreddragon', name: 'Baby red dragon', level: 80, how: 'Skateboarding level 80', says: ['Rawr!', '*puffs smoke*'] },
  { id: 'babybluedragon', npc: 'babybluedragon', name: 'Baby blue dragon', level: 95, how: 'Skateboarding level 95', says: ['RAWR!', '*sneezes ice*'] },
  { id: 'chicken', npc: 'chicken', name: 'Chicken', how: 'Outskate the Evil Chicken', says: ['Bwuk!', 'Bwuk bwuk?'] },
  { id: 'cat', npc: 'cat', name: 'Cat', how: 'Found in a mystery box', says: ['Meow.', '*ignores you*'] },
];
export const petDef = (id: string) => PETS.find((p) => p.id === id) ?? null;

/** The pet following the rider: skates behind them on a mini board, hops when they jump, walks when they walk. */
export class PetFollower {
  private actor: NpcActor | null = null;
  private board = new Skateboard();
  private id = '';
  private velocity = new THREE.Vector3();
  private head = new THREE.Vector3();
  private chatClock = 20;
  constructor(private scene: THREE.Scene, private world: WorldCollision, private set: NpcSet | null, private surfaces: Surfaces | null, private chat: ChatLayer) {
    this.board.root.scale.setScalar(0.55); this.board.setDesign(pick(DECKS));
  }
  private readonly anchor = () => this.actor ? this.head.copy(this.actor.mesh.position).setY(this.actor.mesh.position.y + this.actor.height * this.actor.mesh.scale.y + 0.4) : null;
  /** Shows a pet ('' for none); it appears next to the rider. */
  setPet(id: string, near: THREE.Vector3) {
    if (id === this.id) return;
    this.id = id;
    if (this.actor) { this.scene.remove(this.actor.mesh); this.actor.mesh.geometry.dispose(); this.actor = null; }
    this.scene.remove(this.board.root);
    const def = petDef(id), data = def ? this.set?.npcs[def.npc] : undefined;
    if (!def || !data) return;
    this.actor = new NpcActor(data, this.set!, this.surfaces);
    // big pets (baby dragons) shrink to pet size
    this.actor.mesh.scale.setScalar(Math.min(1, 0.85 / this.actor.height));
    this.scene.add(this.actor.mesh, this.board.root);
    this.snap(near);
  }
  snap(at: THREE.Vector3) { if (this.actor) { this.actor.mesh.position.copy(at).add(new THREE.Vector3(1, 0, 1)); this.velocity.set(0, 0, 0); } }
  /** Says something after the rider's big combos and bails. */
  react(event: SkateEvent) {
    const def = petDef(this.id);
    if (!def || !this.actor) return;
    if ((event.type === 'land' && event.score >= 5000) || (event.type === 'bail' && Math.random() < 0.5)) this.chat.say(def.name, pick(def.says), this.anchor);
  }
  update(dt: number, rider: Skater, riderPosition: THREE.Vector3, skating: boolean) {
    const actor = this.actor, def = petDef(this.id);
    if (!actor || !def) return;
    const m = actor.mesh, h = skating ? rider.travelHeading : Math.atan2(-this.velocity.x, -this.velocity.z) || 0;
    // a spot behind the rider and a little to the side
    const fx = -Math.sin(h), fz = -Math.cos(h), target = new THREE.Vector3(riderPosition.x - fx * 1.7 + fz * 0.7, 0, riderPosition.z - fz * 1.7 - fx * 0.7);
    const dx = target.x - m.position.x, dz = target.z - m.position.z, distance = Math.hypot(dx, dz);
    if (distance > 25) { this.snap(riderPosition); return; }
    const speed = Math.min(distance * 3, Math.max(rider.speed + 3, 4));
    this.velocity.set(distance > 0.05 ? (dx / distance) * speed : 0, 0, distance > 0.05 ? (dz / distance) * speed : 0);
    m.position.x += this.velocity.x * dt; m.position.z += this.velocity.z * dt;
    // on the ground it rides the ground; when the rider is up in the air or on a rail, it hops up with them
    const ground = this.world.groundAt(m.position.x, m.position.z, Math.max(m.position.y, riderPosition.y) + 1) ?? m.position.y;
    const up = skating && (!rider.grounded || rider.grinding) ? Math.max(ground, riderPosition.y - 0.2) : ground;
    m.position.y = THREE.MathUtils.damp(m.position.y, up + (skating ? 0.08 : 0), 10, dt);
    const moving = Math.hypot(this.velocity.x, this.velocity.z) > 0.3;
    if (moving) m.rotation.y = Math.atan2(this.velocity.x, this.velocity.z);
    this.board.root.visible = skating;
    if (skating) {
      this.board.root.position.set(m.position.x, m.position.y - 0.08, m.position.z);
      this.board.root.rotation.set(0, m.rotation.y + Math.PI, 0);
      actor.play('idle');
    } else actor.play(moving ? 'walk' : 'idle');
    if ((this.chatClock -= dt) <= 0) { this.chatClock = 25 + Math.random() * 30; this.chat.say(def.name, pick(def.says), this.anchor); }
    actor.update(dt);
  }
}
