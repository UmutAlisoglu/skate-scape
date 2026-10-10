import * as THREE from 'three';
import { Avatar, type Look } from '../player/avatar.ts';
import type { AnimData, Wardrobe } from '../shared/player-data.ts';
import { rsMaterial, type Surfaces } from '../world/rs-material.ts';
import { Skateboard } from './board.ts';
import { ghostAt, type GhostRun } from './races.ts';

/** Ghost runs live in this browser's storage next to the career (one per race). */
export function loadGhost(key: string): GhostRun | null {
  try { const run = JSON.parse(localStorage.getItem(key) ?? 'null') as GhostRun | null; return run && Array.isArray(run.frames) && run.frames.length > 1 ? run : null; } catch { return null; }
}
export function saveGhost(key: string, run: GhostRun) {
  try { localStorage.setItem(key, JSON.stringify(run)); } catch { /* storage full: the race still counts */ }
}

/** Your own best run, ridden again as a see-through rider beside you (skate.'s throwdowns, RS-style). */
export class GhostRider {
  private avatar: Avatar;
  private board = new Skateboard();
  private run: GhostRun | null = null;
  constructor(private scene: THREE.Scene, wardrobe: Wardrobe, anims: AnimData, surfaces: Surfaces | null) {
    this.avatar = new Avatar(wardrobe, anims, surfaces, rsMaterial({ vertexColors: true, surfaces, transparent: true, opacity: 0.42 }));
    this.avatar.mesh.renderOrder = 2;
    // the RS shader takes its opacity as a uniform; plain materials take it directly
    this.board.root.traverse((o) => {
      const material = (o as THREE.Mesh).material as THREE.Material | undefined;
      if (!material) return;
      material.transparent = true; material.depthWrite = false;
      const uniforms = (material as THREE.ShaderMaterial).uniforms;
      if (uniforms?.opacity) uniforms.opacity.value = 0.45; else material.opacity = 0.45;
    });
  }
  setLook(look: Look) { this.avatar.setLook(look); }
  /** Starts showing a run (null hides the ghost). */
  show(run: GhostRun | null) {
    this.run = run;
    if (run) this.scene.add(this.avatar.mesh, this.board.root); else this.scene.remove(this.avatar.mesh, this.board.root);
  }
  get active() { return !!this.run; }
  get length() { return this.run?.time ?? 0; }
  /** Poses the ghost where the run was `time` seconds in; returns its position (or null when it's done). */
  update(time: number) {
    if (!this.run) return null;
    const g = ghostAt(this.run, time);
    this.avatar.mesh.position.copy(g.player); this.avatar.mesh.quaternion.copy(g.playerRotation);
    this.board.root.position.copy(g.board); this.board.root.quaternion.copy(g.boardRotation); this.board.setDeck(g.deck);
    this.avatar.setSkatePose(g.pose); this.avatar.update(0);
    return g.done ? null : g.player;
  }
}
