// Flyable aircraft: aerodynamic forces with a fly-by-wire control law.
//
// Stick fore/aft commands load factor (as the real F/A-18's FCS does). Centred, the jet holds its
// flight path; pulled, it trades up to the g limit, alpha limit, and whatever lift it can make.
// Lateral stick commands roll rate. Rudder commands yaw rate against weathercock stability.
// When speed runs out, alpha hits its limit: the jet mushes, then drops its nose until flying.
export const MPS_PER_KT = 0.514444;
export const FT_PER_M = 3.28084;
export const G = 9.80665;

export const AIRCRAFT = {
  F18: {
    key: 'F18', name: 'F/A-18 HORNET', model: 'F18',
    mass: 12800, wingArea: 37.2, thrustMil: 96000, thrustAB: 142000,
    gMax: 7.5, gMin: -3, rollRate: 3.3, yawRate: 0.34, cla: 4.1, flapCL: 0.35,
    cd0: 0.021, k: 0.125, fuel: 22500, fuelBurn: [3.2, 16, 62], gearH: 2.3,
    guns: 570, aim9: 2, aim120: 4, chaff: 30, flares: 30, hasHook: true, eyeZ: 4.15, eyeY: 1.0,
  },
  F16: {
    key: 'F16', name: 'F-16 FALCON', model: 'F16',
    mass: 10500, wingArea: 27.9, thrustMil: 64000, thrustAB: 106000,
    gMax: 9, gMin: -3, rollRate: 4.4, yawRate: 0.3, cla: 4.2, flapCL: 0.3,
    cd0: 0.019, k: 0.13, fuel: 20000, fuelBurn: [2.6, 13, 58], gearH: 1.8,
    guns: 500, aim9: 2, aim120: 4, chaff: 30, flares: 30, hasHook: false, eyeZ: 3.3, eyeY: 1.0,
  },
};

// CLASSIC reproduces the 1988 feel: "accelerates like a missile", hugely effective rudder.
export const MODELS = {
  classic: { thrust: 1.3, drag: 0.85, rudder: 1.6, roll: 1.0, fuel: 1.0, machLimit: 1.8 },
  realistic: { thrust: 1.0, drag: 1.0, rudder: 0.35, roll: 1.0, fuel: 1.0, machLimit: 2.0 },
};

const ALPHA_STALL = 0.44;
const ALPHA_LIMIT = 0.5;
const CL_MAX_FLOOR = 0.55;

export const airDensity = (h) => 1.225 * Math.exp(-Math.max(0, h) / 8500);
export const soundSpeed = (h) => Math.max(295, 340.3 - 0.0039 * Math.max(0, h));

export class Jet {
  constructor(specKey, modelName = 'classic') {
    this.spec = AIRCRAFT[specKey];
    this.fm = MODELS[modelName];
    this.model = this.spec.model;
    this.castShadow = true;
    this.hiddenInCockpit = true;
    this.alive = true;
    this.side = 'blue';
    this.hp = 100;
    this.radius = 8;
    this.x = 0; this.y = 0; this.z = 0;
    this.vx = 0; this.vy = 0; this.vz = 0;
    this.rx = 1; this.ry = 0; this.rz = 0;
    this.ux = 0; this.uy = 1; this.uz = 0;
    this.fx = 0; this.fy = 0; this.fz = 1;
    this.p = 0; this.q = 0; this.r = 0;
    this.throttle = 0;
    this.afterburner = false;
    this.rpm = 0.25;
    this.engineOn = true;
    this.engineDamage = 0;
    this.fuel = this.spec.fuel;
    this.gearCmd = true;
    this.gear = 1;
    this.hook = false;
    this.brake = false;
    this.onGround = false;
    this.surfaceType = null;
    this.alpha = 0; this.beta = 0;
    this.gLoad = 1;
    this.speed = 0;
    this.mach = 0;
    this.stalled = false;
    this.overG = 0;
    this.groundPitch = 0;
    this.heading = 0;
    this.catapult = null;
    this.trap = null;
    this.stores = {
      aim9: this.spec.aim9, aim120: this.spec.aim120, gun: this.spec.guns,
      chaff: this.spec.chaff, flares: this.spec.flares, pod: 0,
    };
    this.lastContactVy = 0;
    this.smokeOn = false;
    this.bleedDamage = 0;
    this.hpDisplay = 100;
  }

