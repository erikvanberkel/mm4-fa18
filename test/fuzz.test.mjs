// Random-input soak test: every flight type, hundreds of random key presses, no exceptions allowed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Gfx } from '../src/gfx/gfx.js';
import { FLIGHT_PALETTE } from '../src/gfx/palette.js';
import { World } from '../src/world/world.js';
import { buildAll } from '../src/gfx/models.js';
import { SceneRenderer } from '../src/render/scene.js';
import { MapView } from '../src/ui/map.js';
import { FlightLog } from '../src/log.js';
import { Game } from '../src/game.js';
import { FlightScreen } from '../src/screens/flight.js';
import { MenuScreen, MissionListScreen, FreeFlightScreen, LogScreen } from '../src/screens/menus.js';

const KEYS = [
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Comma', 'Period', 'Space', 'Enter', 'Backspace',
  'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'Equal', 'Minus', 'KeyG', 'KeyA', 'KeyH', 'KeyJ', 'KeyC', 'KeyF', 'KeyE',
  'KeyM', 'KeyR', 'KeyT', 'KeyV', 'KeyB', 'KeyQ', 'KeyX', 'KeyS', 'BracketLeft', 'BracketRight', 'NumpadEnter',
  'Numpad1', 'Numpad2', 'Numpad3', 'Numpad4', 'Numpad5', 'Numpad6', 'Numpad7', 'Numpad8', 'Numpad9', 'NumpadDecimal', 'Home', 'End', 'PageUp', 'PageDown',
];

function rng(seed) { let s = seed >>> 0; return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }

const world = new World();
const models = buildAll();

function makeGame(seed) {
  const gfx = new Gfx(1);
  gfx.setPalette(FLIGHT_PALETTE);
  const store = { d: {}, getItem(k) { return this.d[k] || null; }, setItem(k, v) { this.d[k] = v; } };
  const r = rng(seed);
  const state = { pressed: new Set(), held: new Set(), shift: false };
  const input = {
    edge: new Set(), pad: null, get shift() { return state.shift; },
    pressed: (c) => state.pressed.has(c), held: (c) => state.held.has(c),
    axes: () => ({ pitch: state.held.has('ArrowDown') ? 1 : state.held.has('ArrowUp') ? -1 : 0, roll: state.held.has('ArrowRight') ? 1 : state.held.has('ArrowLeft') ? -1 : 0, rudder: 0 }),
    pollPad() {}, endFrame() { state.pressed.clear(); },
  };
  const game = new Game({ gfx, display: { present() {}, mode: 0 }, input, world, models, scene: new SceneRenderer(gfx, world, models), map: new MapView(world), log: new FlightLog(store) });
  game.sfx.muted = true;
  return { game, gfx, r, state };
}

function fuzz(spec, seconds, seed) {
  const { game, gfx, r, state } = makeGame(seed);
  game.setScreen(new FlightScreen(game, spec));
  const kinds = new Set();
  for (let f = 0; f < seconds * 60; f++) {
    if (r() < 0.12) {
      const k = KEYS[Math.floor(r() * KEYS.length)];
      state.pressed.add(k);
      state.shift = r() < 0.15;
      if (r() < 0.5) state.held.add(k); else state.held.delete(k);
      if (state.held.size > 4) state.held.delete([...state.held][0]);
    }
    // never let the fuzzer quit to the menu or restart: that is covered elsewhere
    state.pressed.delete('Escape');
    game.frame(1 / 60);
    kinds.add(game.screen.constructor.name);
    if (f % 17 === 0) { gfx.setClip(0, 0, 320, 256); }
  }
  return kinds;
}

const SPECS = [
  { kind: 'free', start: 'SFO', aircraft: 'F18' },
  { kind: 'free', start: 'SFO', aircraft: 'F16' },
  { kind: 'free', start: 'CARRIER' },
  { kind: 'free', start: 'AIR', aircraft: 'F16' },
  { kind: 'qual' },
  ...[1, 2, 3, 4, 5, 6].map((id) => ({ kind: 'mission', missionId: id, difficulty: 2 })),
  { kind: 'demo' }, { kind: 'train-demo' }, { kind: 'train-practice' },
];

test('random input never throws in any flight type', () => {
  let n = 0;
  for (const spec of SPECS) {
    for (const seed of [11, 29]) {
      assert.doesNotThrow(() => fuzz(spec, 50, seed + n++), `${spec.kind} ${spec.missionId || spec.start || ''} seed ${seed}`);
    }
  }
});

test('menu screens survive random input', () => {
  const { game, r, state } = makeGame(7);
  game.log.d.unlocked = true;
  const screens = [() => new MenuScreen(game), () => new MissionListScreen(game), () => new FreeFlightScreen(game), () => new LogScreen(game)];
  for (let round = 0; round < 40; round++) {
    game.setScreen(screens[round % screens.length]());
    for (let f = 0; f < 120; f++) {
      if (r() < 0.2) { const codes = ['Digit0', 'Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'ArrowUp', 'ArrowDown', 'Enter', 'Space', 'KeyF', 'KeyH', 'KeyY']; state.pressed.add(codes[Math.floor(r() * codes.length)]); }
      game.frame(1 / 60);
      // a launch moves to a loading screen and then a flight: let it run, it is the same code under test
    }
  }
  assert.ok(true);
});
