// The flight screen: owns a Sim, drives it at a fixed 60 Hz, reads the pilot's controls, picks the
// camera, and draws the cockpit (or an external view) plus all the on-screen text.
import { Sim, MI } from '../sim/sim.js';
import { Cockpit, VIEW_H_COCKPIT, COCKPIT_CENTER_Y, VIEW_H_EXTERNAL } from '../ui/cockpit.js';
import { cockpitCamera, orbitCamera, trackingCamera } from '../render/camera.js';
import { missionById } from '../missions/missions.js';
import { TrainingLesson, DemoMission } from '../training.js';
import { C } from '../gfx/palette.js';
import { FONT_SMALL, FONT_MENU } from '../gfx/fonts.js';
import { BASES, toWorld } from '../world/geo.js';
import { toLatLon } from '../world/geo.js';

const STEP = 1 / 60;
const DEG = Math.PI / 180;
const RADAR_RANGES = [2 * MI, 10 * MI, 40 * MI];

const ORBIT_PRESETS = {
  Numpad8: [0, 0.18], Numpad2: [Math.PI, 0.18], Numpad4: [Math.PI / 2, 0.15], Numpad6: [-Math.PI / 2, 0.15],
  Numpad7: [Math.PI / 4, 0.25], Numpad9: [-Math.PI / 4, 0.25], Numpad1: [(3 * Math.PI) / 4, 0.2], Numpad3: [(-3 * Math.PI) / 4, 0.2],
  Numpad5: [0, 1.45], NumpadDecimal: [0, -0.9],
};
const LOOK_PRESETS = {
  Numpad4: [-Math.PI / 2.2, 0], Numpad6: [Math.PI / 2.2, 0], Numpad2: [Math.PI, 0], Numpad1: [0, -1.05], Numpad7: [0, 1.0], Numpad8: [0, 0],
};

export class FlightScreen {
  constructor(game, spec) {
    this.game = game;
    this.spec = spec;
    this.title = '';
  }

  enter() {
    const game = this.game, spec = this.spec;
    this.sim = new Sim({
      world: game.world, seed: (Math.random() * 4294967296) >>> 0, flightModel: 'classic',
      aircraft: spec.aircraft || 'F18', difficulty: spec.difficulty || 0,
    });
    const sim = this.sim;
    this.missionId = null;
    this.lesson = null;
    this.demo = null;
    switch (spec.kind) {
      case 'free': this.setupFree(spec); break;
      case 'mission': case 'qual': {
        const m = missionById(spec.kind === 'qual' ? 0 : spec.missionId);
        this.missionId = m.id;
        sim.mission = m;
        m.setup(sim);
        this.title = m.name;
        break;
      }
      case 'demo':
        this.demo = new DemoMission(sim);
        this.demo.setup();
        sim.mission = this.demo;
        this.title = 'DEMO';
        break;
      case 'train-demo': case 'train-practice':
        this.lesson = new TrainingLesson(sim, spec.kind === 'train-demo' ? 'demo' : 'practice');
        this.lesson.setup();
        sim.mission = this.lesson;
        this.title = spec.kind === 'train-demo' ? 'DEMO OF MANEUVERS' : 'PRACTICE MANEUVERS';
        break;
      default: break;
    }
    if (spec.kind === 'mission' || spec.kind === 'qual') game.log.startMission();
    this.cockpit = new Cockpit(game.gfx);
    this.st = { hudOn: true, mapOn: false };
    this.view = { mode: 'cockpit', az: 0, el: 0.18, dist: 34, zoom: 1, look: { yaw: 0, pitch: 0, ty: 0, tp: 0, timer: 0, locked: false }, towerPos: null, spotter: null };
    this.acc = 0;
    this.paused = false;
    this.help = false;
    this.endTimer = null;
    this.endInfo = null;
    this.recorded = false;
    this.flightTime = 0;
    this.f1Last = -10;
    this.autoViewT = 0;
    game.musicFor('none');
    game.sfx.startFlight();
    this.lastCam = null;
    this.radarIdx = 1;
    sim.radarRange = RADAR_RANGES[this.radarIdx];
    if (spec.kind === 'demo' || spec.kind === 'train-demo') this.view.mode = 'chase';
  }