  setPose(x, y, z, headingDeg, pitchDeg = 0, bankDeg = 0) {
    this.x = x; this.y = y; this.z = z;
    const h = (headingDeg * Math.PI) / 180, p = (pitchDeg * Math.PI) / 180, b = (bankDeg * Math.PI) / 180;
    const ch = Math.cos(h), sh = Math.sin(h), cp = Math.cos(p), sp = Math.sin(p), cb = Math.cos(b), sb = Math.sin(b);
    // forward from heading/pitch
    const fx = sh * cp, fy = sp, fz = ch * cp;
    // right vector, level, then rotated by bank
    const r0x = ch, r0y = 0, r0z = -sh;
    const u0x = -sh * sp, u0y = cp, u0z = -ch * sp;
    this.fx = fx; this.fy = fy; this.fz = fz;
    this.rx = r0x * cb - u0x * sb; this.ry = r0y * cb - u0y * sb; this.rz = r0z * cb - u0z * sb;
    this.ux = u0x * cb + r0x * sb; this.uy = u0y * cb + r0y * sb; this.uz = u0z * cb + r0z * sb;
    this.heading = headingDeg;
  }
  setVelocityForward(v) { this.vx = this.fx * v; this.vy = this.fy * v; this.vz = this.fz * v; this.speed = v; }

  headingDeg() { let h = (Math.atan2(this.fx, this.fz) * 180) / Math.PI; if (h < 0) h += 360; return h; }
  pitchDeg() { return (Math.asin(Math.max(-1, Math.min(1, this.fy))) * 180) / Math.PI; }
  bankDeg() { return (Math.atan2(-this.ry, this.uy) * 180) / Math.PI; }
  altitudeFt() { return this.y * FT_PER_M; }
  knots() { return this.speed / MPS_PER_KT; }

  hideParts() {
    const s = this.stores;
    const m = this._hide || (this._hide = {});
    m.ab = !this.afterburner || this.rpm < 0.9;
    m.gear = this.gear < 0.5;
    m.hook = !this.hook;
    m.store0 = s.aim9 < 1; m.store1 = s.aim9 < 2;
    m.store2 = s.aim120 < 1; m.store3 = s.aim120 < 2; m.store4 = s.aim120 < 3; m.store5 = s.aim120 < 4;
    return m;
  }

  _thrust(rho) {
    const spec = this.spec;
    if (!this.engineOn || this.fuel <= 0) return 0;
    const frac = Math.max(0, (this.rpm - 0.25) / 0.75);
    const base = this.afterburner && this.rpm > 0.9 ? spec.thrustAB : spec.thrustMil * (0.02 + 0.98 * Math.pow(frac, 1.3));
    const lapse = Math.pow(rho / 1.225, 0.72) * (1 + 0.42 * Math.min(2, this.mach));
    return base * lapse * this.fm.thrust * (1 - this.engineDamage * 0.7);
  }

  _engine(dt) {
    const spec = this.spec;
    const target = this.engineOn && this.fuel > 0 ? Math.max(0.25, this.throttle) : 0;
    const rate = target > this.rpm ? 0.42 : 0.55;
    this.rpm += Math.max(-rate * dt, Math.min(rate * dt, target - this.rpm));
    if (this.throttle < 0.999) this.afterburner = false;
    const burn = this.afterburner ? spec.fuelBurn[2] : spec.fuelBurn[0] + (spec.fuelBurn[1] - spec.fuelBurn[0]) * this.rpm * this.rpm;
    if (this.engineOn) this.fuel = Math.max(0, this.fuel - burn * this.fm.fuel * dt);
  }

