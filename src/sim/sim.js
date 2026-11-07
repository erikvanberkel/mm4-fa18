// The game simulation: deterministic, no DOM. Runs identically in the browser and in Node tests.
import { Jet, G, MPS_PER_KT, FT_PER_M } from './jet.js';
import { FX, KIND } from './fx.js';
import { Carrier } from './carrier.js';
import { CARRIER_START, BASES } from '../world/geo.js';

export const MI = 1609.344;
const DEG = Math.PI / 180;
const FT = 0.3048;

// Weapon data from the manual: AIM-120A beyond 30 mi, AIM-9L 11 mi and about Mach 3,
// M61 at 6,000 rpm with 570 rounds and a useful reach of about a kilometre.
export const WEAPONS = {
  aim9: { name: 'SIDEWINDER', short: 'SW', model: 'AIM9', maxRange: 11 * MI, minRange: 300, vMax: 880, boost: 3, burnA: 240, life: 24, maxG: 40, seeker: 'ir' },
  aim120: { name: 'AMRAAM', short: 'AM', model: 'AIM120', maxRange: 32 * MI, minRange: 900, vMax: 1050, boost: 7, burnA: 170, life: 70, maxG: 32, seeker: 'radar' },
  ir: { name: 'IR MISSILE', model: 'ENEMYMSL', maxRange: 5500, minRange: 300, vMax: 760, boost: 3, burnA: 200, life: 17, maxG: 24, seeker: 'ir', enemy: true },
  radar: { name: 'RADAR MISSILE', model: 'ENEMYMSL', maxRange: 24000, minRange: 1500, vMax: 920, boost: 6, burnA: 170, life: 42, maxG: 24, seeker: 'radar', enemy: true },
};

class Missile {
  constructor(kind, owner, target, sim) {
    const w = WEAPONS[kind];
    this.kind = kind;
    this.w = w;
    this.model = w.model;
    this.owner = owner;
    this.target = target;
    this.alive = true;
    this.isMissile = true;
    this.side = owner.side;
    this.age = 0;
    this.radius = 5;
    this.x = owner.x - owner.ux * 1.2 - owner.fx; this.y = owner.y - owner.uy * 1.2; this.z = owner.z - owner.uz * 1.2;
    this.vx = owner.vx; this.vy = owner.vy; this.vz = owner.vz;
    this.speed = Math.hypot(this.vx, this.vy, this.vz);
    this.rx = owner.rx; this.ry = owner.ry; this.rz = owner.rz;
    this.ux = owner.ux; this.uy = owner.uy; this.uz = owner.uz;
    this.fx = owner.fx; this.fy = owner.fy; this.fz = owner.fz;
    this.closest = Infinity;
    this.dud = false;
    this.trailT = 0;
    this.spoofT = 0;
    void sim;
  }