  setupFree(spec) {
    const sim = this.sim;
    this.title = 'FREE FLIGHT';
    if (spec.start === 'CARRIER') { sim.addCarrier(); sim.spawnPlayerCarrier('F18'); }
    else if (spec.start === 'AIR') {
      const [x, z] = toWorld(37.72, -122.62);
      const j = sim.spawnPlayerAir(x, 1800, z, 70, 200, spec.aircraft || 'F18');
      j.throttle = 0.7;
    } else sim.spawnPlayerRunway(spec.start, spec.aircraft || 'F18');
    // A carrier is always on station off the Gate, as in the manual.
    if (spec.start !== 'CARRIER') sim.addCarrier();
    sim.say('FREE FLIGHT. NO ENEMY CONFRONTATION.', 'green', 6, false);
  }

  leave() {
    this.record(false);
    this.game.sfx.stopFlight();
  }

  // ---- bookkeeping ----
  record(success) {
    if (this.recorded || !this.sim) return;
    this.recorded = true;
    const sim = this.sim;
    const real = this.spec.kind === 'mission' || this.spec.kind === 'qual';
    this.game.log.record({
      stats: sim.log, seconds: this.flightTime, crashed: !!(sim.over && sim.over.kind === 'crash') && sim.player && !sim.player.alive && this.spec.kind !== 'demo',
      missionId: this.missionId, success: success && real,
    });
  }

  // ---- input ----
  controls(dt) {
    const g = this.game, inp = g.input, sim = this.sim, j = sim.player;
    inp.pollPad();
    const press = (c) => inp.pressed(c);
    const shift = inp.shift;
    if (press('Escape')) {
      if (shift) { g.toMenu(); return; }
      g.restartFlight(this.spec); return;
    }
    if (press('Tab')) { this.help = !this.help; if (this.help !== this.paused) this.togglePause(); return; }
    if (this.help && (press('Space') || press('Enter'))) { this.help = false; if (this.paused) this.togglePause(); return; }
    if (press('KeyP')) { if (this.help) this.help = false; this.togglePause(); }
    if (this.paused) return;
    const auto = !!sim.autopilotCtl;

    // --- views ---
    if (press('NumpadEnter') || press('KeyV')) {
      if (shift) this.view.mode = 'tower';
      else this.view.mode = this.view.mode === 'cockpit' ? 'chase' : 'cockpit';
    }
    if (press('KeyB')) this.view.mode = this.view.mode === 'tower' ? 'cockpit' : 'tower';
    if (press('BracketLeft')) this.zoom(-1);
    if (press('BracketRight')) this.zoom(1);
    if (this.view.mode === 'cockpit') {
      for (const k of Object.keys(LOOK_PRESETS)) if (press(k)) { const [yw, pt] = LOOK_PRESETS[k]; this.view.look.ty = yw; this.view.look.tp = pt; this.view.look.timer = 4; }
      if (press('Numpad5')) this.view.look.locked = !this.view.look.locked;
      if (press('KeyQ')) { this.view.look.ty = -Math.PI / 2.2; this.view.look.tp = 0; this.view.look.timer = 4; }
      if (press('KeyE') && !shift) { this.view.look.ty = Math.PI / 2.2; this.view.look.tp = 0; this.view.look.timer = 4; }
      if (press('KeyX')) { this.view.look.ty = Math.PI; this.view.look.tp = 0; this.view.look.timer = 4; }
    } else if (this.view.mode === 'chase') {
      for (const k of Object.keys(ORBIT_PRESETS)) if (press(k)) { [this.view.az, this.view.el] = ORBIT_PRESETS[k]; }
      if (inp.held('KeyQ')) this.view.az += dt * 1.4;
      if (inp.held('KeyE')) this.view.az -= dt * 1.4;
    }

    if (!j || !j.alive) return;

    // --- training and demos intercept some keys ---
    if (this.lesson && this.lesson.mode === 'practice') {
      if (press('Space') || press('NumpadEnter') && false) this.lesson.next();
      if (press('Enter')) this.lesson.skip();
    }
    if (this.demo || (this.lesson && this.lesson.mode === 'demo')) {
      if (press('Space') || press('Enter')) { g.toMenu(); return; }
    }

    // --- instruments ---
    if (press('KeyH')) this.st.hudOn = !this.st.hudOn;
    if (press('KeyM')) this.st.mapOn = !this.st.mapOn;
    if (press('KeyR')) { this.radarIdx = (this.radarIdx + 1) % 3; sim.radarRange = RADAR_RANGES[this.radarIdx]; g.sfx.ui('click'); }
    if (auto) return;

    // --- aircraft ---
    if (press('KeyG') && !j.onGround) j.gearCmd = !j.gearCmd;
    if (press('KeyA')) j.hook = !j.hook;
    j.brake = inp.held('Backspace');
    if (press('KeyJ')) sim.toggleEcm();
    if (press('KeyC')) sim.dropPlayerDecoy('chaff');
    if (press('KeyF')) { if (shift) sim.dropPod(); else sim.dropPlayerDecoy('flare'); }
    if (press('KeyE') && shift) sim.eject();
    if (press('KeyT')) sim.cycleTarget();
    if (press('KeyS') && this.lesson) j.smokeOn = !j.smokeOn;
    if (!(this.lesson && this.lesson.mode === 'practice')) {
      if (press('Enter')) sim.selectNextWeapon();
      if (press('Space')) sim.fireWeapon(true);
      if (!inp.held('Space') && sim.selected === 'gun' && sim.firing && !(this.demo)) sim.fireWeapon(false);
    }

    // --- throttle ---
    this.throttleKeys(j);
  }

