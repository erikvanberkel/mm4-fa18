// Non-player aircraft. A point-mass that banks to turn; "brains" decide where it wants to go.
import { G, MPS_PER_KT } from './jet.js';
import { KIND } from './fx.js';

const DEG = Math.PI / 180;

const wrap = (a) => {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
};

export const TYPES = {
  MIG: { name: 'MIG-29', model: 'MIG', maxG: 7.5, vMax: 560, vCruise: 300, hp: 60, radius: 9, side: 'red', ir: 2, radarMsl: 2, gun: true, ab: true },
  F16: { name: 'F-16', model: 'F16', maxG: 8, vMax: 560, vCruise: 310, hp: 60, radius: 8, side: 'red', ir: 2, radarMsl: 0, gun: true, ab: true },
  B707: { name: 'BOEING 707', model: 'B707', maxG: 1.6, vMax: 260, vCruise: 225, hp: 120, radius: 24, side: 'neutral', ir: 0, radarMsl: 0, gun: false },
  AF1: { name: 'AIR FORCE ONE', model: 'AF1', maxG: 1.5, vMax: 270, vCruise: 235, hp: 160, radius: 24, side: 'blue', ir: 0, radarMsl: 0, gun: false },
  CRUISE: { name: 'CRUISE MSL', model: 'CRUISE', maxG: 2.5, vMax: 260, vCruise: 255, hp: 12, radius: 6, side: 'red', ir: 0, radarMsl: 0, gun: false, stealth: true },
  WING: { name: 'F/A-18', model: 'F18', maxG: 7.5, vMax: 500, vCruise: 280, hp: 60, radius: 9, side: 'blue', ir: 0, radarMsl: 0, gun: false },
};

export class AIPlane {
  constructor(typeKey, x, y, z, headingDeg, speed) {
    const t = TYPES[typeKey];
    this.type = t;
    this.typeKey = typeKey;
    this.name = t.name;
    this.model = t.model;
    this.side = t.side;
    this.alive = true;
    this.radar = true;
    this.castShadow = true;
    this.hp = t.hp;
    this.radius = t.radius;
    this.x = x; this.y = y; this.z = z;
    this.psi = headingDeg * DEG;
    this.theta = 0;
    this.phi = 0;
    this.speed = speed === undefined ? t.vCruise : speed;
    this.des = { psi: this.psi, y: y, speed: this.speed, climb: null, maxBank: 75 * DEG };
    this.brain = null;
    this.irLeft = t.ir;
    this.radarLeft = t.radarMsl;
    this.fireCd = 5; // a few seconds of closing before the first shot (Sim.add randomises it)
    this.gunCd = 0;
    this.flareCd = 0;
    this.dying = false;
    this.spin = 0;
    this.afterburner = false;
    this.onRunway = false;
    this.landed = false;
    this.gearDown = false;
    this.fuelTrail = 0;
    this.hook = false;
    this.stores = null;
    this.identified = false;
    this.basis();
  }

  hideParts() {
    const m = this._hide || (this._hide = {});
    m.ab = !this.afterburner;
    m.gear = !this.gearDown;
    m.hook = true;
    m.store0 = this.irLeft < 1; m.store1 = this.irLeft < 2;
    m.store2 = this.radarLeft < 1; m.store3 = this.radarLeft < 2; m.store4 = true; m.store5 = true;
    return m;
  }

  basis() {
    const ch = Math.cos(this.psi), sh = Math.sin(this.psi), cp = Math.cos(this.theta), sp = Math.sin(this.theta), cb = Math.cos(this.phi), sb = Math.sin(this.phi);
    this.fx = sh * cp; this.fy = sp; this.fz = ch * cp;
    const r0x = ch, r0z = -sh;
    const u0x = -sh * sp, u0y = cp, u0z = -ch * sp;
    this.rx = r0x * cb - u0x * sb; this.ry = -u0y * sb; this.rz = r0z * cb - u0z * sb;
    this.ux = u0x * cb + r0x * sb; this.uy = u0y * cb; this.uz = u0z * cb + r0z * sb;
    this.vx = this.fx * this.speed; this.vy = this.fy * this.speed; this.vz = this.fz * this.speed;
  }

