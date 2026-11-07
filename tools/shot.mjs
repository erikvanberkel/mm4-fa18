// Headless renderer: builds the world and sim in Node and writes frames to PNG, so the
// renderer can be inspected without a browser. Usage: node tools/shot.mjs [scene] [out.png] [scale]
import fs from 'node:fs';
import { savePng as writePng } from './png.mjs';
import { Gfx } from '../src/gfx/gfx.js';
import { FLIGHT_PALETTE } from '../src/gfx/palette.js';
import { World } from '../src/world/world.js';
import { buildAll } from '../src/gfx/models.js';
import { SceneRenderer } from '../src/render/scene.js';
import { Sim } from '../src/sim/sim.js';
import { AIPlane, brainPatrol } from '../src/sim/ai.js';
import { cockpitCamera, orbitCamera, makeCamera } from '../src/render/camera.js';
import { toWorld, LANDMARKS } from '../src/world/geo.js';
import { Cockpit } from '../src/ui/cockpit.js';

export const savePng = writePng;

const t0 = performance.now();
const world = new World();
const models = buildAll();
console.log(`world+models ${(performance.now() - t0) | 0} ms; landmarks ${world.landmarks.length}, terrain tris ${world.tt.length / 3}`);

const [scene = 'sfo', out = 'shot.png', scaleArg = '1'] = process.argv.slice(2);
const gfx = new Gfx(Number(scaleArg));
gfx.setPalette(FLIGHT_PALETTE);
const sc = new SceneRenderer(gfx, world, models);

const sim = new Sim({ world });
let cam;
const fly = (x, y, z, hdg, spd = 250) => {
  const j = sim.spawnPlayerAir(x, y, z, hdg, spd);
  return j;
};
if (scene === 'sfo') {
  const j = sim.spawnPlayerRunway('SFO');
  cam = cockpitCamera(j);
} else if (scene === 'ggb') {
  const { s } = LANDMARKS.goldenGate;
  const j = fly(s[0] - 3500, 180, s[1] - 1800, 62, 230);
  cam = cockpitCamera(j);
} else if (scene === 'ggb-ext') {
  const { s } = LANDMARKS.goldenGate;
  const j = fly(s[0] + 1200, 160, s[1] + 700, 330, 230);
  cam = orbitCamera(j, 40, 2.4, 0.35);
} else if (scene === 'sf') {
  const [x, z] = toWorld(37.76, -122.5);
  const j = fly(x, 1400, z, 85, 230);
  cam = cockpitCamera(j);
} else if (scene === 'bay') {
  const [x, z] = toWorld(37.65, -122.35);
  const j = fly(x, 3000, z, 355, 250);
  j.setPose(x, 3000, z, 355, -12, 0);
  cam = cockpitCamera(j);
} else if (scene === 'carrier') {
  sim.addCarrier();
  const j = sim.spawnPlayerCarrier();
  cam = orbitCamera(j, 38, 2.6, 0.22);
} else if (scene === 'city') {
  const [x, z] = toWorld(37.735, -122.43);
  const j = fly(x, 220, z, 20, 200);
  cam = cockpitCamera(j);
} else if (scene === 'oak') {
  const [x, z] = toWorld(37.78, -122.30);
  const j = fly(x, 260, z, 80, 200);
  cam = cockpitCamera(j);
} else if (scene === 'mig') {
  const [x, z] = toWorld(37.8, -122.55);
  const j = fly(x, 2000, z, 90, 250);
  const m = new AIPlane('MIG', x + 1200, 2050, z + 80, 270, 280);
  sim.add(m);
  cam = orbitCamera(m, 55, 0.5, 0.25);
}
const cockpit = !/ext|carrier|mig/.test(scene);
const cp = new Cockpit(gfx);
if (cockpit) {
  cp.ensureStatic();
  sim.fx.step(0.01);
  // a hostile for the HUD to chew on
  if (scene === 'sf' || scene === 'bay' || scene === 'ggb') {
    const j = sim.player;
    const m = new AIPlane('MIG', j.x + j.fx * 4200 + 300, j.y + 100, j.z + j.fz * 4200, 200, 280);
    sim.add(m);
  }
  sim.step(0.02, { pitch: 0, roll: 0, rudder: 0 });
  sc.render(cam, 190, sim, 92, { cockpit });
  cp.blitStatic();
  cp.panel(sim, { hudOn: true });
  gfx.setClip(0, 0, 320, 184);
  cp.hud(sim, { hudOn: true });
} else {
  sc.render(cam, 214, sim, 107, { cockpit });
  cp.externalBar(sim);
}
savePng(gfx, out);
console.log(`rendered ${scene} -> ${out} in ${(performance.now() - t0) | 0} ms total, polys ${gfx.stats.polys}`);
