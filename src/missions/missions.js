// The six missions plus the carrier qualification flight. Each mission builds its scenario on a
// fresh Sim, then `update` runs every tick and returns {result:'success'|'fail', text} when done.
import { AIPlane, brainFighter, brainGoto, brainAirlinerApproach } from '../sim/ai.js';
import { toWorld, LANDMARKS, CARRIER_START, BASES } from '../world/geo.js';
import { MI } from '../sim/sim.js';

const DEG = Math.PI / 180;

// Where is the player, relative to the places a mission cares about?
function distTo(a, b) { return Math.hypot(a.x - b[0], a.z - b[1]); }
function bearingDeg(from, to) { let h = (Math.atan2(to[0] - from.x, to[1] - from.z) * 180) / Math.PI; if (h < 0) h += 360; return Math.round(h); }

export function playerLanded(sim) {
  const j = sim.player;
  if (!j || !j.alive || !j.onGround || j.catapult || j.trap) return null;
  const surf = sim.surfaceUnder(j);
  const rel = surf.onDeck && surf.ref ? Math.hypot(j.vx - surf.ref.vx, j.vz - surf.ref.vz) : j.speed;
  if (rel > 3) return null;
  if (surf.onDeck && surf.ref && !surf.ref.enemy) return 'carrier';
  if (surf.type === 'runway') return 'runway';
  return null;
}

const skillFor = (sim, base = 0.35) => Math.min(0.95, base + 0.1 * sim.difficulty);

function spawn(sim, type, x, y, z, hdg, spd, brain) {
  const p = new AIPlane(type, x, y, z, hdg, spd);
  p.brain = brain;
  sim.add(p);
  return p;
}

// Everyone alive from a list?
const alive = (list) => list.filter((e) => e.alive && !e.dying);

function pointAtBearing(origin, bearing, dist) {
  const b = bearing * DEG;
  return [origin[0] + Math.sin(b) * dist, origin[1] + Math.cos(b) * dist];
}

function engageBrain(sim, getTarget, skill, opts) {
  const fighter = brainFighter(getTarget, skill, opts);
  return fighter;
}

// Once the objective is met every mission asks the pilot to bring the jet home.
function returnPhase(sim, text, where) {
  sim.m.phase = 'return';
  sim.m.home = where;
  sim.say(text, 'green', 9, true);
}

function checkReturn(sim, where) {
  const l = playerLanded(sim);
  if (!l) return null;
  if (where === 'carrier' && l !== 'carrier') return null;
  return { result: 'success', text: where === 'carrier' ? 'SAFELY ABOARD THE ENTERPRISE' : 'SAFELY DOWN' };
}

