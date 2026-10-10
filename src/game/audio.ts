import type { SkateEvent, Skater } from './skater.ts';

/**
 * Procedural skate sounds (no audio files): rolling wheels, the pop and landing, grinds (metal rails ring,
 * stone ledges grit), powerslides, flip whooshes, Surge, and an RS-style jingle for challenges and levels.
 */
export class SkateAudio {
  enabled = true;
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private loops: Record<'roll' | 'grind' | 'slide', { gain: GainNode; filter: BiquadFilterNode }> | null = null;
  private wasGrounded = true; private wasFalling = 0;

  constructor() {
    const unlock = () => {
      if (!this.context) this.start();
      void this.context?.resume();
    };
    addEventListener('pointerdown', unlock); addEventListener('keydown', unlock);
  }
  private start() {
    const ctx = this.context = new AudioContext();
    this.master = ctx.createGain(); this.master.gain.value = 0.9; this.master.connect(ctx.destination);
    const buffer = this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate), data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const loop = (type: BiquadFilterType, frequency: number, q: number) => {
      const source = ctx.createBufferSource(); source.buffer = buffer; source.loop = true;
      const filter = ctx.createBiquadFilter(); filter.type = type; filter.frequency.value = frequency; filter.Q.value = q;
      const gain = ctx.createGain(); gain.gain.value = 0;
      source.connect(filter).connect(gain).connect(this.master!); source.start(0, Math.random() * 2);
      return { gain, filter };
    };
    this.loops = { roll: loop('lowpass', 500, 0.7), grind: loop('bandpass', 2400, 6), slide: loop('bandpass', 900, 2.5) };
  }

  update(skater: Skater, paused: boolean) {
    if (!this.context || !this.loops) return;
    const now = this.context.currentTime, on = this.enabled && !paused;
    const rolling = on && skater.grounded && !skater.grinding && skater.bailTime === 0;
    const speed = Math.min(1, skater.speed / 10);
    this.loops.roll.gain.gain.setTargetAtTime(rolling ? 0.05 + speed * 0.13 : 0, now, 0.06);
    this.loops.roll.filter.frequency.setTargetAtTime(280 + speed * 1100, now, 0.08);
    // grinds: metal (rails, coping, gates) rings high and narrow; stone and wood ledges are lower and grittier
    const rail = skater.grinding?.rail.name ?? '', metal = /rail|coping|gate|bank lip|funbox/i.test(rail);
    this.loops.grind.gain.gain.setTargetAtTime(on && skater.grinding ? 0.12 + speed * 0.1 : 0, now, 0.03);
    this.loops.grind.filter.frequency.setTargetAtTime((metal ? 2600 : 1100) + speed * 900 + Math.random() * 300, now, 0.02);
    this.loops.grind.filter.Q.setTargetAtTime(metal ? 9 : 2, now, 0.05);
    this.loops.slide.gain.gain.setTargetAtTime(on && skater.powerslide ? 0.12 + speed * 0.1 : 0, now, 0.04);
    // a landing (from the air, onto the ground or a ramp) is a thud scaled by how hard you came down
    if (!skater.grounded && !skater.grinding) this.wasFalling = Math.min(this.wasFalling, skater.verticalSpeed);
    if (on && skater.grounded && !this.wasGrounded && !skater.grinding) this.thud(Math.min(1, 0.25 - this.wasFalling / 12));
    if (skater.grounded || skater.grinding) this.wasFalling = 0;
    this.wasGrounded = skater.grounded || !!skater.grinding;
  }

  cue(event: SkateEvent) {
    if (!this.enabled || !this.context) return;
    if (event.type === 'trick') {
      if (event.names[0] === 'Ollie' || event.names[0] === 'Ollie out') this.pop();
      else if (/°$|Revert|Manual|Nose manual|Wallride|grind|slide|Boardslide/i.test(event.names[0])) this.clack(0.5);
      else this.whoosh();
    } else if (event.type === 'grind') this.clack(0.8);
    else if (event.type === 'bail') this.thud(1, true);
    else if (event.type === 'surge') this.surge();
    else if (event.type === 'slide') this.clack(0.4);
  }
  /** RS-like jingle: a rising arpeggio for a challenge, a fuller fanfare for a level */
  fanfare(kind: 'challenge' | 'level') {
    if (!this.enabled || !this.context) return;
    const notes = kind === 'level' ? [523.25, 659.25, 783.99, 1046.5, 783.99, 1046.5] : [587.33, 739.99, 880];
    notes.forEach((frequency, i) => this.tone(frequency, 0.13 * i, kind === 'level' ? 0.32 : 0.22, 'triangle', 0.08));
  }

  private burst(at: number, duration: number, type: BiquadFilterType, frequency: number, level: number, q = 1) {
    const ctx = this.context!, source = ctx.createBufferSource(), filter = ctx.createBiquadFilter(), gain = ctx.createGain();
    source.buffer = this.noise; filter.type = type; filter.frequency.value = frequency; filter.Q.value = q;
    gain.gain.setValueAtTime(level, at); gain.gain.exponentialRampToValueAtTime(0.0005, at + duration);
    source.connect(filter).connect(gain).connect(this.master!); source.start(at, Math.random()); source.stop(at + duration + 0.02);
    return filter;
  }
  private tone(frequency: number, delay: number, duration: number, type: OscillatorType, level: number, endFrequency = frequency) {
    const ctx = this.context!, at = ctx.currentTime + delay, osc = ctx.createOscillator(), gain = ctx.createGain();
    osc.type = type; osc.frequency.setValueAtTime(frequency, at); osc.frequency.exponentialRampToValueAtTime(endFrequency, at + duration);
    gain.gain.setValueAtTime(0.0001, at); gain.gain.exponentialRampToValueAtTime(level, at + 0.01); gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    osc.connect(gain).connect(this.master!); osc.start(at); osc.stop(at + duration + 0.02);
  }
  /** the tail snapping on the ground: a sharp wooden crack and a low knock */
  private pop() { const at = this.context!.currentTime; this.burst(at, 0.05, 'highpass', 1800, 0.5); this.tone(170, 0, 0.09, 'sine', 0.35, 70); }
  private clack(level: number) { const at = this.context!.currentTime; this.burst(at, 0.04, 'bandpass', 2200, 0.35 * level, 2); this.tone(220, 0, 0.06, 'triangle', 0.15 * level, 110); }
  private thud(level: number, bail = false) {
    const at = this.context!.currentTime;
    this.tone(bail ? 70 : 95, 0, bail ? 0.28 : 0.16, 'sine', 0.45 * level, 40);
    this.burst(at, bail ? 0.35 : 0.08, 'lowpass', bail ? 600 : 1500, (bail ? 0.4 : 0.3) * level);
  }
  private whoosh() {
    const at = this.context!.currentTime, filter = this.burst(at, 0.32, 'bandpass', 500, 0.22, 1.4);
    filter.frequency.setValueAtTime(500, at); filter.frequency.exponentialRampToValueAtTime(2600, at + 0.3);
  }
  private surge() {
    this.tone(330, 0, 0.45, 'sine', 0.18, 1320); this.tone(495, 0.03, 0.4, 'triangle', 0.08, 1980);
    const at = this.context!.currentTime, filter = this.burst(at, 0.5, 'bandpass', 3000, 0.15, 3);
    filter.frequency.setValueAtTime(1500, at); filter.frequency.exponentialRampToValueAtTime(6000, at + 0.45);
  }
}
