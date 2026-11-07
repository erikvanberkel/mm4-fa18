// Every non-flight screen: boot, main menu, free-flight setup, mission list, briefing, loading,
// debrief and the pilot's flight log. Layout follows the original's colour-coded text menus.
import { C } from '../gfx/palette.js';
import { FONT_SMALL } from '../gfx/fonts.js';
import { MENU_FONT, typed, blink, bigText, LOGO_RAMP, bigWidth } from '../ui/widgets.js';
import { MISSIONS, QUALIFICATION, FREE_FLIGHT_STARTS, missionById } from '../missions/missions.js';
import { toWorld, BASES, LANDMARKS, CARRIER_START } from '../world/geo.js';

const digit = (inp) => {
  for (let n = 0; n <= 9; n++) if (inp.pressed('Digit' + n) || inp.pressed('Numpad' + n)) return n;
  return -1;
};
const fire = (inp) => inp.pressed('Space') || inp.pressed('Enter') || inp.pressed('NumpadEnter');

// ---------------------------------------------------------------------------------
export class BootScreen {
  constructor(game) { this.game = game; this.t = 0; }
  update(dt) {
    this.t += dt;
    const inp = this.game.input;
    if (inp.edge.size > 0 && this.t > 0.25) this.game.startAudioThenTitle();
  }
  render(g) {
    g.clear(C.BLACK);
    bigText(g, 'F/A-18', 88, 70, 3, LOGO_RAMP, { pitch: 24 });
    bigText(g, 'INTERCEPTOR', 28, 102, 3, LOGO_RAMP, { pitch: 24 });
    g.textC(this.game.loadingText || 'A LOVING REMAKE OF THE 1988 AMIGA CLASSIC', 160, 150, C.G7, FONT_SMALL);
    if (blink(this.t, 1.6)) g.textC('PRESS ANY KEY', 160, 190, C.WHITE, MENU_FONT);
    g.textC('TURN YOUR SPEAKERS UP', 160, 214, C.G5, FONT_SMALL);
    g.textC('DROP A SOUND FILE HERE TO USE YOUR OWN TITLE MUSIC', 160, 232, C.G4, FONT_SMALL);
  }
}

// ---------------------------------------------------------------------------------
const MENU_ITEMS = [
  { n: 1, text: 'DEMO', color: C.GREEN, y: 52, gap: 0 },
  { n: 2, text: 'FREE FLIGHT, NO ENEMY CONFRONTATION', color: C.GREEN, y: 68 },
  { n: 3, text: 'TRAINING:  DEMO OF MANEUVERS', color: C.BLUE_T, y: 92 },
  { n: 4, text: 'TRAINING:  PRACTICE MANEUVERS', color: C.BLUE_T, y: 108 },
  { n: 5, text: 'QUALIFICATION: REQUIRED FOR MISSIONS', color: C.BLUE_T, y: 124 },
  { n: 6, text: 'SELECTABLE MISSIONS', color: C.RED_L, y: 148 },
  { n: 7, text: 'NEXT ACTIVE ADVANCED MISSION', color: C.RED_L, y: 164 },
  { n: 8, text: 'YOUR CURRENT FLIGHT LOG STATISTICS', color: C.ORANGE, y: 188 },
];