// ---------------------------------------------------------------------------------
export const MISSIONS = [
  {
    id: 1,
    name: 'VISUAL CONFIRMATION',
    start: 'SFO',
    aircraft: 'F18',
    briefing: [
      'AN UNIDENTIFIED AIRCRAFT IS HEADING FOR',
      'SAN FRANCISCO. LOCATE IT AND IDENTIFY IT.',
      '',
      'DO NOT FIRE UNLESS FIRED UPON.',
      '',
      'WHEN YOUR ASSIGNMENT IS COMPLETE, LAND',
      'AT SAN FRANCISCO INTERNATIONAL.',
    ],
    setup(sim) {
      const m = sim.m = { phase: 'find', provoked: false, civilian: sim.random() < 0.25, bandits: [] };
      sim.spawnPlayerRunway('SFO', 'F18');
      const origin = toWorld(38.25, -123.15);
      const sf = toWorld(37.7, -122.4);
      const hdg = bearingDeg({ x: origin[0], z: origin[1] }, sf);
      const n = m.civilian ? 1 : Math.min(3, 1 + (sim.random() < 0.5 ? 1 : 0) + (sim.difficulty > 1 ? 1 : 0));
      for (let i = 0; i < n; i++) {
        const type = m.civilian ? 'B707' : 'MIG';
        const alt = m.civilian ? 5200 : 3800;
        const speed = m.civilian ? 215 : 240;
        const p = spawn(sim, type, origin[0] + i * 900, alt + i * 150, origin[1] + i * 700, hdg, speed, null);
        const cruise = brainGoto(sf[0], sf[1], alt, speed);
        const fighter = brainFighter(() => sim.player, skillFor(sim));
        p.brain = (pl, dt, s) => {
          if (!m.civilian && (m.provoked || distTo(sim.player, [pl.x, pl.z]) < 9000)) { m.provoked = true; fighter(pl, dt, s); }
          else cruise(pl, dt, s);
        };
        p.onHit = () => { m.provoked = true; };
        m.bandits.push(p);
      }
      sim.say(m.civilian ? 'UNKNOWN BOGEY ON RADAR. IDENTIFY.' : 'BOGEYS ON RADAR. IDENTIFY.', 'green', 7, true);
    },
    update(sim) {
      const m = sim.m, j = sim.player;
      // Shooting an airliner ends the mission.
      for (const b of m.bandits) {
        if (m.civilian && b.hp < b.type.hp) return { result: 'fail', text: 'YOU FIRED ON A CIVILIAN AIRLINER' };
      }
      if (m.phase === 'find') {
        if (m.civilian) {
          const b = m.bandits[0];
          if (b.identified) { returnPhase(sim, 'FRIENDLY AIRLINER. ASSIGNMENT COMPLETE. LAND AT SFO.', 'runway'); }
          else if (!b.alive) return { result: 'fail', text: 'THE AIRLINER WAS LOST' };
        } else {
          if (m.bandits.some((b) => b.identified && b.alive) && !m.announced) { m.announced = true; sim.say('HOSTILE MIG-29S. ROE: FIRE IF FIRED UPON.', 'red', 6, true); }
          if (alive(m.bandits).length === 0) returnPhase(sim, 'HOSTILES DESTROYED. ASSIGNMENT COMPLETE. LAND AT SFO.', 'runway');
        }
      } else if (m.phase === 'return') {
        return checkReturn(sim, 'runway');
      }
      if (!j.alive) return { result: 'fail', text: 'YOU WERE SHOT DOWN' };
      return null;
    },
  },

  // ----------------------------------------------------------------------------
  {
    id: 2,
    name: 'EMERGENCY DEFENSE OPERATION',
    start: 'CARRIER',
    aircraft: 'F18',
    briefing: [
      'AIR FORCE ONE IS INBOUND TO SAN FRANCISCO.',
      'HOSTILE FIGHTERS ARE CLOSING ON THE',
      'PRESIDENT. INTERCEPT THEM AT ALL COSTS.',
      '',
      'STAY ON STATION UNTIL THE PRESIDENT IS ON',
      'THE GROUND, THEN RETURN TO THE ENTERPRISE.',
    ],
    setup(sim) {
      const m = sim.m = { phase: 'defend', bandits: [], af1Down: false };
      sim.addCarrier();
      sim.spawnPlayerCarrier('F18');
      const sfo = sim.world.runways[BASES.SFO.rwy];
      const start = toWorld(37.9, -123.02);
      const af1 = spawn(sim, 'AF1', start[0], 3600, start[1], 118, 225, null);
      af1.brain = brainAirlinerApproach(sfo, 'a', { onLanded: () => { m.af1Down = true; } });
      af1.hp = 160;
      af1.name = 'AIR FORCE ONE';
      af1.identified = true;
      m.af1 = af1;
      const hostiles = Math.min(5, 2 + sim.difficulty);
      const origin = toWorld(38.35, -123.1);
      for (let i = 0; i < hostiles; i++) {
        const p = spawn(sim, 'MIG', origin[0] + i * 1500, 4600 + i * 200, origin[1] + i * 1100, 170, 250, null);
        const fighter = brainFighter(() => {
          // Go for the President unless the pilot is close enough to be a more urgent threat.
          if (!m.af1.alive) return sim.player;
          const dp = Math.hypot(sim.player.x - p.x, sim.player.y - p.y, sim.player.z - p.z);
          const da = Math.hypot(m.af1.x - p.x, m.af1.y - p.y, m.af1.z - p.z);
          return dp < 5500 && dp < da ? sim.player : m.af1;
        }, skillFor(sim, 0.4));
        p.brain = fighter;
        p.name = 'MIG-29';
        m.bandits.push(p);
      }
      sim.say('AIR FORCE ONE UNDER THREAT. INTERCEPT!', 'red', 7, true);
    },
    update(sim) {
      const m = sim.m, j = sim.player;
      if (!m.af1.alive && !m.af1Down) return { result: 'fail', text: 'AIR FORCE ONE WAS SHOT DOWN' };
      if (!j.alive) return { result: 'fail', text: 'YOU WERE SHOT DOWN' };
      if (m.phase === 'defend') {
        if (m.af1Down) {
          m.phase = 'cleanup';
          sim.say('AIR FORCE ONE IS DOWN SAFELY.', 'green', 6, true);
        }
      } else if (m.phase === 'cleanup') {
        if (m.af1Down && !m.returnCalled) { m.returnCalled = true; returnPhase(sim, 'RETURN TO THE ENTERPRISE AND LAND.', 'carrier'); }
      } else if (m.phase === 'return') {
        return checkReturn(sim, 'carrier');
      }
      return null;
    },
  },

  // ----------------------------------------------------------------------------
  {
    id: 3,
    name: 'INTERCEPT STOLEN AIRCRAFT',
    start: 'CARRIER',
    aircraft: 'F18',
    briefing: [
      'TWO USAF F-16S WITH SECRET ECM HARDWARE',
      'HAVE BEEN STOLEN AND ARE RUNNING FOR THE',
      'COAST WITH MIG-29 ESCORTS.',
      '',
      'FLY IN FRONT OF THEM TO SIGNAL SURRENDER.',
      'IF THEY REFUSE, STOP THEM FROM ESCAPING.',
    ],
    setup(sim) {
      const m = sim.m = { phase: 'chase', thieves: [], escorts: [], signalT: 0, decided: false, surrender: false, askedAt: 0 };
      sim.addCarrier();
      sim.spawnPlayerCarrier('F18');
      const origin = toWorld(37.75, -122.2);
      const west = toWorld(37.9, -125.5);
      for (let i = 0; i < 2; i++) {
        const p = spawn(sim, 'F16', origin[0] - i * 700, 3300 - i * 80, origin[1] + i * 500, 275, 255, null);
        p.name = 'F-16';
        p.ecm = true;
        p.identified = true;
        p.brain = brainGoto(west[0], west[1], 3300, 262);
        p.fleeing = true;
        m.thieves.push(p);
      }
      const nEsc = Math.min(4, 2 + (sim.difficulty > 1 ? 1 : 0));
      for (let i = 0; i < nEsc; i++) {
        const p = spawn(sim, 'MIG', origin[0] - 1800 - i * 700, 3400 + i * 120, origin[1] - 900 + i * 900, 275, 262, null);
        p.name = 'MIG-29';
        const cruise = brainGoto(west[0], west[1], 3400, 270);
        const fighter = brainFighter(() => sim.player, skillFor(sim, 0.4));
        p.brain = (pl, dt, s) => { if (m.escortsFree || m.provoked) fighter(pl, dt, s); else cruise(pl, dt, s); };
        p.onHit = () => { m.provoked = true; };
        m.escorts.push(p);
      }
      sim.say('STOLEN F-16S HEADING WEST. INTERCEPT.', 'red', 7, true);
    },
    update(sim, dt) {
      const m = sim.m, j = sim.player;
      if (!j.alive) return { result: 'fail', text: 'YOU WERE SHOT DOWN' };
      if (m.phase === 'chase') {
        // The surrender signal: sit in front of a thief, close, and roughly matched in speed.
        if (!m.decided) {
          for (const t of alive(m.thieves)) {
            const dx = j.x - t.x, dy = j.y - t.y, dz = j.z - t.z;
            const d = Math.hypot(dx, dy, dz);
            const ahead = (dx * t.fx + dy * t.fy + dz * t.fz) / (d || 1);
            if (d < 1500 && d > 120 && ahead > 0.93 && j.speed < t.speed * 1.35) {
              m.signalT += dt;
              if (m.signalT > 3.5) {
                m.decided = true;
                m.surrender = sim.random() < 0.45;
                if (m.surrender) {
                  sim.say('F-16s: WE SURRENDER! ESCORT US HOME.', 'green', 7, true);
                  const home = sim.world.runways[BASES.ALAMEDA.rwy];
                  for (const th of alive(m.thieves)) {
                    th.fleeing = false;
                    th.side = 'blue';
                    th.brain = brainAirlinerApproach(home, 'a', { onLanded: () => { th.landedSafe = true; } });
                  }
                  m.escortsFree = true;
                } else {
                  sim.say('NO RESPONSE. STOP THEM!', 'red', 6, true);
                }
              }
              break;
            }
            m.signalT = Math.max(0, m.signalT - dt * 0.5);
          }
        }
        // Done when every thief is destroyed or down safely, and the escorts are dealt with
        const thievesOpen = m.thieves.filter((t) => t.alive && !t.dying && !t.landedSafe && !t.landed);
        const hostile = alive(m.escorts);
        if (thievesOpen.length === 0 && hostile.length === 0) {
          returnPhase(sim, 'TARGETS NEUTRALISED. RETURN TO THE ENTERPRISE.', 'carrier');
        } else if (m.surrender && m.thieves.some((t) => !t.alive && !t.landedSafe)) {
          return { result: 'fail', text: 'YOU SHOT DOWN A SURRENDERING PILOT' };
        } else {
          // They reached the open Pacific
          for (const t of thievesOpen) if (t.x < -230000) return { result: 'fail', text: 'THE STOLEN AIRCRAFT ESCAPED' };
        }
      } else if (m.phase === 'return') {
        return checkReturn(sim, 'carrier');
      }
      return null;
    },
  },

  // ----------------------------------------------------------------------------
  {
    id: 4,
    name: 'SEARCH AND RESCUE OPERATION',
    start: 'CARRIER',
    aircraft: 'F18',
    briefing: [
      'AN ENTERPRISE PILOT HAS EJECTED NEAR THE',
      'FARALLON ISLANDS. FIND HIM AND DROP THE',
      'RESCUE POD WITHIN HIS REACH  (SHIFT-F).',
      '',
      'ENEMY FIGHTERS ARE IN THE AREA AND WILL',
      'TRY TO STOP YOU. THEN RETURN TO THE SHIP.',
    ],
    setup(sim) {
      const m = sim.m = { phase: 'search', bandits: [], delivered: false, podOut: false };
      sim.addCarrier();
      const j = sim.spawnPlayerCarrier('F18');
      j.stores.pod = 1;
      const raftAt = toWorld(37.64, -123.14);
      const raft = {
        model: 'RAFT', alive: true, radar: true, side: 'blue', name: 'PILOT', identified: true, radius: 14, keep: false,
        x: raftAt[0], y: 0.6, z: raftAt[1], vx: 0, vy: 0, vz: 0, speed: 0,
        rx: 1, ry: 0, rz: 0, ux: 0, uy: 1, uz: 0, fx: 0, fy: 0, fz: 1,
        step(dt, s) {
          // a signal flare every few seconds so the pilot can be found by eye
          this.t = (this.t || 0) + dt;
          if (this.t > 0.5) { this.t = 0; s.fx.add(1, this.x, 5, this.z, 0, 8, 0, 4, 2.5); s.fx.add(3, this.x, 6, this.z, 0.6, 9, 0.2, 7, 3); }
        },
        takeDamage() {},
      };
      sim.add(raft);
      m.raft = raft;
      const nHostile = Math.min(4, 2 + (sim.difficulty > 0 ? 1 : 0));
      for (let i = 0; i < nHostile; i++) {
        const a = (i / nHostile) * 6.28 + 0.8;
        const p = spawn(sim, 'MIG', raftAt[0] + Math.cos(a) * 9000, 3600, raftAt[1] + Math.sin(a) * 9000, 0, 230, null);
        p.name = 'MIG-29';
        const fighter = brainFighter(() => sim.player, skillFor(sim, 0.35));
        let angle = a;
        p.brain = (pl, dt, s) => {
          const d = Math.hypot(sim.player.x - pl.x, sim.player.z - pl.z);
          if (m.alerted || d < 14000) { m.alerted = true; fighter(pl, dt, s); return; }
          angle += dt * 0.05;
          const wx = raftAt[0] + Math.cos(angle + 0.7) * 9000, wz = raftAt[1] + Math.sin(angle + 0.7) * 9000;
          pl.des.psi = Math.atan2(wx - pl.x, wz - pl.z);
          pl.des.y = 3600; pl.des.speed = 230; pl.des.climb = null;
        };
        p.onHit = () => { m.alerted = true; };
        m.bandits.push(p);
      }
      sim.say(`RAFT LAST SEEN BEARING ${bearingDeg({ x: j.x, z: j.z }, raftAt)}. FIND HIM.`, 'green', 8, true);
    },
    update(sim) {
      const m = sim.m, j = sim.player;
      if (!j.alive) return { result: 'fail', text: 'YOU WERE SHOT DOWN' };
      if (m.phase === 'search') {
        if (m.delivered) returnPhase(sim, 'POD DELIVERED. RETURN TO THE ENTERPRISE.', 'carrier');
        else if (m.podOut && !sim.podFlying && !m.delivered) {
          // the pod splashed and missed
          if (!m.warned) { m.warned = true; sim.say('POD MISSED THE RAFT. NO SECOND POD.', 'red', 6, true); }
          return { result: 'fail', text: 'THE POD MISSED THE PILOT' };
        }
      } else if (m.phase === 'return') {
        return checkReturn(sim, 'carrier');
      }
      return null;
    },
  },

  // ----------------------------------------------------------------------------
  {
    id: 5,
    name: 'INTERCEPT INCOMING CRUISE MISSILE',
    start: 'CARRIER',
    aircraft: 'F18',
    briefing: [
      'A CRUISE MISSILE IS INBOUND FOR SAN',
      'FRANCISCO AT 200 FEET. IT IS SMALL AND',
      'FAST. YOU MUST DESTROY IT BEFORE IT',
      'REACHES THE CITY.',
      '',
      'GET LOW. FIRE WHEN YOU HAVE A TONE.',
    ],
    setup(sim) {
      const m = sim.m = { phase: 'intercept', impact: false };
      sim.addCarrier();
      const j = sim.spawnPlayerCarrier('F18');
      const target = LANDMARKS.transamerica;
      const start = pointAtBearing(target, 262, 72000 - sim.difficulty * 6000);
      const hdg = bearingDeg({ x: start[0], z: start[1] }, target);
      const speed = 250 + sim.difficulty * 12;
      const msl = spawn(sim, 'CRUISE', start[0], 60, start[1], hdg, speed, null);
      msl.lowFlyer = true;
      msl.name = 'CRUISE MSL';
      msl.identified = true;
      msl.des.maxBank = 40 * DEG;
      msl.brain = (p) => {
        // Terrain following at about 200 feet
        const ahead = Math.max(p.speed * 2.5, 400);
        const h = Math.max(
          sim.world.heightAt(p.x, p.z),
          sim.world.heightAt(p.x + p.vx * 1.5, p.z + p.vz * 1.5),
          sim.world.heightAt(p.x + (p.vx / Math.max(1, p.speed)) * ahead, p.z + (p.vz / Math.max(1, p.speed)) * ahead),
        );
        p.des.y = h + 62;
        p.des.psi = Math.atan2(target[0] - p.x, target[1] - p.z);
        p.des.speed = speed;
        p.des.climb = null;
        if (Math.hypot(target[0] - p.x, target[1] - p.z) < 450) {
          m.impact = true;
          sim.fx.explosion(p.x, 40, p.z, 3.4);
          sim.emit('explode', { x: p.x, y: 40, z: p.z, big: true });
          p.alive = false;
        }
      };
      m.msl = msl;
      m.target = target;
      sim.say(`CRUISE MISSILE BEARING ${bearingDeg({ x: j.x, z: j.z }, start)}. FIND IT LOW.`, 'red', 8, true);
    },
    update(sim) {
      const m = sim.m, j = sim.player;
      if (m.impact) return { result: 'fail', text: 'THE MISSILE HIT SAN FRANCISCO' };
      if (!j.alive) return { result: 'fail', text: 'YOU WERE SHOT DOWN' };
      if (m.phase === 'intercept') {
        if (!m.msl.alive) returnPhase(sim, 'MISSILE DESTROYED. RETURN TO THE ENTERPRISE.', 'carrier');
      } else if (m.phase === 'return') {
        return checkReturn(sim, 'carrier');
      }
      return null;
    },
  },

  // ----------------------------------------------------------------------------
  {
    id: 6,
    name: 'CARRIER SUB MISSION',
    start: 'CARRIER',
    aircraft: 'F18',
    briefing: [
      'INTELLIGENCE REPORTS A SUBMERSIBLE AIRCRAFT',
      'CARRIER SURFACED NORTH-WEST OF THE FLEET,',
      'WITH ITS AIR WING LAUNCHING.',
      '',
      'DESTROY THE CARRIER AND ITS AIRCRAFT.',
      'EXPECT HEAVY OPPOSITION.',
    ],
    setup(sim) {
      const m = sim.m = { phase: 'strike', bandits: [], launchT: 0, launched: 0, samT: 6 };
      sim.addCarrier();
      const j = sim.spawnPlayerCarrier('F18');
      const at = toWorld(38.32, -123.55);
      const sub = sim.addCarrier(true, at[0], at[1], 40, 7);
      sub.radar = true;
      sub.name = 'SUB CARRIER';
      sub.hp = 520;
      m.sub = sub;
      const n = Math.min(5, 3 + (sim.difficulty > 0 ? 1 : 0));
      for (let i = 0; i < n; i++) {
        const a = (i / n) * 6.28;
        const p = spawn(sim, 'MIG', at[0] + Math.cos(a) * 5000, 2600 + i * 200, at[1] + Math.sin(a) * 5000, 90 + i * 70, 230, null);
        p.name = 'MIG-29';
        const fighter = brainFighter(() => sim.player, skillFor(sim, 0.4));
        let ang = a;
        p.brain = (pl, dt, s) => {
          const d = Math.hypot(sim.player.x - pl.x, sim.player.z - pl.z);
          if (m.alerted || d < 22000) { m.alerted = true; fighter(pl, dt, s); return; }
          ang += dt * 0.04;
          pl.des.psi = Math.atan2(at[0] + Math.cos(ang + 0.8) * 5000 - pl.x, at[1] + Math.sin(ang + 0.8) * 5000 - pl.z);
          pl.des.y = 2600; pl.des.speed = 230; pl.des.climb = null;
        };
        p.onHit = () => { m.alerted = true; };
        m.bandits.push(p);
      }
      sim.say(`SUB CARRIER BEARING ${bearingDeg({ x: j.x, z: j.z }, at)}. DESTROY IT.`, 'red', 8, true);
    },
    update(sim, dt) {
      const m = sim.m, j = sim.player;
      if (!j.alive) return { result: 'fail', text: 'YOU WERE SHOT DOWN' };
      if (m.phase === 'strike') {
        const sub = m.sub;
        // Surface-to-air missiles when the pilot comes within reach
        if (sub.alive && !sub.dying) {
          const d = Math.hypot(j.x - sub.x, j.z - sub.z);
          m.samT -= dt;
          if (d < 14000 && j.y < 9000 && m.samT <= 0) {
            m.samT = 15 - 3 * Math.min(3, sim.difficulty);
            const owner = { x: sub.x, y: 60, z: sub.z, vx: 0, vy: 30, vz: 0, fx: 0, fy: 1, fz: 0, rx: 1, ry: 0, rz: 0, ux: 0, uy: 0, uz: -1, side: 'red' };
            sim.enemyFire(owner, j, 'radar');
          }
          // Reinforcements launch from the deck
          m.launchT += dt;
          if (m.launchT > 75 && m.launched < 2) {
            m.launchT = 0; m.launched++;
            const p = spawn(sim, 'MIG', sub.x, 300, sub.z, 200, 220, null);
            p.name = 'MIG-29';
            p.brain = brainFighter(() => sim.player, skillFor(sim, 0.4));
            m.bandits.push(p);
            if (d < 30000) sim.say('MORE BANDITS LAUNCHING FROM THE SUB CARRIER', 'red', 5, true);
          }
        }
        if ((!sub.alive || sub.dying) && alive(m.bandits).length === 0) returnPhase(sim, 'CARRIER SUNK. RETURN TO THE ENTERPRISE.', 'carrier');
      } else if (m.phase === 'return') {
        return checkReturn(sim, 'carrier');
      }
      return null;
    },
  },
];

