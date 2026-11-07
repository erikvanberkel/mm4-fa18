// Mission state machines: objective -> return -> landed. The player is teleported rather than flown,
// since flying is covered by sim.test.mjs; these tests check the rules.
import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/world/world.js';
import { Sim } from '../src/sim/sim.js';
import { MISSIONS, QUALIFICATION, playerLanded } from '../src/missions/missions.js';
import { DECK_Y } from '../src/gfx/models.js';
import { LANDMARKS, BASES } from '../src/world/geo.js';

const DT = 1 / 60;
const world = new World();
const NOCTL = { pitch: 0, roll: 0, rudder: 0 };
const mission = (id) => (id === 0 ? QUALIFICATION : MISSIONS.find((m) => m.id === id));

function start(id, seed = 1) {
  const sim = new Sim({ world, seed });
  const m = mission(id);
  sim.mission = m;
  m.setup(sim);
  sim.player.invulnerable = true; // the parked test pilot must not crash while the rules run
  return sim;
}
function run(sim, seconds, keepAlive = true) {
  for (let i = 0; i < seconds * 60 && !sim.missionDone; i++) {
    sim.step(DT, NOCTL);
    if (keepAlive && sim.player) { sim.player.alive = true; sim.over = null; }
  }
}
// Park the player stationary on the carrier deck, as after an arrested landing.
function parkOnCarrier(sim) {
  const c = sim.enterprise, j = sim.player;
  const [ox, oz] = c.toWorld(-12, -60);
  j.catapult = null; j.trap = null;
  j.x = ox; j.z = oz; j.y = DECK_Y + j.spec.gearH;
  j.vx = c.vx; j.vz = c.vz; j.vy = 0; j.onGround = true; j.speed = c.speed;
  j.engineOn = false; j.throttle = 0;
}
function parkOnRunway(sim, base) {
  const r = world.runways[BASES[base].rwy], j = sim.player;
  j.catapult = null;
  j.x = (r.a[0] + r.b[0]) / 2; j.z = (r.a[1] + r.b[1]) / 2; j.y = j.spec.gearH;
  j.vx = j.vy = j.vz = 0; j.onGround = true; j.speed = 0; j.engineOn = false;
}
function teleportNear(sim, e, dist = 2500) {
  const j = sim.player;
  j.x = e.x - e.fx * dist; j.y = e.y + 200; j.z = e.z - e.fz * dist;
  j.vx = e.vx; j.vy = 0; j.vz = e.vz; j.onGround = false; j.catapult = null;
}

test('mission 1: an airliner is identified, the pilot lands at SFO and succeeds', () => {
  let sim;
  for (let seed = 1; seed < 60; seed++) { sim = start(1, seed); if (sim.m.civilian) break; }
  assert.ok(sim.m.civilian, 'found a seed with a civilian');
  const b = sim.m.bandits[0];
  assert.equal(sim.m.phase, 'find');
  teleportNear(sim, b, 2500);
  run(sim, 1);
  assert.equal(sim.m.phase, 'return', 'identification completes the objective');
  assert.ok(b.identified);
  parkOnRunway(sim, 'SFO');
  run(sim, 1);
  assert.equal(sim.missionDone && sim.missionDone.result, 'success');
});

test('mission 1: shooting the airliner fails the mission', () => {
  let sim;
  for (let seed = 1; seed < 60; seed++) { sim = start(1, seed); if (sim.m.civilian) break; }
  sim.m.bandits[0].takeDamage(10, sim, sim.player);
  run(sim, 1);
  assert.equal(sim.missionDone.result, 'fail');
  assert.match(sim.missionDone.text, /CIVILIAN/);
});

test('mission 1: with hostile MiGs the pilot must destroy them, then land', () => {
  let sim;
  for (let seed = 1; seed < 60; seed++) { sim = start(1, seed); if (!sim.m.civilian) break; }
  assert.ok(!sim.m.civilian);
  for (const b of sim.m.bandits) b.takeDamage(1000, sim, sim.player);
  run(sim, 5);
  assert.equal(sim.m.phase, 'return');
  parkOnRunway(sim, 'SFO');
  run(sim, 1);
  assert.equal(sim.missionDone.result, 'success');
});

test('mission 2: Air Force One lands unopposed, then the pilot returns to the carrier', () => {
  const sim = start(2);
  for (const b of sim.m.bandits) b.alive = false; // no opposition
  run(sim, 600);
  assert.ok(sim.m.af1Down, 'AF1 should complete its approach and land');
  assert.equal(sim.m.phase, 'return');
  parkOnCarrier(sim);
  run(sim, 1);
  assert.equal(sim.missionDone.result, 'success');
});

test('mission 2: losing Air Force One fails the mission', () => {
  const sim = start(2);
  sim.m.af1.takeDamage(1000, sim, sim.player);
  run(sim, 2);
  assert.equal(sim.missionDone.result, 'fail');
  assert.match(sim.missionDone.text, /AIR FORCE ONE/);
});

