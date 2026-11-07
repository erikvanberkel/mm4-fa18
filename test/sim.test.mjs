// Regression tests for the flight model, carrier operations and missions. Headless, deterministic.
import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/world/world.js';
import { Sim } from '../src/sim/sim.js';
import { Autopilot } from '../src/sim/autopilot.js';
import { LandingPilot } from '../src/sim/landing.js';
import { AIPlane } from '../src/sim/ai.js';
import { DECK_Y } from '../src/gfx/models.js';
import { MISSIONS, QUALIFICATION, playerLanded } from '../src/missions/missions.js';
import { toWorld } from '../src/world/geo.js';

const DT = 1 / 60;
const world = new World();
const NOCTL = { pitch: 0, roll: 0, rudder: 0 };

test('takeoff from SFO: rotates near 200 knots and climbs away', () => {
  const sim = new Sim({ world });
  const j = sim.spawnPlayerRunway('SFO');
  j.throttle = 1; j.afterburner = true;
  let liftKts = 0;
  for (let i = 0; i < 60 * 30 && j.alive; i++) {
    // rotate at 175 kt, then hold a 14 degree climb attitude like a pilot would
    const hold = Math.max(-0.3, Math.min(0.3, (14 - j.pitchDeg()) * 0.04));
    const ctl = { pitch: j.onGround && j.knots() > 175 ? 0.5 : (!j.onGround && j.y < 800 ? hold : 0), roll: 0, rudder: 0 };
    const was = j.onGround;
    sim.step(DT, ctl);
    if (was && !j.onGround) liftKts = j.knots();
    if (!j.onGround && j.y > 30) j.gearCmd = false;
  }
  assert.ok(j.alive, 'survived');
  assert.ok(liftKts > 150 && liftKts < 260, `lift-off speed ${liftKts.toFixed(0)} kt`);
  assert.ok(j.y > 300, `climbed to ${j.y.toFixed(0)} m`);
  assert.ok(j.mach > 0.6, 'accelerating');
});

test('flying into the sea ends the flight', () => {
  const sim = new Sim({ world });
  const [x, z] = toWorld(37.7, -123.3);
  const j = sim.spawnPlayerAir(x, 60, z, 90, 120);
  j.throttle = 0.2;
  for (let i = 0; i < 60 * 20 && j.alive; i++) sim.step(DT, { pitch: -0.3, roll: 0, rudder: 0 });
  assert.equal(j.alive, false);
  assert.equal(sim.over.kind, 'crash');
});

test('level flight is stable with a centred stick', () => {
  const sim = new Sim({ world });
  const [x, z] = toWorld(37.7, -123.3);
  const j = sim.spawnPlayerAir(x, 3000, z, 90, 200);
  j.throttle = 0.7;
  const ap = new Autopilot(j);
  ap.alt = 3000;
  for (let i = 0; i < 60 * 30; i++) sim.step(DT, ap.step(DT));
  assert.ok(Math.abs(j.y - 3000) < 120, `altitude drift ${(j.y - 3000).toFixed(0)} m`);
  assert.ok(Math.abs(j.bankDeg()) < 3);
  assert.ok(Math.abs(j.headingDeg() - 90) < 3);
});

test('classic model: afterburner tops out near Mach 1.8', () => {
  const sim = new Sim({ world });
  const [x, z] = toWorld(37.7, -123.3);
  const j = sim.spawnPlayerAir(x, 4500, z, 90, 220);
  const ap = new Autopilot(j);
  ap.alt = 4500;
  for (let i = 0; i < 60 * 90; i++) { j.throttle = 1; j.afterburner = true; sim.step(DT, ap.step(DT)); }
  assert.ok(j.mach > 1.55 && j.mach < 2.0, `AB Mach ${j.mach.toFixed(2)}`);
});

test('every training maneuver completes and leaves the jet flying upright', () => {
  for (const name of ['AILERON ROLL', 'BREAK TURN', 'INSIDE LOOP', 'SPLIT-S', 'VERTICAL HALF-LOOP', 'BARREL ROLL', 'INVERTED FLIGHT']) {
    const sim = new Sim({ world });
    const [x, z] = toWorld(37.7, -123.3);
    const j = sim.spawnPlayerAir(x, 4500, z, 90, 230);
    const ap = new Autopilot(j);
    ap.alt = 4500; j.throttle = 0.8;
    for (let i = 0; i < 240; i++) sim.step(DT, ap.step(DT));
    ap.start(name);
    let t = 0;
    while (ap.busy && t < 85 && j.alive) { sim.step(DT, ap.step(DT)); t += DT; }
    for (let i = 0; i < 60 * 10; i++) sim.step(DT, ap.step(DT));
    assert.ok(j.alive, `${name}: crashed (${sim.over && sim.over.reason})`);
    assert.ok(t < 84, `${name}: did not finish (${t.toFixed(0)} s)`);
    assert.ok(j.uy > 0.8, `${name}: left inverted`);
  }
});

test('catapult launch flies the jet off the bow', () => {
  const sim = new Sim({ world });
  sim.addCarrier();
  const j = sim.spawnPlayerCarrier();
  j.throttle = 1; j.afterburner = true;
  for (let i = 0; i < 60 * 14 && j.alive; i++) sim.step(DT, NOCTL);
  assert.ok(j.alive, 'alive after the shot');
  assert.ok(!j.catapult, 'released');
  assert.ok(j.knots() > 250, `speed ${j.knots().toFixed(0)} kt`);
  assert.ok(j.y > DECK_Y + 20, 'climbing away from the deck');
});

