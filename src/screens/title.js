// The title sequence: a short film cut to "Bay Patrol". Each shot is a real simulation scene
// (flown by autopilots) so everything on screen is the actual game engine.
import { Sim } from '../sim/sim.js';
import { Autopilot, holdHeading, pointNose } from '../sim/autopilot.js';
import { LandingPilot } from '../sim/landing.js';
import { AIPlane } from '../sim/ai.js';
import { orbitCamera, trackingCamera } from '../render/camera.js';
import { LANDMARKS, toWorld, CARRIER_START } from '../world/geo.js';
import { DECK_Y } from '../gfx/models.js';
import { C } from '../gfx/palette.js';
import { FONT_SMALL } from '../gfx/fonts.js';
import { MENU_FONT, bigText, bigWidth, LOGO_RAMP, blink, typed } from '../ui/widgets.js';

// The film is cut to the music's bar grid: six shots of 4, 8, 8, 8, 8 and 4 bars, 40 bars in all.
const SCENE_BARS = [4, 8, 8, 8, 8, 4];
export const sceneLengths = (bpm) => SCENE_BARS.map((b) => (b * 240) / bpm);
export const titleLoopSeconds = (bpm) => sceneLengths(bpm).reduce((a, b) => a + b, 0);

const rad = (d) => (d * Math.PI) / 180;
const lerp = (a, b, t) => a + (b - a) * t;

function newSim(world, seed) {
  const sim = new Sim({ world, seed });
  return sim;
}
function immortal(j) { j.hp = 1e9; j.invulnerable = true; }

// ---- scene builders: return { sim, camera(t), caption, update(t, dt) } ----
function sceneFlyby(world) {
  const sim = newSim(world, 11);
  const s = LANDMARKS.goldenGate.s, n = LANDMARKS.goldenGate.n;
  const mid = [(s[0] + n[0]) / 2, (s[1] + n[1]) / 2];
  const speed = 300;
  const j = sim.spawnPlayerAir(mid[0] - speed * 4.4, 52, mid[1] + 40, 90, speed);
  immortal(j);
  j.throttle = 1; j.afterburner = true; j.gearCmd = false; j.gear = 0;
  const ap = new Autopilot(j); ap.heading = rad(90); ap.alt = 52;
  let tt = 0;
  sim.autopilotCtl = (dt) => { tt += dt; if (tt > 4.9) ap.alt = 2600; j.throttle = 1; j.afterburner = true; return ap.step(dt); };
  const camPos = [mid[0] - speed * 4.4 + speed * 3.2, 58, mid[1] - 150];
  return {
    sim, caption: 'THE 1988 AMIGA CLASSIC, REBUILT FROM SCRATCH',
    camera: (t) => (t < 4.9
      ? trackingCamera(camPos, j, lerp(1.3, 2.4, Math.min(1, t / 5)))
      // after the pass, cut behind the jet as it pulls up over the bay
      : orbitCamera(j, 44, 0.12, 0.1 + (t - 4.9) * 0.012, 1.0)),
  };
}

function sceneOrbit(world) {
  const sim = newSim(world, 12);
  // Over the water between the Embarcadero and Yerba Buena Island, flying north with the skyline to port.
  const [x, z] = toWorld(37.772, -122.352);
  const j = sim.spawnPlayerAir(x, 330, z, 352, 215);
  immortal(j);
  j.gearCmd = false; j.gear = 0;
  const ap = new Autopilot(j); ap.heading = rad(352); ap.alt = 330;
  sim.autopilotCtl = (dt) => { j.throttle = 0.5; return ap.step(dt); };
  return {
    sim, caption: 'ORIGINAL GAME BY BOB DINNERMAN, INTELLISOFT / ELECTRONIC ARTS',
    camera: (t) => orbitCamera(j, lerp(70, 46, t / 20), lerp(-1.25, -2.15, t / 20), 0.1 + 0.05 * Math.sin(t * 0.35), 1.0),
  };
}

function sceneGate(world) {
  const sim = newSim(world, 13);
  const start = toWorld(37.8228, -122.428);
  const j = sim.spawnPlayerAir(start[0], 46, start[1], 271, 255);
  immortal(j);
  j.gearCmd = false; j.gear = 0;
  const ap = new Autopilot(j); ap.heading = rad(271); ap.alt = 46;
  sim.autopilotCtl = (dt) => { j.throttle = 0.8; j.afterburner = false; return ap.step(dt); };
  return {
    sim, caption: 'THE REAL SAN FRANCISCO BAY, FROM SURVEY ELEVATION DATA',
    camera: (t) => orbitCamera(j, lerp(36, 52, t / 20), 0.12 * Math.sin(t * 0.5), 0.1 + 0.05 * Math.sin(t * 0.4), 1.0),
  };
}

