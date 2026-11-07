// Touch controls: an HTML layer on top of the canvas. The 320x256 picture is never touched; this layer
// only turns finger input into the same key codes and analog values the keyboard produces.
//
//   in flight:  floating stick (left half of the screen), rudder pedals, throttle slider, FIRE, weapon,
//               target, gear, hook, brake, flares, chaff, afterburner, pause, and a drawer with the rest
//   elsewhere:  a number pad plus arrows, and a tap on the picture acts as Enter (a tap on a menu row
//               picks it)
//
// Nothing shows until the first finger touches the screen, so desktop players never see it.
// Screens can set `touchUI` to 'none' (hide everything) or 'tap' (only tap-to-continue).

const CSS = `
.fa-touch{--u:clamp(3px,1vmin,6.5px);position:fixed;inset:0;z-index:5;pointer-events:none;overflow:hidden;
  font:700 calc(var(--u)*3.2)/1 ui-monospace,Menlo,Consolas,monospace;color:#fff;letter-spacing:.04em;
  padding:env(safe-area-inset-top,0) env(safe-area-inset-right,0) env(safe-area-inset-bottom,0) env(safe-area-inset-left,0);
  -webkit-user-select:none;user-select:none;-webkit-touch-callout:none;-webkit-tap-highlight-color:transparent;touch-action:none}
.fa-touch *{box-sizing:border-box;-webkit-user-select:none;user-select:none;touch-action:none}
.fa-touch [data-for]{display:none}
.fa-touch[data-mode=flight] [data-for~=flight],.fa-touch[data-mode=keys] [data-for~=keys],
.fa-touch[data-mode=tap] [data-for~=tap]{display:var(--show,block)}
.fa-touch .b:not([data-for]){display:flex}
.fa-touch .b{--show:flex;position:absolute;pointer-events:auto;align-items:center;justify-content:center;text-align:center;
  background:rgba(8,12,18,.46);border:calc(var(--u)*.45) solid rgba(255,255,255,.4);border-radius:calc(var(--u)*2);
  width:calc(var(--u)*10);height:calc(var(--u)*10)}
.fa-touch .hint{--show:flex}
.fa-touch .pad,.fa-touch .arrows{--show:grid}
.fa-touch .b.on{background:rgba(255,255,255,.34);border-color:#fff}
.fa-touch .b.arm{background:rgba(220,40,30,.7);border-color:#ff9a90}
.fa-touch .b.round{border-radius:50%}
.fa-touch .fire{background:rgba(200,30,20,.5);border-color:rgba(255,150,130,.8);font-size:calc(var(--u)*4)}
.fa-touch .fire.on{background:rgba(255,70,50,.8)}
.fa-touch .sm{font-size:calc(var(--u)*2.5)}
.fa-touch .zone{position:absolute;left:0;bottom:0;width:50%;height:72%;pointer-events:auto}
.fa-touch .base{position:absolute;width:calc(var(--u)*24);height:calc(var(--u)*24);margin:calc(var(--u)*-12) 0 0 calc(var(--u)*-12);
  border:calc(var(--u)*.5) solid rgba(255,255,255,.4);border-radius:50%;background:rgba(8,12,18,.28);display:none}
.fa-touch .knob{position:absolute;left:50%;top:50%;width:calc(var(--u)*11);height:calc(var(--u)*11);margin:calc(var(--u)*-5.5) 0 0 calc(var(--u)*-5.5);
  border-radius:50%;background:rgba(255,255,255,.55)}
.fa-touch .hint{position:absolute;left:calc(var(--u)*4);bottom:calc(var(--u)*17);width:calc(var(--u)*24);height:calc(var(--u)*24);
  border:calc(var(--u)*.4) dashed rgba(255,255,255,.22);border-radius:50%;pointer-events:none;
  align-items:center;justify-content:center;color:rgba(255,255,255,.3);font-size:calc(var(--u)*2.4)}
.fa-touch .thr{position:absolute;right:calc(var(--u)*2);bottom:calc(var(--u)*4);width:calc(var(--u)*11);height:calc(var(--u)*46);pointer-events:auto;
  background:rgba(8,12,18,.46);border:calc(var(--u)*.45) solid rgba(255,255,255,.4);border-radius:calc(var(--u)*2);overflow:hidden}
.fa-touch .thr i{position:absolute;left:0;right:0;bottom:0;background:rgba(80,200,120,.55)}
.fa-touch .thr.ab i{background:rgba(255,150,40,.7)}
.fa-touch .thr span{position:absolute;left:0;right:0;top:calc(var(--u)*1.2);text-align:center;font-size:calc(var(--u)*2.4);opacity:.8}
.fa-touch .drawer{position:absolute;right:calc(var(--u)*2);top:calc(var(--u)*14);width:calc(var(--u)*56);display:none;gap:calc(var(--u)*1);
  grid-template-columns:repeat(4,1fr);pointer-events:auto;padding:calc(var(--u)*1);background:rgba(8,12,18,.7);border-radius:calc(var(--u)*2)}
.fa-touch[data-mode=flight][data-drawer=on] .drawer{display:grid}
.fa-touch .drawer .b{position:static;width:auto;height:calc(var(--u)*10);font-size:calc(var(--u)*2.3)}
.fa-touch .pad{position:absolute;right:calc(var(--u)*2);bottom:calc(var(--u)*4);grid-template-columns:repeat(3,calc(var(--u)*11.5));
  gap:calc(var(--u)*1.2);pointer-events:none}
.fa-touch .pad .b{position:static;width:auto;height:calc(var(--u)*10);font-size:calc(var(--u)*4)}
.fa-touch .pad .b.sm{font-size:calc(var(--u)*2.8)}
.fa-touch .arrows{position:absolute;left:calc(var(--u)*2);bottom:calc(var(--u)*4);grid-template-columns:repeat(2,calc(var(--u)*11.5));
  gap:calc(var(--u)*1.2);pointer-events:none}
.fa-touch .arrows .b{position:static;width:auto;height:calc(var(--u)*10);font-size:calc(var(--u)*3.4)}
`;

