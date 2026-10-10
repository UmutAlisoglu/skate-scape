import * as THREE from 'three';

/** Deck designs: the first four are the original unlocks; each town deck comes from that town's Master challenge. */
export type Glyph = 'grain' | 'rune' | 'shield' | 'crown' | 'castle' | 'skull' | 'star' | 'coin' | 'swords' | 'axe' | 'palm' | 'tower' | 'bat' | 'trophy';
export interface DeckDesign { id: string; name: string; base: string; accent: string; glyph: Glyph; place?: string }

export const DECKS: DeckDesign[] = [
  { id: 'oak', name: 'Oak deck', base: '#7a4f2a', accent: '#e6c48a', glyph: 'grain' },
  { id: 'rune', name: 'Rune deck', base: '#1f7f93', accent: '#bff2ff', glyph: 'rune' },
  { id: 'dragon', name: 'Dragon deck', base: '#8d1a1a', accent: '#f2c14e', glyph: 'shield' },
  { id: 'gold', name: 'Gold deck', base: '#b88a1b', accent: '#fff3b0', glyph: 'crown' },
  { id: 'lumbridge', name: 'Lumbridge deck', base: '#2f5e8c', accent: '#f1eadb', glyph: 'castle', place: 'lumbridge' },
  { id: 'varrock', name: 'Varrock deck', base: '#7a1f2b', accent: '#f3c34f', glyph: 'shield', place: 'varrock' },
  { id: 'draynor', name: 'Draynor deck', base: '#3c2350', accent: '#d9c4f0', glyph: 'bat', place: 'draynor' },
  { id: 'alkharid', name: 'Al Kharid deck', base: '#c9a15a', accent: '#5b3a12', glyph: 'palm', place: 'alkharid' },
  { id: 'barbarian', name: 'Barbarian deck', base: '#5e4128', accent: '#e9d3a1', glyph: 'axe', place: 'barbarian' },
  { id: 'edgeville', name: 'Wilderness deck', base: '#1b1414', accent: '#e23b2e', glyph: 'skull', place: 'edgeville' },
  { id: 'grandexchange', name: 'Grand Exchange deck', base: '#2d5a33', accent: '#f6d35b', glyph: 'coin', place: 'grandexchange' },
  { id: 'wizards', name: 'Wizards’ deck', base: '#1f2f7a', accent: '#f3f0b0', glyph: 'star', place: 'wizards' },
  { id: 'duelarena', name: 'Duel Arena deck', base: '#b4885a', accent: '#3a2410', glyph: 'swords', place: 'duelarena' },
  { id: 'champions', name: 'Champions’ deck', base: '#5a1830', accent: '#f6d77a', glyph: 'trophy', place: 'champions' },
  { id: 'lumberyard', name: 'Lumber Yard deck', base: '#6b4a24', accent: '#c9e08a', glyph: 'tower', place: 'lumberyard' },
];

const cache = new Map<string, THREE.Texture>();
/** The underside graphic for a deck (u across the board, v along it; the nose is at the top). */
export function deckTexture(design: DeckDesign) {
  const cached = cache.get(design.id);
  if (cached) return cached;
  const canvas = document.createElement('canvas'); canvas.width = 128; canvas.height = 512;
  const c = canvas.getContext('2d')!, w = 128, h = 512;
  c.fillStyle = design.base; c.fillRect(0, 0, w, h);
  // a subtle pattern over the whole deck
  c.globalAlpha = 0.16; c.strokeStyle = design.accent; c.lineWidth = 2;
  if (design.glyph === 'grain') for (let y = 0; y < h; y += 9) { c.beginPath(); c.moveTo(0, y); c.bezierCurveTo(40, y + 6, 80, y - 6, w, y + 3); c.stroke(); }
  else for (let y = -w; y < h; y += 18) { c.beginPath(); c.moveTo(0, y); c.lineTo(w, y + w); c.stroke(); }
  c.globalAlpha = 1;
  // border stripes near the nose and tail
  c.fillStyle = design.accent; c.fillRect(0, 34, w, 6); c.fillRect(0, h - 40, w, 6);
  drawGlyph(c, design.glyph, w / 2, h / 2 - 20, design.accent, design.base);
  // the name between the trucks (they sit about 98 px from each end), sized to fit the width
  const label = design.name.replace(' deck', '').toUpperCase();
  c.save(); c.translate(w / 2, 336); c.fillStyle = design.accent; c.textAlign = 'center';
  let size = 22; do { c.font = `bold ${size}px Georgia`; } while (c.measureText(label).width > 108 && --size > 8);
  c.fillText(label, 0, 0); c.restore();
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = 4;
  cache.set(design.id, texture);
  return texture;
}