  throttleKeys(j) {
    const inp = this.game.input, press = (c) => inp.pressed(c);
    const setT = (t, ab = false) => { j.throttle = t; j.afterburner = ab && t >= 0.999; j.engineOn = true; };
    for (let n = 1; n <= 10; n++) {
      if (!press('F' + n)) continue;
      if (n === 10) {
        if (j.throttle >= 0.999 && !j.afterburner) setT(1, true);
        else setT(1, false);
      } else if (n === 1) {
        const now = this.sim.time;
        if (now - this.f1Last < 1.2 && j.throttle <= 0.101 && j.engineOn) { j.engineOn = false; this.sim.say('ENGINE SHUT DOWN', 'red', 3); }
        else setT(0.1);
        this.f1Last = now;
      } else setT(n / 10);
    }
    if (press('Equal') || press('PageUp')) { j.engineOn = true; if (j.afterburner) j.afterburner = false; else j.throttle = Math.min(1, Math.round(j.throttle * 10) / 10 + 0.1); }
    if (press('Minus') || press('PageDown')) { j.afterburner = false; j.throttle = Math.max(0, Math.round(j.throttle * 10) / 10 - 0.1); }
    if (press('Home')) setT(1, true);
    if (press('End')) setT(0);
    const tt = inp.takeThrottle && inp.takeThrottle(); // the touch slider
    if (tt) { j.engineOn = true; j.throttle = tt.v; j.afterburner = !!tt.ab && tt.v >= 0.999; }
    const pad = inp.pad;
    if (pad && Math.abs(pad.axes[3] || 0) > 0.2) j.throttle = Math.max(0, Math.min(1, j.throttle - (pad.axes[3] || 0) * 0.02));
  }

  zoom(dir) {
    const v = this.view;
    if (v.mode === 'chase') v.dist = Math.max(12, Math.min(160, v.dist * (dir > 0 ? 0.8 : 1.25)));
    else v.zoom = Math.max(1, Math.min(8, v.zoom * (dir > 0 ? 1.35 : 1 / 1.35)));
  }

  togglePause() {
    this.paused = !this.paused;
    const g = this.game;
    if (this.paused) g.sfx.stopFlight(); else g.sfx.startFlight();
  }

  // ---- update ----
  update(dt) {
    const g = this.game, sim = this.sim;
    this.controls(dt);
    if (this.paused) return;
    const j = sim.player;
    const ctl = g.input.axes(dt);
    this.acc += Math.min(dt, 0.1);
    let steps = 0;
    while (this.acc >= STEP && steps < 6) {
      sim.step(STEP, ctl);
      this.acc -= STEP;
      steps++;
      this.flightTime += STEP;
    }
    // Head-look returns to the front after 4 seconds unless locked
    const lk = this.view.look;
    if (lk.timer > 0 && !lk.locked) { lk.timer -= dt; if (lk.timer <= 0) { lk.ty = 0; lk.tp = 0; } }
    const k = Math.min(1, dt * 7);
    lk.yaw += (lk.ty - lk.yaw) * k;
    lk.pitch += (lk.tp - lk.pitch) * k;
    // Events to sound and bookkeeping
    const view = this.audioView();
    for (const ev of sim.events) {
      if (ev.type === 'kill' && ev.by === j) sim.log.kills++;
      if (ev.type === 'playerHit') g.flash = Math.max(g.flash, ev.kind === 'gun' ? 0.25 : 0.55);
      if (ev.type === 'crash') g.flash = 0.8;
      g.sfx.event(ev, sim, view);
    }
    sim.events.length = 0;
    g.sfx.update(sim, view, dt);
    // Demo/ejection forces an external view
    if ((!j.alive || sim.ejected) && this.view.mode === 'cockpit') this.view.mode = 'chase';
    if (this.demo || (this.lesson && this.lesson.mode === 'demo')) this.autoCameras(dt);
    // End of flight
    if (!this.endInfo) {
      if (sim.missionDone) this.endInfo = { ...sim.missionDone, kind: 'mission' };
      else if (sim.over) this.endInfo = { result: 'fail', text: sim.over.reason ? sim.over.reason : 'LOST', kind: 'over' };
      if (this.endInfo) {
        this.endTimer = this.endInfo.kind === 'mission' && this.endInfo.result === 'success' ? 3 : 4.5;
        if (this.endInfo.result === 'success') g.sfx.jingle('success'); else if (this.spec.kind !== 'free') g.sfx.jingle('fail');
      }
    } else {
      this.endTimer -= dt;
      if (this.endTimer <= 0) this.finish();
    }
    // Free flight and demos wrap up when the user quits; free-flight crashes just end the flight
  }