// ---------------------------------------------------------------------------------
// The qualification flight: launch, fly the bay, deal with two bogeys, trap aboard.
export const QUALIFICATION = {
  id: 0,
  name: 'QUALIFICATION FLIGHT',
  start: 'CARRIER',
  aircraft: 'F18',
  briefing: [
    'TAKE OFF FROM THE ENTERPRISE, FLY OVER THE',
    'GOLDEN GATE, AND HANDLE ANY BOGEYS YOU MEET.',
    '',
    'THEN LAND BACK ON THE CARRIER.',
    'APPROACH FROM ASTERN, HOOK DOWN, GEAR DOWN,',
    'AND CATCH A WIRE.',
  ],
  setup(sim) {
    const m = sim.m = { phase: 'gate', bandits: [] };
    sim.addCarrier();
    sim.spawnPlayerCarrier('F18');
    sim.say('QUALIFICATION. LAUNCH, THEN FLY TO THE GOLDEN GATE.', 'green', 8, true);
  },
  update(sim) {
    const m = sim.m, j = sim.player;
    if (!j.alive) return { result: 'fail', text: 'YOU DID NOT QUALIFY' };
    if (m.phase === 'gate') {
      if (distTo(j, LANDMARKS.fortPoint) < 3500 && !j.onGround) {
        m.phase = 'bogeys';
        const at = toWorld(37.95, -122.75);
        for (let i = 0; i < 2; i++) {
          const p = spawn(sim, 'MIG', at[0] + i * 1200, 3200, at[1] + i * 800, 200, 250, null);
          p.name = 'MIG-29';
          p.brain = brainFighter(() => sim.player, 0.28);
          m.bandits.push(p);
        }
        sim.say('BOGEYS! TWO MIG-29S. ROE: WEAPONS FREE.', 'red', 7, true);
      }
    } else if (m.phase === 'bogeys') {
      if (alive(m.bandits).length === 0) returnPhase(sim, 'BOGEYS DOWN. RETURN TO THE ENTERPRISE AND LAND.', 'carrier');
    } else if (m.phase === 'return') {
      const r = checkReturn(sim, 'carrier');
      if (r) return { result: 'success', text: 'QUALIFIED. ACTIVE COMBAT STATUS.' };
    }
    return null;
  },
};

export const FREE_FLIGHT_STARTS = {
  1: { key: 'SFO', label: 'SAN FRANCISCO INTL' },
  2: { key: 'ALAMEDA', label: 'ALAMEDA NAVAL AIR STATION' },
  3: { key: 'MOFFETT', label: 'MOFFETT FIELD NAVAL AIR STATION' },
  4: { key: 'CARRIER', label: 'USS ENTERPRISE (CVN-65)' },
};

export function missionById(id) { return id === 0 ? QUALIFICATION : MISSIONS.find((m) => m.id === id); }
export { MI, CARRIER_START };
