// Keyboard (and gamepad) input. Keys follow the original manual:
//   Cursor Up/Down = stick forward/back, Left/Right = roll, , . = rudder, F1-F10 = throttle,
//   G gear, A hook, H HUD, J ECM, C chaff, F flare, Shift-F pod, Shift-E eject, M map, R radar range,
//   T target, Return weapon, Space fire, P pause, Esc reset, Shift-Esc menu, keypad = views.
// Alternates exist for keyboards without a numeric keypad.

const GAME_KEYS = new Set([
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Comma', 'Period', 'Space', 'Enter', 'NumpadEnter', 'Backspace', 'Escape', 'Tab',
  'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'Equal', 'Minus', 'BracketLeft', 'BracketRight', 'PageUp', 'PageDown', 'Home', 'End',
  'KeyG', 'KeyA', 'KeyH', 'KeyJ', 'KeyC', 'KeyF', 'KeyE', 'KeyM', 'KeyR', 'KeyT', 'KeyP', 'KeyS', 'KeyV', 'KeyB', 'KeyQ', 'KeyX', 'KeyZ', 'KeyL', 'KeyO', 'KeyK', 'KeyN',
  'Numpad0', 'Numpad1', 'Numpad2', 'Numpad3', 'Numpad4', 'Numpad5', 'Numpad6', 'Numpad7', 'Numpad8', 'Numpad9', 'NumpadDecimal',
  'Digit0', 'Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9',
]);

export class Input {
  constructor(el = window) {
    this.down = new Set();
    this.edge = new Set();
    this.shift = false;
    this.ctrl = false;
    this.stick = { pitch: 0, roll: 0, rudder: 0 };
    this.invertY = false;
    this.pad = null;
    this.listeners = [];
    this.lastKey = null;
    el.addEventListener('keydown', (e) => {
      if (e.metaKey) return;
      this.shift = e.shiftKey; this.ctrl = e.ctrlKey;
      if (GAME_KEYS.has(e.code) || e.code.startsWith('F')) {
        if (!(e.ctrlKey || e.altKey) || e.code.startsWith('Arrow')) e.preventDefault();
      }
      if (e.repeat) return;
      this.down.add(e.code);
      this.edge.add(e.code);
      this.lastKey = { code: e.code, key: e.key, shift: e.shiftKey };
      for (const l of this.listeners) l(e.code, e);
    });
    el.addEventListener('keyup', (e) => {
      this.shift = e.shiftKey; this.ctrl = e.ctrlKey;
      this.down.delete(e.code);
    });
    window.addEventListener('blur', () => { this.down.clear(); this.shift = false; });
  }

  onKey(fn) { this.listeners.push(fn); return () => { this.listeners = this.listeners.filter((f) => f !== fn); }; }

  // True once per physical key press.
  pressed(code) { return this.edge.has(code); }
  held(code) { return this.down.has(code); }
  endFrame() { this.edge.clear(); }

  // Smooths the digital keys into a stick, like a centring joystick.
  axes(dt) {
    const s = this.stick;
    const dir = (neg, pos) => (this.held(pos) ? 1 : 0) - (this.held(neg) ? 1 : 0);
    // A held key ramps its deflection up: a tap is a gentle correction, holding gives full authority.
    const hold = this.holdTime || (this.holdTime = { pitch: 0, roll: 0 });
    const ramp = (axis, d, start, secs) => {
      if (d === 0) { hold[axis] = 0; return 0; }
      hold[axis] += dt;
      return d * Math.min(1, start + (1 - start) * Math.min(1, hold[axis] / secs));
    };
    // The original maps Cursor Up to "nose down": stick forward.
    let pitch = ramp('pitch', dir('ArrowUp', 'ArrowDown'), 0.3, 0.9);
    if (this.invertY) pitch = -pitch;
    // Roll starts gentle (about 55 deg/s) and reaches roughly 130 deg/s if the key is held.
    const roll = ramp('roll', dir('ArrowLeft', 'ArrowRight'), 0.4, 1.0) * 0.72;
    const rudder = dir('Comma', 'Period');
    const pad = this._pad();
    const approach = (v, t, rise, fall) => {
      const rate = Math.abs(t) > Math.abs(v) || Math.sign(t) !== Math.sign(v) ? rise : fall;
      const d = t - v;
      return Math.abs(d) <= rate * dt ? t : v + Math.sign(d) * rate * dt;
    };
    s.pitch = pad ? pad.pitch : approach(s.pitch, pitch, 3.2, 5);
    s.roll = pad ? pad.roll : approach(s.roll, roll, 4.5, 7);
    s.rudder = approach(s.rudder, pad && pad.rudder ? pad.rudder : rudder, 4, 6);
    return s;
  }

  _pad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) {
      if (!p || !p.connected) continue;
      const dz = (v) => (Math.abs(v) < 0.12 ? 0 : (v - Math.sign(v) * 0.12) / 0.88);
      this.pad = p;
      const lt = p.buttons[6] ? p.buttons[6].value : 0, rt = p.buttons[7] ? p.buttons[7].value : 0;
      return { pitch: dz(p.axes[1] || 0), roll: dz(p.axes[0] || 0), rudder: rt - lt, throttleAxis: dz(p.axes[3] || 0) };
    }
    return null;
  }

  // Edge-triggered gamepad buttons, mapped onto the keyboard codes the game already understands.
  pollPad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) {
      if (!p || !p.connected) continue;
      this._padPrev = this._padPrev || [];
      const map = { 0: 'Space', 1: 'Enter', 2: 'KeyT', 3: 'KeyV', 4: 'KeyG', 5: 'KeyA', 8: 'KeyP', 9: 'Escape', 12: 'KeyJ', 13: 'KeyC', 14: 'KeyF', 15: 'KeyR' };
      for (const [b, code] of Object.entries(map)) {
        const pressed = !!(p.buttons[b] && p.buttons[b].pressed);
        if (pressed && !this._padPrev[b]) { this.edge.add(code); this.down.add(code); for (const l of this.listeners) l(code, {}); }
        if (!pressed && this._padPrev[b]) this.down.delete(code);
        this._padPrev[b] = pressed;
      }
    }
  }
}
