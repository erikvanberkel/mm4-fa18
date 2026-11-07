// Writes a framebuffer to PNG, optionally enlarged by whole-number nearest-neighbour steps so the
// native 320x256 pictures are easy to inspect. UP=3 node tools/shot-screens.mjs ...
import fs from 'node:fs';
import { PNG } from 'pngjs';

export function savePng(gfx, path, up = Number(process.env.UP) || (gfx.S === 1 ? 3 : 1)) {
  const small = new PNG({ width: gfx.W, height: gfx.H });
  gfx.writeRGBA(new Uint32Array(small.data.buffer, small.data.byteOffset, gfx.W * gfx.H));
  if (up <= 1) { fs.writeFileSync(path, PNG.sync.write(small)); return; }
  const big = new PNG({ width: gfx.W * up, height: gfx.H * up });
  const src = new Uint32Array(small.data.buffer, small.data.byteOffset, gfx.W * gfx.H);
  const dst = new Uint32Array(big.data.buffer, big.data.byteOffset, big.width * big.height);
  for (let y = 0; y < big.height; y++) {
    const row = Math.floor(y / up) * gfx.W;
    for (let x = 0; x < big.width; x++) dst[y * big.width + x] = src[row + Math.floor(x / up)];
  }
  fs.writeFileSync(path, PNG.sync.write(big));
}
