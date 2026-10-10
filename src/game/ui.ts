import { Career, GOALS } from './career.ts';
import type { Skater } from './skater.ts';
import type { LocalPlace } from './places.ts';
import { ALL_CHALLENGES, TIERS, type Challenge } from './challenges.ts';
import { levelForXp, levelProgress, xpForLevel } from './skill.ts';
import { DECKS } from './decks.ts';

export class GameUI {
  paused = true;
  private panel = document.createElement('section');
  private layer = document.createElement('div');
  private root = document.createElement('div');
  private score: HTMLElement; private clock: HTMLElement; private state: HTMLElement; private combo: HTMLElement; private goal: HTMLElement; private toast: HTMLElement; private balance: HTMLElement; private marker: HTMLElement;
  private menu: string | null = 'title';
  private controls: HTMLElement[] = [];
  private shownMode: boolean | null = null;
  private skill!: HTMLElement; private xpBar!: HTMLElement; private goalTitle!: HTMLElement;
  private tricks!: HTMLElement; private flashText!: HTMLElement;
  private specialBox!: HTMLElement; private specialLabel!: HTMLElement; private specialFill!: HTMLElement;
  private last = { total: 0, count: 0 };
  private replayBox: HTMLElement | null = null;
  /** The replay overlay: position in the buffer, speed, play state, and the combo as it was. */
  setReplay(state: { at: number; length: number; speed: number; playing: boolean; tricks: string; combo: string } | null) {
    if (!this.replayBox) { this.replayBox = document.createElement('div'); this.replayBox.id = 'replay'; document.body.append(this.replayBox); }
    this.replayBox.hidden = !state; this.root.classList.toggle('replaying', !!state);
    if (!state) return;
    this.replayBox.innerHTML = `<div class="replay-head"><b>● REPLAY</b><span>${state.playing ? '▶' : 'Ⅱ'} ${state.speed}× · ${state.at.toFixed(1)} / ${state.length.toFixed(1)} s</span></div><div class="replay-track"><i style="width:${((state.at / Math.max(0.01, state.length)) * 100).toFixed(1)}%"></i></div><div class="replay-combo"><em>${state.tricks}</em><strong>${state.combo}</strong></div><div class="replay-keys">Space play/pause · A/D scrub · W/S speed · drag to orbit · Backspace back to skating</div>`;
  }
  /** THPS-style pop above the combo: the banked total in gold, or a lost combo in red */
  private flash(text: string, kind: 'bank' | 'lost') {
    const el = this.flashText; el.textContent = text; el.className = '';
    void el.offsetWidth; el.className = kind;
  }
  private spot: { name: string; challenges: Challenge[]; best: Record<string, number> } | null = null;
  /** The spot being skated (or null) with its challenges and the best attempts so far. */
  setSpot(name: string | null, challenges: Challenge[], best: Record<string, number>) { this.spot = name ? { name, challenges, best } : null; }
  constructor(private career: Career, private actions: { start(mode: 'free' | 'run', training: boolean): void; practice(): void; board(index: number): void; pause(): void; teleport(place: LocalPlace): void; replay(): void }, private places: LocalPlace[] = [], private areaName = 'Lumbridge') {
    this.root.id = 'game-ui';
    this.root.innerHTML = `<div class="score-card"><span class="eyebrow">SCAPE SKATE</span><strong id="score">0</strong><span id="run-clock">FREE SKATE</span><span id="skill"></span><div class="xp-track"><i id="xp-bar"></i></div><div id="special"><span id="special-label">SPECIAL ATTACK 0%</span><div class="spec-track"><i id="spec-fill"></i></div></div></div><div class="goal-card"><span class="eyebrow" id="goal-title">NEXT QUEST</span><span id="next-goal"></span><button id="pause-game" aria-label="Pause game">Ⅱ</button></div><div class="combo-card"><b id="combo-flash"></b><span id="rider-state"></span><em id="combo-tricks"></em><strong id="combo-text"></strong></div><div id="balance"><span>Balance · A / D</span><div class="balance-track"><i id="balance-marker"></i></div></div><div id="quest-toast"></div><div class="control-strip"><span id="controls-a"></span><span id="controls-b"></span><span id="controls-c"></span><button id="practice-button">P · Training grounds</button><button id="help-button">H · Controls</button></div>`;
    document.body.append(this.root);
    const get = (id: string) => this.root.querySelector<HTMLElement>(`#${id}`)!;
    this.score = get('score'); this.clock = get('run-clock'); this.state = get('rider-state'); this.combo = get('combo-text'); this.goal = get('next-goal'); this.toast = get('quest-toast'); this.balance = get('balance'); this.marker = get('balance-marker');
    this.controls = ['controls-a', 'controls-b', 'controls-c'].map(get);
    this.skill = get('skill'); this.xpBar = get('xp-bar'); this.goalTitle = get('goal-title');
    this.tricks = get('combo-tricks'); this.flashText = get('combo-flash');
    this.specialBox = get('special'); this.specialLabel = get('special-label'); this.specialFill = get('spec-fill');
    get('pause-game').onclick = () => this.togglePause(); get('help-button').onclick = () => this.show('help'); get('practice-button').onclick = () => this.actions.practice();
    this.layer.id = 'menu-layer'; this.panel.className = 'menu-panel'; this.layer.append(this.panel); document.body.append(this.layer); this.show('title');
    // the teleport list answers number keys directly (gameplay input is paused while a menu is open)
    addEventListener('keydown', (event) => {
      if (this.menu !== 'teleport') return;
      const digit = /^Digit([1-9])$/.exec(event.code);
      if (digit && this.places[Number(digit[1]) - 1]) { event.preventDefault(); this.teleport(this.places[Number(digit[1]) - 1]); }
      else if (event.code === 'KeyT') { event.preventDefault(); this.resume(); }
    });
  }
  togglePause() { if (this.menu === 'pause' || this.menu === 'help' || this.menu === 'teleport') this.resume(); else this.show('pause'); }
  private teleport(place: LocalPlace) { this.resume(); this.actions.teleport(place); }
  resume() { this.menu = null; this.paused = false; this.layer.hidden = true; }
  pause() { if (!this.paused) this.show('pause'); }
  show(kind: 'title' | 'pause' | 'help' | 'results' | 'teleport') {
    this.menu = kind; this.paused = true; this.actions.pause(); this.layer.hidden = false;
    const title = kind === 'title' ? `${this.areaName.toUpperCase()} LOCALS` : kind === 'results' ? 'RUN COMPLETE' : kind === 'help' ? 'FIND YOUR LINE' : kind === 'teleport' ? 'TELEPORT' : 'TAKE A BREATHER';
    this.panel.innerHTML = `<span class="eyebrow">SCAPE SKATE</span><h1>${title}</h1><p class="menu-intro"></p><div class="menu-actions"></div><div class="menu-details"></div><div class="board-picker"></div><footer></footer>`;
    const intro = this.panel.querySelector<HTMLElement>('.menu-intro')!, buttons = this.panel.querySelector<HTMLElement>('.menu-actions')!, details = this.panel.querySelector<HTMLElement>('.menu-details')!;
    const button = (label: string, action: () => void, primary = false) => {
      const el = document.createElement('button'); el.textContent = label; if (primary) el.className = 'primary'; el.onclick = action; buttons.append(el);
    };
    const start = (mode: 'free' | 'run', training: boolean) => { this.actions.start(mode, training); this.resume(); };
    if (kind === 'title') {
      intro.textContent = 'Skate the castle paths, learn a new trick, and earn your place in Gielinor.';
      button('Start a 2-minute run', () => start('run', true), true); button(`Free skate in ${this.areaName}`, () => start('free', false)); button('Training grounds', () => start('free', true));
    } else if (kind === 'results') {
      intro.textContent = `${this.career.runScore.toLocaleString()} points · best run ${this.career.profile.bestRun.toLocaleString()}`;
      button('Retry run', () => start('run', true), true); button('Keep free skating', () => { this.career.start('free'); this.resume(); });
    } else if (kind === 'teleport') {
      intro.textContent = 'Cast a teleport to skate somewhere new · press 1–9, or T to close';
      const list = document.createElement('div'); list.className = 'teleport-list';
      this.places.forEach((place, index) => {
        const el = document.createElement('button'); el.className = 'teleport';
        el.innerHTML = `<b>${index < 9 ? `${index + 1} · ` : ''}${place.spell}</b><span>${place.blurb}</span>`;
        el.onclick = () => this.teleport(place); list.append(el);
      });
      details.append(list); button('Stay here', () => this.resume());
    } else { intro.textContent = 'Your line will wait. Progress saves on this browser.'; button('Resume skating', () => this.resume(), true); button('Watch replay', () => { this.resume(); this.actions.replay(); }); button('Start a new run', () => start('run', true)); button('Visit training grounds', () => { this.actions.practice(); this.resume(); }); }
    if (kind === 'help') {
      details.innerHTML = [
        '<p><b>Ride:</b> W pushes, S brakes, A/D steer. At speed, S + A/D throws a powerslide. Hills speed you up and slow you down; stall on a bank and you roll back fakie. V switches follow/free camera; drag to look around.</p>',
        '<p><b>Air:</b> hold Space to crouch, release to ollie (longer = higher). Kickers launch you. In the air A/D spin, and the direction you hold picks the trick: <b>Q</b> kickflip · A heelflip · D double kickflip · W hardflip · S impossible. <b>E</b> shove-it · A varial heelflip · D varial kickflip · W 360 shove-it · S 360 flip. <b>C</b> (hold) indy · W nosegrab · S tailgrab · A melon · D method; let go before you land.</p>',
        '<p><b>Lines:</b> land on any wall, fence, rail or ledge to grind; the direction held at the catch picks it: 50-50 · W nosegrind · S 5-0 · A/D boardslide · W+A/D crooked · S+A/D smith. Keep the balance meter centred with A/D. Tap S to drop off, Space to ollie out, hold Shift for a wider catch, hold Space in the air to skip a grind. M manuals (W+M nose manual). Ollie into a wall at an angle to wallride; Space wallies off. Tap Shift right after landing to revert.</p>',
        '<p><b>Quarter pipes:</b> ride up, fly straight up out of the lip and come back in. Tap A/D in the air to spin 180 and land forward (otherwise you come down fakie); Shift catches the coping.</p>',
        '<p><b>Special attack:</b> combos fill the special bar under your score; it drains while you cruise and empties when you bail. When it is full, hold Shift: Shift+Q Rune flip, Shift+E Teleport shove, Shift+C Dragonfire grab, and Shift+Q/E on a rail turns your grind into a Godsword grind.</p>',
        '<p><b>Gaps:</b> fly over water and land on dry ground (Water gap), drop more than 2.5 m (Big drop) or hang in the air over 1.3 s (Hang time) for bonus points.</p>',
        '<p><b>Replay:</b> Backspace (or Watch replay in the pause menu) plays back your last 20 seconds: Space play/pause, A/D scrub, W/S speed, drag to orbit, Backspace to skate on.</p>',
        '<p><b>Freedom:</b> Z sets a session marker (with your speed), X takes you back. B opens quick drop: 1–6 kicker, quarter pipe, rail, ledge, funbox, bank · Q/E rotate · WASD move · Space place · Backspace remove · B done. G casts Surge (8 s cooldown). T teleports to a town; Tab opens the world map (click a town to go there).</p>',
        '<p><b>Progress:</b> every town has five challenges from bronze (Easy) to rune (Grandmaster). Combos and challenges give Skateboarding XP, levels 1–99.</p>',
        '<p><b>Explore:</b> F walk/skate, R random outfit, G (on foot) body type, 1–0 emotes, P training grounds, Escape pauses.</p>',
        '<p><b>Gamepad:</b> RT push, LT brake/drop, left stick steer, A ollie, X flip, B shove-it, Y grab, LB manual, RB catch/revert, R3 Surge, Start pause.</p>',
      ].join('');
    } else if (kind !== 'teleport') {
      const xp = this.career.profile.xp, level = levelForXp(xp);
      const skill = document.createElement('p'); skill.className = 'skill-line';
      skill.textContent = `Skateboarding level ${level} · ${xp.toLocaleString('en-GB')} XP${level < 99 ? ` · ${(xpForLevel(level + 1) - xp).toLocaleString('en-GB')} to level ${level + 1}` : ' · maxed!'}`;
      details.append(skill);
      const spots = document.createElement('div'); spots.className = 'spot-list';
      for (const place of this.places) {
        const challenges = ALL_CHALLENGES.filter((c) => c.place === place.id);
        if (!challenges.length) continue;
        const row = document.createElement('span');
        row.innerHTML = `<b>${place.name}</b> ${TIERS.map((tier, i) => `<i class="tier t${i} ${this.career.profile.challenges.includes(challenges[i]?.id) ? 'done' : ''}" title="${tier}: ${challenges[i]?.text ?? ''}"></i>`).join('')}`;
        spots.append(row);
      }
      if (spots.childElementCount) {
        const legend = document.createElement('p'); legend.className = 'tier-legend';
        legend.innerHTML = TIERS.map((tier, i) => `<i class="tier t${i} done"></i>${tier}`).join(' ');
        details.append(spots, legend);
      }
      const list = document.createElement('ul'); list.className = 'quest-list';
      for (const goal of GOALS) { const item = document.createElement('li'); item.textContent = `${this.career.profile.completed.includes(goal.id) ? '✓' : '○'} ${goal.title} · ${goal.description}`; list.append(item); }
      details.append(list);
    }
    const picker = this.panel.querySelector<HTMLElement>('.board-picker')!;
    if (kind !== 'teleport') DECKS.forEach((deck, index) => {
      const unlocked = this.career.boardUnlocked(index), place = this.places.find((p) => p.id === deck.place)?.name;
      const el = document.createElement('button'); el.className = `deck ${this.career.profile.board === index ? 'selected' : ''}`; el.disabled = !unlocked;
      el.style.setProperty('--deck', deck.base); el.style.setProperty('--ink', deck.accent);
      el.textContent = `${unlocked ? '' : '🔒 '}${deck.name.replace(' deck', '')}`; el.title = unlocked ? deck.name : place ? `Complete the ${place} Master challenge` : 'Complete a training quest';
      el.onclick = () => { this.career.profile.board = index; this.career.save(); this.actions.board(index); this.show(kind); }; picker.append(el);
    });
    const footer = this.panel.querySelector('footer')!;
    const sound = document.createElement('button'); sound.textContent = `Sound: ${this.career.profile.sound ? 'on' : 'off'}`;
    sound.onclick = () => { this.career.profile.sound = !this.career.profile.sound; this.career.save(); this.show(kind); }; footer.append(sound);
    const stats = document.createElement('span'); stats.textContent = `Best combo ${this.career.profile.bestCombo.toLocaleString()} · quests ${this.career.profile.completed.length}/${GOALS.length}`; footer.append(stats);
  }
  /** "best 6.2 m" style progress toward a measured goal */
  private progress(challenge: Challenge) {
    const best = this.spot?.best ?? {}, g = challenge.goal;
    if (g.kind === 'trick') return '';
    const value = g.kind === 'combo' ? best.combo : best[g.kind];
    if (!value) return '';
    return g.kind === 'combo' ? ` · best ${Math.round(value).toLocaleString('en-GB')}` : ` · best ${value.toFixed(1)}${g.kind === 'grind' ? ' m' : ' s'}`;
  }
  update(skater: Skater, skating: boolean) {
    this.score.textContent = (this.career.mode === 'run' ? this.career.runScore : skater.totalScore).toLocaleString();
    const seconds = Math.ceil(this.career.remaining); this.clock.textContent = this.career.overtime && !this.career.ended ? 'LAST COMBO' : this.career.mode === 'run' ? `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}` : 'FREE SKATE';
    const phases: Record<string, string> = { ramp: 'Transition', grab: 'Grab', slide: 'Powerslide', push: 'Pushing', ride: 'Cruising', crouch: 'Crouching', pop: 'Ollie', flip: 'Kickflip', shove: 'Pop shove-it', air: 'In air', land: 'Landing', grind: 'Grinding', wallride: 'Wallride', manual: 'Manual', bail: 'Bail', recover: 'Getting up', stumble: 'Sketchy landing' };
    if (this.shownMode !== skating) {
      this.shownMode = skating;
      const labels = skating
        ? ['W push · S brake · S+A/D powerslide', 'Space ollie · Q flip · E shove · Shift revert', 'T teleport · Z marker · X return']
        : ['WASD walk · Shift run', '1–0 emotes · R outfit', 'F back on the board'];
      labels.forEach((text, i) => (this.controls[i].textContent = text));
    }
    // RS special attack bar
    const ready = skater.special >= 0.999;
    this.specialFill.style.width = `${(skater.special * 100).toFixed(1)}%`;
    this.specialLabel.textContent = ready ? 'SPECIAL READY · SHIFT + Q / E / C' : `SPECIAL ATTACK ${Math.floor(skater.special * 100)}%`;
    this.specialBox.classList.toggle('ready', ready); this.specialBox.hidden = !skating;
    if (skating) {
      const fakie = skater.fakie && ['push', 'ride', 'land', 'crouch'].includes(skater.phase) ? ' fakie' : '';
      // flips and grabs show the trick itself (Heelflip, 360 flip, Melon...)
      const label = skater.phase === 'grab' ? skater.grab?.name : skater.phase === 'flip' || skater.phase === 'shove' ? skater.trick?.name : phases[skater.phase];
      const surge = skater.surgeCooldown > 0 ? ` · Surge ${Math.ceil(skater.surgeCooldown)}s` : ' · Surge ready';
      this.state.textContent = `${label ?? skater.phase}${fakie} · ${(skater.speed * 3.6).toFixed(0)} km/h${surge}`;
      const names = skater.comboNames;
      if (skater.comboCount) {
        this.tricks.textContent = `${names.length > 6 ? '… + ' : ''}${names.slice(-6).join(' + ')}`;
        this.combo.textContent = `${Math.round(skater.comboPoints).toLocaleString('en-GB')} × ${skater.comboCount}`; this.combo.className = 'live';
      } else { this.tricks.textContent = ''; this.combo.textContent = skater.message; this.combo.className = ''; }
      if (skater.totalScore > this.last.total) this.flash(`+${(skater.totalScore - this.last.total).toLocaleString('en-GB')}`, 'bank');
      else if (this.last.count > 0 && skater.comboCount === 0 && (skater.bailTime > 0 || skater.stumbleTime > 0)) this.flash('Combo lost', 'lost');
      this.last = { total: skater.totalScore, count: skater.comboCount };
    } else {
      this.state.textContent = 'On foot';
      this.combo.textContent = `Explore ${this.areaName} · press F to skate again`; this.combo.className = ''; this.tricks.textContent = '';
    }
    const level = levelForXp(this.career.profile.xp);
    this.skill.textContent = `Skateboarding ${level} · ${this.career.profile.xp.toLocaleString('en-GB')} XP`;
    this.xpBar.style.width = `${(levelProgress(this.career.profile.xp) * 100).toFixed(1)}%`;
    const next = this.spot?.challenges.find((c) => !this.career.profile.challenges.includes(c.id));
    if (this.spot) {
      const done = this.spot.challenges.filter((c) => this.career.profile.challenges.includes(c.id)).length;
      this.goalTitle.textContent = `${this.spot.name.toUpperCase()} · ${next ? next.tier.toUpperCase() : 'COMPLETE'} · ${done}/${this.spot.challenges.length}`;
      this.goal.textContent = next ? `${next.text}${this.progress(next)}` : 'Every challenge here is done · teleport somewhere new';
    } else {
      this.goalTitle.textContent = 'NEXT QUEST';
      this.goal.textContent = GOALS.find((g) => !this.career.profile.completed.includes(g.id))?.description ?? 'All quests complete · chase your best run';
    }
    this.toast.textContent = this.career.toastTime > 0 ? this.career.toast : ''; this.toast.hidden = this.career.toastTime === 0;
    this.balance.hidden = !skater.manual && !skater.grinding; this.marker.style.left = `${50 + skater.balance * 45}%`;
    if (this.career.ended && this.menu !== 'results') this.show('results');
  }
}
