// The world at runtime: real terrain, painted ground layers, height and collision queries.
import { WORLD } from './data.gen.js';
import { RUNWAYS } from './geo.js';
import { buildLandmarks } from './landmarks.js';
import { C, RAMP } from '../gfx/palette.js';
import { SUN } from '../gfx/mesh.js';

export const SURFACE = { SEA: 0, LAND: 1, RUNWAY: 2, DECK: 3, HILL: 4 };

export class World {
  constructor() {
    this.extents = WORLD.extents;
    this.groundLayers = [
      { color: C.LAND, v: WORLD.layers.land.v, t: WORLD.layers.land.t },
      { color: C.G4, v: WORLD.layers.urban.v, t: WORLD.layers.urban.t },
      { color: C.G3, v: WORLD.layers.downtown.v, t: WORLD.layers.downtown.t },
      { color: C.G5, v: WORLD.layers.apron.v, t: WORLD.layers.apron.t },
    ];
    this.outer = WORLD.outer;
    this._buildTerrain();
    this._buildRunways();
    this.mapRings = WORLD.map;
    const lm = buildLandmarks();
    this.landmarks = lm.meshes;
    this._buildColliders(lm.colliders);
  }

  _buildTerrain() {
    const { v, t, c } = WORLD.terrain;
    this.tv = Float64Array.from(v);
    this.tt = Int32Array.from(t);
    const nTri = t.length / 3;
    this.tColor = new Uint8Array(nTri);
    this.tMaxH = new Float32Array(nTri);
    const sunY = SUN[1];
    for (let i = 0; i < nTri; i++) {
      const a = t[i * 3] * 3, b = t[i * 3 + 1] * 3, cc = t[i * 3 + 2] * 3;
      const ux = v[b] - v[a], uy = v[b + 1] - v[a + 1], uz = v[b + 2] - v[a + 2];
      const wx = v[cc] - v[a], wy = v[cc + 1] - v[a + 1], wz = v[cc + 2] - v[a + 2];
      let nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
      const l = Math.hypot(nx, ny, nz) || 1;
      nx /= l; ny /= l; nz /= l;
      if (ny < 0) { nx = -nx; ny = -ny; nz = -nz; }
      const avgH = (v[a + 1] + v[b + 1] + v[cc + 1]) / 3;
      this.tMaxH[i] = Math.max(v[a + 1], v[b + 1], v[cc + 1]);
      // Slope facing the sun lightens, slope facing away darkens, flat matches the painted land.
      const s = (nx * SUN[0] + ny * SUN[1] + nz * SUN[2] - sunY) * 3.6;
      if (c[i] === 1) {
        this.tColor[i] = rampPick(RAMP.urban, 1, s);
      } else {
        const lift = avgH > 620 ? 1.2 : avgH > 300 ? 0.45 : 0;
        this.tColor[i] = rampPick(RAMP.land, 2, s + lift);
      }
    }
    // Chunk the triangles for culling, and a grid for point queries.
    const { w, e, s, n } = this.extents;
    const CH = 12;
    this.chunks = [];
    const buckets = Array.from({ length: CH * CH }, () => []);
    const cw = (e - w) / CH, cd = (n - s) / CH;
    const QCELL = 2000;
    this.qx0 = w; this.qz0 = s; this.qCell = QCELL;
    this.qw = Math.ceil((e - w) / QCELL) + 1;
    this.qh = Math.ceil((n - s) / QCELL) + 1;
    this.qGrid = Array.from({ length: this.qw * this.qh }, () => null);
    for (let i = 0; i < nTri; i++) {
      const a = t[i * 3] * 3, b = t[i * 3 + 1] * 3, cc = t[i * 3 + 2] * 3;
      const mx = (v[a] + v[b] + v[cc]) / 3, mz = (v[a + 2] + v[b + 2] + v[cc + 2]) / 3;
      const ci = Math.min(CH - 1, Math.max(0, Math.floor((mx - w) / cw)));
      const cj = Math.min(CH - 1, Math.max(0, Math.floor((mz - s) / cd)));
      buckets[cj * CH + ci].push(i);
      // Query grid: every cell the triangle's bounding box touches.
      const x0 = Math.min(v[a], v[b], v[cc]), x1 = Math.max(v[a], v[b], v[cc]);
      const z0 = Math.min(v[a + 2], v[b + 2], v[cc + 2]), z1 = Math.max(v[a + 2], v[b + 2], v[cc + 2]);
      for (let qj = Math.floor((z0 - s) / QCELL); qj <= Math.floor((z1 - s) / QCELL); qj++) {
        for (let qi = Math.floor((x0 - w) / QCELL); qi <= Math.floor((x1 - w) / QCELL); qi++) {
          if (qi < 0 || qj < 0 || qi >= this.qw || qj >= this.qh) continue;
          const k = qj * this.qw + qi;
          (this.qGrid[k] || (this.qGrid[k] = [])).push(i);
        }
      }
    }
    for (const tris of buckets) {
      if (!tris.length) continue;
      let cx = 0, cz = 0, maxH = 0;
      for (const i of tris) {
        for (let k = 0; k < 3; k++) { const q = t[i * 3 + k] * 3; cx += v[q]; cz += v[q + 2]; if (v[q + 1] > maxH) maxH = v[q + 1]; }
      }
      cx /= tris.length * 3; cz /= tris.length * 3;
      let r = 0;
      for (const i of tris) for (let k = 0; k < 3; k++) { const q = t[i * 3 + k] * 3; r = Math.max(r, Math.hypot(v[q] - cx, v[q + 1] - maxH / 2, v[q + 2] - cz)); }
      this.chunks.push({ cx, cy: maxH / 2, cz, r, tris: Int32Array.from(tris) });
    }
    this.tStamp = new Uint32Array(v.length / 3);
    this.tCamX = new Float64Array(v.length / 3);
    this.tCamY = new Float64Array(v.length / 3);
    this.tCamZ = new Float64Array(v.length / 3);
    this.frameStamp = 0;
  }