  finish() {
    const info = this.endInfo;
    const success = info.result === 'success';
    this.record(success);
    this.game.showDebrief({ spec: this.spec, info, title: this.title, sim: this.sim, seconds: this.flightTime, success });
  }

  autoCameras(dt) {
    this.autoViewT += dt;
    if (this.autoViewT > 9) {
      this.autoViewT = 0;
      const order = ['chase', 'cockpit', 'tower', 'chase'];
      const cur = order.indexOf(this.view.mode);
      this.view.mode = order[(cur + 1) % order.length];
      this.view.az = (Math.random() - 0.5) * 3.2;
      this.view.el = 0.1 + Math.random() * 0.4;
      this.view.dist = 26 + Math.random() * 30;
    }
  }

  audioView() { return { mode: this.view.mode === 'cockpit' ? 'cockpit' : 'external', cam: this.lastCam }; }

  // ---- camera ----
  buildCamera(dt) {
    const sim = this.sim, j = sim.player, v = this.view;
    const focus = sim.ejected && sim.ejected.alive ? sim.ejected : j;
    if (v.mode === 'cockpit' && j.alive && !sim.ejected) return cockpitCamera(j, v.look);
    if (v.mode === 'tower') {
      const pos = this.towerPosition(focus);
      return trackingCamera(pos, focus, v.zoom * 2.2);
    }
    let target = focus;
    if (!j.alive && !sim.ejected) target = this.wreck || (this.wreck = { x: j.x, y: Math.max(8, j.y), z: j.z, fx: j.fx, fz: j.fz });
    return orbitCamera(target, v.dist * (target === j ? 1 : 2.2), v.az + (j.alive ? 0 : this.sim.time * 0.15), v.el, v.zoom);
  }

  towerPosition(target) {
    const sim = this.sim, v = this.view;
    let best = null, bd = 14000 * 14000;
    for (const key of Object.keys(BASES)) {
      const t = BASES[key].towerAt;
      const d = (t[0] - target.x) ** 2 + (t[1] - target.z) ** 2;
      if (d < bd) { bd = d; best = [t[0], 56, t[1]]; }
    }
    for (const c of sim.carriers) {
      if (c.enemy || !c.alive) continue;
      const d = (c.x - target.x) ** 2 + (c.z - target.z) ** 2;
      if (d < Math.min(bd, 7000 * 7000)) { bd = d; const [wx, wz] = c.toWorld(32, 2); best = [wx, c.deckY + 30, wz]; }
    }
    if (best) { v.spotter = null; return best; }
    // Spotter plane: a chase point that trails the target loosely
    const want = [target.x - (target.fx || 0) * 220 + (target.rx || 1) * 160, target.y + 120, target.z - (target.fz || 1) * 220 + (target.rz || 0) * 160];
    if (!v.spotter) v.spotter = want;
    const k = 0.04;
    v.spotter = [v.spotter[0] + (want[0] - v.spotter[0]) * k, v.spotter[1] + (want[1] - v.spotter[1]) * k, v.spotter[2] + (want[2] - v.spotter[2]) * k];
    return v.spotter;
  }

  // ---- render ----
  render(g) {
    const sim = this.sim, j = sim.player, sc = this.game.scene;
    const cam = this.buildCamera();
    this.lastCam = cam;
    const cockpit = this.view.mode === 'cockpit' && j.alive && !sim.ejected;
    if (cockpit) {
      this.cockpit.ensureStatic();
      sc.render(cam, VIEW_H_COCKPIT, sim, COCKPIT_CENTER_Y, { cockpit: true });
      this.cockpit.blitStatic();
      this.cockpit.panel(sim, this.st, this.game.map);
      g.setClip(0, 0, 320, 184);
      this.cockpit.hud(sim, this.st);
      g.setClip(0, 0, 320, 256);
    } else {
      sc.render(cam, VIEW_H_EXTERNAL, sim, VIEW_H_EXTERNAL / 2, { cockpit: false });
      this.cockpit.externalBar(sim);
    }
    this.drawOverlay(g, cockpit);
  }