export class MenuScreen {
  constructor(game, notice = null) { this.game = game; this.t = 0; this.notice = notice; this.noticeT = notice ? 3 : 0; }
  enter() { this.game.musicFor('menu'); }
  update(dt) {
    this.t += dt;
    if (this.noticeT > 0) this.noticeT -= dt;
    const g = this.game, inp = g.input;
    const n = digit(inp);
    if (inp.pressed('KeyU') && inp.shift) { g.log.unlockAll(); this.say('ALL MISSIONS UNLOCKED'); return; }
    if (n < 1 || n > 8) return;
    g.sfx.ui('select');
    switch (n) {
      case 1: g.launch({ kind: 'demo' }, { skipBriefing: true }); break;
      case 2: g.setScreen(new FreeFlightScreen(g)); break;
      case 3: g.launch({ kind: 'train-demo' }, { skipBriefing: true }); break;
      case 4: g.launch({ kind: 'train-practice' }, { skipBriefing: true }); break;
      case 5: g.setScreen(new BriefingScreen(g, { kind: 'qual' }, QUALIFICATION)); break;
      case 6:
        if (!g.log.unlocked) { this.say('QUALIFICATION REQUIRED FIRST (OPTION 5)'); break; }
        g.setScreen(new MissionListScreen(g));
        break;
      case 7: {
        if (!g.log.unlocked) { this.say('QUALIFICATION REQUIRED FIRST (OPTION 5)'); break; }
        const id = g.log.nextMission();
        const spec = { kind: 'mission', missionId: id, difficulty: Math.min(3, g.log.timesDone(id)) };
        g.setScreen(new BriefingScreen(g, spec, missionById(id)));
        break;
      }
      case 8: g.setScreen(new LogScreen(g)); break;
      default: break;
    }
  }
  say(text) { this.notice = text; this.noticeT = 3.2; this.game.sfx.ui('back'); }
  render(g) {
    g.clear(C.BLACK);
    g.textC('F/A-18 INTERCEPTOR', 160, 2, C.BLUE_T, MENU_FONT);
    g.text('SELECT:', 14, 28, C.G6, MENU_FONT);
    const lock = !this.game.log.unlocked;
    for (const it of MENU_ITEMS) {
      const dim = lock && (it.n === 6 || it.n === 7);
      const col = dim ? C.G4 : it.color;
      g.text(String(it.n), 14, it.y, col, MENU_FONT);
      g.text('...', 27, it.y, col, MENU_FONT);
      g.text(it.text, 51, it.y, col, MENU_FONT);
    }
    g.text('ESC ......... RESTARTS YOUR SELECTION', 14, 214, C.G6, MENU_FONT);
    g.text('SHIFT ESC ... RETURNS YOU TO THIS MENU', 14, 230, C.G6, MENU_FONT);
    if (this.game.audioReady) g.text('SHIFT-M MUSIC: ' + this.game.themeName(), 14, 240, C.G4, FONT_SMALL);
    if (this.noticeT > 0) {
      g.rect(0, 28, 320, 10, C.BLACK);
      g.text(this.notice, 14, 28, blink(this.t, 4) ? C.YELLOW : C.WHITE, MENU_FONT);
    }
    const r = this.game.log.rank;
    g.textR(`${r.name}  CALLSIGN ${this.game.log.d.callsign}`, 316, 247, C.G5, FONT_SMALL);
  }
}

// ---------------------------------------------------------------------------------
export class FreeFlightScreen {
  constructor(game) { this.game = game; this.t = 0; this.aircraft = 'F18'; }
  update(dt) {
    this.t += dt;
    const g = this.game, inp = g.input;
    if (inp.pressed('Escape')) { g.sfx.ui('back'); g.toMenu(); return; }
    if (inp.pressed('KeyF')) { this.aircraft = 'F16'; g.sfx.ui('click'); }
    if (inp.pressed('KeyH')) { this.aircraft = 'F18'; g.sfx.ui('click'); }
    const n = digit(inp);
    if (n === 0) { g.sfx.ui('select'); g.launch({ kind: 'free', start: 'AIR', aircraft: this.aircraft }, { skipBriefing: true }); }
    const s = FREE_FLIGHT_STARTS[n];
    if (s) {
      g.sfx.ui('select');
      const ac = s.key === 'CARRIER' ? 'F18' : this.aircraft;
      g.launch({ kind: 'free', start: s.key, aircraft: ac }, { skipBriefing: true });
    }
  }
  render(g) {
    g.clear(C.BLACK);
    g.textC('FREE FLIGHT', 160, 2, C.GREEN, MENU_FONT);
    g.text('AIRCRAFT:', 14, 28, C.G6, MENU_FONT);
    g.text('F ... F-16 FALCON', 30, 46, this.aircraft === 'F16' ? C.YELLOW : C.GREEN, MENU_FONT);
    g.text('H ... F/A-18 HORNET', 30, 62, this.aircraft === 'F18' ? C.YELLOW : C.GREEN, MENU_FONT);
    g.text('START AT:', 14, 92, C.G6, MENU_FONT);
    g.text('1 ... SAN FRANCISCO INTL', 30, 110, C.BLUE_T, MENU_FONT);
    g.text('2 ... ALAMEDA NAVAL AIR STATION', 30, 126, C.BLUE_T, MENU_FONT);
    g.text('3 ... MOFFETT FIELD NAS', 30, 142, C.BLUE_T, MENU_FONT);
    g.text('4 ... USS ENTERPRISE (F/A-18 ONLY)', 30, 158, C.RED_L, MENU_FONT);
    g.text('0 ... AIRBORNE OVER THE BAY', 30, 182, C.ORANGE, MENU_FONT);
    g.text('ESC ......... BACK TO THE MENU', 14, 230, C.G6, MENU_FONT);
  }
}