  step(dt, sim) {
    this.age += dt;
    const w = this.w;
    const t = this.target;
    // Speed: boost, then drag bleeds it
    const a = this.age < w.boost ? w.burnA : -Math.min(90, this.speed * 0.06);
    this.speed = Math.max(120, Math.min(w.vMax, this.speed + a * dt));

    // Seeker: decoys can steal it
    if (t && t.alive && !this.dud && this.age > 0.3) {
      if (this.spoofT <= 0) {
        const lure = sim.decoyNear(this);
        if (lure && sim.random() < lure.strength * dt * 3) {
          this.target = lure.decoy;
          this.spoofT = 2;
          if (t === sim.player) sim.emit('decoyed', {});
        }
      } else this.spoofT -= dt;
    }

    // Jamming: radar missiles can lose lock on an ECM-equipped target
    if (t && !this.dud && this.age > 1 && w.seeker === 'radar') {
      const jam = (t.ecm ? 0.35 : 0) + (t === sim.player && sim.ecm ? 0.3 : 0);
      if (jam > 0 && sim.random() < dt * jam) { this.dud = true; if (t === sim.player) sim.emit('jammed', {}); }
    }
    let dx = this.fx, dy = this.fy, dz = this.fz;
    const tgt = this.target;
    if (tgt && (tgt.alive || tgt.isDecoy) && !this.dud && this.age > 0.25) {
      // Intercept: aim where the target will be, then turn at most at the g limit.
      const rx = tgt.x - this.x, ry = tgt.y - this.y, rz = tgt.z - this.z;
      const range = Math.hypot(rx, ry, rz);
      const tGo = Math.min(25, range / Math.max(100, this.speed));
      const px = rx + (tgt.vx || 0) * tGo, py = ry + (tgt.vy || 0) * tGo, pz = rz + (tgt.vz || 0) * tGo;
      const l = Math.hypot(px, py, pz) || 1;
      dx = px / l; dy = py / l; dz = pz / l;
      // Lost lock if the target slips out of the seeker's gimbal at close range.
      const cos = dx * this.fx + dy * this.fy + dz * this.fz;
      if (cos < 0.05 && range < 2500) this.dud = true;
      if (range < this.closest) this.closest = range;
      else if (range > this.closest + 280) this.dud = true;
      const fuse = (tgt.radius || 8) + 18;
      if (range < fuse && !tgt.isDecoy) {
        this.detonate(sim, tgt);
        return;
      }
    }
    // Turn the airframe toward the desired direction
    const maxTurn = (Math.min(w.maxG, 8 + this.speed * 0.05) * G * dt) / Math.max(120, this.speed);
    const cos = Math.max(-1, Math.min(1, this.fx * dx + this.fy * dy + this.fz * dz));
    const ang = Math.acos(cos);
    if (ang > 1e-5) {
      const f = Math.min(1, maxTurn / ang);
      let nx = this.fx + (dx - this.fx) * f, ny = this.fy + (dy - this.fy) * f, nz = this.fz + (dz - this.fz) * f;
      const l = Math.hypot(nx, ny, nz) || 1;
      this.fx = nx / l; this.fy = ny / l; this.fz = nz / l;
    }
    // Rebuild a right/up pair for the drawn model
    let rx = this.fz, rz = -this.fx;
    const rl = Math.hypot(rx, rz) || 1;
    rx /= rl; rz /= rl;
    this.rx = rx; this.ry = 0; this.rz = rz;
    this.ux = this.fy * rz; this.uy = this.fz * rx - this.fx * rz; this.uz = -this.fy * rx;

    this.vx = this.fx * this.speed; this.vy = this.fy * this.speed; this.vz = this.fz * this.speed;
    this.x += this.vx * dt; this.y += this.vy * dt; this.z += this.vz * dt;

    // Smoke trail while the motor burns
    this.trailT -= dt;
    if (this.age < w.boost + 0.4 && this.trailT <= 0) {
      this.trailT = 0.035;
      sim.fx.add(KIND.WHITE, this.x - this.fx * 2, this.y - this.fy * 2, this.z - this.fz * 2, 0, 0.4, 0, 2.2 + sim.random() * 1.6, 2.2);
      sim.fx.add(KIND.FIRE, this.x - this.fx * 2.5, this.y - this.fy * 2.5, this.z - this.fz * 2.5, 0, 0, 0, 0.1, 1.2);
    }

    const h = sim.world.heightAt(this.x, this.z);
    if (this.y < h + 1) {
      if (h < 1) { sim.fx.splash(this.x, this.z, 0.4); sim.emit('splash', { x: this.x, y: 0, z: this.z, small: true }); }
      else sim.fx.explosion(this.x, h + 1, this.z, 0.5);
      this.alive = false;
      return;
    }
    if (this.age > w.life) this.detonate(sim, null);
  }

  detonate(sim, victim) {
    this.alive = false;
    sim.fx.explosion(this.x, this.y, this.z, 0.55, this.vx * 0.1, this.vy * 0.1, this.vz * 0.1);
    if (victim) {
      // enemy missiles cripple (two hits leave a jet barely flying); ours are lethal to a MiG
      const dmg = this.kind === 'aim120' ? 95 : this.kind === 'aim9' ? 85 : this.kind === 'radar' ? 50 : 44;
      if (this.owner === sim.player) {
        sim.log.hits++;
        sim.emit('missileHit', { victim });
      }
      if (victim === sim.player) {
        sim.log.hitsTaken++;
        sim.emit('playerHit', { kind: this.kind });
      }
      victim.takeDamage(dmg, sim, this.owner);
    } else {
      sim.emit('explode', { x: this.x, y: this.y, z: this.z, big: false, far: true });
    }
  }
}

export class Sim {
  constructor({ world, seed = 12345, flightModel = 'classic', aircraft = 'F18', difficulty = 0 }) {
    this.world = world;
    // Scramble the seed (murmur3 finaliser) so small seeds give well-spread first values
    let h = seed >>> 0;
    h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
    this.seed = h >>> 0 || 1;
    this.flightModelName = flightModel;
    this.aircraftKey = aircraft;
    this.difficulty = difficulty; // Each replay of a mission is harder, as in the manual.
    this.time = 0;
    this.entities = [];
    this.events = [];
    this.fx = new FX(() => this.random());
    this.decoys = [];
    this.bullets = [];
    this.carriers = [];
    this.message = null;
    this.player = null;
    this.mission = null;
    this.log = { shots: 0, hits: 0, hitsTaken: 0, roundsFired: 0, roundsHit: 0, kills: 0 };
    this.radarRange = 10 * MI;
    this.radarMode = 'radar';
    this.ecm = false;
    this.ecmTimer = 0;
    this.selected = 'aim9';
    this.target = null;
    this.lockT = 0;
    this.locked = false;
    this.inRange = false;
    this.seekerState = 'off';
    this.firing = false;
    this.gunHeat = 0;
    this.incoming = { ir: false, radar: false };
    this.alerts = { stall: false, pullUp: false, bingo: false, enemy: false, friend: false, gearWarn: false };
    this.over = null;
    this.lastLaunched = null;
    this.landing = null;
    this.landed = null;
    this.ejected = null;
    this.bulletCount = 0;
  }

  random() {
    let s = this.seed;
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    this.seed = s;
    return s / 4294967296;
  }