  _dragCoef(cl, mach) {
    const s = this.spec;
    let cd0 = s.cd0;
    // Transonic drag rise
    if (mach > 0.82) cd0 += 0.024 * Math.min(1, (mach - 0.82) / 0.3);
    if (mach > 1.3) cd0 -= 0.006 * Math.min(1, (mach - 1.3) / 0.7);
    if (mach > this.fm.machLimit) cd0 += (mach - this.fm.machLimit) * 0.4;
    cd0 *= this.fm.drag;
    let cd = cd0 + s.k * cl * cl;
    if (this.gear > 0.05) cd += 0.03 * this.gear;
    if (this.brake && !this.onGround) cd += 0.075;
    return cd;
  }

  // ctl: {pitch: -1..1 (+ = pull), roll: -1..1 (+ = right), rudder: -1..1 (+ = right)}
  step(dt, ctl, sim) {
    if (!this.alive) return;
    this._engine(dt);
    // Gear transit takes about two seconds.
    const g = this.gearCmd ? 1 : 0;
    this.gear += Math.max(-dt * 0.5, Math.min(dt * 0.5, g - this.gear));
    if (this.catapult) this._stepCatapult(dt, sim);
    else if (this.trap) this._stepTrap(dt, sim);
    else if (this.onGround) this._stepGround(dt, ctl, sim);
    else this._stepAir(dt, ctl, sim);
    this.speed = Math.hypot(this.vx, this.vy, this.vz);
    this.mach = this.speed / soundSpeed(this.y);
  }

