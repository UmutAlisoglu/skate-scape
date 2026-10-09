import type { SkateEvent, Skater } from './skater.ts';

export class SkateAudio {
  enabled = true;
  private context: AudioContext | null = null;
  private roll: GainNode | null = null;
  constructor() {
    const unlock = () => {
      if (!this.context) {
        this.context = new AudioContext();
        const buffer = this.context.createBuffer(1, this.context.sampleRate, this.context.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * 0.2;
        const source = this.context.createBufferSource(); source.buffer = buffer; source.loop = true;
        const filter = this.context.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 700;
        this.roll = this.context.createGain(); this.roll.gain.value = 0;
        source.connect(filter).connect(this.roll).connect(this.context.destination); source.start();
      }
      void this.context.resume();
    };
    addEventListener('pointerdown', unlock); addEventListener('keydown', unlock);
  }
  update(skater: Skater, paused: boolean) {
    if (this.context && this.roll) this.roll.gain.setTargetAtTime(this.enabled && !paused && skater.grounded ? skater.speed / 9 * 0.12 : 0, this.context.currentTime, 0.08);
  }
  cue(event: SkateEvent) {
    if (!this.enabled || !this.context) return;
    const oscillator = this.context.createOscillator(), gain = this.context.createGain(), now = this.context.currentTime;
    oscillator.type = event.type === 'bail' ? 'triangle' : 'sine';
    const frequency = event.type === 'land' ? 440 : event.type === 'bail' ? 100 : event.type === 'grind' ? 180 : 240;
    oscillator.frequency.setValueAtTime(frequency, now); oscillator.frequency.exponentialRampToValueAtTime(frequency * (event.type === 'bail' ? 0.5 : 1.5), now + 0.12);
    gain.gain.setValueAtTime(0.045, now); gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
    oscillator.connect(gain).connect(this.context.destination); oscillator.start(); oscillator.stop(now + 0.2);
  }
}