// [id, label, key code, cls, vars]. vars are in units of --u from the right/bottom edge (or l/t from left/top).
const FLIGHT_BTNS = [
  { id: 'fire', label: 'FIRE', code: 'Space', cls: 'round fire', hold: true, r: 15, bt: 4, w: 21, h: 21 },
  { id: 'wpn', label: 'WPN', code: 'Enter', cls: 'round sm', r: 15, bt: 27, w: 10, h: 10 },
  { id: 'tgt', label: 'TGT', code: 'KeyT', cls: 'round sm', r: 26.5, bt: 27, w: 10, h: 10 },
  { id: 'gear', label: 'GEAR', code: 'KeyG', cls: 'sm', r: 38, bt: 4, w: 10, h: 10 },
  { id: 'hook', label: 'HOOK', code: 'KeyA', cls: 'sm', r: 38, bt: 15.5, w: 10, h: 10 },
  { id: 'flare', label: 'FLARE', code: 'KeyF', cls: 'sm', r: 49.5, bt: 4, w: 10, h: 10 },
  { id: 'chaff', label: 'CHAFF', code: 'KeyC', cls: 'sm', r: 49.5, bt: 15.5, w: 10, h: 10 },
  { id: 'ab', label: 'AB', act: 'ab', cls: 'sm', r: 2, bt: 51, w: 11, h: 10 },
  { id: 'rl', label: '<', code: 'Comma', hold: true, cls: '', x: 2, bt: 4, w: 11, h: 11 },
  { id: 'rr', label: '>', code: 'Period', hold: true, cls: '', x: 14, bt: 4, w: 11, h: 11 },
  { id: 'brk', label: 'BRK', code: 'Backspace', hold: true, cls: 'sm', x: 26, bt: 4, w: 11, h: 11 },
  { id: 'pause', label: 'II', code: 'KeyP', cls: '', r: 2, y: 2, w: 10, h: 10 },
  { id: 'more', label: '...', act: 'drawer', cls: '', r: 13.5, y: 2, w: 10, h: 10 },
];
const DRAWER_BTNS = [
  ['HUD', 'KeyH'], ['MAP', 'KeyM'], ['RADAR', 'KeyR'], ['VIEW', 'KeyV'],
  ['ZOOM+', 'BracketRight'], ['ZOOM-', 'BracketLeft'], ['LOOK<', 'KeyQ', { hold: true }], ['LOOK>', 'KeyE', { hold: true }],
  ['BACK', 'KeyX'], ['TOWER', 'KeyB'], ['ECM', 'KeyJ'], ['POD', 'KeyF', { shift: true }],
  ['HELP', 'Tab'], ['EJECT', 'KeyE', { shift: true, confirm: true }], ['RESTART', 'Escape', { confirm: true }], ['MENU', 'Escape', { shift: true, confirm: true }],
];
const PAD_KEYS = [['7', 'Digit7'], ['8', 'Digit8'], ['9', 'Digit9'], ['4', 'Digit4'], ['5', 'Digit5'], ['6', 'Digit6'],
  ['1', 'Digit1'], ['2', 'Digit2'], ['3', 'Digit3'], ['ESC', 'Escape', 'sm'], ['0', 'Digit0'], ['OK', 'Enter', 'sm']];
