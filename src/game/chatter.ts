import * as THREE from 'three';

/** What other players say, RS 2009 style. Some lines carry the client's chat effects (wave:, flash1:, glow1:). */
export const CHAT = {
  idle: [
    'gimme gp pl0x', 'jamflex wtf?', 'god ash is here', 'buying gf', 'free armour trimming', 'doubling money, trade me',
    'selling lobbies 300ea', 'wave:sk8 or die', 'flash1:party at fally park!!', 'glow1:selling rune deck 10k', 'wtb dragon board',
    'lvl 3 sk8er here', 'brb mum says dinner', 'afk', 'where is the bank?', 'lumby is best town', 'cabbage!', 'anyone seen the evil chicken?',
    'mod ash pls fix grinds', 'how do u wallplant', 'who wants to race to varrock', 'dance for gp', 'trade me', 'this game is so 2009',
    'scroll:follow me 4 free stuff', 'i have 99 sk8 (lie)', 'noob', 'sit', 'plz giv bord', 'wc lvls?', 'flash2:pk me noob', 'gz on 99 m8',
    'my board is rune btw', 'found a bug lol', 'wave2:yo yo yo', 'u wanna duel?', 'ty', 'np', 'lol', 'roflmao', 'glow2:sk8 guild when',
  ],
  /** after the player banks a big combo nearby */
  combo: ['gz!!', 'nice line', 'how do u do that', 'flash1:WOW', 'teach me pls', 'nice combo m8', 'gz', 'hacker', 'glow3:legend', 'u r so pro', 'wave:GZ'],
  /** after the player bails nearby */
  bail: ['lol', 'rip', 'oof', 'noob', 'f', 'that hurt', 'oh dear, you are dead!', 'sit', 'lmao', 'unlucky'],
  /** their own tricks */
  trick: ['kickflip!', 'ez', 'watch this', 'grind time', 'yeee', 'shake:whoa', 'woo'],
};
export const pick = <T,>(list: T[]) => list[Math.floor(Math.random() * list.length)];

const EFFECTS = ['wave2', 'wave', 'scroll', 'shake', 'flash1', 'flash2', 'flash3', 'glow1', 'glow2', 'glow3', 'slide'];
/** Splits "effect:message" into the RS chat effect and the text. */
export function parseChat(line: string) {
  const match = /^([a-z0-9]+):(.*)$/.exec(line);
  return match && EFFECTS.includes(match[1]) ? { effect: match[1], text: match[2] } : { effect: '', text: line };
}

interface Bubble { el: HTMLElement; anchor: () => THREE.Vector3 | null; time: number }

/**
 * RS public chat: yellow text over the speaker's head for a few seconds (with the client's chat effects), and
 * a little chatbox in the corner listing who said what.
 */
export class ChatLayer {
  private layer = document.createElement('div');
  private box = document.createElement('div');
  private bubbles: Bubble[] = [];
  private screen = new THREE.Vector3();
  constructor() {
    this.layer.id = 'overhead-chat'; this.box.id = 'chatbox';
    document.body.append(this.layer, this.box);
  }
  /** Shows a line over a moving anchor (null hides it) and logs it in the chatbox. */
  say(name: string, line: string, anchor: () => THREE.Vector3 | null) {
    const { effect, text } = parseChat(line);
    for (const old of this.bubbles.filter((b) => b.anchor === anchor)) this.remove(old);
    const el = document.createElement('div'); el.className = `overhead ${effect}`;
    if (effect.startsWith('wave') || effect === 'shake') {
      [...text].forEach((ch, i) => { const span = document.createElement('span'); span.textContent = ch; span.style.animationDelay = `${-i * 0.08}s`; el.append(span); });
    } else el.textContent = text;
    this.layer.append(el); this.bubbles.push({ el, anchor, time: 0 });
    const row = document.createElement('p');
    const who = document.createElement('b'); who.textContent = `${name}: `;
    row.append(who, text); this.box.append(row);
    while (this.box.childElementCount > 6) this.box.firstElementChild!.remove();
    this.box.classList.add('active'); this.idle = 0;
  }
  private idle = 0;
  private remove(bubble: Bubble) { bubble.el.remove(); this.bubbles = this.bubbles.filter((b) => b !== bubble); }
  update(dt: number, camera: THREE.Camera) {
    this.idle += dt;
    if (this.idle > 12) this.box.classList.remove('active');
    for (const bubble of [...this.bubbles]) {
      bubble.time += dt;
      const at = bubble.anchor();
      if (!at || bubble.time > 4.5) { this.remove(bubble); continue; }
      this.screen.copy(at).project(camera);
      const visible = this.screen.z < 1 && Math.abs(this.screen.x) < 1.1 && Math.abs(this.screen.y) < 1.1;
      bubble.el.hidden = !visible;
      if (visible) bubble.el.style.transform = `translate(${((this.screen.x + 1) / 2) * innerWidth}px, ${((1 - this.screen.y) / 2) * innerHeight}px) translate(-50%, -100%)`;
    }
  }
  set hidden(value: boolean) { this.layer.hidden = value; this.box.hidden = value; }
}
