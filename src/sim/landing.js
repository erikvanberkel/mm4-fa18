// A landing pilot for the real flight model: flies a glideslope to the carrier's angled deck or a
// runway. Used by the demo mode and by tests that check carrier traps and runway landings.
import { LANDING, DECK_Y } from '../gfx/models.js';
import { pointNose } from './autopilot.js';

const clamp = (x, a = -1, b = 1) => (x < a ? a : x > b ? b : x);
const DEG = Math.PI / 180;

// Aims the NOSE so that the flight PATH heads along `d` (alpha is the difference between them).
function steerPath(j, d, ctl, opts) {
  const sp = Math.max(30, j.speed);
  const vx = j.vx / sp, vy = j.vy / sp, vz = j.vz / sp;
  const l = Math.hypot(d[0], d[1], d[2]) || 1;
  const tx = d[0] / l + (j.fx - vx), ty = d[1] / l + (j.fy - vy), tz = d[2] / l + (j.fz - vz);
  return pointNose(j, tx, ty, tz, ctl, opts);
}

export class LandingPilot {
  // kind 'carrier': target = Carrier. kind 'runway': target = {runway, end:'a'|'b'}
  constructor(jet, kind, target, opts = {}) {
    this.j = jet;
    this.kind = kind;
    this.t = target;
    this.ctl = { pitch: 0, roll: 0, rudder: 0 };
    this.state = 'join';
    this.speed = opts.speed || (kind === 'carrier' ? 78 : 74);
    this.glide = (kind === 'carrier' ? 3.5 : 3.0) * DEG;
    this.done = false;
    this.log = null;
  }

  // Frame of the landing surface: origin (threshold/ramp), unit direction of landing roll,
  // and which way is "right of the centreline".
  frame() {
    if (this.kind === 'carrier') {
      const c = this.t;
      const [ox, oz] = c.rampWorld();
      const [dx, dz] = c.landingDir();
      return { ox, oz, dx, dz, vx: c.vx, vz: c.vz, floorY: DECK_Y, aimA: LANDING.wires[2], halfW: LANDING.halfWidth };
    }
    const { runway, end } = this.t;
    const s = end === 'a' ? 1 : -1;
    const o = end === 'a' ? runway.a : runway.b;
    return { ox: o[0], oz: o[1], dx: runway.ux * s, dz: runway.uz * s, vx: 0, vz: 0, floorY: 0, aimA: 320, halfW: runway.width / 2 };
  }

  step(dt, sim) {
    const j = this.j, ctl = this.ctl, f = this.frame();
    // Position in the landing frame: a = along (0 at threshold), b = right of centreline
    const px = j.x - f.ox, pz = j.z - f.oz;
    const a = px * f.dx + pz * f.dz;
    const b = px * f.dz - pz * f.dx;
    const rvx = j.vx - f.vx, rvz = j.vz - f.vz;
    const hSpeed = Math.hypot(rvx, rvz);
    const heightAbove = j.y - j.spec.gearH - f.floorY;
    ctl.rudder = 0;
    this.a = a; this.b = b; this.h = heightAbove;

    if (this.state === 'join') {
      // Fly to a point 5.5 km astern on the extended centreline, 290 m up.
      const ipA = -5500;
      const ipX = f.ox + f.dx * ipA + f.dz * 0, ipZ = f.oz + f.dz * ipA;
      const hy = f.floorY + 290;
      const tx = ipX + f.vx * 0, tz = ipZ + f.vz * 0;
      steerPath(j, [tx - j.x, hy - j.y, tz - j.z], ctl, { maxPull: 0.7 });
      j.throttle = clamp(0.5 + (110 - j.speed) * 0.05, 0.05, 1);
      j.afterburner = false;
      j.gearCmd = j.gear < 0.99 ? true : j.gearCmd;
      if (Math.hypot(tx - j.x, tz - j.z) < 1600 || a > -5600 && a < -1500 && Math.abs(b) < 500) { this.state = 'final'; }
      if (hSpeed > 100) j.brake = true; else j.brake = false;
      if (j.speed < 95) { j.gearCmd = true; j.hook = this.kind === 'carrier'; }
      return ctl;
    }

    if (this.state === 'final') {
      j.gearCmd = true;
      j.hook = this.kind === 'carrier';
      j.brake = false;
      // Lateral: converge on the centreline, heading = deck heading corrected by offset
      const deckHdg = Math.atan2(f.dx, f.dz);
      const corr = clamp(-b / Math.max(300, -a * 1.1), -0.22, 0.22);
      const hdg = deckHdg + corr;
      // Vertical: glideslope toward the aim point
      const ahead = this.aimAhead(a);
      const desH = Math.max(0, (f.aimA - a) * Math.tan(this.glide));
      const err = heightAbove - desH;
      let gamma = -this.glide - clamp(err * 0.012, -0.05, 0.05);
      if (a > -60 && this.kind === 'runway') gamma = Math.max(gamma, -1.2 * DEG);
      const cg = Math.cos(gamma);
      steerPath(j, [Math.sin(hdg) * cg, Math.sin(gamma), Math.cos(hdg) * cg], ctl, { gain: 2.2, maxPull: 0.6, rollGain: 2.0 });
      // Speed: approach speed relative to the ship, throttle trim plus power-off at touchdown
      const target = this.speed + (hSpeed - j.speed) * 0 + f.vz * 0;
      j.throttle = clamp(0.42 + (target - hSpeed) * 0.07 + (err > 0 ? 0.0 : 0.04), 0.05, 1);
      j.afterburner = false;
      void ahead;
      if (this.kind === 'runway' && heightAbove < 7 && a > f.aimA - 150) { j.throttle = 0.05; }
      if (j.onGround || j.trap) this.state = 'rollout';
      return ctl;
    }

    // rollout: on the wire, full power as bolter insurance; once stopped, idle and brakes
    j.throttle = j.trap ? 1 : 0.05;
    j.afterburner = false;
    if (!j.trap && this.kind === 'carrier') j.brake = true;
    ctl.pitch = 0; ctl.roll = 0;
    const deckHdg = Math.atan2(f.dx, f.dz);
    const h = Math.atan2(j.fx, j.fz);
    let dh = deckHdg - h; while (dh > Math.PI) dh -= 2 * Math.PI; while (dh < -Math.PI) dh += 2 * Math.PI;
    ctl.rudder = clamp(dh * 2.5 - b * 0.02);
    if (this.kind === 'runway') j.brake = j.speed < 62;
    if (!j.onGround && !j.trap) this.state = 'final'; // bolter
    if (!j.trap && hSpeed < 3) this.done = true;
    return ctl;
  }

  aimAhead(a) { return a; }
}