// ---------------------------------------------------------------------------------
export class MissionListScreen {
  constructor(game) { this.game = game; this.t = 0; this.sel = 0; this.list = []; }
  enter() {
    const log = this.game.log;
    this.list = log.d.unlocked || log.d.qualified || /unlock/.test(typeof location !== 'undefined' ? location.search : '')
      ? (log.d.unlocked ? MISSIONS.map((m) => m.id) : log.available()) : [];
    if (this.list.length === 0) this.list = log.available();
  }
  update(dt) {
    this.t += dt;
    const g = this.game, inp = g.input;
    if (inp.pressed('Escape')) { g.toMenu(); return; }
    if (inp.pressed('ArrowUp')) { this.sel = (this.sel + this.list.length - 1) % this.list.length; g.sfx.ui('click'); }
    if (inp.pressed('ArrowDown')) { this.sel = (this.sel + 1) % this.list.length; g.sfx.ui('click'); }
    const n = digit(inp);
    if (n >= 1 && n <= 6 && this.list.includes(n)) this.sel = this.list.indexOf(n);
    if (fire(inp) || (n >= 1 && n <= 6 && this.list.includes(n))) {
      const id = this.list[this.sel];
      g.sfx.ui('select');
      g.setScreen(new BriefingScreen(g, { kind: 'mission', missionId: id, difficulty: Math.min(3, g.log.timesDone(id)) }, missionById(id)));
    }
  }
  render(g) {
    g.clear(C.BLACK);
    g.textC('SELECTABLE MISSIONS', 160, 2, C.RED_L, MENU_FONT);
    const log = this.game.log;
    this.list.forEach((id, i) => {
      const m = missionById(id);
      const done = log.timesDone(id);
      const y = 36 + i * 24;
      const on = i === this.sel;
      g.text(String(id), 16, y, on ? C.YELLOW : C.RED_L, MENU_FONT);
      g.text('...', 30, y, on ? C.YELLOW : C.RED_L, MENU_FONT);
      g.text(m.name, 56, y, on ? C.YELLOW : C.RED_L, MENU_FONT);
      g.text(done ? `COMPLETED ${done} TIME${done > 1 ? 'S' : ''}${done ? '  (HARDER EACH TIME)' : ''}` : 'NEW', 56, y + 10, done ? C.GREEN : C.ORANGE, FONT_SMALL);
    });
    g.text('UP/DOWN OR NUMBER, FIRE TO BRIEFING', 14, 214, C.G6, FONT_SMALL);
    g.text('ESC ......... BACK TO THE MENU', 14, 230, C.G6, MENU_FONT);
  }
}