function drawGlyph(c: CanvasRenderingContext2D, glyph: Glyph, x: number, y: number, ink: string, base: string) {
  c.save(); c.translate(x, y); c.fillStyle = ink; c.strokeStyle = ink; c.lineWidth = 6; c.lineJoin = 'round';
  const poly = (points: number[]) => { c.beginPath(); for (let i = 0; i < points.length; i += 2) c.lineTo(points[i], points[i + 1]); c.closePath(); c.fill(); };
  switch (glyph) {
    case 'grain': c.font = 'bold 84px Georgia'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('S', 0, 0); break;
    case 'rune': poly([0, -60, 36, 0, 0, 60, -36, 0]); c.fillStyle = base; poly([0, -34, 20, 0, 0, 34, -20, 0]); break;
    case 'shield': poly([-40, -50, 40, -50, 40, 0, 0, 60, -40, 0]); c.fillStyle = base; poly([-24, -34, 24, -34, 24, -2, 0, 36, -24, -2]); break;
    case 'crown': poly([-44, 30, -44, -24, -22, 4, 0, -38, 22, 4, 44, -24, 44, 30]); break;
    case 'castle': c.fillRect(-42, -10, 84, 50); for (let i = -42; i < 42; i += 21) c.fillRect(i, -26, 12, 18); c.fillRect(-16, -54, 32, 50); c.fillStyle = base; c.fillRect(-10, 16, 20, 24); break;
    case 'skull': c.beginPath(); c.arc(0, -8, 38, 0, Math.PI * 2); c.fill(); c.fillRect(-22, 20, 44, 26); c.fillStyle = base;
      c.beginPath(); c.arc(-14, -8, 10, 0, Math.PI * 2); c.arc(14, -8, 10, 0, Math.PI * 2); c.fill(); break;
    case 'star': { const p: number[] = []; for (let i = 0; i < 10; i++) { const a = (i * Math.PI) / 5 - Math.PI / 2, r = i % 2 ? 20 : 50; p.push(Math.cos(a) * r, Math.sin(a) * r); } poly(p); break; }
    case 'coin': for (const [dx, dy] of [[-18, 18], [18, 18], [0, -14]]) { c.beginPath(); c.arc(dx, dy, 24, 0, Math.PI * 2); c.fill(); c.strokeStyle = base; c.lineWidth = 3; c.stroke(); } break;
    case 'swords': c.lineWidth = 8; c.beginPath(); c.moveTo(-40, -50); c.lineTo(40, 50); c.moveTo(40, -50); c.lineTo(-40, 50); c.stroke(); c.fillRect(-30, 26, 18, 8); c.fillRect(12, 26, 18, 8); break;
    case 'axe': c.fillRect(-4, -56, 8, 112); poly([4, -50, 44, -62, 50, -14, 4, -22]); break;
    case 'palm': c.fillRect(-4, -20, 8, 76); for (const a of [-2.6, -2, -1.2, -0.6]) { c.beginPath(); c.ellipse(Math.cos(a) * 26, -24 + Math.sin(a) * 12, 30, 7, a, 0, Math.PI * 2); c.fill(); } break;
    case 'tower': c.fillRect(-22, -40, 44, 96); poly([-30, -40, 0, -76, 30, -40]); c.fillStyle = base; c.fillRect(-7, -14, 14, 20); break;
    case 'bat': poly([0, -10, 16, -26, 50, -20, 34, 0, 44, 18, 14, 8, 0, 24, -14, 8, -44, 18, -34, 0, -50, -20, -16, -26]); break;
    case 'trophy': c.beginPath(); c.arc(0, -16, 30, 0, Math.PI); c.fill(); c.fillRect(-30, -32, 60, 16); c.fillRect(-5, 12, 10, 26); c.fillRect(-24, 38, 48, 10); break;
  }
  c.restore();
}