  _stepAir(dt, ctl, sim) {
    const spec = this.spec;
    const mass = spec.mass + this.fuel * 0.15;
    const rho = airDensity(this.y);
    let V = Math.hypot(this.vx, this.vy, this.vz);
    const Vs = Math.max(V, 1);
    const hx = this.vx / Vs, hy = this.vy / Vs, hz = this.vz / Vs;
    const vF = this.vx * this.fx + this.vy * this.fy + this.vz * this.fz;
    const vU = this.vx * this.ux + this.vy * this.uy + this.vz * this.uz;
    const vR = this.vx * this.rx + this.vy * this.ry + this.vz * this.rz;
    this.alpha = Math.atan2(-vU, Math.max(1, vF));
    this.beta = Math.atan2(vR, Math.max(1, vF));
    const qbar = 0.5 * rho * V * V;
    const qS = Math.max(1, qbar * spec.wingArea);
    const flaps = this.gear > 0.5 ? spec.flapCL : 0;
    const clAt = (a) => {
      // Linear to the stall, gently falling past it.
      const lim = ALPHA_STALL;
      if (a > lim) return Math.max(CL_MAX_FLOOR, spec.cla * lim - (a - lim) * 1.6) + flaps;
      if (a < -lim * 0.8) return -spec.cla * lim * 0.8 + flaps;
      return spec.cla * a + flaps;
    };
    const weightN = mass * G;
    const clMax = spec.cla * ALPHA_STALL + flaps;

    // --- Control law: stick commands load factor ---
    const upY = this.uy;
    // Centred stick: cancel gravity's normal component. A partial altitude-hold in banks makes
    // turns feel natural, at the original's forgiving level.
    let n1 = upY;
    if (upY > 0.25) n1 = upY + 0.6 * (1 / Math.max(upY, 0.4) - upY);
    const s = ctl.pitch;
    const limitG = this.hp < 40 ? Math.min(spec.gMax, 5) : spec.gMax;
    let nCmd = s >= 0 ? n1 + s * (limitG - n1) : n1 + -s * (spec.gMin - n1);
    if (nCmd > limitG) nCmd = limitG;
    if (nCmd < spec.gMin) nCmd = spec.gMin;
    const clCmd = (nCmd * weightN) / qS;
    const alphaCmd = Math.max(-0.35, Math.min(ALPHA_LIMIT, (clCmd - flaps) / spec.cla));
    const Vturn = Math.max(V, 45);
    const nReal = (clAt(this.alpha) * qS) / weightN;
    // Rate to hold alpha as the path curves, plus closing the alpha error.
    let qCmd = ((nReal - upY) * G) / Vturn + (alphaCmd - this.alpha) * 5.2;
    // Past the stall the nose drops decisively, as in the original's canned stall.
    this.stalled = (this.alpha > ALPHA_STALL && V < 130) || (V < 58 && this.gear < 0.5) || V < 45;
    if (this.stalled && V < 95) qCmd -= 0.4 * Math.min(1, (95 - V) / 35);
    // Elevator authority fades at very low dynamic pressure.
    const authority = Math.min(1, qbar / 1800 + 0.15);
    const qMax = 1.15;
    qCmd = Math.max(-qMax, Math.min(qMax, qCmd)) * authority;
    const lag = 1 - Math.exp(-dt / 0.09);
    this.q += (qCmd - this.q) * lag;

    // --- Roll ---
    const rollAuth = Math.min(1, qbar / 5200 + 0.12) * Math.max(0.35, 1 - Math.abs(this.alpha) * 1.1);
    const pCmd = ctl.roll * spec.rollRate * this.fm.roll * rollAuth * (this.hp < 40 ? 0.55 : 1);
    this.p += (pCmd - this.p) * (1 - Math.exp(-dt / 0.13));

    // --- Yaw: rudder against weathercock stability ---
    const yawAuth = Math.min(1, qbar / 3500 + 0.1);
    const rudderRate = ctl.rudder * spec.yawRate * this.fm.rudder * yawAuth;
    const kBeta = 2.3 * Math.min(1, qbar / 2200 + 0.12);
    const rCmd = rudderRate + this.beta * kBeta;
    this.r += (rCmd - this.r) * (1 - Math.exp(-dt / 0.2));

    // Stall and high-alpha buffet: a rough ride, not a loss of control.
    if (this.stalled || this.alpha > 0.34) {
      const amp = 0.07 * Math.min(1, (this.alpha - 0.3) * 6 + (this.stalled ? 0.6 : 0));
      this.q += (sim.random() - 0.5) * amp * dt * 14;
      this.p += (sim.random() - 0.5) * amp * dt * 14;
    }
    this._rotate(this.p * dt, this.q * dt, this.r * dt);

    // --- Forces ---
    const cl = clAt(this.alpha);
    const clamped = Math.max(-clMax * 0.6, Math.min(clMax, cl));
    const lift = clamped * qS;
    const cd = this._dragCoef(clamped, this.mach);
    const drag = cd * qS;
    const thrust = this._thrust(rho);

    // Lift perpendicular to velocity, in the plane of the up vector
    const dot = this.ux * hx + this.uy * hy + this.uz * hz;
    let lx = this.ux - dot * hx, ly = this.uy - dot * hy, lz = this.uz - dot * hz;
    const ll = Math.hypot(lx, ly, lz) || 1;
    lx /= ll; ly /= ll; lz /= ll;

    // Side force pulls the velocity toward the nose
    const sideC = 1.8 * this.beta;
    const side = -sideC * qS;
    const ax = (thrust * this.fx + lift * lx - drag * hx + side * this.rx) / mass;
    const ay = (thrust * this.fy + lift * ly - drag * hy + side * this.ry) / mass - G;
    const az = (thrust * this.fz + lift * lz - drag * hz + side * this.rz) / mass;
    this.vx += ax * dt; this.vy += ay * dt; this.vz += az * dt;
    this.x += this.vx * dt; this.y += this.vy * dt; this.z += this.vz * dt;

    // Accelerometer reading along the jet's up axis
    const measured = (lift * (lx * this.ux + ly * this.uy + lz * this.uz) + thrust * (this.fx * this.ux + this.fy * this.uy + this.fz * this.uz)) / (mass * G);
    this.gLoad += (measured - this.gLoad) * Math.min(1, dt * 8);
    if (this.gLoad > spec.gMax + 0.5) this.overG += dt;

    // Service ceiling: the air simply runs out, like the original's hard stop near 40,000 ft.
    if (this.y > 16000) { this.vy -= (this.y - 16000) * 0.02 * dt; }

    // --- Surface contact ---
    const surf = sim.surfaceUnder(this);
    const footH = this.gear > 0.95 ? spec.gearH : 1.2;
    if (this.y - footH <= surf.y) this._touchdown(surf, sim);
    else if (surf.hookZone && this.hook) this._tryHook(surf, sim);
  }

