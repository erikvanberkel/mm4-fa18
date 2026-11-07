// Browser entry point.
import { Gfx } from './gfx/gfx.js';
import { Display } from './gfx/display.js';
import { FLIGHT_PALETTE } from './gfx/palette.js';
import { Input } from './input.js';
import { World } from './world/world.js';
import { buildAll } from './gfx/models.js';
import { SceneRenderer } from './render/scene.js';
import { MapView } from './ui/map.js';
import { FlightLog } from './log.js';
import { Game } from './game.js';

const canvas = document.getElementById('screen');
const display = new Display(canvas);
const gfx = new Gfx(1);
gfx.setPalette(FLIGHT_PALETTE);

const world = new World();
const models = buildAll();
const scene = new SceneRenderer(gfx, world, models);
const map = new MapView(world);
const log = new FlightLog();
const input = new Input(window);
const game = new Game({ gfx, display, input, world, models, scene, map, log });
window.__game = game; // handy for debugging in the console
import('./sim/ai.js').then((m) => { window.__ai = m; });

// The whole picture, 3D view and instruments alike, is one native 320x256 PAL screen. The display scales it up.
gfx.setScale(1);

if (/[?&]fps/.test(location.search)) game.showFps = true;
// Shift-L toggles scanlines. Pixels are never interpolated, in either mode.
input.onKey((code) => {
  if (code === 'KeyL' && input.shift) display.cycleMode();
  // Shift-M changes the title music (on the title and menus; in flight M is the map)
  if (code === 'KeyM' && input.shift && !(game.screen && game.screen.sim)) game.cycleTheme();
});

// Drop a sound file anywhere on the window to use it as the title music.
window.addEventListener('dragover', (e) => { e.preventDefault(); });
window.addEventListener('drop', (e) => {
  e.preventDefault();
  const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
  if (f) game.dropMusicFile(f);
});

// Switching tabs or windows pauses a flight in progress
document.addEventListener('visibilitychange', () => {
  const s = game.screen;
  if (document.hidden && s && s.sim && s.togglePause && !s.paused && !s.endInfo) s.togglePause();
});

game.start();

let last = performance.now();
function loop(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  game.frame(dt);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