  step(dt, sim) {
    if (this.dying) return this.stepDying(dt, sim);
    if (this.brain) this.brain(this, dt, sim);
    if (this.landed) { this.basis(); return undefined; }
    const d = this.des;
    const t = this.type;
    const dpsi = wrap(d.psi - this.psi);
    // Bank in proportion to heading error
    const maxBank = Math.min(d.maxBank, Math.acos(Math.min(1, 1 / t.maxG)));
    const wantBank = Math.max(-maxBank, Math.min(maxBank, dpsi * 2.0));
    const rollRate = t.maxG > 3 ? 3.2 : 0.55;
    this.phi += Math.max(-rollRate * dt, Math.min(rollRate * dt, wantBank - this.phi));
    const turn = (G * Math.tan(this.phi)) / Math.max(40, this.speed);
    this.psi = wrap(this.psi + turn * dt);
    // Climb: pitch toward the required flight-path angle
    let wantPitch;
    if (d.climb !== null) wantPitch = d.climb;
    else {
      const dy = d.y - this.y;
      wantPitch = Math.max(-0.6, Math.min(0.6, (dy / Math.max(60, this.speed * 4))));
    }
    if (t.maxG < 3) wantPitch = Math.max(-0.14, Math.min(0.16, wantPitch));
    const pitchRate = ((t.maxG * 0.5 * G) / Math.max(60, this.speed));
    this.theta += Math.max(-pitchRate * dt, Math.min(pitchRate * dt, wantPitch - this.theta));
    // Speed
    const a = t.maxG > 3 ? 22 : 4;
    this.speed += Math.max(-a * dt, Math.min(a * dt, d.speed - this.speed));
    this.afterburner = t.ab && d.speed > 360;
    this.basis();
    this.x += this.vx * dt; this.y += this.vy * dt; this.z += this.vz * dt;

    // Terrain avoidance and ground strike
    if (!this.lowFlyer) {
      const look = sim.world.heightAt(this.x + this.vx * 4, this.z + this.vz * 4);
      if (this.y - look < 110 && this.vy < 12) { this.theta = Math.min(0.5, this.theta + dt * 0.8); this.y += dt * 8; }
    }
    const here = sim.world.heightAt(this.x, this.z);
    if (this.y < here + 2) {
      sim.fx.explosion(this.x, here + 2, this.z, 1.4);
      sim.emit('explode', { x: this.x, y: this.y, z: this.z, big: false });
      if (this.onImpact) this.onImpact(sim);
      this.alive = false;
    }
    if (this.hp < this.type.hp * 0.5 && Math.floor(sim.time * 20) !== Math.floor((sim.time - dt) * 20)) {
      sim.fx.add(KIND.DARK, this.x - this.vx * 0.05, this.y, this.z - this.vz * 0.05, 0, 2, 0, 3, 5);
    }
    return undefined;
  }

  stepDying(dt, sim) {
    this.spin += dt * 3;
    this.phi += dt * this.spinDir * 4.5;
    this.theta = Math.max(-1.1, this.theta - dt * 0.55);
    this.speed = Math.max(90, this.speed - dt * 18);
    this.basis();
    this.x += this.vx * dt; this.y += this.vy * dt; this.z += this.vz * dt;
    this.vy -= 0;
    if (Math.floor(sim.time * 24) !== Math.floor((sim.time - dt) * 24)) {
      sim.fx.add(KIND.FIRE, this.x, this.y, this.z, 0, 0, 0, 0.5, 4);
      sim.fx.add(KIND.DARK, this.x, this.y, this.z, 0, 3, 0, 4, 7);
    }
    const h = sim.world.heightAt(this.x, this.z);
    if (this.y < h + 1) {
      if (h < 1 && !sim.world.isLand(this.x, this.z)) { sim.fx.splash(this.x, this.z, 1.3); sim.emit('splash', { x: this.x, y: 0, z: this.z }); }
      else sim.fx.explosion(this.x, h + 2, this.z, 1.6);
      sim.emit('explode', { x: this.x, y: this.y, z: this.z, big: false });
      this.alive = false;
    }
  }