  _rotate(dPitch, dRoll_q, dYaw_r) {
    // Arguments are: roll (about forward), pitch (about right), yaw (about up).
    const dRoll = dPitch, dP = dRoll_q, dY = dYaw_r;
    let { rx, ry, rz, ux, uy, uz, fx, fy, fz } = this;
    // Pitch: nose toward up
    let c = Math.cos(dP), s = Math.sin(dP);
    let nfx = fx * c + ux * s, nfy = fy * c + uy * s, nfz = fz * c + uz * s;
    let nux = ux * c - fx * s, nuy = uy * c - fy * s, nuz = uz * c - fz * s;
    fx = nfx; fy = nfy; fz = nfz; ux = nux; uy = nuy; uz = nuz;
    // Yaw: nose toward right
    c = Math.cos(dY); s = Math.sin(dY);
    nfx = fx * c + rx * s; nfy = fy * c + ry * s; nfz = fz * c + rz * s;
    let nrx = rx * c - fx * s, nry = ry * c - fy * s, nrz = rz * c - fz * s;
    fx = nfx; fy = nfy; fz = nfz; rx = nrx; ry = nry; rz = nrz;
    // Roll: right wing down
    c = Math.cos(dRoll); s = Math.sin(dRoll);
    nrx = rx * c - ux * s; nry = ry * c - uy * s; nrz = rz * c - uz * s;
    nux = ux * c + rx * s; nuy = uy * c + ry * s; nuz = uz * c + rz * s;
    rx = nrx; ry = nry; rz = nrz; ux = nux; uy = nuy; uz = nuz;
    // Re-orthonormalise (Gram-Schmidt)
    let l = Math.hypot(fx, fy, fz);
    fx /= l; fy /= l; fz /= l;
    let d = ux * fx + uy * fy + uz * fz;
    ux -= d * fx; uy -= d * fy; uz -= d * fz;
    l = Math.hypot(ux, uy, uz);
    ux /= l; uy /= l; uz /= l;
    d = rx * fx + ry * fy + rz * fz;
    rx -= d * fx; ry -= d * fy; rz -= d * fz;
    d = rx * ux + ry * uy + rz * uz;
    rx -= d * ux; ry -= d * uy; rz -= d * uz;
    l = Math.hypot(rx, ry, rz);
    rx /= l; ry /= l; rz /= l;
    this.rx = rx; this.ry = ry; this.rz = rz;
    this.ux = ux; this.uy = uy; this.uz = uz;
    this.fx = fx; this.fy = fy; this.fz = fz;
  }

  _touchdown(surf, sim) {
    const spec = this.spec;
    const gearOk = this.gear > 0.95;
    const sink = -this.vy;
    const bank = Math.abs(this.bankDeg()), pitch = this.pitchDeg();
    this.lastContactVy = sink;
    if (surf.type === 'sea') return sim.crash(this, 'WATER');
    if (surf.type === 'hill') return sim.crash(this, 'TERRAIN');
    if (!gearOk) return sim.crash(this, surf.onDeck ? 'BELLY LANDING ON DECK' : 'WHEELS UP');
    const sinkLimit = surf.onDeck ? 11 : 7.5;
    if (sink > sinkLimit) return sim.crash(this, 'HARD LANDING');
    if (bank > 26 || pitch < -7 || pitch > 24) return sim.crash(this, 'BAD ATTITUDE');
    // Good touchdown: settle on the wheels.
    this.y = surf.y + spec.gearH;
    this.vy = 0;
    this.onGround = true;
    this.surfaceType = surf.type;
    this.surfaceRef = surf.ref || null;
    this.groundPitch = pitch * (Math.PI / 180);
    sim.emit('touchdown', { sink, onDeck: !!surf.onDeck, type: surf.type });
    if (surf.onDeck && this.hook) this._tryHook(surf, sim, true);
  }