  // Terrain height at a point, from the same triangles that are drawn.
  heightAt(x, z) {
    const qi = Math.floor((x - this.qx0) / this.qCell), qj = Math.floor((z - this.qz0) / this.qCell);
    if (qi < 0 || qj < 0 || qi >= this.qw || qj >= this.qh) return 0;
    const list = this.qGrid[qj * this.qw + qi];
    if (!list) return 0;
    const v = this.tv, t = this.tt;
    for (let n = 0; n < list.length; n++) {
      const i = list[n] * 3;
      const a = t[i] * 3, b = t[i + 1] * 3, c = t[i + 2] * 3;
      const x0 = v[a], z0 = v[a + 2], x1 = v[b], z1 = v[b + 2], x2 = v[c], z2 = v[c + 2];
      const d = (z1 - z2) * (x0 - x2) + (x2 - x1) * (z0 - z2);
      if (d === 0) continue;
      const u = ((z1 - z2) * (x - x2) + (x2 - x1) * (z - z2)) / d;
      const w = ((z2 - z0) * (x - x2) + (x0 - x2) * (z - z2)) / d;
      const k = 1 - u - w;
      if (u >= -1e-4 && w >= -1e-4 && k >= -1e-4) return u * v[a + 1] + w * v[b + 1] + k * v[c + 1];
    }
    return 0;
  }

  isLand(x, z) {
    for (let li = 0; li < 1; li++) {
      const { v, t } = this.groundLayers[0];
      for (let i = 0; i < t.length; i += 3) {
        const a = t[i] * 2, b = t[i + 1] * 2, c = t[i + 2] * 2;
        const x0 = v[a], z0 = v[a + 1], x1 = v[b], z1 = v[b + 1], x2 = v[c], z2 = v[c + 1];
        const minX = x0 < x1 ? (x0 < x2 ? x0 : x2) : x1 < x2 ? x1 : x2;
        if (x < minX) continue;
        const maxX = x0 > x1 ? (x0 > x2 ? x0 : x2) : x1 > x2 ? x1 : x2;
        if (x > maxX) continue;
        const d = (z1 - z2) * (x0 - x2) + (x2 - x1) * (z0 - z2);
        if (d === 0) continue;
        const u = ((z1 - z2) * (x - x2) + (x2 - x1) * (z - z2)) / d;
        const w = ((z2 - z0) * (x - x2) + (x0 - x2) * (z - z2)) / d;
        if (u >= 0 && w >= 0 && 1 - u - w >= 0) return true;
      }
    }
    const { w: W, e: E, s: S, n: N } = this.extents;
    return x > E || z > N || z < S ? x > W : false;
  }

