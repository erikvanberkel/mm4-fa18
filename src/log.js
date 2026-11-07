// The pilot's flight log, saved in the browser. Tracks everything the original manual lists:
// missions started and completed, weapons fired and hits, flight time, crashes, hits suffered.
const KEY = 'fa18-interceptor-log-v1';

const RANKS = [
  [0, 'ROOKIE', 'R'], [2, 'ENSIGN', 'E'], [4, 'LIEUTENANT JG', 'LJ'], [7, 'LIEUTENANT', 'L'],
  [11, 'LT COMMANDER', 'LC'], [16, 'COMMANDER', 'C'], [22, 'CAPTAIN', 'CP'],
];

const blank = () => ({
  callsign: 'R', qualified: false, started: 0, completed: 0, done: {}, fired: 0, hits: 0,
  flightTime: 0, crashes: 0, hitsTaken: 0, roundsFired: 0, roundsHit: 0, kills: 0, trapped: 0, unlocked: false,
});

export class FlightLog {
  constructor(storage = typeof localStorage !== 'undefined' ? localStorage : null) {
    this.storage = storage;
    this.d = blank();
    try {
      const raw = storage && storage.getItem(KEY);
      if (raw) this.d = { ...blank(), ...JSON.parse(raw) };
    } catch { /* private mode or corrupt: start fresh */ }
  }
  save() { try { if (this.storage) this.storage.setItem(KEY, JSON.stringify(this.d)); } catch { /* ignore */ } }
  reset() { const cs = this.d.callsign; this.d = blank(); this.d.callsign = cs; this.save(); }

  get rank() {
    let r = RANKS[0];
    for (const x of RANKS) if (this.d.completed >= x[0]) r = x;
    return { name: r[1], code: r[2] };
  }
  get unlocked() { return this.d.qualified || this.d.unlocked || (typeof location !== 'undefined' && /[?&]unlock/.test(location.search)); }
  unlockAll() { this.d.unlocked = true; this.save(); }

  isDone(id) { return (this.d.done[id] || 0) > 0; }
  timesDone(id) { return this.d.done[id] || 0; }
  // First mission not yet completed, or the least-flown one once everything has been done.
  nextMission(count = 6) {
    for (let i = 1; i <= count; i++) if (!this.isDone(i)) return i;
    let best = 1;
    for (let i = 2; i <= count; i++) if (this.timesDone(i) < this.timesDone(best)) best = i;
    return best;
  }
  available(count = 6) {
    const out = [];
    const next = this.nextMission(count);
    for (let i = 1; i <= count; i++) if (this.isDone(i) || i === next) out.push(i);
    return out;
  }

  startMission() { this.d.started++; this.save(); }
  // Fold a finished flight into the totals. stats: sim.log; seconds: time aloft.
  record({ stats, seconds, crashed, missionId, success }) {
    const d = this.d;
    d.flightTime += seconds;
    d.fired += stats.shots || 0;
    d.hits += stats.hits || 0;
    d.roundsFired += stats.roundsFired || 0;
    d.roundsHit += stats.roundsHit || 0;
    d.hitsTaken += Math.round(stats.hitsTaken || 0);
    d.kills += stats.kills || 0;
    if (crashed) d.crashes++;
    if (success) {
      if (missionId === 0) d.qualified = true;
      else { d.done[missionId] = (d.done[missionId] || 0) + 1; d.completed++; }
    }
    this.save();
  }
}