  _tryHook(surf, sim, contact = false) {
    if (!surf.ref) return;
    const wire = surf.ref.wireCrossed(this, contact);
    if (wire) {
      this.trap = { carrier: surf.ref, wire, t: 0, v0: this.speedRelative(surf.ref) };
      this.onGround = true;
      this.y = surf.y + this.spec.gearH;
      this.vy = 0;
      sim.emit('trap', { wire, sink: this.lastContactVy, carrier: surf.ref });
    }
  }

  speedRelative(c) {
    return Math.hypot(this.vx - c.vx, this.vz - c.vz);
  }

  _setLevelBasis(pitch) {
    // Rebuild orientation from the current heading, at wings level, with the given pitch.
    const h = Math.atan2(this.fx, this.fz);
    const ch = Math.cos(h), sh = Math.sin(h), cp = Math.cos(pitch), sp = Math.sin(pitch);
    this.fx = sh * cp; this.fy = sp; this.fz = ch * cp;
    this.rx = ch; this.ry = 0; this.rz = -sh;
    this.ux = -sh * sp; this.uy = cp; this.uz = -ch * sp;
    this.p = 0; this.q = 0; this.r = 0;
  }

  _stepGround(dt, ctl, sim) {
    const spec = this.spec;
    const surf = sim.surfaceUnder(this);
    const ref = surf.onDeck ? surf.ref : null;
    const svx = ref ? ref.vx : 0, svz = ref ? ref.vz : 0;
    // Rolled off the deck edge or the land's end
    if (this.surfaceRef && !surf.onDeck) { this.onGround = false; this.surfaceRef = null; return; }
    if (surf.type === 'sea') return sim.crash(this, 'WATER');
    if (surf.type === 'hill' && this.speed > 30) return sim.crash(this, 'TERRAIN');

    const rho = airDensity(this.y);
    const mass = spec.mass + this.fuel * 0.15;
    // Relative speed along the nose
    const hx = this.fx, hz = this.fz;
    const hl = Math.hypot(hx, hz) || 1;
    const ax = hx / hl, az = hz / hl;
    const rvx = this.vx - svx, rvz = this.vz - svz;
    let V = rvx * ax + rvz * az;

    // Steering: nosewheel at taxi speed, rudder as it comes alive.
    const steer = (ctl.rudder + ctl.roll * 0.7) * (Math.abs(V) < 25 ? 0.75 : 0.75 / (1 + (Math.abs(V) - 25) * 0.05)) * Math.min(1, Math.abs(V) / 5);
    const dYaw = steer * dt;
    const c = Math.cos(dYaw), s = Math.sin(dYaw);
    const nfx = ax * c + az * s, nfz = az * c - ax * s;
    const h = Math.atan2(nfx, nfz);

    // Forward stick and rotation. Nose comes up above rotation speed.
    const flaps = this.gear > 0.5 ? spec.flapCL : 0;
    const q = 0.5 * rho * V * V * spec.wingArea;
    const liftAtPitch = (spec.cla * Math.max(0, this.groundPitch) + flaps) * q;
    const rotateFloor = 0.62 * Math.sqrt((2 * mass * G) / (rho * spec.wingArea * (spec.cla * 0.2 + flaps)));
    let pitchRate;
    if (ctl.pitch > 0.2 && V > rotateFloor) pitchRate = 0.24 * ctl.pitch;
    else pitchRate = -0.32;
    this.groundPitch = Math.max(0, Math.min(0.28, this.groundPitch + pitchRate * dt));

    // Longitudinal forces
    const thrust = this._thrust(rho);
    const cd = this._dragCoef(0.3, 0.1);
    const drag = cd * q + (ref ? 0 : 0);
    const weightOnWheels = Math.max(0, mass * G - liftAtPitch);
    const rolling = 0.02 * weightOnWheels * Math.sign(V);
    let brake = 0;
    if (this.brake) brake = Math.min(Math.abs(V) * mass * 4, 0.42 * weightOnWheels) * Math.sign(V);
    const a = (thrust - drag * Math.sign(V) - rolling - brake) / mass;
    V += a * dt;
    if (Math.abs(V) < 0.05 && thrust < rolling + 1) V = 0;

    this.vx = Math.sin(h) * V + svx;
    this.vz = Math.cos(h) * V + svz;
    this.vy = 0;
    this.x += this.vx * dt;
    this.z += this.vz * dt;
    this.y = surf.y + spec.gearH;

    // Rebuild attitude: heading h, pitch from rotation
    this.fx = Math.sin(h); this.fz = Math.cos(h); this.fy = 0;
    this._setLevelBasis(this.groundPitch);
    this.alpha = this.groundPitch;
    this.beta = 0;
    this.gLoad = 1;
    this.stalled = false;
    this.surfaceType = surf.type;

    // Lift-off
    if (liftAtPitch > mass * G * 1.02 && this.groundPitch > 0.03) {
      this.onGround = false;
      this.surfaceRef = null;
      this.vy = 0.6;
      this.vx = this.fx * V + svx;
      this.vz = this.fz * V + svz;
      sim.emit('liftoff', {});
    }

    // Hook drag on the deck
    if (this.hook && surf.hookZone) this._tryHook(surf, sim, true);
  }

