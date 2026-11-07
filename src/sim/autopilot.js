// Autopilot: closes the loop on a Jet's own attitude. It drives the real flight model through the
// same control inputs a pilot uses, so instructors and demo pilots fly genuine maneuvers.
import { Jet, MPS_PER_KT, G } from './jet.js';

const clamp = (x, a = -1, b = 1) => (x < a ? a : x > b ? b : x);
const wrapPi = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };

// Steers the nose toward world direction d (any length). Fills ctl, returns the off-boresight angle.
export function pointNose(j, dx, dy, dz, ctl, { gain = 1.6, maxPull = 1, rollGain = 2.4 } = {}) {
  const l = Math.hypot(dx, dy, dz) || 1;
  dx /= l; dy /= l; dz /= l;
  const ex = dx * j.rx + dy * j.ry + dz * j.rz;
  const ey = dx * j.ux + dy * j.uy + dz * j.uz;
  const ez = dx * j.fx + dy * j.fy + dz * j.fz;
  const ang = Math.atan2(Math.hypot(ex, ey), ez);
  if (ang < 0.025) {
    // Nearly on: wings-level behaviour with fine pitch trim
    const bank = j.bankDeg() * (Math.PI / 180);
    ctl.roll = clamp(-bank * 2 + ex * 6);
    ctl.pitch = clamp(ey * 12, -1, maxPull);
    return ang;
  }
  const rollErr = Math.atan2(ex, ey);
  // Target below and within ~55 degrees: push the nose over instead of rolling inverted and pulling
  if (ey < 0 && Math.abs(rollErr) > 2.2 && ang < 0.95) {
    ctl.roll = clamp(ex * 4);
    ctl.pitch = -clamp(ang * 0.9, 0, 0.45);
    return ang;
  }
  ctl.roll = clamp(rollErr * rollGain);
  const aligned = Math.abs(rollErr) < 0.55 || ang > 2.0;
  const pull = clamp(ang * gain, 0, maxPull);
  ctl.pitch = aligned ? pull : pull * 0.15;
  if (ey < 0 && Math.abs(rollErr) > 1.8) ctl.pitch = 0; // target below: roll first, don't pull away
  return ang;
}

// Ground-collision avoidance: if a pull-up started now would not clear the surface, take over:
// wings level by the shortest roll, then pull hard. Returns true while it has control.
export function groundAvoid(j, ctl, terrainH, margin = 260) {
  const v = Math.max(1, j.speed);
  const gam = Math.asin(clamp(j.vy / v));
  if (gam > 0.12) return false;
  const R = (v * v) / (G * 4.5);
  const loss = R * (1 - Math.cos(Math.min(1.5, Math.max(0, -gam)))) + v * 1.1;
  if (j.y - terrainH > loss + margin) return false;
  const bank = j.bankDeg() * (Math.PI / 180);
  ctl.roll = clamp(-bank * 2.5);
  ctl.pitch = Math.abs(bank) < 1.0 ? 1 : Math.abs(bank) < 1.7 ? 0.35 : 0;
  ctl.rudder = 0;
  j.throttle = Math.max(j.throttle, 0.8);
  return true;
}

export function holdAltitude(j, ctl, alt, opts) {
  const sp = Math.max(60, j.speed);
  const gamma = clamp((alt - j.y) / (sp * 6), -0.35, 0.35);
  const h = Math.hypot(j.fx, j.fz) || 1;
  return pointNose(j, (j.fx / h) * Math.cos(gamma), Math.sin(gamma), (j.fz / h) * Math.cos(gamma), ctl, opts);
}

export function holdHeading(j, ctl, headingRad, alt, opts) {
  const sp = Math.max(60, j.speed);
  const gamma = clamp((alt - j.y) / (sp * 6), -0.35, 0.35);
  return pointNose(j, Math.sin(headingRad) * Math.cos(gamma), Math.sin(gamma), Math.cos(headingRad) * Math.cos(gamma), ctl, opts);
}

const bankOf = (j) => j.bankDeg() * (Math.PI / 180);
const headingOf = (j) => Math.atan2(j.fx, j.fz);

// ---- Maneuvers: each is a generator that yields once per physics tick, writing ap.ctl ----

// Unwrapped pitch angle of the nose in the vertical plane of the initial heading. Robust against
// speed: a loop is finished when the nose has really travelled 360 degrees, not after a set time.
function pitchTrack(j) {
  const hl = Math.hypot(j.fx, j.fz) || 1;
  const h0x = j.fx / hl, h0z = j.fz / hl;
  let last = Math.atan2(j.fy, hl), total = 0;
  return {
    update() {
      const cur = Math.atan2(j.fy, j.fx * h0x + j.fz * h0z);
      total += wrapPi(cur - last);
      last = cur;
      return total;
    },
  };
}

