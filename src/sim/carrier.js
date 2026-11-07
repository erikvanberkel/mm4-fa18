// USS Enterprise (CVN-65) and the enemy submersible carrier: a moving deck with catapults,
// arresting wires, and a Fresnel lens for carrier approaches.
import { DECK_Y, DECK_OUTLINE, LANDING, CATAPULT } from '../gfx/models.js';

function inPoly(poly, x, z) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
}

export class Carrier {
  constructor(x, z, headingDeg, speedKts, enemy = false) {
    this.model = enemy ? 'SUBCARRIER' : 'CARRIER';
    this.enemy = enemy;
    this.name = enemy ? 'SUB CARRIER' : 'USS ENTERPRISE';
    this.alive = true;
    this.side = enemy ? 'red' : 'blue';
    this.ship = true;
    this.x = x; this.y = 0; this.z = z;
    this.headingDeg = headingDeg;
    const h = (headingDeg * Math.PI) / 180;
    const c = Math.cos(h), s = Math.sin(h);
    this.fx = s; this.fy = 0; this.fz = c;
    this.rx = c; this.ry = 0; this.rz = -s;
    this.ux = 0; this.uy = 1; this.uz = 0;
    const v = speedKts * 0.514444;
    this.vx = s * v; this.vy = 0; this.vz = c * v;
    this.speed = v;
    this.deckY = DECK_Y;
    this.radius = 180;
    this.hp = enemy ? 450 : 1e9;
    this.radar = enemy;
    this.dotColor = 0;
    this.wake = [];
    this.wakeTimer = 0;
    this.dying = false;
    this.dyingT = 0;
    this.boomT = 0;
  }

  step(dt, sim) {
    this.x += this.vx * dt;
    this.z += this.vz * dt;
    if (this.dying && sim) {
      // Chain of secondary explosions along the deck while she goes down by the stern.
      this.dyingT += dt;
      this.y -= dt * 1.6;
      this.boomT -= dt;
      if (this.boomT <= 0) {
        this.boomT = 0.25 + sim.random() * 0.5;
        const [wx, wz] = this.toWorld((sim.random() - 0.5) * 60, (sim.random() - 0.5) * 300);
        const y = Math.max(2, this.deckY + this.y + sim.random() * 14);
        sim.fx.explosion(wx, y, wz, 1.2 + sim.random() * 1.6);
        sim.emit('explode', { x: wx, y, z: wz, big: sim.random() < 0.3 });
      }
      if (this.dyingT > 16) this.alive = false;
    }
  }

  takeDamage(amount, sim, by) {
    if (!this.enemy || this.dying) return;
    this.hp -= amount;
    const [wx, wz] = this.toWorld((sim.random() - 0.5) * 40, (sim.random() - 0.5) * 200);
    sim.fx.explosion(wx, this.deckY + 2, wz, 0.7);
    if (this.hp <= 0) {
      this.dying = true;
      this.dyingT = 0;
      this.boomT = 0;
      this.radar = false;
      sim.emit('kill', { target: this, by });
      sim.say('SUB CARRIER DESTROYED', 'green', 6, true);
    }
  }

  toLocal(x, z) {
    const dx = x - this.x, dz = z - this.z;
    return [dx * this.rx + dz * this.rz, dx * this.fx + dz * this.fz];
  }
  toWorld(lx, lz) {
    return [this.x + lx * this.rx + lz * this.fx, this.z + lx * this.rz + lz * this.fz];
  }
  near(x, z) { return (x - this.x) ** 2 + (z - this.z) ** 2 < 260 * 260; }
  deckContains(lx, lz) { return inPoly(DECK_OUTLINE, lx, lz); }
  overHull(lx, lz) { return lz > -166 && lz < 166 && Math.abs(lx) < 38; }

  // Along-deck coordinates of a world point, ramp = 0.
  landingCoords(x, z) {
    const [lx, lz] = this.toLocal(x, z);
    const px = lx - LANDING.from[0], pz = lz - LANDING.from[1];
    const a = px * LANDING.dir[0] + pz * LANDING.dir[1];
    const b = px * LANDING.dir[1] - pz * LANDING.dir[0];
    return [a, b];
  }
  // Direction of the landing deck in the world, degrees.
  landingHeading() {
    const dx = LANDING.dir[0], dz = LANDING.dir[1];
    const wx = dx * this.rx + dz * this.fx, wz = dx * this.rz + dz * this.fz;
    let h = (Math.atan2(wx, wz) * 180) / Math.PI;
    if (h < 0) h += 360;
    return h;
  }
  landingDir() {
    const dx = LANDING.dir[0], dz = LANDING.dir[1];
    return [dx * this.rx + dz * this.fx, dx * this.rz + dz * this.fz];
  }
  rampWorld() { return this.toWorld(LANDING.from[0], LANDING.from[1]); }

  // Has the hook just crossed a wire?
  wireCrossed(jet) {
    const [a, b] = this.landingCoords(jet.x, jet.z);
    const hookA = a - 8.5; // Hook point is aft of the centre of gravity.
    const last = jet._lastHookA;
    jet._lastHookA = hookA;
    if (last === undefined || Math.abs(b) > LANDING.halfWidth) return 0;
    const height = jet.y - jet.spec.gearH - DECK_Y;
    if (height > 2.8) return 0;
    for (let i = 0; i < LANDING.wires.length; i++) {
      const w = LANDING.wires[i];
      if (last < w && hookA >= w) return i + 1;
    }
    return 0;
  }

  catapultStroke() { return CATAPULT.z1 - CATAPULT.z0; }
  placeOnCatapult(jet, s, v = 0) {
    const [wx, wz] = this.toWorld(CATAPULT.x, CATAPULT.z0 + s);
    jet.x = wx; jet.z = wz;
    jet.y = DECK_Y + jet.spec.gearH;
    jet.fx = this.fx; jet.fy = 0; jet.fz = this.fz;
    jet._setLevelBasis(0);
    jet.vx = this.vx + this.fx * v;
    jet.vz = this.vz + this.fz * v;
    jet.vy = 0;
    jet.onGround = true;
  }

  // The "meatball": how far above or below the 3.5 degree glideslope, in units of ±1 at ±1 degree,
  // plus line-up off the landing centreline. null when the jet isn't astern of the ship.
  lens(jet) {
    const [a, b] = this.landingCoords(jet.x, jet.z);
    const touch = LANDING.wires[2];
    const range = touch - a;
    if (range < 20 || range > 7000) return null;
    const hookY = jet.y - DECK_Y - jet.spec.gearH * 0.6;
    const angle = (Math.atan2(hookY, range) * 180) / Math.PI;
    const ball = (angle - 3.5) / 1.0;
    const lineup = (Math.atan2(b, range) * 180) / Math.PI;
    return { ball, lineup, range, angle };
  }

  explodeable() { return this.enemy; }
}
