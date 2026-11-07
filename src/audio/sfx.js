// The sound director: turns simulation state and events into Paula voice commands.
//
// Voice map (16 voices; 0-3 belong to the music, exactly like the four hardware channels):
//   4 engine roar   5 turbine whine   6 afterburner   7 wind   8 buffet / wheel rumble
//   9 cannon        10 warning tone   11 seeker tone  12-15 one-shots
import { MI } from '../sim/sim.js';

const V = { ROAR: 4, WHINE: 5, AB: 6, WIND: 7, BUF: 8, GUN: 9, WARN: 10, SEEK: 11, ONE: [12, 13, 14, 15] };
const SOUND_SPEED = 343;

const clamp = (x, a = 0, b = 1) => (x < a ? a : x > b ? b : x);

export class Sfx {
  constructor(backend, samples = []) {
    this.b = backend;
    this.info = new Map();
    this.jingles = {};
    this.setSamples(samples);
    this.oneEnd = [0, 0, 0, 0];
    this.sm = { roar: 0, whine: 0, ab: 0, wind: 0, buf: 0, roll: 0 };
    this.last = {};
    this.flying = false;
    this.pending = [];
    this.now = 0;
    this.gunOn = false;
    this.warn = { id: null, phase: 0 };
    this.seek = null;
    this.prevGear = null;
    this.prevBrake = false;
    this.prevHook = false;
    this.muted = false;
    this.cabinMuffle = 0.4;
  }

  setSamples(samples) {
    for (const s of samples) this.info.set(s.id, { rate: s.rate || 11025, dur: s.data.length / (s.rate || 11025), loop: s.loopStart >= 0 });
  }
  jingle(kind) {
    const song = this.jingles[kind];
    if (!song || this.muted) return;
    this.send('setWet', 0.14);
    this.send('setEcho', 0, 0, 0);
    this.send('loadSong', song);
    this.send('playSong', 0);
  }

  // ---- low-level ----
  send(c, ...a) { this.b.cmd(c, ...a); }
  _setIf(key, v, send) { if (this.last[key] === undefined || Math.abs(this.last[key] - v) > 0.004) { this.last[key] = v; send(); } }

  panGains(pan) { return pan < 0 ? [1, 1 + pan] : [1 - pan, 1]; }

  play(id, { rate = null, vol = 1, pan = 0 } = {}) {
    const i = this.info.get(id);
    if (!i || this.muted) return -1;
    // Steal the voice that will finish first.
    let best = 0;
    for (let k = 1; k < 4; k++) if (this.oneEnd[k] < this.oneEnd[best]) best = k;
    const v = V.ONE[best];
    this.oneEnd[best] = this.now + i.dur * (i.rate / (rate || i.rate));
    const [l, r] = this.panGains(clamp(pan, -1, 1));
    this.send('setPan', v, l, r);
    this.send('voicePlay', v, id, rate || i.rate, clamp(vol, 0, 1), { noLoop: true });
    return v;
  }

  loop(v, id, vol = 0, rate = null) {
    const i = this.info.get(id);
    if (!i || this.muted) return;
    this.send('voicePlay', v, id, rate || i.rate, vol, { ramp: true });
  }

  // ---- music ----
  // A song may carry its own room: a reverb amount, and a tempo-sized echo for its lead channel.
  playSong(song, wet = song.wet === undefined ? 0.16 : song.wet) {
    if (this.muted) return;
    const e = song.echo;
    this.send('setWet', wet);
    this.send('setEcho', e ? e.time : 0, e ? e.feedback : 0, e ? e.mix : 0);
    this.send('loadSong', song);
    this.send('playSong', 0);
  }
  stopSong(fade = 0.8) { this.send('stopSong', fade); }
  setMusicGain(g) { this.send('setGains', g, null, null); }