// ---------------------------------------------------------------------------------
// Mission start/objective markers for the briefing map
function mapMarkers(spec, mission) {
  const m = [];
  const carrier = CARRIER_START;
  if (mission.start === 'SFO') m.push({ at: toWorld(37.62, -122.38), label: 'SFO', color: C.GREEN });
  else m.push({ at: carrier, label: 'CVN-65', color: C.GREEN });
  switch (mission.id) {
    case 0: m.push({ at: LANDMARKS.fortPoint, label: 'GATE', color: C.YELLOW }); break;
    case 1: m.push({ at: toWorld(38.25, -123.15), label: 'BOGEY', color: C.RED_L }); break;
    case 2: m.push({ at: toWorld(37.9, -123.55), label: 'AF1', color: C.GREEN }); m.push({ at: toWorld(38.5, -123.05), label: 'BANDITS', color: C.RED_L }); break;
    case 3: m.push({ at: toWorld(37.75, -122.2), label: 'F-16S', color: C.RED_L }); break;
    case 4: m.push({ at: toWorld(37.64, -123.14), label: 'PILOT', color: C.YELLOW }); break;
    case 5: m.push({ at: toWorld(37.64, -124.0), label: 'MISSILE', color: C.RED_L }); m.push({ at: LANDMARKS.transamerica, label: 'SF', color: C.G10 }); break;
    case 6: m.push({ at: toWorld(38.32, -123.55), label: 'SUB CARRIER', color: C.RED_L }); break;
    default: break;
  }
  return m;
}

export class BriefingScreen {
  constructor(game, spec, mission) { this.game = game; this.spec = spec; this.mission = mission; this.t = 0; }
  enter() { this.game.musicFor('menu'); }
  update(dt) {
    const prev = Math.floor(this.t * 38);
    this.t += dt;
    const g = this.game, inp = g.input;
    // teletype ticks while the text types out
    if (Math.floor(this.t * 38) !== prev && Math.floor(this.t * 38) % 3 === 0 && this.t < 6) g.sfx.ui('tty');
    if (inp.pressed('Escape')) { g.sfx.ui('back'); g.toMenu(); return; }
    if (this.t > 0.4 && fire(inp)) { g.sfx.ui('select'); g.launch(this.spec, { skipBriefing: true }); }
  }
  render(g) {
    g.clear(C.BLACK);
    const m = this.mission;
    g.textC(m.id === 0 ? 'QUALIFICATION FLIGHT' : `MISSION ${m.id}`, 160, 2, C.RED_L, MENU_FONT);
    g.textC(m.name, 160, 16, C.ORANGE, MENU_FONT);
    const diff = this.spec.difficulty || 0;
    if (diff > 0) g.textC(`REPEAT SORTIE: ENEMY SKILL +${diff}`, 160, 29, C.YELLOW, FONT_SMALL);
    // briefing text, typed out
    const full = m.briefing.join('\n');
    const lines = typed(full, this.t, 38).split('\n');
    lines.forEach((ln, i) => g.text(ln, 8, 42 + i * 9, C.GREEN, FONT_SMALL));
    // map, framed around the places this mission uses
    const mv = this.game.map;
    const mx = 8, my = 112, mw = 176, mh = 108;
    const marks = mapMarkers(this.spec, m);
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const k of marks) { minX = Math.min(minX, k.at[0]); maxX = Math.max(maxX, k.at[0]); minZ = Math.min(minZ, k.at[1]); maxZ = Math.max(maxZ, k.at[1]); }
    const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
    const mpp = Math.max(700, Math.max((maxX - minX) / (mw * 0.62), (maxZ - minZ) / (mh * 0.62)));
    const proj = mv.draw(g, mx, my, mw, mh, cx, cz, mpp, C.LAND_D, C.SEA2, C.LAND);
    g.rect(mx - 1, my - 1, mw + 2, 1, C.G5); g.rect(mx - 1, my + mh, mw + 2, 1, C.G5);
    g.rect(mx - 1, my - 1, 1, mh + 2, C.G5); g.rect(mx + mw, my - 1, 1, mh + 2, C.G5);
    g.setClip(mx, my, mx + mw, my + mh);
    for (const mk of marks) {
      const [px, py] = proj.project(mk.at[0], mk.at[1]);
      if (blink(this.t + mk.at[0] * 0.0001, 2.5)) g.rect(px - 2, py - 2, 4, 4, mk.color);
      else g.rect(px - 1, py - 1, 2, 2, mk.color);
      g.text(mk.label, px + 4, py - 3, mk.color, FONT_SMALL, C.BLACK);
    }
    g.setClip(0, 0, 320, 256);
    // aircraft block, right of the map
    g.text('YOUR AIRCRAFT', 192, 114, C.G6, FONT_SMALL);
    ['F/A-18 HORNET', 'AIM-9L X2', 'AIM-120A X4', 'M61 20MM 570', 'CHAFF X30', 'FLARES X30', 'ECM POD'].forEach((t, i) => g.text(t, 192, 126 + i * 9, C.G10, FONT_SMALL));
    if (blink(this.t, 1.8)) g.textC('PRESS FIRE TO LAUNCH', 160, 228, C.WHITE, MENU_FONT);
    g.text('ESC ... MENU', 232, 247, C.G6, FONT_SMALL);
  }
}