  // Catapult: the shuttle drags the jet down the bow track, then releases at flying speed.
  _stepCatapult(dt, sim) {
    const cat = this.catapult;
    const ship = cat.carrier;
    cat.t += dt;
    // Tensioned and waiting for military power
    if (!cat.fired) {
      ship.placeOnCatapult(this, 0);
      if (this.throttle >= 0.8 && this.rpm >= 0.72) {
        cat.hold = (cat.hold || 0) + dt;
        if (cat.hold > 0.55) {
          cat.fired = true;
          cat.s = 0; cat.v = 0;
          sim.emit('catapult', {});
        }
      }
      this.speed = 0;
      return;
    }
    const stroke = ship.catapultStroke();
    const launch = 84; // m/s over the deck, about 165 knots
    const accel = (launch * launch) / (2 * stroke);
    cat.v += accel * dt;
    cat.s += cat.v * dt;
    ship.placeOnCatapult(this, cat.s, cat.v);
    if (cat.s >= stroke) {
      // Release. A slight nose-up attitude, flying speed, climbing away.
      this.catapult = null;
      this.onGround = false;
      this.groundPitch = 0;
      this.surfaceRef = null;
      this._setLevelBasis(0.15);
      this.vy = 2.5;
      sim.emit('catshot', {});
    }
  }

  _stepTrap(dt, sim) {
    const t = this.trap;
    const c = t.carrier;
    t.t += dt;
    // The wire's arrest is a near-constant deceleration of about 4 g.
    const decel = 42;
    const rvx = this.vx - c.vx, rvz = this.vz - c.vz;
    const v = Math.hypot(rvx, rvz);
    const nv = Math.max(0, v - decel * dt);
    if (v > 0.001) {
      this.vx = c.vx + (rvx / v) * nv;
      this.vz = c.vz + (rvz / v) * nv;
    }
    this.x += this.vx * dt;
    this.z += this.vz * dt;
    this.groundPitch = Math.max(0, this.groundPitch - dt * 0.9);
    this._setLevelBasis(this.groundPitch);
    this.vy = 0;
    if (nv <= 0) {
      this.trap = null;
      this.onGround = true;
      this.surfaceRef = c;
      this.hook = false;
      sim.emit('trapped', { wire: t.wire, carrier: c });
    }
  }

  takeDamage(amount, sim, cause = '') {
    if (this.invulnerable) return;
    this.hp -= amount;
    if (this.hp < 60 && sim.random() < 0.5) this.engineDamage = Math.max(this.engineDamage, 0.4);
    if (this.hp <= 0) sim.crash(this, cause || 'SHOT DOWN');
  }
}