  emit(type, data = {}) { this.events.push({ type, ...data }); }
  say(text, color = 'green', seconds = 5, voice = null) {
    this.message = { text, color, until: this.time + seconds, start: this.time };
    this.emit('message', { text, color, voice });
  }

  // ---- Setup helpers ----
  addCarrier(enemy = false, x = CARRIER_START[0], z = CARRIER_START[1], hdg = 295, spd = 10) {
    const c = new Carrier(x, z, hdg, spd, enemy);
    this.carriers.push(c);
    this.entities.push(c);
    if (!enemy) this.enterprise = c;
    return c;
  }

  spawnPlayerRunway(baseKey, aircraft = this.aircraftKey) {
    const b = BASES[baseKey];
    const r = this.world.runways[b.rwy];
    const fromA = b.startEnd === 'a';
    const start = fromA ? r.a : r.b;
    const dirX = fromA ? r.ux : -r.ux, dirZ = fromA ? r.uz : -r.uz;
    const h = (Math.atan2(dirX, dirZ) * 180) / Math.PI;
    const j = new Jet(aircraft, this.flightModelName);
    j.setPose(start[0] + dirX * 90, j.spec.gearH, start[1] + dirZ * 90, h);
    j.onGround = true;
    j.surfaceType = 'runway';
    this.player = j;
    this.entities.push(j);
    this.homeBase = { kind: 'runway', baseKey, runway: r };
    return j;
  }

  spawnPlayerAir(x, y, z, hdg, speed, aircraft = this.aircraftKey) {
    const j = new Jet(aircraft, this.flightModelName);
    j.setPose(x, y, z, hdg);
    j.setVelocityForward(speed);
    j.throttle = 0.7;
    j.rpm = 0.7;
    j.gearCmd = false;
    j.gear = 0;
    this.player = j;
    this.entities.push(j);
    return j;
  }

  spawnPlayerCarrier(aircraft = 'F18') {
    const c = this.enterprise || this.addCarrier();
    const j = new Jet(aircraft, this.flightModelName);
    this.player = j;
    this.entities.push(j);
    j.catapult = { carrier: c, t: 0, fired: false, s: 0, v: 0 };
    c.placeOnCatapult(j, 0, 0);
    this.homeBase = { kind: 'carrier', carrier: c };
    return j;
  }

  add(e) {
    if (e.fireCd !== undefined) e.fireCd = 3 + this.random() * 7; // seeded, so scenarios replay identically
    this.entities.push(e);
    return e;
  }

  // ---- Queries ----
  surfaceUnder(e) {
    const x = e.x, z = e.z;
    for (let i = 0; i < this.carriers.length; i++) {
      const c = this.carriers[i];
      if (!c.alive || !c.near(x, z)) continue;
      const [lx, lz] = c.toLocal(x, z);
      if (c.deckContains(lx, lz)) {
        const [a, b] = c.landingCoords(x, z);
        const hookZone = !c.enemy && a > 0 && a < 130 && Math.abs(b) < 22;
        return { y: c.deckY, type: 'deck', onDeck: true, ref: c, hookZone };
      }
    }
    const h = this.world.heightAt(x, z);
    if (e.y - h > 40) return { y: h, type: 'air' };
    if (h > 3) return { y: h, type: 'hill' };
    if (this.world.runwayAt(x, z)) return { y: 0, type: 'runway' };
    if (this.world.isLand(x, z)) return { y: h, type: 'land' };
    return { y: 0, type: 'sea' };
  }