// ---------------------------------------------------------------------------------
// A short fake floppy load: the head steps, the motor whirrs, then the flight begins.
export class LoadingScreen {
  constructor(game, spec) { this.game = game; this.spec = spec; this.t = 0; this.track = 0; this.next = 0.2; this.done = false; }
  enter() { this.game.sfx.silence(); this.game.sfx.floppyStart(); this.game.sfx.ui('insert'); }
  update(dt) {
    this.t += dt;
    this.next -= dt;
    if (this.next <= 0 && this.t < 1.35) { this.next = 0.07 + Math.random() * 0.12; this.track = (this.track + 1 + ((Math.random() * 3) | 0)) % 80; this.game.sfx.ui('step'); }
    if (this.t > 1.45 && !this.done) {
      this.done = true;
      this.game.sfx.floppyStop();
      this.game.beginFlight(this.spec);
    }
  }
  render(g) {
    g.clear(C.BLACK);
    g.textC('LOADING', 160, 100, C.G8, MENU_FONT);
    // the cylinder/track counter
    g.textC(`TRACK ${String(this.track).padStart(2, '0')}  SIDE 0`, 160, 120, C.G5, FONT_SMALL);
    const w = Math.min(120, Math.floor(this.t / 1.4 * 120));
    g.rect(100, 134, 120, 4, C.G2);
    g.rect(100, 134, w, 4, C.G7);
  }
}

// ---------------------------------------------------------------------------------
export class DebriefScreen {
  constructor(game, info) { this.game = game; this.info = info; this.t = 0; }
  enter() { this.game.musicFor('none'); }
  update(dt) {
    this.t += dt;
    const g = this.game, inp = g.input;
    if (inp.pressed('Escape') || inp.pressed('Enter') || inp.pressed('NumpadEnter')) { g.sfx.ui('select'); g.toMenu(); return; }
    if (this.t > 0.6 && inp.pressed('Space')) {
      g.sfx.ui('select');
      const s = this.info.spec;
      // success moves the story on; failure retries the same sortie
      if (s.kind === 'mission' && this.info.success) { const id = g.log.nextMission(); g.setScreen(new BriefingScreen(g, { kind: 'mission', missionId: id, difficulty: Math.min(3, g.log.timesDone(id)) }, missionById(id))); }
      else g.launch(s, { skipBriefing: true });
    }
  }
  render(g) {
    g.clear(C.BLACK);
    const { info, success, seconds, sim } = this.info;
    const free = this.info.spec.kind === 'free' || this.info.spec.kind.startsWith('train') || this.info.spec.kind === 'demo';
    const col = success ? C.GREEN : C.RED_L;
    g.textC(success ? (this.info.spec.kind === 'qual' ? 'QUALIFIED' : 'MISSION COMPLETE') : (free ? 'FLIGHT ENDED' : 'MISSION FAILED'), 160, 20, col, MENU_FONT);
    g.textC(String(info.text || '').slice(0, 42), 160, 38, C.G10, FONT_SMALL);
    const st = sim.log;
    const mm = Math.floor(seconds / 60), ss = Math.floor(seconds % 60);
    const rows = [
      ['FLIGHT TIME', `${mm}:${String(ss).padStart(2, '0')}`],
      ['MISSILES FIRED', String(st.shots)],
      ['MISSILE HITS', String(st.hits)],
      ['CANNON ROUNDS', String(st.roundsFired)],
      ['CANNON HITS', String(st.roundsHit)],
      ['ENEMY AIRCRAFT DESTROYED', String(st.kills)],
      ['HITS SUFFERED', String(Math.round(st.hitsTaken))],
    ];
    rows.forEach(([k, v], i) => { g.text(k, 40, 64 + i * 14, C.G8, MENU_FONT); g.textR(v, 280, 64 + i * 14, C.G10, MENU_FONT); });
    const r = this.game.log.rank;
    g.textC(`RANK ${r.name}`, 160, 176, C.ORANGE, MENU_FONT);
    if (blink(this.t, 1.8)) g.textC(success && this.info.spec.kind === 'mission' ? 'FIRE: NEXT MISSION   ENTER: MENU' : 'FIRE: FLY AGAIN   ENTER: MENU', 160, 214, C.WHITE, FONT_SMALL);
  }
}