function sceneFight(world) {
  const sim = newSim(world, 14);
  // Just inside the Golden Gate, flying west toward the bridge: headlands and towers frame the shot.
  const hs = toWorld(37.8265, -122.405);
  const ms = toWorld(37.8262, -122.441);
  const j = sim.spawnPlayerAir(hs[0], 380, hs[1], 270, 285);
  immortal(j);
  j.gearCmd = false; j.gear = 0;
  const mig = new AIPlane('MIG', ms[0], 410, ms[1], 270, 235);
  mig.name = 'MIG-29';
  mig.brain = (p) => { p.des.psi = rad(270); p.des.speed = 235; p.des.y = 410; };
  mig.lowFlyer = true;
  sim.add(mig);
  sim.selected = 'aim9'; sim.target = mig; sim.weaponsSafe = false;
  const ctl = { pitch: 0, roll: 0, rudder: 0 };
  const st = { fired: false, hitT: -1, lastPos: [mig.x, mig.y, mig.z], sidePos: null };
  sim.autopilotCtl = () => {
    if (st.hitT >= 0 && sim.time - st.hitT > 6) { j.throttle = 0.9; holdHeading(j, ctl, rad(300), 420); return ctl; }
    const dx = mig.x - j.x, dy = mig.y - j.y, dz = mig.z - j.z;
    pointNose(j, dx + mig.vx * 2, dy, dz + mig.vz * 2, ctl, { maxPull: 0.5 });
    j.throttle = 1; j.afterburner = true;
    if (sim.locked && !st.fired) {
      st.fired = true; sim.fireWeapon(true);
      // A fixed camera on the south side of the intercept: the missile streaks in from the east
      st.sidePos = [mig.x + mig.vx * 6.1, mig.y - 14, mig.z + mig.vz * 6.1 - 120];
    }
    return ctl;
  };
  return {
    sim, caption: 'AMIGA PAULA SOUND CHIP, EMULATED SAMPLE FOR SAMPLE',
    update() {
      if (mig.dying || !mig.alive) { if (st.hitT < 0) st.hitT = sim.time; }
      if (mig.alive) st.lastPos = [mig.x, mig.y, mig.z];
    },
    camera: (t) => {
      const m = sim.lastLaunched;
      if (!st.fired || t < 1.8) return orbitCamera(j, 34, 2.55, 0.12, 1.0);
      if (st.hitT < 0) {
        // frame the missile and its target together as they close
        const a = m && m.alive ? m : mig;
        const mid = { x: (a.x + mig.x) / 2, y: (a.y + mig.y) / 2, z: (a.z + mig.z) / 2 };
        const range = Math.hypot(a.x - mig.x, a.y - mig.y, a.z - mig.z);
        return trackingCamera(st.sidePos, mid, Math.max(1.6, Math.min(4.2, 2600 / Math.max(300, range + 300))));
      }
      if (sim.time - st.hitT < 5.5) {
        const tgt = mig.alive ? mig : { x: st.lastPos[0], y: st.lastPos[1], z: st.lastPos[2], fx: 0.3, fz: 1 };
        return orbitCamera(tgt, 150, 0.9 + (sim.time - st.hitT) * 0.45, 0.16, 1.0);
      }
      return orbitCamera(j, 52, 0.5 + (t - 12) * 0.1, 0.14, 1.0);
    },
  };
}

function sceneCarrier(world) {
  const sim = newSim(world, 15);
  const car = sim.addCarrier();
  const [ox, oz] = car.rampWorld(), [dx, dz] = car.landingDir();
  const a0 = -1500;
  const j = sim.spawnPlayerAir(ox + dx * a0, DECK_Y + -a0 * Math.tan(rad(3.5)) + 1.5, oz + dz * a0, car.landingHeading(), 82);
  immortal(j);
  j.vx += car.vx; j.vz += car.vz;
  j.gearCmd = true; j.gear = 1; j.hook = true;
  const lp = new LandingPilot(j, 'carrier', car);
  lp.state = 'final';
  sim.autopilotCtl = (dt) => lp.step(dt, sim);
  return {
    sim, caption: 'CARRIER LANDINGS: CATCH A WIRE, OR GO AROUND',
    camera: (t) => {
      // On the port sponson beside the wires, looking aft: the jet grows from a speck to a roaring pass
      const [wx, wz] = car.toWorld(-46, -96);
      return trackingCamera([wx, car.deckY + 2.6, wz], j, lerp(1.5, 1.3, Math.min(1, t / 19)));
    },
  };
}

function sceneLaunch(world) {
  const sim = newSim(world, 16);
  const car = sim.addCarrier();
  const j = sim.spawnPlayerCarrier('F18');
  immortal(j);
  j.throttle = 1; j.afterburner = true;
  const ap = new Autopilot(j); ap.heading = Math.atan2(car.fx, car.fz); ap.alt = 400;
  sim.autopilotCtl = () => { j.throttle = 1; j.afterburner = true; return ap.step(1 / 60); };
  return {
    sim, caption: '',
    camera: (t) => {
      const [wx, wz] = car.toWorld(-14, 70);
      return trackingCamera([wx, car.deckY + 3, wz], j, lerp(1.2, 2.2, Math.min(1, t / 6)));
    },
  };
}

