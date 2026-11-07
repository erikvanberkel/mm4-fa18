// Renders every model from a 3/4 view into one contact sheet: shots/models.png
import fs from 'node:fs';
import { PNG } from 'pngjs';
import { Gfx } from '../src/gfx/gfx.js';
import { FLIGHT_PALETTE, C } from '../src/gfx/palette.js';
import { buildAll } from '../src/gfx/models.js';
import { drawMesh } from '../src/gfx/mesh.js';
import { makeCamera } from '../src/render/camera.js';

const models = buildAll();
const list = [
  ['F18', 17, 0.9], ['F16', 15, 0.9], ['MIG', 17, 0.9], ['B707', 46, 0.9],
  ['AF1', 46, 0.9], ['CRUISE', 6, 0.9], ['AIM9', 3.5, 1.1], ['CHUTE', 8, 0.9],
  ['RAFT', 4, 1.0], ['POD', 3, 1.0], ['CARRIER', 330, 0.8], ['SUBCARRIER', 330, 0.8],
];
const cols = 4, W = 320, H = 256;
const sheet = new PNG({ width: W * cols, height: H * Math.ceil(list.length / cols) });
const gfx = new Gfx(1);
gfx.setPalette(FLIGHT_PALETTE);
list.forEach(([name, size, az], i) => {
  const m = models[name];
  gfx.setClip(0, 0, 320, 256);
  const cam = makeCamera(0, 0, 0, [0, 0, 1]);
  const d = size * 1.55 + 4;
  const ex = Math.sin(az) * d * 0.9, ez = -Math.cos(az) * d * 0.9, ey = size * 0.32;
  const c2 = makeCamera(ex, ey, ez, [-ex, -ey, -ez]);
  void cam;
  gfx.setCamera(c2, 256, 128);
  gfx.clearZ();
  gfx.fb.fill(C.SKY, 0, 256 * 320 * 0.62);
  gfx.fb.fill(C.SEA, 256 * 320 * 0.62, 256 * 320);
  drawMesh(gfx, m, 0, 0, 0, undefined, { noDot: false });
  gfx.text(name, 6, 6, C.WHITE, undefined, C.BLACK);
  const png = new PNG({ width: W, height: H });
  gfx.writeRGBA(new Uint32Array(png.data.buffer, png.data.byteOffset, W * H));
  PNG.bitblt(png, sheet, 0, 0, W, H, (i % cols) * W, Math.floor(i / cols) * H);
});
fs.writeFileSync('shots/models.png', PNG.sync.write(sheet));
console.log('wrote shots/models.png', sheet.width, sheet.height);