test('mission 3: flying ahead of the stolen F-16s makes them decide; destroying everything completes it', () => {
  const sim = start(3, 4);
  const thief = sim.m.thieves[0];
  const j = sim.player;
  // sit in front of the lead F-16, level, matching speed, for the signal time
  for (let i = 0; i < 60 * 6 && !sim.m.decided; i++) {
    j.x = thief.x + thief.fx * 600; j.y = thief.y; j.z = thief.z + thief.fz * 600;
    j.vx = thief.vx; j.vy = 0; j.vz = thief.vz; j.onGround = false; j.catapult = null;
    j.fx = thief.fx; j.fy = 0; j.fz = thief.fz;
    sim.step(DT, NOCTL);
    j.alive = true;
  }
  assert.ok(sim.m.decided, 'the pilots responded to the signal');
  // whichever way they chose, wipe out the opposition and the thieves
  for (const t of sim.m.thieves) { t.landedSafe = true; t.alive = false; }
  for (const e of sim.m.escorts) e.alive = false;
  sim.m.surrender = false;
  run(sim, 3);
  assert.equal(sim.m.phase, 'return');
});

test('mission 4: a pod dropped on the raft is a success; the pilot returns to the carrier', () => {
  const sim = start(4);
  const j = sim.player, raft = sim.m.raft;
  for (const b of sim.m.bandits) b.alive = false;
  assert.equal(j.stores.pod, 1);
  j.catapult = null; j.onGround = false;
  j.x = raft.x; j.z = raft.z; j.y = 300; j.vx = j.vy = j.vz = 0;
  sim.dropPod();
  assert.equal(j.stores.pod, 0);
  const pod = sim.entities.find((e) => e.model === 'POD');
  pod.vx = 0; pod.vz = 0;
  run(sim, 60);
  assert.ok(sim.m.delivered, 'pod landed within reach of the pilot');
  assert.equal(sim.m.phase, 'return');
  parkOnCarrier(sim);
  run(sim, 1);
  assert.equal(sim.missionDone.result, 'success');
});

test('mission 4: a pod that misses the raft fails the mission', () => {
  const sim = start(4);
  const j = sim.player, raft = sim.m.raft;
  for (const b of sim.m.bandits) b.alive = false;
  j.catapult = null; j.onGround = false;
  j.x = raft.x + 3000; j.z = raft.z; j.y = 300; j.vx = j.vy = j.vz = 0;
  sim.dropPod();
  run(sim, 60);
  assert.equal(sim.missionDone.result, 'fail');
});

test('mission 5: destroying the cruise missile moves the mission to the return phase', () => {
  const sim = start(5);
  sim.m.msl.takeDamage(100, sim, sim.player);
  run(sim, 5);
  assert.equal(sim.m.phase, 'return');
  parkOnCarrier(sim);
  run(sim, 1);
  assert.equal(sim.missionDone.result, 'success');
});

test('mission 6: the sub carrier sinks after enough hits and takes its air wing with it', () => {
  const sim = start(6);
  const sub = sim.m.sub;
  assert.ok(sub.alive && !sub.dying);
  let hits = 0;
  while (!sub.dying && hits < 40) { sub.takeDamage(90, sim, sim.player); hits++; }
  assert.ok(hits >= 5 && hits <= 7, `sinking took ${hits} missile hits`);
  assert.ok(sub.dying);
  for (const b of sim.m.bandits) b.alive = false;
  run(sim, 20); // let her go down, with secondary explosions along the way
  assert.equal(sub.alive, false, 'sub carrier is gone');
  assert.equal(sim.m.phase, 'return');
});

test('qualification: reaching the Golden Gate brings the bogeys; killing them lets the pilot land and qualify', () => {
  const sim = start(0);
  const j = sim.player;
  j.catapult = null; j.onGround = false;
  j.x = LANDMARKS.fortPoint[0]; j.z = LANDMARKS.fortPoint[1]; j.y = 800;
  run(sim, 1);
  assert.equal(sim.m.phase, 'bogeys');
  assert.equal(sim.m.bandits.length, 2);
  for (const b of sim.m.bandits) b.takeDamage(1000, sim, sim.player);
  run(sim, 5);
  assert.equal(sim.m.phase, 'return');
  parkOnCarrier(sim);
  run(sim, 1);
  assert.equal(sim.missionDone.result, 'success');
  assert.match(sim.missionDone.text, /QUALIFIED/);
});

test('landing off the runway or on the wrong ship does not count', () => {
  const sim = start(2);
  const j = sim.player;
  j.catapult = null; j.onGround = true; j.speed = 0; j.vx = j.vy = j.vz = 0;
  // grass beside the airport
  j.x = world.runways[0].a[0] + 4000; j.z = world.runways[0].a[1] + 8000; j.y = 3;
  assert.equal(playerLanded(sim), null);
});
