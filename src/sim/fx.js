// Fire, smoke, tracers, decoys. Everything is a coloured pixel or small polygon, as in 1988.
import { C } from '../gfx/palette.js';

const P_LIFE = 0, P_MAX = 1, P_X = 2, P_Y = 3, P_Z = 4, P_VX = 5, P_VY = 6, P_VZ = 7, P_SIZE = 8, P_KIND = 9;
const STRIDE = 10;
const CAP = 2400;

export const KIND = { SMOKE: 0, FIRE: 1, SPARK: 2, WHITE: 3, FLARE: 4, CHAFF: 5, WATER: 6, STEAM: 7, DARK: 8 };
const COLORS = {
  [KIND.SMOKE]: [C.G6, C.G5, C.G4],
  [KIND.DARK]: [C.G2, C.G2, C.G3],
  [KIND.FIRE]: [C.PALE, C.YELLOW, C.ORANGE, C.RED_L, C.RED, C.G3],
  [KIND.SPARK]: [C.YELLOW, C.ORANGE],
  [KIND.WHITE]: [C.G10, C.G9, C.G8],
  [KIND.FLARE]: [C.WHITE, C.PALE, C.YELLOW, C.ORANGE],
  [KIND.CHAFF]: [C.G10, C.G7, C.G9],
  [KIND.WATER]: [C.WHITE, C.G10, C.G9, C.G8],
  [KIND.STEAM]: [C.WHITE, C.G10, C.G9],
};

export class FX {
  constructor(rand) {
    this.rand = rand;
    this.p = new Float64Array(CAP * STRIDE);
    this.count = 0;
    this.next = 0;
    this.tracers = [];
    this.rings = []; // expanding fireball shells
  }

  add(kind, x, y, z, vx, vy, vz, life, size = 1) {
    const i = this.next * STRIDE;
    const p = this.p;
    p[i + P_LIFE] = life; p[i + P_MAX] = life; p[i + P_X] = x; p[i + P_Y] = y; p[i + P_Z] = z;
    p[i + P_VX] = vx; p[i + P_VY] = vy; p[i + P_VZ] = vz; p[i + P_SIZE] = size; p[i + P_KIND] = kind;
    this.next = (this.next + 1) % CAP;
    if (this.count < CAP) this.count++;
  }

  explosion(x, y, z, scale = 1, vx = 0, vy = 0, vz = 0) {
    const r = this.rand;
    const n = Math.floor(50 * scale);
    for (let i = 0; i < n; i++) {
      const a = r() * 6.283, b = r() * 3.14 - 1.57;
      const sp = (10 + r() * 32) * Math.sqrt(scale);
      const cx = Math.cos(a) * Math.cos(b), cy = Math.sin(b), cz = Math.sin(a) * Math.cos(b);
      this.add(KIND.FIRE, x, y, z, vx * 0.5 + cx * sp, vy * 0.5 + cy * sp, vz * 0.5 + cz * sp, 0.5 + r() * 1.1, (2 + r() * 2.5) * Math.sqrt(scale));
    }
    for (let i = 0; i < 25 * scale; i++) {
      const a = r() * 6.283, b = r() * 3.14 - 1.57;
      const sp = 30 + r() * 80 * Math.sqrt(scale);
      this.add(KIND.SPARK, x, y, z, vx * 0.5 + Math.cos(a) * Math.cos(b) * sp, vy * 0.5 + Math.sin(b) * sp, vz * 0.5 + Math.sin(a) * Math.cos(b) * sp, 0.6 + r() * 1.3, 1);
    }
    for (let i = 0; i < 22 * scale; i++) {
      const a = r() * 6.283;
      const sp = 3 + r() * 10 * Math.sqrt(scale);
      this.add(KIND.DARK, x, y, z, Math.cos(a) * sp, r() * 6, Math.sin(a) * sp, 3 + r() * 4, (4 + r() * 3) * Math.sqrt(scale));
    }
    this.rings.push({ x, y, z, r: 2, vr: 42 * Math.sqrt(scale), life: 0.55, max: 0.55, seed: Math.floor(r() * 1000) });
  }

  splash(x, z, scale = 1) {
    const r = this.rand;
    for (let i = 0; i < 90 * scale; i++) {
      const a = r() * 6.283;
      const s = 3 + r() * 16;
      this.add(KIND.WATER, x, 1, z, Math.cos(a) * s, 14 + r() * 42 * Math.sqrt(scale), Math.sin(a) * s, 1 + r() * 2, 2 + r() * 2);
    }
  }

  tracer(x, y, z, vx, vy, vz, life, hot = true) {
    this.tracers.push({ x, y, z, vx, vy, vz, life, hot, owner: null });
  }

