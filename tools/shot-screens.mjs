// Renders every screen headlessly to shots/*.png using a mock input. Catches runtime errors in UI code.
import fs from 'node:fs';
import { savePng } from './png.mjs';
import { Gfx } from '../src/gfx/gfx.js';
import { FLIGHT_PALETTE } from '../src/gfx/palette.js';
import { World } from '../src/world/world.js';
import { buildAll } from '../src/gfx/models.js';
import { SceneRenderer } from '../src/render/scene.js';
import { MapView } from '../src/ui/map.js';
import { FlightLog } from '../src/log.js';
import { Game } from '../src/game.js';
import { MenuScreen, FreeFlightScreen, MissionListScreen, BriefingScreen, LoadingScreen, DebriefScreen, LogScreen, BootScreen } from '../src/screens/menus.js';
import { TitleScreen } from '../src/screens/title.js';
import { FlightScreen } from '../src/screens/flight.js';
import { missionById } from '../src/missions/missions.js';

const scale = Number(process.argv[2] || 1);
const only = process.argv[3] || '';
const gfx = new Gfx(scale);
gfx.setPalette(FLIGHT_PALETTE);
const world = new World();
const models = buildAll();
const scene = new SceneRenderer(gfx, world, models);
const map = new MapView(world);
const store = { d: {}, getItem(k) { return this.d[k] || null; }, setItem(k, v) { this.d[k] = v; } };
const log = new FlightLog(store);
const pressedSet = new Set();
const input = {
  edge: new Set(), shift: false, pad: null, stick: { pitch: 0, roll: 0, rudder: 0 },
  pressed: (c) => pressedSet.has(c), held: () => false, axes: () => ({ pitch: 0, roll: 0, rudder: 0 }), pollPad() {}, endFrame() { pressedSet.clear(); },
};
const display = { present() {}, mode: 1 };
const game = new Game({ gfx, display, input, world, models, scene, map, log });
game.sfx.muted = true;

function save(name) {
  if (only && !name.includes(only)) return;
  gfx.setPalette(FLIGHT_PALETTE, game.fade, game.flash);
  savePng(gfx, `shots/${name}.png`);
}
function run(name, screen, seconds, snaps = [seconds]) {
  game.fade = 1; game.flash = 0;
  game.setScreen(screen);
  let t = 0;
  const dt = 1 / 30;
  const queue = [...snaps];
  let n = 0;
  while (t < seconds + 1e-6) {
    screen.update(dt);
    t += dt;
    if (queue.length && t >= queue[0] - 1e-6) {
      gfx.setClip(0, 0, 320, 256);
      screen.render(gfx);
      save(snaps.length > 1 ? `${name}-${n++}` : name);
      queue.shift();
    }
  }
}

const t0 = performance.now();
run('s-boot', new BootScreen(game), 0.8);
run('s-menu', new MenuScreen(game), 0.5);
run('s-free', new FreeFlightScreen(game), 0.3);
log.d.unlocked = true;
run('s-missions', new MissionListScreen(game), 0.3);
run('s-brief', new BriefingScreen(game, { kind: 'mission', missionId: 2 }, missionById(2)), 3.5);
run('s-brief6', new BriefingScreen(game, { kind: 'mission', missionId: 6 }, missionById(6)), 4);
run('s-loading', new LoadingScreen(game, { kind: 'free', start: 'SFO' }), 0.7);
run('s-log', new LogScreen(game), 0.3);
run('s-title', new TitleScreen(game), 62, [1, 3.4, 9, 14, 25, 40, 58, 61]);
console.log('menus+title', ((performance.now() - t0) | 0) + ' ms');

// Flight screens, a few seconds each
const flights = [
  ['f-free-sfo', { kind: 'free', start: 'SFO', aircraft: 'F18' }, 6],
  ['f-free-carrier', { kind: 'free', start: 'CARRIER' }, 5],
  ['f-m1', { kind: 'mission', missionId: 1 }, 5],
  ['f-m2', { kind: 'mission', missionId: 2 }, 5],
  ['f-m4', { kind: 'mission', missionId: 4 }, 5],
  ['f-qual', { kind: 'qual' }, 5],
  ['f-demo', { kind: 'demo' }, 20],
  ['f-train-demo', { kind: 'train-demo' }, 30],
  ['f-train-practice', { kind: 'train-practice' }, 12],
];
for (const [name, spec, secs] of flights) {
  const t1 = performance.now();
  const f = new FlightScreen(game, spec);
  run(name, f, secs);
  console.log(name.padEnd(18), 'ok', ((performance.now() - t1) | 0) + ' ms');
}
console.log('done');
