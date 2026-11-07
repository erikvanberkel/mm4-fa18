// Training flights and the self-flying DEMO. All of them fly the real flight model through the
// Autopilot, so the instructor performs genuine maneuvers rather than canned animations.
import { PilotedJet, Instructor, Autopilot, MANEUVER_ORDER, pointNose, holdHeading, groundAvoid } from './sim/autopilot.js';
import { AIPlane, brainGoto, brainFighter } from './sim/ai.js';
import { toWorld, BASES } from './world/geo.js';

const clamp = (x, a = -1, b = 1) => (x < a ? a : x > b ? b : x);

export const MANEUVER_TEXT = {
  'AILERON ROLL': 'AILERON ROLL: HOLD THE STICK OVER, ROLL A FULL 360',
  'BREAK TURN': 'BREAK TURN: ROLL TO 80 DEGREES AND PULL HARD',
  'INSIDE LOOP': 'INSIDE LOOP: PULL STRAIGHT UP AND OVER THE TOP',
  'SPLIT-S': 'SPLIT-S: ROLL INVERTED, THEN PULL THROUGH',
  'VERTICAL HALF-LOOP': 'HALF-LOOP: PULL UP AND OVER, ROLL UPRIGHT',
  'BARREL ROLL': 'BARREL ROLL: ROLL WHILE ARCING OVER',
  'INVERTED FLIGHT': 'INVERTED FLIGHT: ROLL OVER AND HOLD IT',
};

// ----------------------------------------------------------------------------
// DEMO OF MANEUVERS (passenger) and PRACTICE (student follows the instructor)
export class TrainingLesson {
  constructor(sim, mode) {
    this.mode = mode; // 'demo' | 'practice'
    this.sim = sim;
    this.index = 0;
    this.announced = -1;
    this.waitingFor = null;
    this.finished = false;
    this.t = 0;
    this.msgT = 0;
  }

  setup() {
    const sim = this.sim;
    const b = BASES.SFO;
    const r = sim.world.runways[b.rwy];
    const start = r.b;
    const dirX = -r.ux, dirZ = -r.uz;
    const hdg = (Math.atan2(dirX, dirZ) * 180) / Math.PI;
    // The instructor sits 160 m ahead on the runway; the student behind him.
    const inst = new PilotedJet('F18', sim.flightModelName, null);
    inst.setPose(start[0] + dirX * 260, inst.spec.gearH, start[1] + dirZ * 260, hdg);
    inst.onGround = true;
    inst.side = 'blue';
    inst.name = 'INSTRUCTOR';
    inst.identified = true;
    this.instructor = new Instructor(inst);
    this.instructor.heading = (hdg * Math.PI) / 180;
    inst.brain = this.instructor.brain();
    sim.add(inst);
    this.inst = inst;
    if (this.mode === 'demo') {
      // The passenger rides in the student's seat; the autopilot flies the student's jet in formation.
      const j = sim.spawnPlayerRunway('SFO', 'F18');
      j.setPose(start[0] + dirX * 100, j.spec.gearH, start[1] + dirZ * 100, hdg);
      j.onGround = true;
      sim.weaponsSafe = true;
      this.studentAp = new FormationPilot(j, inst);
      sim.autopilotCtl = (dt) => this.studentAp.step(dt, sim);
    } else {
      const j = sim.spawnPlayerRunway('SFO', 'F18');
      j.setPose(start[0] + dirX * 100, j.spec.gearH, start[1] + dirZ * 100, hdg);
      j.onGround = true;
      sim.weaponsSafe = true;
    }
    this.instructor.cruiseAlt = 4500;
    sim.say(this.mode === 'demo' ? 'DEMONSTRATION. SIT BACK AND WATCH.' : 'PRACTICE. FOLLOW THE INSTRUCTOR. FIRE TO START.', 'green', 7, true);
  }

  get current() { return MANEUVER_ORDER[this.index]; }

  // Student requests the next maneuver (fire button) in practice mode.
  next() {
    if (this.mode !== 'practice' || this.finished) return;
    if (this.instructor.state === 'takeoff') return;
    if (this.instructor.busy) { this.sim.say('WAIT FOR THE INSTRUCTOR', 'red', 2); return; }
    this.sim.say(MANEUVER_TEXT[this.current], 'green', 9, false);
    this.instructor.perform(this.current);
    this.waitingFor = this.current;
    this.index++;
    if (this.index >= MANEUVER_ORDER.length) this.finishing = true;
  }