  step(dt) {
    const p = this.p;
    for (let n = 0; n < CAP; n++) {
      const i = n * STRIDE;
      if (p[i + P_LIFE] <= 0) continue;
      p[i + P_LIFE] -= dt;
      p[i + P_X] += p[i + P_VX] * dt;
      p[i + P_Y] += p[i + P_VY] * dt;
      p[i + P_Z] += p[i + P_VZ] * dt;
      const k = p[i + P_KIND];
      if (k === KIND.SMOKE || k === KIND.DARK || k === KIND.WHITE || k === KIND.STEAM) {
        const drag = 1 - dt * 0.8;
        p[i + P_VX] *= drag; p[i + P_VY] *= drag; p[i + P_VZ] *= drag;
      } else if (k === KIND.FLARE) {
        p[i + P_VY] -= 9.8 * dt * 0.5;
      } else if (k === KIND.FIRE) {
        const drag = 1 - dt * 2.4;
        p[i + P_VX] *= drag; p[i + P_VY] *= drag; p[i + P_VZ] *= drag;
      } else if (k === KIND.CHAFF) {
        const drag = 1 - dt * 2.5;
        p[i + P_VX] *= drag; p[i + P_VY] *= drag; p[i + P_VZ] *= drag;
        p[i + P_VY] -= 1.2 * dt;
      } else {
        p[i + P_VY] -= 9.8 * dt;
      }
    }
    const t = this.tracers;
    for (let i = t.length - 1; i >= 0; i--) {
      const b = t[i];
      b.life -= dt;
      b.px = b.x; b.py = b.y; b.pz = b.z;
      b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
      if (b.life <= 0) t.splice(i, 1);
    }
    const rg = this.rings;
    for (let i = rg.length - 1; i >= 0; i--) {
      const r = rg[i];
      r.life -= dt;
      r.r += r.vr * dt;
      r.vr *= 1 - dt * 2;
      if (r.life <= 0) rg.splice(i, 1);
    }
  }

  draw(g) {
    const p = this.p;
    for (let n = 0; n < CAP; n++) {
      const i = n * STRIDE;
      const life = p[i + P_LIFE];
      if (life <= 0) continue;
      const x = p[i + P_X], y = p[i + P_Y], z = p[i + P_Z];
      if (!g.project(x, y, z)) continue;
      const kind = p[i + P_KIND];
      const cols = COLORS[kind];
      const age = 1 - life / p[i + P_MAX];
      const c = cols[Math.min(cols.length - 1, (age * cols.length) | 0)];
      const worldSize = p[i + P_SIZE];
      let px = (worldSize * g.focalX) / Math.max(1, 1 / g.pw) / g.S;
      if (px < 1) px = 1;
      if (px > 24) px = 24;
      g.point3D(x, y, z, c, Math.round(px));
    }
    const t = this.tracers;
    for (let i = 0; i < t.length; i++) {
      const b = t[i];
      const k = 0.022;
      g.line3D(b.x, b.y, b.z, b.x - b.vx * k, b.y - b.vy * k, b.z - b.vz * k, b.hot ? C.YELLOW : C.RED_L);
    }
    // Fireball shells: a jagged sphere of flat fire polygons
    const rg = this.rings;
    for (let i = 0; i < rg.length; i++) {
      const r = rg[i];
      const u = r.life / r.max;
      const col = u > 0.6 ? C.PALE : u > 0.3 ? C.YELLOW : C.ORANGE;
      const rad = r.r;
      const N = 7;
      for (let k = 0; k < N; k++) {
        const a0 = (k / N) * 6.283 + r.seed, a1 = ((k + 1) / N) * 6.283 + r.seed;
        const jig = 0.72 + 0.5 * (((k * 7 + r.seed) % 5) / 5);
        const ax = g.ux * Math.sin(a0) * rad * jig + g.rx * Math.cos(a0) * rad * jig;
        const ay = g.uy * Math.sin(a0) * rad * jig + g.ry * Math.cos(a0) * rad * jig;
        const az = g.uz * Math.sin(a0) * rad * jig + g.rz * Math.cos(a0) * rad * jig;
        const bx = g.ux * Math.sin(a1) * rad + g.rx * Math.cos(a1) * rad;
        const by = g.uy * Math.sin(a1) * rad + g.ry * Math.cos(a1) * rad;
        const bz = g.uz * Math.sin(a1) * rad + g.rz * Math.cos(a1) * rad;
        g.polyWorld3(r.x, r.y, r.z, r.x + ax, r.y + ay, r.z + az, r.x + bx, r.y + by, r.z + bz, col, true);
      }
    }
  }
}
