/** Keyboard state with one-shot presses/releases and focus-loss cleanup. */
export class GameInput {
  private held = new Set<string>();
  private pressed = new Set<string>();
  private released = new Set<string>();

  constructor() {
    addEventListener('keydown', (event) => {
      if (event.target instanceof HTMLElement && (event.target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName))) return;
      if (event.code === 'Space' || event.code.startsWith('Arrow') || (event.code === 'Tab' && !(event.target instanceof HTMLButtonElement))) event.preventDefault();
      if (!this.held.has(event.code)) this.pressed.add(event.code);
      this.held.add(event.code);
    });
    addEventListener('keyup', (event) => {
      if (this.held.delete(event.code)) this.released.add(event.code);
    });
    addEventListener('blur', () => this.clear());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.clear();
    });
  }

  has(code: string) { return this.held.has(code); }
  takePress(code: string) { return this.pressed.delete(code); }
  takeRelease(code: string) { return this.released.delete(code); }
  clear() { this.held.clear(); this.pressed.clear(); this.released.clear(); }
}