  // ---- flight loops ----
  startFlight() {
    this.flying = true;
    this.last = {};
    this.sm = { roar: 0, whine: 0, ab: 0, wind: 0, buf: 0, roll: 0 };
    this.send('setWet', 0.05);
    this.loop(V.ROAR, 'e_roar', 0);
    this.loop(V.WHINE, 'e_whine', 0);
    this.loop(V.AB, 'e_ab', 0);
    this.loop(V.WIND, 'e_wind', 0);
    this.loop(V.BUF, 'e_buffet', 0);
    this.prevGear = null;
  }
  stopFlight() {
    this.flying = false;
    for (const v of [V.ROAR, V.WHINE, V.AB, V.WIND, V.BUF, V.GUN, V.WARN, V.SEEK]) this.send('voiceStop', v, true);
    this.gunOn = false;
    this.warn.id = null;
    this.seek = null;
  }
  silence() { this.send('silenceAll'); this.flying = false; }

  // Called every rendered frame.
  update(sim, view, dt) {
    this.now += dt;
    this._runPending(sim);
    if (!this.flying || this.muted) return;
    const j = sim.player;
    if (!j) return;
    const cabin = view.mode === 'cockpit';
    const camX = view.cam ? view.cam.x : j.x, camY = view.cam ? view.cam.y : j.y, camZ = view.cam ? view.cam.z : j.z;
    const dx = j.x - camX, dy = j.y - camY, dz = j.z - camZ;
    const dist = Math.hypot(dx, dy, dz);
    const att = cabin ? 1 : 1 / (1 + Math.pow(dist / 90, 1.4));
    // Doppler: closing speed along the line from camera to jet
    let dop = 1;
    if (!cabin && dist > 1) {
      const vr = -((j.vx * dx + j.vy * dy + j.vz * dz) / dist);
      dop = 1 / (1 - clamp(vr / SOUND_SPEED, -0.45, 0.45));
    }
    const rpm = j.engineOn && j.fuel > 0 ? j.rpm : 0;
    const speed = j.speed;
    const k = Math.min(1, dt * 9);
    const sm = this.sm;
    const dead = !j.alive;
    const target = {
      roar: dead ? 0 : (0.1 + 0.9 * Math.pow(rpm, 1.25)) * (cabin ? 0.62 : 0.95) * att,
      whine: dead ? 0 : (0.06 + 0.7 * rpm * rpm) * (cabin ? 0.28 : 0.85) * att,
      ab: dead ? 0 : (j.afterburner && rpm > 0.9 ? 1 : 0) * (cabin ? 0.55 : 1) * att,
      wind: dead ? 0 : clamp(Math.pow(speed / 320, 1.3), 0, 1) * (j.onGround ? 0.2 : 1) * (cabin ? 0.5 : 0.8) * Math.min(1, att + 0.2),
      buf: dead ? 0 : (j.onGround ? clamp(speed / 70, 0, 1) * 0.65 : clamp((Math.abs(j.alpha) - 0.26) * 5, 0, 1) * 0.9 + clamp((Math.abs(j.gLoad) - 5.5) * 0.3, 0, 0.6)) * (cabin ? 1 : 0.6) * att,
    };
    for (const key of Object.keys(target)) sm[key] += (target[key] - sm[key]) * k;
    const lp = cabin ? this.cabinMuffle : 1;
    this._setIf('roar', sm.roar, () => this.send('voiceSet', V.ROAR, 11025 * (0.5 + 0.95 * rpm) * dop, sm.roar * 0.95, lp));
    this._setIf('whine', sm.whine, () => this.send('voiceSet', V.WHINE, 16726 * (0.42 + 1.1 * rpm) * dop, sm.whine * 0.9, cabin ? 0.55 : 1));
    this._setIf('ab', sm.ab, () => this.send('voiceSet', V.AB, 11025 * dop, sm.ab * 0.95, cabin ? 0.5 : 0.9));
    this._setIf('wind', sm.wind, () => this.send('voiceSet', V.WIND, 11025 * (0.55 + 0.9 * clamp(speed / 450)) * dop, sm.wind * 0.85, cabin ? 0.45 : 0.9));
    // Wheel rumble and buffet share a voice: the voice swaps sample when ground contact changes.
    const wantRoll = j.onGround;
    if (this.last.rollMode !== wantRoll) { this.last.rollMode = wantRoll; this.loop(V.BUF, wantRoll ? 'e_roll' : 'e_buffet', 0); }
    this._setIf('buf', sm.buf, () => this.send('voiceSet', V.BUF, wantRoll ? 8363 * (0.7 + speed / 90) : 8363 * (0.8 + 0.5 * clamp(Math.abs(j.alpha) * 2)), sm.buf, cabin ? 0.5 : 0.9));

    // Gear and brake mechanics
    if (this.prevGear !== null && this.prevGear !== j.gearCmd) this.play('a_gear', { vol: cabin ? 0.55 : 0.8 * att });
    this.prevGear = j.gearCmd;
    if (j.brake && !this.prevBrake) this.play('a_brake', { vol: 0.5 });
    this.prevBrake = j.brake;
    if (j.hook !== this.prevHook) { this.play('a_hook', { vol: 0.8 }); this.prevHook = j.hook; }

    // Cannon: a continuous 100 Hz buzz while the trigger is held
    const gun = sim.firing && j.stores.gun > 0 && !j.onGround && sim.selected === 'gun';
    if (gun && !this.gunOn) { this.loop(V.GUN, 'w_gun', 0.95, 16726); this.gunOn = true; }
    else if (!gun && this.gunOn) { this.send('voiceStop', V.GUN, false); this.play('w_gunstop', { vol: 0.5 }); this.gunOn = false; }

    this._warnings(sim, j, dt);
  }

