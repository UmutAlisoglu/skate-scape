import { Career, GOALS } from './career.ts';
import type { Skater } from './skater.ts';

export class GameUI {
  paused = true;
  private panel = document.createElement('section');
  private layer = document.createElement('div');
  private root = document.createElement('div');
  private score: HTMLElement; private clock: HTMLElement; private state: HTMLElement; private combo: HTMLElement; private goal: HTMLElement; private toast: HTMLElement; private balance: HTMLElement; private marker: HTMLElement;
  private menu: string | null = 'title';
  constructor(private career: Career, private actions: { start(mode: 'free' | 'run', training: boolean): void; practice(): void; board(index: number): void; pause(): void }) {
    this.root.id = 'game-ui';
    this.root.innerHTML = `<div class="score-card"><span class="eyebrow">SCAPE SKATE</span><strong id="score">0</strong><span id="run-clock">FREE SKATE</span></div><div class="goal-card"><span class="eyebrow">NEXT QUEST</span><span id="next-goal"></span><button id="pause-game" aria-label="Pause game">Ⅱ</button></div><div class="combo-card"><span id="rider-state"></span><strong id="combo-text"></strong></div><div id="balance"><span>Balance · A / D</span><div class="balance-track"><i id="balance-marker"></i></div></div><div id="quest-toast"></div><div class="control-strip"><span>W push · S brake · A/D steer</span><span>Space ollie · Q flip · E shove</span><span>Auto-grind tops · M manual</span><button id="practice-button">P · Training grounds</button><button id="help-button">H · Controls</button></div>`;
    document.body.append(this.root);
    const get = (id: string) => this.root.querySelector<HTMLElement>(`#${id}`)!;
    this.score = get('score'); this.clock = get('run-clock'); this.state = get('rider-state'); this.combo = get('combo-text'); this.goal = get('next-goal'); this.toast = get('quest-toast'); this.balance = get('balance'); this.marker = get('balance-marker');
    get('pause-game').onclick = () => this.togglePause(); get('help-button').onclick = () => this.show('help'); get('practice-button').onclick = () => this.actions.practice();
    this.layer.id = 'menu-layer'; this.panel.className = 'menu-panel'; this.layer.append(this.panel); document.body.append(this.layer); this.show('title');
  }
  togglePause() { if (this.menu === 'pause' || this.menu === 'help') this.resume(); else this.show('pause'); }
  resume() { this.menu = null; this.paused = false; this.layer.hidden = true; }
  pause() { if (!this.paused) this.show('pause'); }
  show(kind: 'title' | 'pause' | 'help' | 'results') {
    this.menu = kind; this.paused = true; this.actions.pause(); this.layer.hidden = false;
    const title = kind === 'title' ? 'LUMBRIDGE LOCALS' : kind === 'results' ? 'RUN COMPLETE' : kind === 'help' ? 'FIND YOUR LINE' : 'TAKE A BREATHER';
    this.panel.innerHTML = `<span class="eyebrow">SCAPE SKATE</span><h1>${title}</h1><p class="menu-intro"></p><div class="menu-actions"></div><div class="menu-details"></div><div class="board-picker"></div><footer></footer>`;
    const intro = this.panel.querySelector<HTMLElement>('.menu-intro')!, buttons = this.panel.querySelector<HTMLElement>('.menu-actions')!, details = this.panel.querySelector<HTMLElement>('.menu-details')!;
    const button = (label: string, action: () => void, primary = false) => {
      const el = document.createElement('button'); el.textContent = label; if (primary) el.className = 'primary'; el.onclick = action; buttons.append(el);
    };
    const start = (mode: 'free' | 'run', training: boolean) => { this.actions.start(mode, training); this.resume(); };
    if (kind === 'title') {
      intro.textContent = 'Skate the castle paths, learn a new trick, and earn your place in Gielinor.';
      button('Start a 2-minute run', () => start('run', true), true); button('Free skate in Lumbridge', () => start('free', false)); button('Training grounds', () => start('free', true));
    } else if (kind === 'results') {
      intro.textContent = `${this.career.runScore.toLocaleString()} points · best run ${this.career.profile.bestRun.toLocaleString()}`;
      button('Retry run', () => start('run', true), true); button('Keep free skating', () => { this.career.start('free'); this.resume(); });
    } else { intro.textContent = 'Your line will wait. Progress saves on this browser.'; button('Resume skating', () => this.resume(), true); button('Start a new run', () => start('run', true)); button('Visit training grounds', () => { this.actions.practice(); this.resume(); }); }
    if (kind === 'help') {
      details.innerHTML = '<p><b>Push & steer:</b> W builds speed, S brakes, A/D turn the board. The camera follows behind you. Drag to look around; V switches follow/free camera.</p><p><b>Tricks:</b> hold Space to crouch, release to ollie. Q kickflips and E shove-its in the air. A/D spin; face your direction of travel when you land.</p><p><b>Lines:</b> land on a wall, fence or rail top to automatically grind. Shift gives a wider catch window. S drops off; Space ollies out. Hold M on the ground to manual, and use A/D to balance.</p><p><b>Explore:</b> P training grounds, T home, F walk/skate, R random outfit, G change gender, 1–0 emotes. Escape pauses.</p><p><b>Gamepad:</b> RT push, LT brake/drop, left stick steer/balance, hold/release A ollie, X flip, B shove-it, LB manual, RB catch assist, Start pause.</p>';
    } else {
      const list = document.createElement('ul'); list.className = 'quest-list';
      for (const goal of GOALS) { const item = document.createElement('li'); item.textContent = `${this.career.profile.completed.includes(goal.id) ? '✓' : '○'} ${goal.title} · ${goal.description}`; list.append(item); }
      details.append(list);
    }
    const picker = this.panel.querySelector<HTMLElement>('.board-picker')!;
    ['Oak deck', 'Rune deck', 'Dragon deck', 'Gold deck'].forEach((label, index) => {
      const el = document.createElement('button'); el.textContent = `${this.career.boardUnlocked(index) ? '' : '🔒 '}${label}`; el.disabled = !this.career.boardUnlocked(index); el.className = this.career.profile.board === index ? 'selected' : '';
      el.onclick = () => { this.career.profile.board = index; this.career.save(); this.actions.board(index); this.show(kind); }; picker.append(el);
    });
    const footer = this.panel.querySelector('footer')!;
    const sound = document.createElement('button'); sound.textContent = `Sound: ${this.career.profile.sound ? 'on' : 'off'}`;
    sound.onclick = () => { this.career.profile.sound = !this.career.profile.sound; this.career.save(); this.show(kind); }; footer.append(sound);
    const stats = document.createElement('span'); stats.textContent = `Best combo ${this.career.profile.bestCombo.toLocaleString()} · quests ${this.career.profile.completed.length}/${GOALS.length}`; footer.append(stats);
  }
  update(skater: Skater, skating: boolean) {
    this.score.textContent = (this.career.mode === 'run' ? this.career.runScore : skater.totalScore).toLocaleString();
    const seconds = Math.ceil(this.career.remaining); this.clock.textContent = this.career.overtime && !this.career.ended ? 'LAST COMBO' : this.career.mode === 'run' ? `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}` : 'FREE SKATE';
    const phases: Record<string, string> = { push: 'Pushing', ride: 'Cruising', crouch: 'Crouching', pop: 'Ollie', flip: 'Kickflip', shove: 'Pop shove-it', air: 'In air', land: 'Landing', grind: 'Grinding', manual: 'Manual', bail: 'Bail', recover: 'Getting up', stumble: 'Sketchy landing' };
    this.state.textContent = `${skating ? phases[skater.phase] : 'Walking'} · ${(skater.speed * 3.6).toFixed(0)} km/h`;
    this.combo.textContent = skater.comboCount ? `${Math.round(skater.comboPoints).toLocaleString()} × ${skater.comboCount} · ${skater.message}` : skater.message;
    this.goal.textContent = GOALS.find((g) => !this.career.profile.completed.includes(g.id))?.description ?? 'All quests complete · chase your best run';
    this.toast.textContent = this.career.toastTime > 0 ? this.career.toast : ''; this.toast.hidden = this.career.toastTime === 0;
    this.balance.hidden = !skater.manual && !skater.grinding; this.marker.style.left = `${50 + skater.balance * 45}%`;
    if (this.career.ended && this.menu !== 'results') this.show('results');
  }
}