  nearestMissileAt(p, range) {
    let best = null, bd = range * range;
    for (let i = 0; i < this.entities.length; i++) {
      const e = this.entities[i];
      if (!e.isMissile || !e.alive || e.target !== p) continue;
      const d = (e.x - p.x) ** 2 + (e.y - p.y) ** 2 + (e.z - p.z) ** 2;
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }

  // ---- Decoys ----
  dropDecoy(owner, kind) {
    const d = { isDecoy: true, kind, x: owner.x, y: owner.y, z: owner.z, vx: owner.vx * 0.4, vy: owner.vy * 0.4 - 4, vz: owner.vz * 0.4, age: 0, life: kind === 'flare' ? 4 : 3.2, alive: true, owner };
    this.decoys.push(d);
    if (kind === 'flare') {
      this.fx.add(KIND.FLARE, d.x, d.y, d.z, d.vx, d.vy, d.vz, d.life, 3);
    } else {
      for (let i = 0; i < 28; i++) {
        this.fx.add(KIND.CHAFF, d.x, d.y, d.z, d.vx + (this.random() - 0.5) * 14, d.vy + (this.random() - 0.5) * 14, d.vz + (this.random() - 0.5) * 14, 2.4 + this.random() * 1.4, 1);
      }
    }
    return d;
  }

  decoyNear(m) {
    const want = m.w.seeker === 'ir' ? 'flare' : 'chaff';
    let best = null, bd = 2200 * 2200;
    for (let i = 0; i < this.decoys.length; i++) {
      const d = this.decoys[i];
      if (d.kind !== want || d.owner === m.owner) continue;
      if (d.owner !== m.target) continue;
      const dist = (d.x - m.x) ** 2 + (d.y - m.y) ** 2 + (d.z - m.z) ** 2;
      if (dist < bd) { bd = dist; best = d; }
    }
    if (!best) return null;
    const newness = 1 - best.age / best.life;
    return { decoy: best, strength: 0.45 + 0.55 * newness };
  }

  // ---- Player weapons ----
  selectNextWeapon() {
    const order = ['aim9', 'aim120', 'gun'];
    this.selected = order[(order.indexOf(this.selected) + 1) % 3];
    this.lockT = 0;
    this.locked = false;
    this.emit('weaponSelect', { weapon: this.selected });
  }

  radarContacts() {
    const list = [];
    const me = this.player;
    if (!me) return list;
    for (let i = 0; i < this.entities.length; i++) {
      const e = this.entities[i];
      if (e === me || !e.alive) continue;
      if (e.radar || e.isMissile) {
        const d = Math.hypot(e.x - me.x, e.z - me.z);
        // Sea-skimmers only show on radar inside ten miles, as the manual warns.
        if (e.type && e.type.stealth && d > 10 * MI) continue;
        list.push(e);
      }
    }
    return list;
  }

  cycleTarget() {
    const me = this.player;
    const cands = this.radarContacts().filter((e) => !e.isMissile);
    if (!cands.length) { this.target = null; return; }
    cands.sort((a, b) => dist(a, me) - dist(b, me));
    const i = cands.indexOf(this.target);
    this.target = cands[(i + 1) % cands.length];
    this.lockT = 0;
    this.locked = false;
    this.emit('targetSelect', { target: this.target });
  }

  fireWeapon(pressed) {
    const j = this.player;
    if (!j || !j.alive || this.over) return;
    if (this.weaponsSafe) return;
    if (this.selected === 'gun') { this.firing = pressed; return; }
    if (!pressed) return;
    if (j.onGround) { this.say('WEAPONS SAFE ON DECK', 'red', 2); return; }
    const s = this.selected;
    if (j.stores[s] <= 0) { this.say(`${WEAPONS[s].name} EMPTY`, 'red', 2); this.emit('dryFire', {}); return; }
    j.stores[s]--;
    const target = this.locked ? this.target : null;
    const m = new Missile(s, j, target, this);
    this.add(m);
    this.log.shots++;
    this.lastLaunched = m;
    this.emit('launch', { kind: s, m });
    if (this.mission && this.mission.onPlayerFired) this.mission.onPlayerFired(this, target);
  }

  dropPlayerDecoy(kind) {
    const j = this.player;
    if (!j || !j.alive) return;
    const key = kind === 'flare' ? 'flares' : 'chaff';
    if (j.stores[key] <= 0) { this.say(`NO ${kind === 'flare' ? 'FLARES' : 'CHAFF'}`, 'red', 2); return; }
    j.stores[key]--;
    this.dropDecoy(j, kind);
    this.emit('decoy', { kind });
  }

  toggleEcm() {
    this.ecm = !this.ecm;
    this.emit('ecm', { on: this.ecm });
    this.say(this.ecm ? 'ECM JAMMER ON' : 'ECM JAMMER OFF', 'green', 2);
  }

  // ---- Enemy weapons ----
  enemyFire(owner, target, kind) {
    if (kind === 'radar' && target === this.player && this.ecm && this.random() < 0.55) return; // Jammed before launch
    const m = new Missile(kind, owner, target, this);
    this.add(m);
    if (target === this.player) {
      this.emit('enemyLaunch', { kind });
      this.say(kind === 'ir' ? 'IR MISSILE FIRED AT YOU' : 'RADAR MISSILE FIRED AT YOU', 'red', 4);
    }
  }

  enemyGun(owner, target) {
    const spread = 0.02;
    const r = () => (this.random() - 0.5) * spread;
    const vx = owner.fx + r(), vy = owner.fy + r(), vz = owner.fz + r();
    const b = { x: owner.x + owner.fx * 10, y: owner.y + owner.fy * 10, z: owner.z + owner.fz * 10, vx: vx * 1000 + owner.vx, vy: vy * 1000 + owner.vy, vz: vz * 1000 + owner.vz, life: 1.4, owner };
    this.bullets.push(b);
    this.fx.tracer(b.x, b.y, b.z, b.vx, b.vy, b.vz, b.life, false);
    void target;
  }

  debris(from, n) {
    for (let i = 0; i < n; i++) {
      const d = {
        model: 'SHARD', alive: true, debris: true, life: 2 + this.random() * 3,
        x: from.x, y: from.y, z: from.z,
        vx: (from.vx || 0) * 0.5 + (this.random() - 0.5) * 80, vy: (from.vy || 0) * 0.5 + (this.random() - 0.5) * 80, vz: (from.vz || 0) * 0.5 + (this.random() - 0.5) * 80,
        rx: 1, ry: 0, rz: 0, ux: 0, uy: 1, uz: 0, fx: 0, fy: 0, fz: 1, spin: this.random() * 8 + 2,
        step(dt) {
          this.life -= dt;
          this.vy -= G * dt;
          this.x += this.vx * dt; this.y += this.vy * dt; this.z += this.vz * dt;
          const a = this.spin * dt;
          const c = Math.cos(a), s = Math.sin(a);
          const ux = this.ux * c - this.fx * s, uy = this.uy * c - this.fy * s, uz = this.uz * c - this.fz * s;
          const fx = this.fx * c + this.ux * s, fy = this.fy * c + this.uy * s, fz = this.fz * c + this.uz * s;
          this.ux = ux; this.uy = uy; this.uz = uz; this.fx = fx; this.fy = fy; this.fz = fz;
          if (this.life <= 0 || this.y < 0) this.alive = false;
        },
      };
      this.entities.push(d);
    }
  }

  crash(jet, reason) {
    if (!jet.alive || jet.invulnerable) return;
    jet.alive = false;
    jet.y = Math.max(jet.y, 2);
    if (reason === 'WATER') { this.fx.splash(jet.x, jet.z, 2.4); this.emit('splash', { x: jet.x, y: 0, z: jet.z, big: true }); }
    else {
      this.fx.explosion(jet.x, jet.y, jet.z, 2.2);
      this.emit('explode', { x: jet.x, y: jet.y, z: jet.z, big: true, own: true });
    }
    this.debris(jet, 12);
    if (jet === this.player) {
      this.emit('crash', { reason });
      this.over = this.over || { kind: 'crash', reason, at: this.time };
    }
  }

  eject() {
    const j = this.player;
    if (!j || !j.alive || this.ejected) return;
    this.ejected = {
      model: 'CHUTE', alive: true, x: j.x + j.ux * 3, y: j.y + j.uy * 3, z: j.z + j.uz * 3,
      vx: j.vx * 0.6 + j.ux * 30, vy: j.vy * 0.6 + j.uy * 30, vz: j.vz * 0.6 + j.uz * 30,
      rx: 1, ry: 0, rz: 0, ux: 0, uy: 1, uz: 0, fx: 0, fy: 0, fz: 1, speed: 0, t: 0,
      step(dt, sim) {
        this.t += dt;
        const drag = this.t > 1.2 ? 2.8 : 0.3;
        this.vx -= this.vx * drag * dt; this.vz -= this.vz * drag * dt;
        const term = this.t > 1.2 ? -7 : -60;
        this.vy += (term - this.vy) * Math.min(1, dt * (this.t > 1.2 ? 2.6 : 0.2));
        this.x += this.vx * dt; this.y += this.vy * dt; this.z += this.vz * dt;
        this.speed = Math.hypot(this.vx, this.vy, this.vz);
        const h = sim.world.heightAt(this.x, this.z);
        if (this.y < h + 0.5) { this.alive = false; sim.over = sim.over || { kind: 'ejected', reason: 'PILOT EJECTED', at: sim.time }; }
      },
    };
    this.entities.push(this.ejected);
    // The empty jet keeps going for a moment, then the mission's over when the chute lands.
    j.engineOn = false;
    j.pilotless = true;
    j.throttle = 0;
    this.emit('eject', {});
    const canopy = {
      model: 'CANOPY', alive: true, x: j.x + j.ux * 3, y: j.y + j.uy * 3, z: j.z + j.uz * 3,
      vx: j.vx * 0.7 + j.ux * 18, vy: j.vy * 0.7 + j.uy * 18, vz: j.vz * 0.7 + j.uz * 18,
      rx: j.rx, ry: j.ry, rz: j.rz, ux: j.ux, uy: j.uy, uz: j.uz, fx: j.fx, fy: j.fy, fz: j.fz, life: 12,
      step(dt) {
        this.life -= dt;
        this.vy -= G * dt;
        this.x += this.vx * dt; this.y += this.vy * dt; this.z += this.vz * dt;
        if (this.life <= 0 || this.y < 0) this.alive = false;
      },
    };
    this.entities.push(canopy);
    this.lastEjectAt = this.time;
  }

  // ---- Main step ----
  step(dt, ctl) {
    if (this.paused) return;
    this.time += dt;
    const j = this.player;
    if (j && j.alive) {
      j.step(dt, j.pilotless ? { pitch: 0, roll: 0.25, rudder: 0 } : (this.autopilotCtl ? this.autopilotCtl(dt) : ctl), this);
      if (j.alive && !j.onGround && j.y < 900) this._checkPlayerCollisions(j);
    }
    // Everything else
    const ents = this.entities;
    for (let i = 0; i < ents.length; i++) {
      const e = ents[i];
      if (e !== j && e.alive && e.step) e.step(dt, this);
    }
    for (let i = ents.length - 1; i >= 0; i--) {
      if (!ents[i].alive && ents[i] !== j && !ents[i].keep) ents.splice(i, 1);
    }
    this._stepGun(dt);
    this._stepBullets(dt);
    this._stepDecoys(dt);
    this._stepWeaponsSystem(dt);
    this._stepAlerts(dt);
    this._stepIdent();
    this._stepShipEffects(dt);
    this.fx.step(dt);
    if (j && j.alive && j.afterburner && !j.onGround && Math.floor(this.time * 30) !== Math.floor((this.time - dt) * 30) && false) {
      this.fx.add(KIND.FIRE, j.x - j.fx * 9, j.y - j.fy * 9, j.z - j.fz * 9, 0, 0, 0, 0.2, 1);
    }
    if (j && j.smokeOn && j.alive && Math.floor(this.time * 25) !== Math.floor((this.time - dt) * 25)) {
      this.fx.add(KIND.WHITE, j.x - j.fx * 9, j.y - j.fy * 9, j.z - j.fz * 9, 0, 0, 0, 7, 3);
    }
    if (j && !j.alive && !this.over) this.over = { kind: 'crash', reason: 'LOST', at: this.time };
    // A badly damaged jet trails black smoke
    if (j && j.alive && j.hp < 55 && Math.floor(this.time * 20) !== Math.floor((this.time - dt) * 20)) {
      this.fx.add(KIND.DARK, j.x - j.fx * 8, j.y - j.fy * 8, j.z - j.fz * 8, 0, 1.5, 0, 3.5, 4 + (55 - j.hp) * 0.05);
      if (j.hp < 30) this.fx.add(KIND.FIRE, j.x - j.fx * 7, j.y - j.fy * 7, j.z - j.fz * 7, 0, 0, 0, 0.35, 2.5);
    }
    if (this.message && this.time > this.message.until) this.message = null;
    if (this.mission && !this.missionDone) {
      const out = this.mission.update(this, dt);
      if (out) {
        this.missionDone = out;
        this.emit('missionEnd', { result: out });
      }
    }
  }

  _checkPlayerCollisions(j) {
    if (this.world.hitsStructure(j.x, j.y, j.z)) {
      this.crash(j, 'STRUCTURE');
      return;
    }
    for (let i = 0; i < this.carriers.length; i++) {
      const c = this.carriers[i];
      if (!c.alive || !c.near(j.x, j.z)) continue;
      const [lx, lz] = c.toLocal(j.x, j.z);
      if (!c.enemy && lx > 26 && lx < 38 && lz > -12 && lz < 28 && j.y < c.deckY + 30) { this.crash(j, 'HIT THE ISLAND'); return; }
      if (j.y - 1 < c.deckY && !j.onGround && c.overHull(lx, lz)) { this.crash(j, 'RAMP STRIKE'); return; }
    }
    // Other aircraft: a mid-air is rare but deadly.
    for (let i = 0; i < this.entities.length; i++) {
      const e = this.entities[i];
      if (e === j || !e.alive || !e.radar || e.ship) continue;
      const d = (e.x - j.x) ** 2 + (e.y - j.y) ** 2 + (e.z - j.z) ** 2;
      const r = (e.radius || 8) * 0.8 + 6;
      if (d < r * r) {
        this.crash(j, 'MID-AIR COLLISION');
        if (e.takeDamage) e.takeDamage(1e4, this, j);
        return;
      }
    }
  }

  _stepGun(dt) {
    const j = this.player;
    const firing = this.firing && j && j.alive && !j.onGround && j.stores.gun > 0 && this.selected === 'gun';
    if (firing !== this.gunWasFiring) {
      this.emit(firing ? 'gunStart' : 'gunStop', {});
      this.gunWasFiring = firing;
    }
    if (!firing) { this.gunAcc = 0; return; }
    // 100 rounds per second. Every sixth round is a modelled tracer.
    this.gunAcc = (this.gunAcc || 0) + dt * 100;
    while (this.gunAcc >= 1) {
      this.gunAcc -= 1;
      if (j.stores.gun <= 0) break;
      j.stores.gun--;
      this.log.roundsFired++;
      this.bulletCount++;
      if (this.bulletCount % 3 !== 0) continue;
      const sp = 1040;
      const r = () => (this.random() - 0.5) * 0.006;
      const dx = j.fx + r(), dy = j.fy + r(), dz = j.fz + r();
      const b = {
        x: j.x + j.fx * 9 + j.rx * 0.8, y: j.y + j.fy * 9 + j.ry * 0.8, z: j.z + j.fz * 9 + j.rz * 0.8,
        vx: dx * sp + j.vx, vy: dy * sp + j.vy, vz: dz * sp + j.vz, life: 1.5, owner: j,
      };
      this.bullets.push(b);
      if (this.bulletCount % 6 === 0) this.fx.tracer(b.x, b.y, b.z, b.vx, b.vy, b.vz, b.life, true);
    }
    if (j.stores.gun <= 0) { this.say('GUN EMPTY', 'red', 2); this.firing = false; }
  }

  _stepBullets(dt) {
    const bs = this.bullets;
    for (let i = bs.length - 1; i >= 0; i--) {
      const b = bs[i];
      const nx = b.x + b.vx * dt, ny = b.y + b.vy * dt, nz = b.z + b.vz * dt;
      b.vy -= G * dt;
      let hit = false;
      if (b.owner === this.player) {
        for (let k = 0; k < this.entities.length; k++) {
          const e = this.entities[k];
          if (!e.alive || e === b.owner || !e.takeDamage || e.dying) continue;
          if (segHitsSphere(b.x, b.y, b.z, nx, ny, nz, e.x, e.y, e.z, (e.radius || 8) * 1.2)) {
            this.log.roundsHit += 3;
            e.takeDamage(7, this, b.owner);
            this.fx.add(KIND.SPARK, e.x, e.y, e.z, 0, 0, 0, 0.3, 2);
            this.emit('gunHit', { target: e });
            hit = true;
            break;
          }
        }
      } else if (this.player && this.player.alive) {
        const p = this.player;
        if (segHitsSphere(b.x, b.y, b.z, nx, ny, nz, p.x, p.y, p.z, 9)) {
          p.takeDamage(4, this, 'GUNNED DOWN');
          this.log.hitsTaken += 0.1;
          this.emit('playerHit', { kind: 'gun' });
          hit = true;
        }
      }
      b.x = nx; b.y = ny; b.z = nz;
      b.life -= dt;
      if (hit || b.life <= 0 || ny < 0) {
        if (ny < 1 && !hit) this.fx.add(KIND.WATER, nx, 0.5, nz, 0, 12, 0, 0.5, 1.2);
        bs.splice(i, 1);
      }
    }
  }

  _stepDecoys(dt) {
    const ds = this.decoys;
    for (let i = ds.length - 1; i >= 0; i--) {
      const d = ds[i];
      d.age += dt;
      d.vx *= 1 - dt * 0.9; d.vz *= 1 - dt * 0.9;
      d.vy -= 3 * dt;
      d.x += d.vx * dt; d.y += d.vy * dt; d.z += d.vz * dt;
      if (d.age >= d.life) { ds.splice(i, 1); d.alive = false; }
    }
  }

  // Lock logic and threat warnings.
  _stepWeaponsSystem(dt) {
    const j = this.player;
    if (!j || !j.alive) { this.seekerState = 'off'; return; }
    // Keep a valid target: pick the nearest hostile if none is selected.
    if (this.target && (!this.target.alive || !this.target.radar || this.target.dying)) this.target = null;
    if (!this.target) {
      let best = null, bd = this.radarRange * 4;
      const c = this.radarContacts();
      for (let i = 0; i < c.length; i++) {
        const e = c[i];
        if (e.isMissile || e.side === 'blue') continue;
        const d = dist(e, j);
        if (d < bd) { bd = d; best = e; }
      }
      if (best) { this.target = best; this.lockT = 0; }
    }
    const t = this.target;
    const sel = this.selected;
    let locked = false, inRange = false;
    if (t && sel !== 'gun') {
      const w = WEAPONS[sel];
      const d = dist(t, j);
      const dx = (t.x - j.x) / (d || 1), dy = (t.y - j.y) / (d || 1), dz = (t.z - j.z) / (d || 1);
      const cos = dx * j.fx + dy * j.fy + dz * j.fz;
      inRange = d <= w.maxRange && d >= w.minRange && j.stores[sel] > 0;
      const coneDeg = sel === 'aim9' ? 11 : 55;
      const inCone = cos > Math.cos(coneDeg * DEG);
      if (inRange && inCone) {
        this.lockT += dt;
        locked = this.lockT > (sel === 'aim9' ? 0.8 : 1.3);
      } else this.lockT = 0;
      this.seekerState = sel === 'aim9' && j.stores.aim9 > 0 ? (locked ? 'lock' : inRange && inCone ? 'search' : 'search') : 'off';
    } else {
      this.seekerState = sel === 'aim9' && j.stores.aim9 > 0 ? 'search' : 'off';
      this.lockT = 0;
    }
    if (locked && !this.locked) this.emit('lockOn', { weapon: sel });
    this.locked = locked;
    this.inRange = inRange;
    // Missiles chasing us
    let ir = false, radar = false;
    for (let i = 0; i < this.entities.length; i++) {
      const e = this.entities[i];
      if (e.isMissile && e.alive && e.target === j) {
        if (e.w.seeker === 'ir') ir = true;
        else radar = true;
      }
    }
    this.incoming.ir = ir;
    this.incoming.radar = radar;
  }

  _stepAlerts(dt) {
    const j = this.player, a = this.alerts;
    void dt;
    if (!j || !j.alive) {
      a.stall = a.pullUp = a.bingo = false;
      return;
    }
    a.stall = j.stalled && !j.onGround;
    // Low and slow with the wheels up: the classic landing mistake
    const agl = j.y - this.world.heightAt(j.x, j.z);
    a.gearWarn = !j.onGround && !j.gearCmd && j.gear < 0.5 && agl < 260 && j.speed < 105 && j.vy < 1;
    const sink = -j.vy;
    const terrain = this.world.heightAt(j.x, j.z);
    const gearDownLanding = j.gearCmd && j.speed < 130;
    a.pullUp = !j.onGround && !gearDownLanding && (j.y - terrain) < Math.max(70, sink * 5) && sink > 3;
    const was = a.bingo;
    a.bingo = j.fuel < j.spec.fuel * 0.12;
    if (a.bingo && !was) { this.say('BINGO FUEL', 'red', 4); this.emit('bingo', {}); }
    if (j.fuel <= 0 && !this.flamedOut) {
      this.flamedOut = true;
      this.say('FLAME OUT', 'red', 6);
      this.emit('flameout', {});
    }
    const hadEnemy = a.enemy;
    a.enemy = false; a.friend = false;
    for (let i = 0; i < this.entities.length; i++) {
      const e = this.entities[i];
      if (!e.alive || !e.radar || e === j) continue;
      const d = dist(e, j);
      if (d < 40 * MI) {
        if (e.side === 'red') a.enemy = true;
        else if (e.side === 'blue' && !e.ship) a.friend = true;
      }
    }
    if (a.enemy && !hadEnemy && this.time > 2) { this.say('ALERT: ENEMY IN VICINITY', 'red', 4, true); this.emit('enemyAlert', {}); }
  }

  // Visual identification: anything within about 4 km is seen and called out.
  _stepIdent() {
    const j = this.player;
    if (!j || !j.alive) return;
    for (let i = 0; i < this.entities.length; i++) {
      const e = this.entities[i];
      if (e === j || !e.alive || !e.radar || e.isMissile || e.identified || e.ship || e.dying) continue;
      if (dist(e, j) < 4200) {
        e.identified = true;
        this.emit('identified', { target: e });
        const tag = e.side === 'red' ? 'HOSTILE' : e.side === 'blue' ? 'FRIENDLY' : 'CIVILIAN';
        this.say(`IDENT: ${e.name || 'AIRCRAFT'} - ${tag}`, e.side === 'red' ? 'red' : 'green', 4, false);
      }
    }
  }

  dropPod() {
    const j = this.player;
    if (!j || !j.alive) return;
    if (j.onGround || j.stores.pod <= 0) { this.say(j.stores.pod <= 0 ? 'NO RESCUE POD' : 'POD DROP IN FLIGHT ONLY', 'red', 2); return; }
    j.stores.pod--;
    const sim = this;
    const pod = {
      model: 'POD', alive: true, t: 0, x: j.x - j.ux * 2, y: j.y - j.uy * 2, z: j.z - j.uz * 2,
      vx: j.vx, vy: j.vy, vz: j.vz, rx: j.rx, ry: j.ry, rz: j.rz, ux: j.ux, uy: j.uy, uz: j.uz, fx: j.fx, fy: j.fy, fz: j.fz,
      step(dt) {
        this.t += dt;
        const chute = this.t > 1.2;
        const k = chute ? 2.2 : 0.015;
        this.vx -= this.vx * k * dt; this.vz -= this.vz * k * dt;
        if (chute) this.vy += (-12 - this.vy) * Math.min(1, dt * 1.6);
        else this.vy -= G * dt;
        this.x += this.vx * dt; this.y += this.vy * dt; this.z += this.vz * dt;
        if (chute && Math.floor(this.t * 12) !== Math.floor((this.t - dt) * 12)) sim.fx.add(KIND.WHITE, this.x, this.y + 3, this.z, 0, 0, 0, 1.2, 3);
        if (this.y <= 1) {
          this.alive = false;
          sim.podFlying = false;
          sim.fx.splash(this.x, this.z, 0.5);
          sim.emit('splash', { x: this.x, y: 0, z: this.z, small: true });
          const m = sim.m;
          if (m && m.raft && Math.hypot(this.x - m.raft.x, this.z - m.raft.z) < 230) { m.delivered = true; sim.say('POD DELIVERED', 'green', 4, true); }
        }
      },
    };
    this.entities.push(pod);
    this.podFlying = true;
    if (this.m) this.m.podOut = true;
    this.emit('podDrop', {});
    this.say('POD AWAY', 'green', 3);
  }

  _stepShipEffects(dt) {
    for (let i = 0; i < this.carriers.length; i++) {
      const c = this.carriers[i];
      if (!c.alive) continue;
      c.wakeTimer -= dt;
      if (c.wakeTimer <= 0 && c.speed > 0.5) {
        c.wakeTimer = 0.25;
        const r = () => (this.random() - 0.5) * 26;
        const [wx, wz] = c.toWorld(r(), -168);
        this.fx.add(KIND.WATER, wx, 0.5, wz, 0, 0, 0, 16, 5);
      }
    }
  }
}

function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z); }

function segHitsSphere(x0, y0, z0, x1, y1, z1, cx, cy, cz, r) {
  const dx = x1 - x0, dy = y1 - y0, dz = z1 - z0;
  const fx = x0 - cx, fy = y0 - cy, fz = z0 - cz;
  const a = dx * dx + dy * dy + dz * dz;
  const t = Math.max(0, Math.min(1, -(fx * dx + fy * dy + fz * dz) / (a || 1)));
  const qx = fx + dx * t, qy = fy + dy * t, qz = fz + dz * t;
  return qx * qx + qy * qy + qz * qz <= r * r;
}

export { MPS_PER_KT, FT_PER_M, FT };