  // Cockpit warning tones. One tone voice, strict priority: missile alarm, pull-up, stall.
  _warnings(sim, j, dt) {
    const w = this.warn;
    w.phase += dt;
    let want = null, on = false, hz = 0;
    if (sim.incoming.radar) { want = 't_rwr'; on = (w.phase * 9) % 1 < 0.45; }
    else if (sim.incoming.ir) { want = 't_warn'; on = (w.phase * 5) % 1 < 0.6; }
    else if (sim.alerts.pullUp) { want = (w.phase * 2.4) % 1 < 0.5 ? 't_hi' : 't_lo'; on = true; }
    else if (sim.alerts.gearWarn) { want = 't_warn'; on = (w.phase * 3) % 1 < 0.3; }
    else if (sim.alerts.stall) { want = 't_stall'; on = (w.phase * 6) % 1 < 0.5; }
    else if (sim.alerts.bingo && (w.phase * 0.5) % 1 < 0.06) { want = 't_pull'; on = true; }
    void hz;
    if (want && on) {
      if (w.id !== want) { w.id = want; this.loop(V.WARN, want, 0.55, 11025); }
    } else if (w.id) { w.id = null; this.send('voiceStop', V.WARN, false); }

    // Sidewinder seeker: growl while searching, a high pure tone on lock
    let seek = null;
    if (sim.selected === 'aim9' && j.stores.aim9 > 0 && !j.onGround && sim.target) {
      seek = sim.locked ? 't_lock' : (sim.lockT > 0 ? 't_growl' : null);
    }
    if (seek !== this.seek) {
      this.seek = seek;
      if (seek) this.loop(V.SEEK, seek, seek === 't_lock' ? 0.42 : 0.5, seek === 't_lock' ? 16726 : 11025 * (1 + 0.5 * clamp(sim.lockT / 0.8)));
      else this.send('voiceStop', V.SEEK, false);
    } else if (seek === 't_growl') {
      this.send('voiceSet', V.SEEK, 11025 * (1 + 0.5 * clamp(sim.lockT / 0.8)), 0.5, 1);
    }
  }

  // ---- positional events ----
  _bearingPan(sim, view, x, z) {
    const cam = view && view.cam;
    const j = sim.player;
    if (!cam) return 0;
    const dx = x - cam.x, dz = z - cam.z;
    const d = Math.hypot(dx, dz) || 1;
    return clamp((dx * cam.rx + dz * cam.rz) / d, -1, 1) * 0.85 + (j ? 0 : 0);
  }

  _later(delay, fn) { if (delay < 0.03) fn(); else this.pending.push({ at: this.now + delay, fn }); }
  _runPending() {
    for (let i = this.pending.length - 1; i >= 0; i--) {
      if (this.now >= this.pending[i].at) { const p = this.pending.splice(i, 1)[0]; p.fn(); }
    }
  }
  _dist(sim, view, x, y, z) {
    const cam = view && view.cam ? view.cam : sim.player;
    return cam ? Math.hypot(x - cam.x, y - cam.y, z - cam.z) : 0;
  }