  // Skip to the next maneuver / pull the student up behind the instructor.
  skip() {
    if (this.mode !== 'practice' || this.finished) return;
    const sim = this.sim, j = sim.player, i = this.inst;
    if (i.onGround || !j.alive) return;
    // Reposition 600 m behind and slightly below, matching speed and attitude
    j.x = i.x - i.fx * 600; j.y = i.y - 30; j.z = i.z - i.fz * 600;
    j.fx = i.fx; j.fy = i.fy; j.fz = i.fz; j.rx = i.rx; j.ry = i.ry; j.rz = i.rz; j.ux = i.ux; j.uy = i.uy; j.uz = i.uz;
    j.vx = i.vx; j.vy = i.vy; j.vz = i.vz;
    j.gearCmd = false; j.gear = 0;
    sim.say('REPOSITIONED BEHIND THE INSTRUCTOR', 'green', 3, false);
  }

  update(sim, dt) {
    this.t += dt;
    const inst = this.instructor;
    if (this.mode === 'demo') {
      // Auto-sequence the maneuvers with a pause between each.
      if (inst.state === 'fly' && !inst.busy) {
        this.msgT += dt;
        if (this.msgT > 3.5) {
          this.msgT = 0;
          if (this.index < MANEUVER_ORDER.length) {
            sim.say(MANEUVER_TEXT[this.current], 'green', 8, false);
            inst.perform(this.current);
            this.index++;
          } else { this.finished = true; }
        }
      }
    } else if (this.finishing && !inst.busy && !this.finished) {
      this.finished = true;
      sim.say('LESSON COMPLETE. WELL FLOWN.', 'green', 8, true);
    }
    if (this.finished && this.mode === 'demo' && !this.doneSaid) { this.doneSaid = true; sim.say('END OF DEMONSTRATION', 'green', 6, false); }
    if (this.finished && !this.endAt) this.endAt = this.t + 7;
    if (this.endAt && this.t > this.endAt) return { result: 'success', text: this.mode === 'demo' ? 'DEMONSTRATION COMPLETE' : 'TRAINING COMPLETE' };
    if (!sim.player.alive) return { result: 'fail', text: 'TRAINING ENDED' };
    return null;
  }
}

// Flies a jet in loose formation off a leader: used for the passenger seat in the demonstration.
class FormationPilot {
  constructor(jet, leader) {
    this.j = jet;
    this.leader = leader;
    this.ctl = { pitch: 0, roll: 0, rudder: 0 };
    this.state = 'takeoff';
  }
  step(dt) {
    const j = this.j, L = this.leader, ctl = this.ctl;
    ctl.rudder = 0;
    if (this.state === 'takeoff') {
      j.throttle = 0.9; j.afterburner = false; j.gearCmd = true;
      ctl.pitch = 0; ctl.roll = 0;
      if (j.onGround) {
        const h = Math.atan2(j.fx, j.fz), th = Math.atan2(L.fx, L.fz);
        let dh = th - h; while (dh > Math.PI) dh -= 2 * Math.PI; while (dh < -Math.PI) dh += 2 * Math.PI;
        ctl.rudder = clamp(dh * 2.5);
        if (j.knots() > 195) ctl.pitch = 0.5;
      } else {
        const hold = clamp((14 - j.pitchDeg()) * 0.05, -0.3, 0.3);
        ctl.pitch = hold;
        if (j.y > 50) j.gearCmd = false;
        if (j.y > 700) this.state = 'follow';
      }
      return ctl;
    }
    // Follow: aim at a point 400 m behind and 15 m to the right of the leader
    const bx = L.x - L.fx * 420 + L.rx * 20, by = L.y - L.fy * 420 + L.ry * 20 - 12, bz = L.z - L.fz * 420 + L.rz * 20;
    const dx = bx - j.x, dy = by - j.y, dz = bz - j.z;
    const dist = Math.hypot(dx, dy, dz);
    // Lead the leader's velocity a little
    pointNose(j, dx + L.vx * 1.2 - j.vx * 0.6, dy + L.vy * 1.2 - j.vy * 0.6, dz + L.vz * 1.2 - j.vz * 0.6, ctl, { maxPull: 0.8, gain: 1.4 });
    const dv = L.speed - j.speed;
    j.throttle = clamp(0.5 + dist * 0.0012 + dv * 0.02, 0.15, 1);
    j.afterburner = dist > 1500 && j.throttle > 0.95;
    j.brake = dist < 200 && dv < -10;
    return ctl;
  }
}