  drawOverlay(g, cockpit) {
    const sim = this.sim;
    g.setClip(0, 0, 320, 256);
    if (this.paused && this.help) {
      g.rect(6, 14, 308, 200, C.BLACK);
      g.rect(6, 14, 308, 1, C.G6); g.rect(6, 213, 308, 1, C.G6);
      g.textC('FLIGHT CONTROLS', 160, 18, C.ORANGE, FONT_MENU);
      const rows = [
        ['CURSOR UP / DOWN', 'NOSE DOWN / NOSE UP'], ['CURSOR LEFT / RIGHT', 'ROLL LEFT / RIGHT'], [', AND .', 'RUDDER LEFT / RIGHT'],
        ['F1-F10  OR PGUP/PGDN', 'THROTTLE (F10 TWICE = A/B)'], ['BACKSPACE', 'BRAKES / SPEED BRAKE'],
        ['G  GEAR     A  HOOK', 'H  HUD     M  MAP ON HSI'], ['R  RADAR RANGE', 'T  NEXT TARGET'],
        ['ENTER', 'SELECT WEAPON'], ['SPACE', 'FIRE (HOLD: CANNON)'], ['J  ECM JAMMER', 'C  CHAFF    F  FLARE'],
        ['SHIFT-F', 'DROP RESCUE POD'], ['SHIFT-E', 'EJECT'], ['V  OR KEYPAD ENTER', 'COCKPIT / CHASE VIEW'],
        ['B  OR SHIFT-KEYPAD ENTER', 'TOWER / SPOTTER VIEW'], ['[  AND  ]', 'ZOOM OUT / IN'],
        ['KEYPAD 4 6 2 1 7 8', 'LOOK L/R/BACK/DOWN/UP/FWD'], ['KEYPAD 5', 'LOCK THE HEAD POSITION'],
        ['Q AND E', 'LOOK LEFT / RIGHT, ORBIT'], ['P', 'PAUSE'], ['ESC  /  SHIFT-ESC', 'RESTART / BACK TO MENU'],
      ];
      rows.forEach(([k, v], i) => { g.text(k, 14, 32 + i * 8.5, C.G10, FONT_SMALL); g.text(v, 160, 32 + i * 8.5, C.GREEN, FONT_SMALL); });
      g.textC('TAB OR FIRE TO RETURN TO THE FLIGHT', 160, 202, C.YELLOW, FONT_SMALL);
    } else if (this.paused) {
      g.textC('PAUSED', 160, 84, C.WHITE, FONT_MENU, C.BLACK);
      g.textC('P TO RESUME   TAB FOR CONTROLS   SHIFT-ESC FOR MENU', 160, 98, C.G9, FONT_SMALL, C.BLACK);
    }
    if (this.endInfo) {
      const ok = this.endInfo.result === 'success';
      const y = 60;
      g.rect(30, y - 6, 260, 44, C.BLACK);
      g.rect(30, y - 6, 260, 1, ok ? C.GREEN : C.RED_L);
      g.rect(30, y + 37, 260, 1, ok ? C.GREEN : C.RED_L);
      g.textC(ok ? (this.spec.kind === 'qual' ? 'QUALIFIED' : 'MISSION COMPLETE') : (this.spec.kind === 'free' ? 'FLIGHT ENDED' : 'MISSION FAILED'), 160, y, ok ? C.GREEN : C.RED_L, FONT_MENU);
      g.textC(String(this.endInfo.text || '').slice(0, 40), 160, y + 16, C.G10, FONT_SMALL);
      g.textC(ok ? 'WELL FLOWN' : 'THE JET IS LOST', 160, y + 26, C.G7, FONT_SMALL);
    }
    // Training captions in the external view
    if (this.lesson && !cockpit && sim.message) { /* already shown in the data bar */ }
    if (sim.paused) return;
    // Tiny frame-rate chip when debugging
    if (this.game.showFps) g.text(`${this.game.fps.toFixed(0)} FPS S${g.S}`, 2, 2, C.YELLOW, FONT_SMALL, C.BLACK);
  }
}