  event(ev, sim, view) {
    if (this.muted) return;
    const j = sim.player;
    switch (ev.type) {
      case 'explode': {
        const d = this._dist(sim, view, ev.x, ev.y, ev.z);
        const own = ev.own;
        const vol = own ? 1 : clamp(1.35 / (1 + d / 600), 0.07, 1);
        const id = ev.big ? 'x_big' : d < 1800 ? 'x_near' : 'x_far';
        const pan = own ? 0 : this._bearingPan(sim, view, ev.x, ev.z);
        this._later(own ? 0 : d / SOUND_SPEED, () => this.play(id, { vol, pan, rate: ev.far ? 9500 : null }));
        break;
      }
      case 'splash': {
        const d = this._dist(sim, view, ev.x, ev.y, ev.z);
        this._later(d / SOUND_SPEED, () => this.play('x_splash', { vol: clamp((ev.small ? 0.35 : 0.9) / (1 + d / 500), 0.05, 1), pan: this._bearingPan(sim, view, ev.x, ev.z) }));
        break;
      }
      case 'launch':
        this.play(ev.kind === 'aim120' ? 'w_aim120' : 'w_aim9', { vol: 0.85 });
        break;
      case 'enemyLaunch':
        this.play('w_aim9', { vol: 0.35, rate: 14500 });
        break;
      case 'decoy':
        this.play(ev.kind === 'flare' ? 'w_flare' : 'w_chaff', { vol: 0.8 });
        break;
      case 'ecm':
        this.play('u_blip', { vol: 0.6, rate: ev.on ? 11025 : 7500 });
        break;
      case 'playerHit':
        this.play('x_hit', { vol: 1, pan: (Math.random() - 0.5) * 0.7 });
        break;
      case 'gunHit':
        this.play('x_hit', { vol: 0.35, rate: 16726 * 1.3 });
        break;
      case 'lockOn':
        this.play('u_blip', { vol: 0.5, rate: 16000 });
        break;
      case 'weaponSelect':
      case 'targetSelect':
        this.play('u_click', { vol: 0.8 });
        break;
      case 'dryFire':
        this.play('u_click', { vol: 0.8, rate: 7000 });
        break;
      case 'touchdown':
        if (ev.other) break;
        this.play('a_chirp', { vol: clamp(0.4 + ev.sink * 0.1, 0.4, 1) });
        this.play('a_thump', { vol: clamp(0.5 + ev.sink * 0.08, 0.5, 1) });
        break;
      case 'trap':
        this.play('a_trap', { vol: 1 });
        break;
      case 'catapult':
        this.play('a_cat', { vol: 1 });
        break;
      case 'eject':
        this.play('a_eject', { vol: 1 });
        break;
      case 'crash':
        break;
      case 'message':
        if (ev.voice) { this.play('r_open', { vol: 0.5 }); this._later(0.35, () => this.play('r_close', { vol: 0.45 })); }
        break;
      case 'bingo':
        this.play('u_blip', { vol: 0.7, rate: 7400 });
        break;
      case 'flameout':
        this.send('voiceSet', V.ROAR, 4000, 0, 1);
        break;
      default:
        break;
    }
    void j;
  }

  // ---- UI ----
  ui(kind) {
    if (kind === 'click') this.play('u_click', { vol: 0.9 });
    else if (kind === 'select') this.play('u_blip', { vol: 0.8 });
    else if (kind === 'back') this.play('u_blip', { vol: 0.7, rate: 7000 });
    else if (kind === 'step') this.play('u_step', { vol: 0.8 });
    else if (kind === 'insert') this.play('u_insert', { vol: 0.9 });
    else if (kind === 'tty') this.play('u_tty', { vol: 0.5 });
  }
  floppyStart() { this.loop(V.BUF, 'u_spin', 0.35); }
  floppyStop() { this.send('voiceStop', V.BUF, true); }
  flyby(vol = 1) { this.play('j_flyby', { vol }); }
}

export { MI };
