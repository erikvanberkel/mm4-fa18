// The display must never interpolate: whole-number scale factors, pixel shape near 4:3, and a window
// that is too small is the only case allowed to use a fractional size.
import test from 'node:test';
import assert from 'node:assert/strict';
import { pickScale } from '../src/gfx/display.js';

const aspect = (s) => (s.w / s.h);

test('common window sizes all get whole-number scale factors', () => {
  const windows = [
    [2880, 1530], [1920, 1080], [2560, 1440], [3840, 2160], [1366, 768], [1440, 900], [1280, 720],
    [1600, 900], [2048, 1152], [1024, 768], [800, 600], [3440, 1440], [2560, 1080], [1536, 864],
  ];
  for (const [W, H] of windows) {
    const s = pickScale(W, H);
    assert.ok(s.integer, `${W}x${H} should scale by whole numbers`);
    assert.ok(Number.isInteger(s.kx) && Number.isInteger(s.ky), `${W}x${H}: factors ${s.kx}x${s.ky}`);
    assert.equal(s.w, 320 * s.kx);
    assert.equal(s.h, 256 * s.ky);
    assert.ok(s.h <= H * 1.021 && s.w <= W * 1.021, `${W}x${H}: picture ${s.w}x${s.h} must fit`);
    assert.ok(Math.abs(aspect(s) - 4 / 3) < 0.14, `${W}x${H}: aspect ${aspect(s).toFixed(3)} should be close to 4:3`);
  }
});

test('the picture fills the window as well as whole numbers allow', () => {
  assert.deepEqual(pickScale(2880, 1530), { kx: 6, ky: 6, w: 1920, h: 1536, integer: true }); // 0.4% overshoot beats losing a whole step
  assert.equal(pickScale(1920, 1080).ky, 4);
  assert.equal(pickScale(1366, 768).ky, 3);
  const uhd = pickScale(3840, 2160);
  assert.equal(uhd.ky, 8);
  assert.equal(uhd.kx, 9); // 9x8 pixels are nearer a 4:3 tube than 8x8
});

test('a window narrower than the picture limits the scale by width', () => {
  const s = pickScale(700, 2000);
  assert.ok(s.integer);
  assert.ok(s.w <= 700 * 1.02);
  assert.equal(s.kx, 2);
});

test('only a window smaller than the native picture falls back to a fractional size', () => {
  const s = pickScale(200, 160);
  assert.equal(s.integer, false);
  assert.ok(s.w <= 200 && s.h <= 160);
  assert.ok(pickScale(320, 256).integer);
  assert.ok(pickScale(640, 512).integer);
});