const ARROW_KEYS = [['F-16', 'KeyF', 'sm'], ['F-18', 'KeyH', 'sm'], ['UP', 'ArrowUp', 'sm'], ['DOWN', 'ArrowDown', 'sm']];

export class Touch {
  constructor({ game, input, display, canvas }) {
    this.game = game; this.input = input; this.display = display; this.canvas = canvas;
    this.active = false;       // set by the first finger
    this.mode = 'none';
    this.drawer = false;
    this.stickId = null; this.thrId = null;
    this.armed = new Map();    // confirm buttons waiting for a second tap
    this.cleanups = new Map(); // pointer id -> release function
    const st = document.createElement('style');
    st.textContent = CSS;
    document.head.appendChild(st);
    this.root = document.createElement('div');
    this.root.className = 'fa-touch';
    this.root.dataset.mode = 'none';
    document.body.appendChild(this.root);
    this._build();

    // The first finger anywhere switches the layer on. A real key press hides it again.
    window.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse') return;
      if (!this.active) { this.active = true; }
      this.game.audio.prime(); // iOS only lets audio start from inside a touch handler
    }, true);
    window.addEventListener('keydown', (e) => { if (e.isTrusted && this.active && !e.repeat) this.active = false; }, true);
    // Picture taps
    canvas.addEventListener('pointerdown', (e) => this._tapCanvas(e));
    window.addEventListener('blur', () => this._releaseAll());
    document.addEventListener('contextmenu', (e) => { if (this.active) e.preventDefault(); });
  }

  // ---- building ----
  _el(parent, cls, text, forModes) {
    const d = document.createElement('div');
    d.className = cls;
    if (text) d.textContent = text;
    if (forModes) d.dataset.for = forModes;
    parent.appendChild(d);
    return d;
  }

  // Positions are in --u units from the right/bottom edge, or from the left (x) / top (y) when given.
  _style(d, o) {
    const u = (n) => `calc(var(--u) * ${n})`;
    if (o.w !== undefined) d.style.width = u(o.w);
    if (o.h !== undefined) d.style.height = u(o.h);
    if (o.x !== undefined) d.style.left = u(o.x); else if (o.r !== undefined) d.style.right = u(o.r);
    if (o.y !== undefined) d.style.top = u(o.y); else if (o.bt !== undefined) d.style.bottom = u(o.bt);
  }

  // A button: pointer down presses the key, pointer up releases it.
  _button(parent, o, forModes) {
    const d = this._el(parent, 'b ' + (o.cls || ''), o.label, forModes);
    this._style(d, o);
    d.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      d.setPointerCapture(e.pointerId);
      d.classList.add('on');
      this._press(d, o);
      this.cleanups.set(e.pointerId, () => { d.classList.remove('on'); if (o.code) this.input.vrelease(o.code); });
    });
    const up = (e) => { const f = this.cleanups.get(e.pointerId); if (f) { f(); this.cleanups.delete(e.pointerId); } };
    d.addEventListener('pointerup', up);
    d.addEventListener('pointercancel', up);
    d.addEventListener('lostpointercapture', up);
    return d;
  }

  _press(d, o) {
    const inp = this.input;
    if (o.act === 'drawer') { this.drawer = !this.drawer; this.root.dataset.drawer = this.drawer ? 'on' : 'off'; return; }
    if (o.act === 'full') { this._fullscreen(); return; }
    if (o.act === 'ab') {
      const s = this.game.screen, j = s && s.sim && s.sim.player;
      if (j && j.afterburner) inp.setThrottle(1, false); else inp.vpress('Home');
      return;
    }
    if (o.confirm) {
      if (!this.armed.has(d)) {
        const label = d.textContent;
        d.classList.add('arm'); d.textContent = 'SURE?';
        this.armed.set(d, setTimeout(() => { d.classList.remove('arm'); d.textContent = label; this.armed.delete(d); }, 2500));
        return;
      }
      clearTimeout(this.armed.get(d)); this.armed.delete(d);
      d.classList.remove('arm');
      d.textContent = o.label || d.dataset.label;
    }
    inp.vpress(o.code, !!o.shift);
    if (o.shift) this.drawer = false, this.root.dataset.drawer = 'off';
  }

  _build() {
    const r = this.root;
    // flight
    this.zone = this._el(r, 'zone', '', 'flight');
    this.base = this._el(this.zone, 'base'); this.knob = this._el(this.base, 'knob');
    this._el(r, 'hint', 'STICK', 'flight');
    this._stickEvents();
    for (const o of FLIGHT_BTNS) this._button(r, o, 'flight');
    this._button(r, { id: 'full', label: 'FULL', act: 'full', cls: 'sm', r: 25, y: 2, w: 10, h: 10 }, 'flight tap keys').classList.add('fs');
    this.thr = this._el(r, 'thr', '', 'flight');
    this.thrFill = document.createElement('i'); this.thr.appendChild(this.thrFill);
    this._el(this.thr, '', 'THR');
    this._throttleEvents();
    const dr = this._el(r, 'drawer', '', 'drawer');
    for (const [label, code, opt = {}] of DRAWER_BTNS) {
      const d = this._button(dr, { label, code, ...opt, cls: '' }, '');
      d.dataset.label = label; d.removeAttribute('data-for');
    }
    // menus
    const pad = this._el(r, 'pad', '', 'keys');
    for (const [label, code, cls] of PAD_KEYS) this._button(pad, { label, code, cls: cls || '' }, '').removeAttribute('data-for');
    const ar = this._el(r, 'arrows', '', 'keys');
    for (const [label, code, cls] of ARROW_KEYS) this._button(ar, { label, code, cls: cls || '' }, '').removeAttribute('data-for');
    // The fullscreen button is only useful where the browser can do it
    this.fsOk = !!(document.fullscreenEnabled || document.webkitFullscreenEnabled);
    if (!this.fsOk) for (const e of r.querySelectorAll('.fs')) e.remove();
  }

  _fullscreen() {
    const de = document.documentElement;
    if (document.fullscreenElement || document.webkitFullscreenElement) {
      (document.exitFullscreen || document.webkitExitFullscreen).call(document);
      return;
    }
    const req = de.requestFullscreen || de.webkitRequestFullscreen;
    if (!req) return;
    Promise.resolve(req.call(de)).then(() => {
      if (screen.orientation && screen.orientation.lock) screen.orientation.lock('landscape').catch(() => {});
    }).catch(() => {});
  }

  // ---- floating stick ----
  _stickEvents() {
    const z = this.zone;
    let ox = 0, oy = 0;
    const apply = (e) => {
      const R = this.base.offsetWidth / 2 || 40;
      let dx = (e.clientX - ox) / R, dy = (e.clientY - oy) / R;
      const len = Math.hypot(dx, dy);
      if (len > 1) { dx /= len; dy /= len; }
      this.knob.style.transform = `translate(${dx * R}px,${dy * R}px)`;
      const dz = 0.1, shape = (v) => { const a = Math.abs(v); return a < dz ? 0 : Math.sign(v) * Math.min(1, (a - dz) / (1 - dz)); };
      const ts = this.input.touchStick;
      ts.active = true; ts.pitch = shape(dy); ts.roll = shape(dx);
    };
    z.addEventListener('pointerdown', (e) => {
      if (this.stickId !== null) return;
      e.preventDefault();
      z.setPointerCapture(e.pointerId);
      this.stickId = e.pointerId;
      const box = this.root.getBoundingClientRect();
      ox = e.clientX; oy = e.clientY;
      this.base.style.display = 'block';
      this.base.style.left = (ox - box.left) + 'px'; this.base.style.top = (oy - box.top) + 'px';
      apply(e);
    });
    z.addEventListener('pointermove', (e) => { if (e.pointerId === this.stickId) apply(e); });
    const end = (e) => {
      if (e.pointerId !== this.stickId) return;
      this.stickId = null;
      this.base.style.display = 'none';
      this.knob.style.transform = '';
      const ts = this.input.touchStick; ts.active = false; ts.pitch = 0; ts.roll = 0;
    };
    z.addEventListener('pointerup', end);
    z.addEventListener('pointercancel', end);
    z.addEventListener('lostpointercapture', end);
  }

  // ---- throttle slider ----
  _throttleEvents() {
    const t = this.thr;
    const set = (e) => {
      const r = t.getBoundingClientRect();
      let v = 1 - (e.clientY - r.top) / r.height;
      v = Math.max(0, Math.min(1, v));
      v = Math.round(v * 10) / 10;
      this.input.setThrottle(v, false);
    };
    t.addEventListener('pointerdown', (e) => { e.preventDefault(); t.setPointerCapture(e.pointerId); this.thrId = e.pointerId; set(e); });
    t.addEventListener('pointermove', (e) => { if (e.pointerId === this.thrId) set(e); });
    const end = (e) => { if (e.pointerId === this.thrId) this.thrId = null; };
    t.addEventListener('pointerup', end);
    t.addEventListener('pointercancel', end);
    t.addEventListener('lostpointercapture', end);
  }

  // ---- taps on the picture ----
  // Converts a screen position to the 320x256 picture's own coordinates (null outside the picture).
  toGame(clientX, clientY) {
    const c = this.canvas, d = this.display, rect = c.getBoundingClientRect();
    const kx = d.bw / rect.width, ky = d.bh / rect.height;
    const x = ((clientX - rect.left) * kx - d.view.x) / d.view.w * d.srcW;
    const y = ((clientY - rect.top) * ky - d.view.y) / d.view.h * d.srcH;
    return x < 0 || y < 0 || x >= d.srcW || y >= d.srcH ? null : { x, y };
  }

  _tapCanvas(e) {
    if (e.pointerType === 'mouse') return;
    const m = this._mode(); // not this.mode: the very first touch arrives before the first update()
    if (m === 'flight' || m === 'none') return;
    e.preventDefault();
    const s = this.game.screen, p = this.toGame(e.clientX, e.clientY);
    const code = s && s.tap && p ? s.tap(p.x, p.y) : 'Enter';
    if (code) { this.input.vpress(code); this.input.vrelease(code); }
  }

  _releaseAll() {
    for (const f of this.cleanups.values()) f();
    this.cleanups.clear();
    const ts = this.input.touchStick; ts.active = false; ts.pitch = 0; ts.roll = 0;
    this.stickId = null; this.thrId = null;
    if (this.base) this.base.style.display = 'none';
  }

  // ---- per frame ----
  _mode() {
    const s = this.game.screen;
    return this.active && s ? (s.sim ? 'flight' : (s.touchUI || 'keys')) : 'none';
  }

  update() {
    const s = this.game.screen;
    const mode = this._mode();
    this.game.touchMode = this.active;
    if (mode !== this.mode) {
      this.mode = mode;
      this.root.dataset.mode = mode;
      if (mode !== 'flight') { this.drawer = false; this.root.dataset.drawer = 'off'; this._releaseAll(); }
    }
    if (mode === 'flight') {
      const j = s.sim.player;
      if (j && this.thrId === null) {
        this.thrFill.style.height = (Math.max(0, Math.min(1, j.throttle)) * 100) + '%';
        this.thr.classList.toggle('ab', !!j.afterburner);
      } else if (j) {
        this.thrFill.style.height = (Math.max(0, Math.min(1, this.input._thr ? this.input._thr.v : j.throttle)) * 100) + '%';
      }
    }
  }
}
