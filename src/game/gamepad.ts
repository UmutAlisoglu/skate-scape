import type { SkateInput } from './skater.ts';

export class PadInput {
  connected = false;
  private previous: boolean[] = [];
  read(): SkateInput & { pause: boolean } {
    const pad = Array.from(navigator.getGamepads?.() ?? []).find((p) => p?.connected);
    this.connected = !!pad;
    if (!pad) { this.previous = []; return { push: false, brake: false, steer: 0, crouch: false, pop: false, flip: false, shove: false, grab: false, surge: false, pause: false }; }
    const buttons = pad.buttons.map((b) => b.pressed);
    const press = (i: number) => buttons[i] && !this.previous[i];
    const input = { push: buttons[7] || pad.axes[1] < -0.25, brake: buttons[6] || pad.axes[1] > 0.4, steer: Math.abs(pad.axes[0]) > 0.12 ? -pad.axes[0] : 0, crouch: buttons[0], pop: !buttons[0] && !!this.previous[0], flip: press(2), shove: press(1), manual: buttons[4], grind: buttons[5], revert: press(5), grab: buttons[3], surge: press(11), pause: press(9) };
    this.previous = buttons; return input;
  }
}