// ---------------------------------------------------------------------------------
export class LogScreen {
  constructor(game) { this.game = game; this.t = 0; this.confirm = false; }
  update(dt) {
    this.t += dt;
    const g = this.game, inp = g.input;
    if (this.confirm) {
      if (inp.pressed('KeyY')) { g.log.reset(); this.confirm = false; g.sfx.ui('select'); }
      else if (inp.edge.size) this.confirm = false;
      return;
    }
    if (inp.pressed('Escape') || fire(inp)) { g.sfx.ui('back'); g.toMenu(); return; }
    if (inp.pressed('Digit2') && inp.shift) this.confirm = true;
  }
  render(g) {
    g.clear(C.BLACK);
    const d = this.game.log.d, r = this.game.log.rank;
    g.textC('FLIGHT LOG', 160, 2, C.ORANGE, MENU_FONT);
    const hrs = Math.floor(d.flightTime / 3600), mins = Math.floor((d.flightTime % 3600) / 60), secs = Math.floor(d.flightTime % 60);
    const rows = [
      ['CALLSIGN', d.callsign],
      ['RANK', r.name],
      ['QUALIFIED', d.qualified ? 'YES' : 'NO'],
      ['MISSIONS STARTED', String(d.started)],
      ['MISSIONS COMPLETED', String(d.completed)],
      ['WEAPONS FIRED', String(d.fired + d.roundsFired)],
      ['WEAPON HITS', String(d.hits + d.roundsHit)],
      ['ENEMY AIRCRAFT DESTROYED', String(d.kills)],
      ['FLIGHT TIME', `${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`],
      ['CRASHES', String(d.crashes)],
      ['HITS FROM ENEMY MISSILES', String(d.hitsTaken)],
    ];
    rows.forEach(([k, v], i) => { g.text(k, 20, 24 + i * 12, C.G8, MENU_FONT); g.textR(v, 300, 24 + i * 12, C.G10, MENU_FONT); });
    g.text('MISSIONS', 20, 164, C.G6, MENU_FONT);
    for (let i = 1; i <= 6; i++) {
      const x = 20 + (i - 1) * 46;
      const n = d.done[i] || 0;
      g.text(String(i), x, 178, n ? C.GREEN : C.G4, MENU_FONT);
      g.text(n ? `X${n}` : '--', x + 10, 178, n ? C.GREEN : C.G4, MENU_FONT);
    }
    if (this.confirm) g.textC('ERASE THE LOG?  Y = YES', 160, 200, blink(this.t, 4) ? C.RED_L : C.WHITE, MENU_FONT);
    else g.text('SHIFT-2 ... RESET LOG     ESC ... MENU', 14, 230, C.G6, FONT_SMALL);
  }
}

export { bigWidth };