const BUILDERS = [sceneFlyby, sceneOrbit, sceneGate, sceneFight, sceneCarrier, sceneLaunch];

// ---------------------------------------------------------------------------------
export class TitleScreen {
  constructor(game) {
    this.game = game;
    this.touchUI = 'tap';
    this.t = 0;
    this.sceneIdx = -1;
    this.sceneT = 0;
    this.scene = null;
    this.flash = 0;
    this.leaving = 0;
    this.acc = 0;
    this.shake = 0;
    this.lengths = sceneLengths(game.titleBpm);
  }

  enter() {
    this.game.startTitleMusic();
    this.nextScene(0);
  }

  // The theme was changed: cut the film to the new tune's tempo and start both from the top.
  restartFilm() {
    this.lengths = sceneLengths(this.game.titleBpm);
    this.nextScene(0);
  }

  nextScene(i) {
    this.sceneIdx = i % BUILDERS.length;
    this.sceneT = 0;
    this.acc = 0;
    this.scene = BUILDERS[this.sceneIdx](this.game.world);
    if (this.sceneIdx === 0) { this.game.sfx.flyby(0.95); this.t = 0; this.flash = 1; this.shake = 1; this.game.startTitleMusic(true); }
    if (this.sceneIdx === 3) this.shake = 0;
  }

  update(dt) {
    const g = this.game, inp = g.input;
    this.t += dt;
    this.sceneT += dt;
    this.flash = Math.max(0, this.flash - dt * 1.6);
    this.shake = Math.max(0, this.shake - dt * 1.4);
    // advance the shot at its musical boundary
    if (this.sceneT >= this.lengths[this.sceneIdx]) this.nextScene(this.sceneIdx + 1);
    const sim = this.scene.sim;
    this.acc += Math.min(dt, 0.1);
    while (this.acc >= 1 / 60) {
      sim.step(1 / 60, { pitch: 0, roll: 0, rudder: 0 });
      this.acc -= 1 / 60;
      if (this.scene.update) this.scene.update(this.sceneT);
    }
    sim.events.length = 0;
    g.fade = this.leaving > 0 ? Math.max(0, 1 - this.leaving / 0.7) : Math.min(1, this.t / 0.5 + (this.sceneIdx === 0 ? 0 : 1));
    g.whiteFlash = this.flash * 0.75;
    if (this.leaving > 0) { this.leaving += dt; if (this.leaving > 0.7) { g.fade = 1; g.toMenu(); } }
    else if (this.t > 1.0 && (inp.pressed('Space') || inp.pressed('Enter') || inp.pressed('NumpadEnter') || inp.pressed('Escape'))) {
      this.leaving = 0.001;
      g.sfx.ui('select');
    }
  }

  leave() { this.game.fade = 1; this.game.flash = 0; this.game.whiteFlash = 0; }

  render(g) {
    const sc = this.game.scene;
    const cam = this.scene.camera(this.sceneT);
    if (this.shake > 0) {
      const s = this.shake * 0.7;
      cam.x += (Math.sin(this.t * 71) * s); cam.y += (Math.sin(this.t * 53 + 1) * s);
    }
    sc.render(cam, 256, this.scene.sim, 128, { cockpit: false });
    g.setClip(0, 0, 320, 256);
    // letterbox, as in the original's cover shots
    g.rect(0, 0, 320, 14, C.BLACK);
    g.rect(0, 242, 320, 14, C.BLACK);
    // logo: big slam in the intro, small afterwards
    const t = this.sceneT;
    if (this.sceneIdx === 0) {
      const k = Math.min(1, t / 0.35);
      const s = 3;
      const y0 = 22 - (1 - k) * 40;
      bigText(g, 'F/A-18', 24, y0, s, LOGO_RAMP, { shear: 0.28, pitch: 24 });
      bigText(g, 'INTERCEPTOR', 24, y0 + 30, s, LOGO_RAMP, { shear: 0.28, pitch: 24 });
    } else if (this.sceneIdx === 5 || this.sceneT < 1.2) {
      bigText(g, 'F/A-18 INTERCEPTOR', 14, 17, 1.5, LOGO_RAMP, { shear: 0.28, shadowOff: 1, pitch: 16 });
    } else {
      g.text('F/A-18 INTERCEPTOR', 8, 4, C.ORANGE, MENU_FONT, C.BLACK);
    }
    if (this.scene.caption) {
      const txt = typed(this.scene.caption, Math.max(0, t - 0.8), 40);
      g.textC(txt, 160, 231, C.G10, FONT_SMALL, C.BLACK);
    }
    if (this.t > 2 && blink(this.t, 1.4)) g.textC('PRESS FIRE', 160, 246, C.WHITE, FONT_SMALL, C.BLACK);
  }
}