// Gets to a comfortable entry speed, holding heading and altitude meanwhile.
function* setSpeed(ap, kts, ab = false) {
  const { j, ctl } = ap;
  for (let t = 0; t < 28; t += ap.dt) {
    const v = j.knots();
    if (Math.abs(v - kts) < 16) break;
    ap.power(v < kts ? 1 : 0.05, v < kts && ab);
    j.brake = v > kts + 25; // speed brakes bleed energy off quickly
    holdHeading(j, ctl, ap.heading, ap.alt);
    yield;
  }
  j.brake = false;
}

export const MANEUVERS = {
  'AILERON ROLL': function* (ap) {
    const { j, ctl } = ap;
    yield* setSpeed(ap, 350);
    ap.power(0.9, false);
    let acc = 0;
    while (acc < Math.PI * 2 - 0.3) {
      ctl.roll = 1; ctl.pitch = 0.04; ctl.rudder = 0;
      acc += Math.abs(j.p) * ap.dt;
      yield;
    }
  },
  'BREAK TURN': function* (ap) {
    const { j, ctl } = ap;
    yield* setSpeed(ap, 430, true);
    ap.power(1, true);
    while (Math.abs(bankOf(j)) < 1.3) { ctl.roll = 1; ctl.pitch = 0; yield; }
    let turned = 0, last = headingOf(j);
    while (turned < Math.PI - 0.35) {
      ctl.roll = clamp((1.38 - Math.abs(bankOf(j))) * 3) * Math.sign(bankOf(j) || 1);
      ctl.pitch = 0.92;
      const h = headingOf(j);
      turned += Math.abs(wrapPi(h - last));
      last = h;
      yield;
    }
    while (Math.abs(bankOf(j)) > 0.12) { ctl.roll = clamp(-bankOf(j) * 3); ctl.pitch = 0.15; yield; }
  },
  'INSIDE LOOP': function* (ap) {
    const { j, ctl } = ap;
    yield* setSpeed(ap, 420, true);
    ap.power(1, true);
    const pt = pitchTrack(j);
    while (pt.update() < Math.PI * 2 - 0.14) {
      ctl.pitch = j.speed < 85 ? 0.3 : 0.5;
      ctl.roll = clamp(j.ry * 2 * Math.sign(j.uy || 1), -0.25, 0.25); // keep the wings level to the horizon, upright or inverted
      yield;
    }
  },
  'SPLIT-S': function* (ap) {
    const { j, ctl } = ap;
    yield* setSpeed(ap, 300);
    ap.power(0.25, false);
    while (j.uy > -0.9) { ctl.roll = clamp((j.uy + 1.0) * 2.4, 0.1, 1); ctl.pitch = 0; yield; }
    const pt = pitchTrack(j);
    while (pt.update() > -(Math.PI - 0.14)) {
      ctl.pitch = 0.7;
      ctl.roll = clamp(j.ry * 2 * Math.sign(j.uy || 1), -0.25, 0.25);
      yield;
    }
  },
  'VERTICAL HALF-LOOP': function* (ap) {
    const { j, ctl } = ap;
    yield* setSpeed(ap, 440, true);
    ap.power(1, true);
    const pt = pitchTrack(j);
    while (pt.update() < Math.PI - 0.14) {
      ctl.pitch = j.speed < 85 ? 0.3 : 0.5;
      ctl.roll = clamp(j.ry * 2 * Math.sign(j.uy || 1), -0.25, 0.25);
      yield;
    }
    while (j.uy < 0.92) { ctl.roll = clamp((1.0 - j.uy) * 2.4, 0.1, 1); ctl.pitch = 0; yield; }
  },
  'BARREL ROLL': function* (ap) {
    const { j, ctl } = ap;
    yield* setSpeed(ap, 380);
    ap.power(0.9, false);
    let acc = 0, t = 0;
    while (acc < Math.PI * 2 - 0.35) {
      t += ap.dt;
      ctl.roll = 0.62;
      ctl.pitch = t < 1.9 ? 0.42 : t < 3.4 ? 0.12 : -0.05;
      acc += Math.abs(j.p) * ap.dt;
      yield;
    }
  },
  'INVERTED FLIGHT': function* (ap) {
    const { j, ctl } = ap;
    yield* setSpeed(ap, 320);
    ap.power(0.6, false);
    while (j.uy > -0.9) { ctl.roll = clamp((j.uy + 1.0) * 2.4, 0.1, 1); ctl.pitch = 0; yield; }
    for (let t = 0; t < 6; t += ap.dt) {
      ctl.roll = clamp(j.ry * 2 * Math.sign(j.uy || 1), -0.25, 0.25);
      ctl.pitch = 0;
      yield;
    }
    while (j.uy < 0.92) { ctl.roll = clamp((1.0 - j.uy) * 2.4, 0.1, 1); ctl.pitch = 0; yield; }
  },
};
export const MANEUVER_ORDER = ['AILERON ROLL', 'BREAK TURN', 'INSIDE LOOP', 'SPLIT-S', 'VERTICAL HALF-LOOP', 'BARREL ROLL', 'INVERTED FLIGHT'];

