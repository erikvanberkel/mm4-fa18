// Handedness: the world is X east, Y up, Z north, so things to the east must appear on the RIGHT of
// the screen when looking north. This guards against a mirrored external camera.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Gfx } from '../src/gfx/gfx.js';
import { makeCamera, cockpitCamera, orbitCamera } from '../src/render/camera.js';
import { Jet } from '../src/sim/jet.js';

const gfx = new Gfx(1);
const screenX = (cam, x, y, z) => { gfx.setCamera(cam, 184, 92); assert.ok(gfx.project(x, y, z), 'point in front'); return gfx.px - gfx.centerX; };

test('looking north, east is on the right and up is up', () => {
  const cam = makeCamera(0, 0, 0, [0, 0, 1]);
  assert.ok(screenX(cam, 100, 0, 1000) > 5, 'east appears right');
  assert.ok(screenX(cam, -100, 0, 1000) < -5, 'west appears left');
  gfx.setCamera(cam, 184, 92);
  gfx.project(0, 100, 1000);
  assert.ok(gfx.py < gfx.centerY - 5, 'higher things appear higher on screen');
});

test('looking east, south is on the right; looking south, west is on the right', () => {
  assert.ok(screenX(makeCamera(0, 0, 0, [1, 0, 0]), 1000, 0, -100) > 5);
  assert.ok(screenX(makeCamera(0, 0, 0, [0, 0, -1]), -100, 0, -1000) > 5);
});

test('external chase camera agrees with the cockpit camera about left and right', () => {
  const j = new Jet('F18');
  j.setPose(0, 1000, 0, 90); // heading east
  const cockpit = cockpitCamera(j);
  const chase = orbitCamera(j, 40, 0, 0.1);
  for (const cam of [cockpit, chase]) {
    // a point south of an eastbound jet is to its right
    gfx.setCamera(cam, 184, 92);
    const front = [j.x + 600, j.y, j.z - 80];
    assert.ok(gfx.project(...front));
    assert.ok(gfx.px > gfx.centerX, 'south of an eastbound jet should be on the right');
  }
});

test('banking right drops the right wing on screen in a chase view', () => {
  const j = new Jet('F18');
  j.setPose(0, 1000, 0, 0, 0, 30); // heading north, banked 30 degrees right
  const cam = orbitCamera(j, 40, 0, 0.0);
  gfx.setCamera(cam, 184, 92);
  const wing = (side) => { gfx.project(j.x + j.rx * 6 * side, j.y + j.ry * 6 * side, j.z + j.rz * 6 * side); return { x: gfx.px, y: gfx.py }; };
  const right = wing(1), left = wing(-1);
  assert.ok(right.x > left.x, 'right wing on the right of the screen');
  assert.ok(right.y > left.y, 'right wing is lower on screen');
});