  // Called by weapons. `by` tells mission scripts who did it.
  takeDamage(amount, sim, by) {
    if (this.dying) return;
    this.hp -= amount;
    this.lastHitBy = by;
    if (this.onHit) this.onHit(sim, by);
    if (this.hp <= 0) {
      this.killedBy = by;
      this.radar = false;
      sim.emit('kill', { target: this, by });
      sim.fx.explosion(this.x, this.y, this.z, 1.2, this.vx, this.vy, this.vz);
      sim.emit('explode', { x: this.x, y: this.y, z: this.z, big: false, airburst: true });
      sim.debris(this, 8);
      if (this.type.maxG > 3 && sim.random() < 0.65) {
        this.dying = true;
        this.spinDir = sim.random() < 0.5 ? -1 : 1;
      } else {
        this.alive = false;
      }
    }
  }
}

// ---- Brains: small state machines assigned by the mission ----

export function brainPatrol(points, speed = 240, altY = null) {
  let idx = 0;
  return (p) => {
    const w = points[idx];
    const dx = w[0] - p.x, dz = w[1] - p.z;
    if (dx * dx + dz * dz < 2500 * 2500) idx = (idx + 1) % points.length;
    p.des.psi = Math.atan2(dx, dz);
    p.des.speed = speed;
    p.des.y = altY === null ? p.y : altY;
    p.des.climb = null;
  };
}

// Straight to a point at a fixed altitude; `onArrive` runs once when within 1 km.
export function brainGoto(tx, tz, y, speed, onArrive) {
  let done = false;
  return (p, dt, sim) => {
    const dx = tx - p.x, dz = tz - p.z;
    p.des.psi = Math.atan2(dx, dz);
    p.des.y = y;
    p.des.speed = speed;
    p.des.climb = null;
    if (!done && dx * dx + dz * dz < 1000 * 1000) {
      done = true;
      if (onArrive) onArrive(p, sim);
    }
  };
}

// Full air combat brain. skill 0..1 sets fire discipline and reaction time.
export function brainFighter(getTarget, skill = 0.5, opts = {}) {
  let evadeT = 0, breakDir = 1, weaveT = 0;
  return (p, dt, sim) => {
    const target = getTarget(sim);
    const des = p.des;
    p.fireCd -= dt; p.gunCd -= dt; p.flareCd -= dt;
    // A hit makes the missile's pilot react first, last chance is all skill
    const threat = sim.nearestMissileAt(p, 4500);
    if (threat && sim.random() < dt * (0.8 + 2.4 * skill) && evadeT <= 0) {
      evadeT = 3.5;
      breakDir = sim.random() < 0.5 ? -1 : 1;
    }
    if (evadeT > 0) {
      evadeT -= dt;
      const m = threat || null;
      if (m) {
        // Turn hard across the missile's line of flight
        const bearing = Math.atan2(m.x - p.x, m.z - p.z);
        des.psi = wrap(bearing + breakDir * 1.75);
      }
      des.speed = p.type.vMax;
      des.y = Math.max(300, p.y + (m && m.y > p.y ? -200 : 120));
      des.climb = null;
      if (p.flareCd <= 0 && m) {
        p.flareCd = 0.85;
        sim.dropDecoy(p, m.kind === 'ir' || m.kind === 'aim9' ? 'flare' : 'chaff');
      }
      return;
    }
    if (!target || !target.alive) {
      des.speed = p.type.vCruise;
      des.climb = null;
      return;
    }
    const dx = target.x - p.x, dy = target.y - p.y, dz = target.z - p.z;
    const range = Math.hypot(dx, dy, dz);
    // Lead pursuit
    const tGo = Math.min(5, range / Math.max(200, p.speed + 80));
    const lx = dx + (target.vx || 0) * tGo, ly = dy + (target.vy || 0) * tGo, lz = dz + (target.vz || 0) * tGo;
    const ll = Math.hypot(lx, ly, lz) || 1;
    const ahead = (p.fx * dx + p.fy * dy + p.fz * dz) / (range || 1);
    const targetAhead = target.fx !== undefined ? (target.fx * -dx + target.fy * -dy + target.fz * -dz) / (range || 1) : 0;

    // Bandit on our six, and close: jink instead of pointing at him.
    if (targetAhead > 0.85 && range < 2600 && ahead < 0.2) {
      weaveT += dt;
      des.psi = wrap(p.psi + Math.sin(weaveT * 1.8) * 1.2);
      des.speed = p.type.vMax;
      des.climb = Math.sin(weaveT * 1.1) * 0.35;
      return;
    }
    des.psi = Math.atan2(lx, lz);
    des.climb = Math.max(-0.65, Math.min(0.65, Math.asin(Math.max(-1, Math.min(1, ly / ll)))));
    // Stay out of the ground
    if (p.y < 260) des.climb = Math.max(des.climb, 0.3);
    des.speed = range > 8000 ? p.type.vMax * 0.92 : Math.max(260, Math.min(p.type.vMax * 0.8, (target.speed || 300) + 30));

    if (opts.holdFire && opts.holdFire(p, sim)) return;
    // Fire control
    const aim = (p.fx * lx + p.fy * ly + p.fz * lz) / ll;
    if (p.fireCd <= 0 && p.irLeft > 0 && range < 5200 && range > 700 && aim > 0.93 - 0.05 * skill) {
      sim.enemyFire(p, target, 'ir');
      p.irLeft--;
      p.fireCd = 13 - 8 * skill + sim.random() * 8;
    } else if (p.fireCd <= 0 && p.radarLeft > 0 && range < 15000 && range > 3500 && aim > 0.93) {
      sim.enemyFire(p, target, 'radar');
      p.radarLeft--;
      p.fireCd = 15 - 8 * skill + sim.random() * 8;
    }
    if (p.type.gun && p.gunCd <= 0 && range < 950 && aim > 0.992 - 0.004 * skill) {
      sim.enemyGun(p, target);
      p.gunCd = 0.12;
    }
  };
}