export class Autopilot {
  constructor(jet) {
    this.j = jet;
    this.ctl = { pitch: 0, roll: 0, rudder: 0 };
    this.dt = 1 / 60;
    this.gen = null;
    this.name = null;
    this.mode = 'level';
    this.heading = Math.atan2(jet.fx, jet.fz);
    this.alt = Math.max(1200, jet.y);
    this.cruiseThrottle = 0.8;
    this.onManeuverDone = null;
  }

  power(thr, ab = false) {
    const j = this.j;
    j.throttle = thr;
    j.afterburner = ab && thr >= 0.999;
  }

  start(name) {
    this.mt = 0;
    this.name = name;
    this.gen = MANEUVERS[name](this);
  }
  get busy() { return !!this.gen; }

  // Returns the control for this tick. Mode 'level' holds heading/altitude; maneuvers override it.
  step(dt) {
    this.dt = dt;
    const j = this.j, ctl = this.ctl;
    ctl.rudder = 0;
    if (this.gen) {
      this.mt = (this.mt || 0) + dt;
      if (this.mt > 85) { this.gen = null; this.name = null; this.heading = headingOf(j); this.power(this.cruiseThrottle, false); j.brake = false; this.mt = 0; return ctl; }
      const r = this.gen.next();
      if (r.done) {
        this.gen = null;
        const done = this.name;
        this.name = null;
        this.heading = headingOf(j);
        this.power(this.cruiseThrottle, false);
        if (this.onManeuverDone) this.onManeuverDone(done);
      }
      return ctl;
    }
    holdHeading(j, ctl, this.heading, this.alt);
    return ctl;
  }
}

// A flyable AI-controlled jet using the full flight model. `brain(jet, dt, sim)` returns ctl.
export class PilotedJet extends Jet {
  constructor(spec, modelName, brain) {
    super(spec, modelName);
    this.brain = brain;
    this.isPiloted = true;
    this.radar = true;
    this.hiddenInCockpit = false;
    this.name = this.spec.name;
  }
  step(dt, sim) {
    const ctl = this.brain ? this.brain(this, dt, sim) : { pitch: 0, roll: 0, rudder: 0 };
    super.step(dt, ctl, sim);
  }
  takeDamage(amount, sim, by) { super.takeDamage(amount, sim, by); }
}

// The instructor for training flights: takes off, flies straight and level, performs maneuvers on cue.
export class Instructor {
  constructor(jet) {
    this.j = jet;
    this.ap = new Autopilot(jet);
    this.state = 'takeoff';
    this.t = 0;
    this.queue = [];
    this.cruiseAlt = 4500;
    this.heading = Math.atan2(jet.fx, jet.fz);
    this.done = [];
    this.waiting = true;
  }
  brain() {
    return (j, dt) => {
      this.t += dt;
      const ap = this.ap;
      if (this.state === 'takeoff') {
        j.throttle = 0.8; j.afterburner = false;
        j.gearCmd = true;
        const ctl = ap.ctl;
        ctl.pitch = 0; ctl.roll = 0; ctl.rudder = 0;
        // Track the runway centreline on the ground
        if (j.onGround) {
          ctl.rudder = clamp(wrapPi(this.heading - headingOf(j)) * 2.5);
          if (j.speed / MPS_PER_KT > 195) ctl.pitch = 0.5;
        } else {
          holdHeading(j, ctl, this.heading, this.cruiseAlt, { maxPull: 0.55 });
          if (j.y > 60) j.gearCmd = false;
          if (j.y > this.cruiseAlt - 150 || this.t > 90) { this.state = 'fly'; ap.heading = this.heading; ap.alt = this.cruiseAlt; ap.power(0.8, false); }
        }
        return ctl;
      }
      if (!ap.busy && this.queue.length) ap.start(this.queue.shift());
      const ctl = ap.step(dt);
      if (!ap.busy) {
        // Steady cruise; a gentle turn-around keeps the show over the bay
        ap.alt = this.cruiseAlt;
        j.throttle = ap.cruiseThrottle; j.afterburner = false;
        if (j.speed / MPS_PER_KT > 560) j.throttle = 0.6;
      }
      return ctl;
    };
  }
  perform(name) { this.queue.push(name); }
  get busy() { return this.ap.busy || this.queue.length > 0; }
}
