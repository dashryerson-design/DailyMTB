// Keyboard state. W pedal, S rear brake, Space front brake, A/D steer, arrows = rider weight fore/aft.
export class Input {
  constructor() {
    this.k = { w: false, a: false, s: false, d: false, space: false, up: false, down: false, left: false, right: false };
    this.handlers = {};
    const map = { KeyW: 'w', KeyA: 'a', KeyS: 's', KeyD: 'd', Space: 'space', ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };
    addEventListener('keydown', (e) => {
      if (map[e.code]) { this.k[map[e.code]] = true; e.preventDefault(); }
      else if (this.handlers[e.code] && !e.repeat) this.handlers[e.code](e);
      else if (/^Digit[1-9]$/.test(e.code) && this.handlers.digit && !e.repeat) this.handlers.digit(+e.code.slice(5));
    });
    addEventListener('keyup', (e) => { if (map[e.code]) this.k[map[e.code]] = false; });
    addEventListener('blur', () => Object.keys(this.k).forEach(k => this.k[k] = false));
  }
  on(code, fn) { this.handlers[code] = fn; }
}
