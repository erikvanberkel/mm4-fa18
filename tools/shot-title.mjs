// Renders one title scene at several timestamps: node tools/shot-title.mjs <sceneIndex> <t1> <t2> ... [--scale=2]
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
import { TitleScreen } from '../src/screens/title.js';

const args = process.argv.slice(2);
const scaleArg = args.find((a) => a.startsWith('--scale='));
const scale = scaleArg ? Number(scaleArg.split('=')[1]) : 1;
const nums = args.filter((a) => !a.startsWith('--')).map(Number);
const [idx, ...times] = nums;
const gfx = new Gfx(scale);
gfx.setPalette(FLIGHT_PALETTE);
const world = new World();
const models = buildAll();
const store = { d: {}, getItem(k) { return this.d[k] || null; }, setItem(k, v) { this.d[k] = v; } };
const input = { edge: new Set(), shift: false, pad: null, pressed: () => false, held: () => false, axes: () => ({}), pollPad() {}, endFrame() {} };
const game = new Game({ gfx, display: { present() {}, mode: 1 }, input, world, models, scene: new SceneRenderer(gfx, world, models), map: new MapView(world), log: new FlightLog(store) });
game.sfx.muted = true;
const title = new TitleScreen(game);
game.screen = title;
title.nextScene(idx);
title.sceneT = 0;
let t = 0;
const dt = 1 / 30;
for (const target of times) {
  while (t < target) {
    // keep the scene from auto-advancing so any timestamp in it can be inspected
    title.sceneT = Math.min(title.sceneT, 1e6);
    title.update(dt);
    t += dt;
  }
  gfx.setClip(0, 0, 320, 256);
  title.render(gfx);
  gfx.setPalette(FLIGHT_PALETTE, 1, 0);
  savePng(gfx, `shots/ts${idx}-${String(target).replace('.', '_')}.png`);
  console.log('wrote', `shots/ts${idx}-${target}.png`, 'scene', title.sceneIdx);
}