// ----------------------------------------------------------------------------
// DEMO: an ace pilot flies the player's jet through an intercept.
export class DemoMission {
  constructor(sim) { this.sim = sim; this.t = 0; this.state = 'close'; this.cool = 0; }
  setup() {
    const sim = this.sim;
    const [x, z] = toWorld(37.84, -123.2);
    const j = sim.spawnPlayerAir(x, 3600, z, 20, 260);
    j.throttle = 0.8;
    this.ap = new Autopilot(j);
    this.ap.heading = (20 * Math.PI) / 180; this.ap.alt = 3600;
    this.bandits = [];
    for (let i = 0; i < 2; i++) {
      const p = new AIPlane('MIG', x + 7000 + i * 1200, 3700 + i * 200, z + 20000 + i * 900, 200, 250);
      p.name = 'MIG-29';
      const sfx = toWorld(37.75, -123.5);
      const cruise = brainGoto(sfx[0], sfx[1], 3700, 250);
      const fighter = brainFighter(() => sim.player, 0.45);
      // the bandits fly home until the demo pilot closes to missile range, then fight
      p.brain = (pl, dt, s) => { if (Math.hypot(sim.player.x - pl.x, sim.player.z - pl.z) < 16000) fighter(pl, dt, s); else cruise(pl, dt, s); };
      sim.add(p);
      this.bandits.push(p);
    }
    sim.target = this.bandits[0];
    sim.autopilotCtl = (dt) => this.control(dt);
    sim.weaponsSafe = false;
    sim.say('DEMONSTRATION: AIR INTERCEPT', 'green', 6, true);
  }
  control(dt) {
    const sim = this.sim, j = sim.player, ctl = this.ctl || (this.ctl = { pitch: 0, roll: 0, rudder: 0 });
    this.t += dt;
    this.cool -= dt;
    if (groundAvoid(j, ctl, sim.world.heightAt(j.x, j.z))) { sim.firing = false; return ctl; }
    const live = this.bandits.filter((b) => b.alive && !b.dying);
    if (!live.length) {
      // Victory lap
      j.throttle = 0.7; j.afterburner = false;
      holdHeading(j, ctl, this.ap.heading + this.t * 0.02, 3600, {});
      return ctl;
    }
    // Defence first: when a missile is inbound, pop decoys and break across its line of flight
    const threat = sim.nearestMissileAt(j, 4500);
    if (threat) { this.defendT = 3.2; this.lastThreat = threat; }
    if (this.defendT > 0) {
      this.defendT -= dt;
      this.decoyT = (this.decoyT || 0) - dt;
      const th = this.lastThreat;
      if (this.decoyT <= 0 && th) { this.decoyT = 0.9; sim.dropPlayerDecoy(th.w.seeker === 'ir' ? 'flare' : 'chaff'); if (th.w.seeker === 'radar' && !sim.ecm) sim.toggleEcm(); }
      if (th) {
        const brg = Math.atan2(th.x - j.x, th.z - j.z);
        const side = Math.sin(this.t * 0.7) > 0 ? 1 : -1;
        // break across the missile's line of flight, trading height for speed only while there is plenty of it
        const dy = j.y > 3200 ? -0.2 : j.y < 1800 ? 0.45 : 0.05;
        pointNose(j, Math.sin(brg + side * 1.57), dy, Math.cos(brg + side * 1.57), ctl, { maxPull: 1, gain: 2.5 });
        j.throttle = 1; j.afterburner = j.knots() < 620;
        sim.firing = false;
        return ctl;
      }
    }
    let tg = live.reduce((a, b) => (Math.hypot(a.x - j.x, a.z - j.z) < Math.hypot(b.x - j.x, b.z - j.z) ? a : b));
    sim.target = tg;
    const dx = tg.x - j.x, dy = tg.y - j.y, dz = tg.z - j.z;
    const range = Math.hypot(dx, dy, dz);
    const tgo = Math.min(6, range / (j.speed + 220));
    const ang = pointNose(j, dx + tg.vx * tgo - j.vx * 0.0, dy + tg.vy * tgo, dz + tg.vz * tgo, ctl, { maxPull: 0.9, gain: 1.8 });
    // afterburner only to run the bandit down, and never beyond a controllable speed
    if (range > 7000 && j.knots() < 560) { j.throttle = 1; j.afterburner = true; } else { j.afterburner = false; j.throttle = clamp(0.55 + (tg.speed + 40 - j.speed) * 0.02, 0.25, 0.9); }
    // Weapons: missile when locked, guns inside a kilometre
    if (range < 1100) { sim.selected = 'gun'; sim.firing = ang < 0.06; }
    else {
      sim.firing = false;
      if (sim.selected === 'gun') sim.selected = 'aim9';
      if (sim.locked && this.cool <= 0 && j.stores[sim.selected] > 0 && sim.lastLaunched !== undefined) {
        sim.fireWeapon(true);
        this.cool = 6;
      }
      if (j.stores.aim9 <= 0 && sim.selected === 'aim9') sim.selected = 'aim120';
    }
    return ctl;
  }
  update(sim) {
    if (!sim.player.alive) return { result: 'fail', text: 'DEMONSTRATION ENDED' };
    const live = this.bandits.filter((b) => b.alive && !b.dying);
    if (!live.length) { this.endT = (this.endT || 0) + 1 / 60; if (this.endT > 10) return { result: 'success', text: 'DEMONSTRATION COMPLETE' }; }
    if (this.t > 140) return { result: 'success', text: 'DEMONSTRATION COMPLETE' };
    return null;
  }
}