// A real approach: fly to a fix, intercept the runway centreline, 3-degree slope, flare, roll out.
export function brainAirlinerApproach(runway, fromEnd, opts = {}) {
  // fromEnd: 'a' lands from end a toward b.
  const sign = fromEnd === 'a' ? 1 : -1;
  const ux = runway.ux * sign, uz = runway.uz * sign;
  const thr = fromEnd === 'a' ? runway.a : runway.b;
  const stage = { s: 'inbound' };
  return (p, dt, sim) => {
    const dx = p.x - thr[0], dz = p.z - thr[1];
    const along = dx * ux + dz * uz; // negative before the threshold
    const cross = dx * uz - dz * ux;
    const des = p.des;
    if (stage.s === 'inbound') {
      // Aim at a point 18 km out on the centreline, then turn in.
      const fix = [thr[0] - ux * 18000, thr[1] - uz * 18000];
      const fdx = fix[0] - p.x, fdz = fix[1] - p.z;
      des.psi = Math.atan2(fdx, fdz);
      des.y = 1000;
      des.speed = p.type.vCruise * 0.95;
      des.climb = null;
      if (fdx * fdx + fdz * fdz < 2500 * 2500) stage.s = 'final';
      if (along < 0 && along > -22000 && Math.abs(cross) < 1500) stage.s = 'final';
    } else if (stage.s === 'final') {
      p.lowFlyer = true; // terrain avoidance must not fight the glideslope
      const correction = Math.max(-0.45, Math.min(0.45, (-cross / Math.max(800, -along * 0.25))));
      des.psi = wrap(Math.atan2(ux, uz) + correction);
      des.speed = Math.max(92, 100 + Math.max(0, -along - 3000) * 0.012);
      const glide = Math.max(14, Math.tan(3.2 * DEG) * -along + 14);
      des.y = glide;
      des.climb = null;
      p.gearDown = -along < 9000;
      p.des.maxBank = 22 * DEG;
      if (along > 0 && p.y < 22) {
        stage.s = 'rollout';
        p.y = 4;
        p.theta = 0.02;
        p.onRunway = true;
        sim.emit('touchdown', { sink: 2, onDeck: false, type: 'runway', other: p });
      }
    } else if (stage.s === 'rollout') {
      des.psi = Math.atan2(ux, uz);
      des.speed = 0;
      p.speed = Math.max(0, p.speed - dt * 8);
      p.y = 4;
      p.theta = 0;
      p.phi = 0;
      if (p.speed < 4) {
        p.landed = true;
        p.speed = 0;
        if (opts.onLanded) opts.onLanded(p, sim);
      }
    }
  };
}

export const knots = (k) => k * MPS_PER_KT;
export const DEG2RAD = DEG;