test('carrier landing: a glideslope approach catches a wire and stops on the moving deck', () => {
  for (const [startA, startB] of [[-5400, 0], [-6000, 120], [-5000, -150]]) {
    const sim = new Sim({ world });
    const car = sim.addCarrier();
    const [ox, oz] = car.rampWorld(), [dx, dz] = car.landingDir();
    const j = sim.spawnPlayerAir(ox + dx * startA + dz * startB, DECK_Y + 290, oz + dz * startA - dx * startB, car.landingHeading(), 85);
    j.vx += car.vx; j.vz += car.vz;
    j.gearCmd = true; j.gear = 1; j.hook = true;
    const lp = new LandingPilot(j, 'carrier', car);
    let trap = false;
    for (let i = 0; i < 60 * 160 && j.alive && !lp.done; i++) {
      sim.step(DT, lp.step(DT, sim));
      for (const e of sim.events) if (e.type === 'trap') trap = true;
      sim.events.length = 0;
    }
    assert.ok(j.alive, `crashed: ${sim.over && sim.over.reason} (start ${startA}, ${startB})`);
    assert.ok(trap, 'caught a wire');
    assert.equal(playerLanded(sim), 'carrier');
  }
});

test('landing on the runway at SFO', () => {
  const sim = new Sim({ world });
  const rwy = world.runways[0];
  const hdg = (Math.atan2(rwy.ux, rwy.uz) * 180) / Math.PI;
  const j = sim.spawnPlayerAir(rwy.a[0] - rwy.ux * 6000, 330, rwy.a[1] - rwy.uz * 6000, hdg, 80);
  j.gearCmd = true; j.gear = 1;
  const lp = new LandingPilot(j, 'runway', { runway: rwy, end: 'a' });
  for (let i = 0; i < 60 * 160 && j.alive && !lp.done; i++) sim.step(DT, lp.step(DT, sim));
  assert.ok(j.alive, `crashed: ${sim.over && sim.over.reason}`);
  assert.equal(playerLanded(sim), 'runway');
});

test('every mission sets up and runs for 60 seconds without errors', () => {
  for (const mission of [QUALIFICATION, ...MISSIONS]) {
    const sim = new Sim({ world, seed: 99 + mission.id });
    sim.mission = mission;
    mission.setup(sim);
    assert.ok(sim.player, `${mission.name}: no player`);
    const j = sim.player;
    j.throttle = 1;
    for (let i = 0; i < 60 * 60; i++) {
      sim.step(DT, { pitch: j.onGround && j.knots() > 175 ? 0.5 : 0, roll: 0, rudder: 0 });
      if (!j.alive) break;
    }
    assert.ok(sim.entities.length > 1, `${mission.name}: scenario empty`);
    assert.ok(mission.briefing.length >= 5);
  }
});

test('mission 5: unopposed, the cruise missile reaches San Francisco', () => {
  const sim = new Sim({ world, seed: 5 });
  const m = MISSIONS.find((x) => x.id === 5);
  sim.mission = m;
  m.setup(sim);
  let result = null;
  for (let i = 0; i < 60 * 420 && !result; i++) {
    sim.step(DT, NOCTL);
    sim.player.alive = true; // keep the parked player from ending the scenario early
    if (sim.missionDone) result = sim.missionDone;
  }
  assert.ok(result, 'mission should end');
  assert.equal(result.result, 'fail');
  assert.match(result.text, /SAN FRANCISCO/);
});

test('missile guidance: an AIM-9 fired with lock kills a MiG ahead', () => {
  const sim = new Sim({ world });
  const [x, z] = toWorld(37.7, -123.3);
  const j = sim.spawnPlayerAir(x, 3000, z, 90, 250);
  j.throttle = 0.8;
  const mig = new AIPlane('MIG', x + 4500, 3000, z + 100, 90, 230);
  mig.brain = (p) => { p.des.psi = Math.PI / 2; p.des.speed = 230; p.des.y = 3000; };
  sim.add(mig);
  sim.selected = 'aim9';
  sim.target = mig;
  let fired = false;
  for (let i = 0; i < 60 * 40 && mig.alive && !mig.dying; i++) {
    sim.step(DT, NOCTL);
    if (sim.locked && !fired) { sim.fireWeapon(true); fired = true; }
  }
  assert.ok(fired, 'lock was achieved');
  assert.ok(mig.dying || !mig.alive, 'MiG destroyed');
});

test('the cannon kills a target in front of it', () => {
  const sim = new Sim({ world });
  const [x, z] = toWorld(37.7, -123.3);
  const j = sim.spawnPlayerAir(x, 3000, z, 90, 250);
  j.throttle = 0.8;
  const mig = new AIPlane('MIG', x + 600, 3000, z, 90, 230);
  mig.brain = (p) => { p.des.psi = Math.PI / 2; p.des.speed = 230; p.des.y = 3000; };
  sim.add(mig);
  sim.selected = 'gun';
  sim.target = mig;
  sim.fireWeapon(true);
  for (let i = 0; i < 60 * 8 && mig.alive && !mig.dying; i++) sim.step(DT, NOCTL);
  assert.ok(mig.dying || !mig.alive, 'cannon should destroy the MiG');
  assert.ok(j.stores.gun < 570, 'rounds were expended');
});