  _buildRunways() {
    this.runways = RUNWAYS.map((r) => {
      const dx = r.b[0] - r.a[0], dz = r.b[1] - r.a[1];
      const len = Math.hypot(dx, dz);
      return { ...r, len, ux: dx / len, uz: dz / len, nx: dz / len, nz: -dx / len, cx: (r.a[0] + r.b[0]) / 2, cz: (r.a[1] + r.b[1]) / 2 };
    });
    // Decals painted on the ground, nearest-first order doesn't matter since they're all flat.
    const quad = (r, u0, u1, n0, n1, color, group) => {
      const P = (u, n) => [r.a[0] + r.ux * u + r.nx * n, r.a[1] + r.uz * u + r.nz * n];
      const a = P(u0, n0), b = P(u1, n0), c = P(u1, n1), d = P(u0, n1);
      group.push(color, a[0], a[1], b[0], b[1], c[0], c[1], d[0], d[1]);
    };
    this.runwayBodies = [];
    this.runwayDetail = [];
    for (const r of this.runways) {
      const hw = r.width / 2;
      const body = [];
      const detail = [];
      quad(r, 0, r.len, -hw, hw, C.G2, body);
      quad(r, 0, r.len, -hw, -hw + 1.8, C.G9, detail);
      quad(r, 0, r.len, hw - 1.8, hw, C.G9, detail);
      for (let u = 120; u < r.len - 120; u += 90) quad(r, u, u + 42, -0.9, 0.9, C.G10, detail);
      for (const e of [0, 1]) {
        const dir = e ? -1 : 1, base = e ? r.len : 0;
        // Threshold "piano keys"
        for (let k = -3; k <= 3; k++) {
          if (k === 0) continue;
          const n = (k * hw) / 3.6;
          quad(r, base + dir * 8, base + dir * 44, n - 1.6, n + 1.6, C.G10, detail);
        }
        // Touchdown zone and aiming point
        for (const u of [300, 450]) for (const s of [-1, 1]) quad(r, base + dir * u, base + dir * (u + 50), s * 8, s * 14, C.G9, detail);
      }
      this.runwayBodies.push({ r, polys: body });
      this.runwayDetail.push({ r, polys: detail });
    }
  }

  // Which runway, if any, is under this point?
  runwayAt(x, z) {
    for (const r of this.runways) {
      const px = x - r.a[0], pz = z - r.a[1];
      const u = px * r.ux + pz * r.uz;
      if (u < -30 || u > r.len + 30) continue;
      if (Math.abs(px * r.nx + pz * r.nz) <= r.width / 2 + 4) return r;
    }
    return null;
  }

  nearestRunway(x, z) {
    let best = null, bd = Infinity;
    for (const r of this.runways) {
      const d = (r.cx - x) ** 2 + (r.cz - z) ** 2;
      if (d < bd) { bd = d; best = r; }
    }
    return best;
  }

  _buildColliders(list) {
    const CELL = 800;
    this.colCell = CELL;
    this.colMap = new Map();
    const put = (c, x0, z0, x1, z1) => {
      for (let j = Math.floor(z0 / CELL); j <= Math.floor(z1 / CELL); j++) {
        for (let i = Math.floor(x0 / CELL); i <= Math.floor(x1 / CELL); i++) {
          const k = i * 100003 + j;
          let a = this.colMap.get(k);
          if (!a) { a = []; this.colMap.set(k, a); }
          a.push(c);
        }
      }
    };
    for (const c of list) {
      if (c.kind === 'box') put(c, c.x - c.hx, c.z - c.hz, c.x + c.hx, c.z + c.hz);
      else {
        c.len = Math.hypot(c.bx - c.ax, c.bz - c.az);
        c.ux = (c.bx - c.ax) / c.len; c.uz = (c.bz - c.az) / c.len;
        put(c, Math.min(c.ax, c.bx) - c.hw, Math.min(c.az, c.bz) - c.hw, Math.max(c.ax, c.bx) + c.hw, Math.max(c.az, c.bz) + c.hw);
      }
    }
  }

  // True if this point is inside a structure.
  hitsStructure(x, y, z) {
    const k = Math.floor(x / this.colCell) * 100003 + Math.floor(z / this.colCell);
    const a = this.colMap.get(k);
    if (!a) return false;
    for (let i = 0; i < a.length; i++) {
      const c = a[i];
      if (y < c.y0 || y > c.y1) continue;
      if (c.kind === 'box') {
        if (Math.abs(x - c.x) <= c.hx && Math.abs(z - c.z) <= c.hz) return true;
      } else {
        const px = x - c.ax, pz = z - c.az;
        const u = px * c.ux + pz * c.uz;
        if (u < 0 || u > c.len) continue;
        if (Math.abs(px * c.uz - pz * c.ux) <= c.hw) return true;
      }
    }
    return false;
  }
}

function rampPick(ramp, base, s) {
  let i = Math.round(base + s);
  if (i < 0) i = 0;
  if (i >= ramp.length) i = ramp.length - 1;
  return ramp[i];
}
