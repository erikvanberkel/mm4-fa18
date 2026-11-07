// Every structure in the Bay, placed at its real coordinates and built to scale.
// Each returns meshes in local coordinates (origin = its centre) and collision volumes.
import { MeshBuilder } from '../gfx/mesh.js';
import { RAMP, C } from '../gfx/palette.js';
import { LANDMARKS, RUNWAYS, BASES, toWorld } from './geo.js';

const SHADOW = { x: 0.62, z: -0.56 }; // ground shadow offset per metre of height, opposite the sun

function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class Placed {
  constructor(name, cx, cz, baseY = 0) {
    this.name = name; this.cx = cx; this.cz = cz; this.baseY = baseY;
    this.m = new MeshBuilder();
    this.colliders = [];
    this.lodLines = null;
  }
  // World point to local
  L(x, y, z) { return [x - this.cx, y, z - this.cz]; }
}

const LIGHT_BLD = [C.G4, C.G5, C.G6, C.G7, C.G8, C.G9];
const PALE_BLD = [C.G5, C.G6, C.G7, C.G8, C.G9, C.G10];
const DARK_BLD = [C.G2, C.G3, C.G4, C.G5];

// A ground-standing box with the original's black cast shadow.
function building(p, x, z, w, d, h, ramp = LIGHT_BLD, top = null, base = 0) {
  const lx = x - p.cx, lz = z - p.cz;
  const m = p.m;
  m.box(lx, base + h / 2, lz, w, h, d, ramp, top || ramp);
  // Shadow parallelogram, flat on the ground; z-test keeps it behind nearer things.
  const sx = SHADOW.x * h, sz = SHADOW.z * h;
  const hw = w / 2, hd = d / 2;
  m.poly([
    [lx - hw, base + 0.5, lz - hd], [lx - hw + sx, base + 0.5, lz - hd + sz], [lx + hw + sx, base + 0.5, lz - hd + sz],
    [lx + hw + sx, base + 0.5, lz + hd + sz], [lx + hw, base + 0.5, lz + hd], [lx - hw, base + 0.5, lz + hd],
  ], C.BLACK);
  p.colliders.push({ kind: 'box', x, z, hx: hw, hz: hd, y0: 0, y1: base + h });
}

// A beam between two world points: a box whose long axis follows the line in plan view.
function beam(p, a, b, y0, y1, width, ramp, topRamp = ramp) {
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const len = Math.hypot(dx, dz);
  const nx = (-dz / len) * (width / 2), nz = (dx / len) * (width / 2);
  const o = [[a[0] + nx, a[1] + nz], [b[0] + nx, b[1] + nz], [b[0] - nx, b[1] - nz], [a[0] - nx, a[1] - nz]].map(([x, z]) => [x - p.cx, z - p.cz]);
  p.m.prismXZ(o, y0, y1, ramp, topRamp);
}

function segCollider(p, a, b, y0, y1, halfWidth) {
  p.colliders.push({ kind: 'seg', ax: a[0], az: a[1], bx: b[0], bz: b[1], y0, y1, hw: halfWidth });
}

const lerp2 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

// A suspension bridge in the Golden Gate's manner. spans: fractions along A-B of the towers.
function suspension(p, A, B, towers, opts) {
  const { deckY, towerY, width, red, deckRamp, spacing = 36, lod } = opts;
  const dir = [B[0] - A[0], B[1] - A[1]];
  const len = Math.hypot(dir[0], dir[1]);
  const lat = [(-dir[1] / len) * (width / 2), (dir[0] / len) * (width / 2)];
  const m = p.m;
  // Deck: slab with a stiffening girder under it
  beam(p, A, B, deckY - 7, deckY, width, deckRamp, [C.G3]);
  segCollider(p, A, B, deckY - 9, deckY + 5, width / 2 + 2);
  const lineColor = opts.lineColor;
  // Towers
  for (const t of towers) {
    const c = lerp2(A, B, t);
    const legs = [[c[0] + lat[0], c[1] + lat[1]], [c[0] - lat[0], c[1] - lat[1]]];
    for (const leg of legs) {
      const lx = leg[0] - p.cx, lz = leg[1] - p.cz;
      m.taper(lx, 0, lz, 15, towerY * 0.55, 10, red);
      m.taper(lx, towerY * 0.55, lz, 10, towerY, 7, red);
      p.colliders.push({ kind: 'box', x: leg[0], z: leg[1], hx: 9, hz: 9, y0: 0, y1: towerY });
    }
    // Portal struts
    for (const f of [0.42, 0.62, 0.8, 0.99]) {
      const y = deckY + (towerY - deckY) * f;
      beam(p, legs[0], legs[1], y - 4, y + 3, 6, red);
    }
    beam(p, legs[0], legs[1], deckY - 13, deckY - 7, 7, red);
    if (opts.xBrace) {
      for (let i = 0; i < 3; i++) {
        const y0 = deckY * (i / 3), y1 = deckY * ((i + 1) / 3);
        const pa = p.L(legs[0][0], y0, legs[0][1]), pb = p.L(legs[1][0], y1, legs[1][1]);
        const pc = p.L(legs[1][0], y0, legs[1][1]), pd = p.L(legs[0][0], y1, legs[0][1]);
        m.line(pa, pb, lineColor);
        m.line(pc, pd, lineColor);
      }
    }
  }
  // Main cables, sagging between the towers
  const cable = (side) => {
    const off = [lat[0] * side, lat[1] * side];
    const stops = [0, ...towers, 1];
    let last = null;
    for (let s = 0; s + 1 < stops.length; s++) {
      const t0 = stops[s], t1 = stops[s + 1];
      const isEnd = s === 0 || s === stops.length - 2;
      const y0 = t0 === 0 || t0 === 1 ? deckY + 2 : towerY;
      const y1 = t1 === 0 || t1 === 1 ? deckY + 2 : towerY;
      const sag = isEnd ? 12 : (towerY - deckY) * 0.86;
      const N = isEnd ? 5 : 18;
      for (let i = 0; i <= N; i++) {
        const u = i / N;
        const t = t0 + (t1 - t0) * u;
        const pos = lerp2(A, B, t);
        const y = y0 + (y1 - y0) * u - sag * 4 * u * (1 - u);
        const point = p.L(pos[0] + off[0], y, pos[1] + off[1]);
        if (last) m.line(last, point, lineColor);
        last = point;
      }
      // Suspender ropes: near LOD only. They're what makes the bridge a lacework up close.
      const count = Math.floor(((t1 - t0) * len) / spacing);
      for (let k = 1; k < count; k++) {
        const u = k / count;
        const t = t0 + (t1 - t0) * u;
        const pos = lerp2(A, B, t);
        const y = y0 + (y1 - y0) * u - sag * 4 * u * (1 - u);
        lod.line(p.L(pos[0] + off[0], y, pos[1] + off[1]), p.L(pos[0] + off[0], deckY, pos[1] + off[1]), lineColor);
      }
    }
  };
  cable(1); cable(-1);
}

// Low causeway on pile bents, optionally rising to a high-level span.
function causeway(p, A, B, opts) {
  const { lowY = 12, highY = 42, highFrom = 0.45, highTo = 0.72, width = 16, ramp = RAMP.grey } = opts;
  const N = 26;
  const yAt = (t) => {
    if (t < highFrom - 0.08 || t > highTo + 0.08) return lowY;
    if (t < highFrom) return lowY + (highY - lowY) * ((t - highFrom + 0.08) / 0.08);
    if (t > highTo) return highY + (lowY - highY) * ((t - highTo) / 0.08);
    return highY;
  };
  let prev = lerp2(A, B, 0), prevY = yAt(0);
  for (let i = 1; i <= N; i++) {
    const t = i / N;
    const c = lerp2(A, B, t);
    const y = yAt(t);
    const d = [c[0] - prev[0], c[1] - prev[1]];
    const l = Math.hypot(d[0], d[1]);
    const n = [(-d[1] / l) * (width / 2), (d[0] / l) * (width / 2)];
    p.m.poly([
      p.L(prev[0] + n[0], prevY, prev[1] + n[1]), p.L(c[0] + n[0], y, c[1] + n[1]),
      p.L(c[0] - n[0], y, c[1] - n[1]), p.L(prev[0] - n[0], prevY, prev[1] - n[1]),
    ], ramp);
    p.lodLines.line(p.L(c[0], y, c[1]), p.L(c[0], 0, c[1]), C.G5);
    segCollider(p, prev, c, 0, Math.max(y, prevY) + 3, width / 2 + 2);
    prev = c; prevY = y;
  }
}

function truss(p, A, B, y0, y1, width, color, bays) {
  const d = [B[0] - A[0], B[1] - A[1]];
  const len = Math.hypot(d[0], d[1]);
  const n = [(-d[1] / len) * (width / 2), (d[0] / len) * (width / 2)];
  for (const s of [1, -1]) {
    const off = [n[0] * s, n[1] * s];
    for (let i = 0; i < bays; i++) {
      const a = lerp2(A, B, i / bays), b = lerp2(A, B, (i + 1) / bays);
      p.m.line(p.L(a[0] + off[0], y0, a[1] + off[1]), p.L(b[0] + off[0], y1, b[1] + off[1]), color);
      p.m.line(p.L(a[0] + off[0], y1, a[1] + off[1]), p.L(b[0] + off[0], y0, b[1] + off[1]), color);
      p.m.line(p.L(a[0] + off[0], y1, a[1] + off[1]), p.L(b[0] + off[0], y1, b[1] + off[1]), color);
    }
  }
}

function makeBridges() {
  const out = [];
  // --- Golden Gate: International Orange, 1280 m main span, 227 m towers, 67 m deck clearance ---
  {
    const { s, n } = LANDMARKS.goldenGate;
    const c = lerp2(s, n, 0.5);
    const p = new Placed('GOLDEN GATE BRIDGE', c[0], c[1]);
    const lod = new MeshBuilder();
    p.lodLines = lod;
    const len = Math.hypot(n[0] - s[0], n[1] - s[1]);
    const t1 = (len - 1280) / 2 / len;
    suspension(p, s, n, [t1, 1 - t1], { deckY: 67, towerY: 227, width: 27, red: RAMP.red, deckRamp: [C.G2, C.G3, C.G4], lod, spacing: 30, lineColor: C.RED, xBrace: true });
    out.push(p);
  }
  // --- Bay Bridge: silver twin suspension spans to Yerba Buena, cantilever and causeway beyond ---
  {
    const { a, b } = LANDMARKS.bayBridgeW;
    const c = lerp2(a, b, 0.5);
    const p = new Placed('BAY BRIDGE', c[0], c[1]);
    const lod = new MeshBuilder();
    p.lodLines = lod;
    suspension(p, a, lerp2(a, b, 0.5), [0.22, 0.78], { deckY: 58, towerY: 150, width: 22, red: RAMP.light, deckRamp: RAMP.urban, lod, spacing: 45, lineColor: C.G8 });
    suspension(p, lerp2(a, b, 0.5), b, [0.22, 0.78], { deckY: 58, towerY: 150, width: 22, red: RAMP.light, deckRamp: RAMP.urban, lod, spacing: 45, lineColor: C.G8 });
    // Central anchorage pier
    const ca = lerp2(a, b, 0.5);
    p.m.box(ca[0] - p.cx, 35, ca[1] - p.cz, 30, 70, 30, RAMP.grey);
    p.colliders.push({ kind: 'box', x: ca[0], z: ca[1], hx: 16, hz: 16, y0: 0, y1: 72 });
    out.push(p);
  }
  {
    const { a, b } = LANDMARKS.bayBridgeE;
    const c = lerp2(a, b, 0.5);
    const p = new Placed('BAY BRIDGE EAST', c[0], c[1]);
    const lod = new MeshBuilder();
    p.lodLines = lod;
    causeway(p, a, b, { lowY: 16, highY: 52, highFrom: -0.1, highTo: 0.22, width: 20 });
    truss(p, a, lerp2(a, b, 0.3), 52, 92, 20, C.G8, 14);
    out.push(p);
  }
  for (const [name, key, opts] of [
    ['SAN MATEO BRIDGE', 'sanMateo', { lowY: 11, highY: 41, highFrom: 0.08, highTo: 0.24, width: 15 }],
    ['DUMBARTON BRIDGE', 'dumbarton', { lowY: 12, highY: 26, highFrom: 0.3, highTo: 0.5, width: 13 }],
    ['RICHMOND BRIDGE', 'richmond', { lowY: 18, highY: 56, highFrom: 0.3, highTo: 0.7, width: 13 }],
    ['CARQUINEZ BRIDGE', 'carquinez', { lowY: 45, highY: 50, highFrom: 0, highTo: 1, width: 18 }],
  ]) {
    const { a, b } = LANDMARKS[key];
    const c = lerp2(a, b, 0.5);
    const p = new Placed(name, c[0], c[1]);
    const lod = new MeshBuilder();
    p.lodLines = lod;
    causeway(p, a, b, opts);
    if (key === 'richmond') truss(p, lerp2(a, b, 0.3), lerp2(a, b, 0.7), 56, 86, 13, C.G7, 16);
    if (key === 'carquinez') truss(p, a, b, 50, 96, 18, C.G8, 14);
    out.push(p);
  }
  return out;
}

function makeSanFrancisco() {
  const out = [];
  const [tx, tz] = LANDMARKS.transamerica;
  {
    const p = new Placed('DOWNTOWN', tx, tz);
    // The Transamerica Pyramid, 260 m, the skyline's signature
    const lx = 0, lz = 0;
    p.m.taper(lx, 0, lz, 44, 212, 12, PALE_BLD);
    p.m.taper(lx, 212, lz, 12, 260, 0.5, [C.G6, C.G7, C.G8, C.G9, C.G10, C.WHITE]);
    // "Wings"
    p.m.poly([[22, 80, 0], [10, 150, 0], [10, 80, 0]], PALE_BLD);
    p.m.poly([[-22, 80, 0], [-10, 150, 0], [-10, 80, 0]], PALE_BLD);
    p.m.poly([[-22, 0.5, -22], [22, 0.5, -22], [160, 0.5, -146], [160 - 10, 0.5, -130], [0, 0.5, 22]], C.BLACK);
    p.colliders.push({ kind: 'box', x: tx, z: tz, hx: 22, hz: 22, y0: 0, y1: 260 });
    const r = seeded(1906);
    const grid = 90;
    for (let i = -6; i <= 6; i++) {
      for (let j = -5; j <= 7; j++) {
        if (Math.abs(i) < 1 && Math.abs(j) < 1) continue;
        const x = tx + i * grid + 80, z = tz + j * grid - 150;
        const dist = Math.hypot(i - 1, j + 1);
        if (r() < 0.3 + dist * 0.05) continue;
        const tall = Math.max(16, (190 - dist * 26) * (0.35 + r() * 0.75));
        const w = 30 + r() * 28, d = 30 + r() * 28;
        building(p, x, z, w, d, tall, r() < 0.3 ? DARK_BLD : r() < 0.5 ? PALE_BLD : LIGHT_BLD);
        if (tall > 120) p.m.box(x - p.cx, tall + 12, z - p.cz, w * 0.5, 24, d * 0.5, LIGHT_BLD);
      }
    }
    // Ferry Building clock tower
    const [fx, fz] = LANDMARKS.ferry;
    building(p, fx, fz, 26, 100, 14, LIGHT_BLD);
    p.m.taper(fx - p.cx, 14, fz - p.cz, 12, 72, 7, PALE_BLD);
    p.colliders.push({ kind: 'box', x: fx, z: fz, hx: 7, hz: 7, y0: 0, y1: 75 });
    out.push(p);
  }
  // Coit Tower on Telegraph Hill
  {
    const [x, z] = LANDMARKS.coit;
    const p = new Placed('COIT TOWER', x, z, 60);
    p.m.cyl(0, 60, 0, 9, 125, PALE_BLD, 8, 9);
    p.colliders.push({ kind: 'box', x, z, hx: 9, hz: 9, y0: 0, y1: 125 });
    out.push(p);
  }
  // Sutro Tower on Mount Sutro, three-pronged and striped
  {
    const [x, z] = LANDMARKS.sutro;
    const p = new Placed('SUTRO TOWER', x, z, 240);
    const y0 = 245;
    const white = [C.G9, C.G10, C.WHITE], red = RAMP.red;
    const legs = [[0, 24], [20.8, -12], [-20.8, -12]];
    for (let s = 0; s < 6; s++) {
      const t0 = s / 6, t1 = (s + 1) / 6;
      const w0 = 1 - t0 * 0.75, w1 = 1 - t1 * 0.75;
      for (const [lx, lz] of legs) {
        const m = s % 2 ? white : red;
        p.m.cyl(lx * w0, y0 + 210 * t0, lz * w0, 3, y0 + 210 * t1, m, 4, 2.6);
      }
    }
    for (const [lx, lz] of legs) p.m.cyl(lx * 0.25, y0 + 210, lz * 0.25, 2.3, y0 + 298, white, 4, 0.8);
    p.colliders.push({ kind: 'box', x, z, hx: 24, hz: 24, y0: 0, y1: y0 + 298 });
    out.push(p);
  }
  // Alcatraz: cellhouse, lighthouse, the water tower
  {
    const [x, z] = LANDMARKS.alcatraz;
    const p = new Placed('ALCATRAZ', x, z, 20);
    p.m.box(0, 26, 0, 100, 16, 34, LIGHT_BLD);
    p.m.box(40, 18, -55, 60, 10, 20, DARK_BLD);
    p.m.taper(-60, 20, 28, 8, 64, 4, PALE_BLD);
    p.m.taper(70, 18, 40, 10, 48, 8, DARK_BLD);
    p.colliders.push({ kind: 'box', x, z, hx: 110, hz: 90, y0: 0, y1: 36 });
    out.push(p);
  }
  // Fort Point, under the bridge's south approach
  {
    const [x, z] = LANDMARKS.fortPoint;
    const p = new Placed('FORT POINT', x, z);
    p.m.box(0, 8, -6, 60, 16, 45, [C.BROWN, C.DRY, C.G5]);
    out.push(p);
  }
  // Candlestick Park
  {
    const [x, z] = LANDMARKS.candlestick;
    const p = new Placed('CANDLESTICK PARK', x, z);
    stadium(p, 120, 100, 34);
    out.push(p);
  }
  return out;
}

function stadium(p, a, b, h) {
  const n = 14;
  const outer = [], inner = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2;
    outer.push([Math.cos(t) * a, Math.sin(t) * b]);
    inner.push([Math.cos(t) * a * 0.62, Math.sin(t) * b * 0.62]);
  }
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    p.m.poly([[outer[i][0], 0, outer[i][1]], [outer[j][0], 0, outer[j][1]], [outer[j][0], h, outer[j][1]], [outer[i][0], h, outer[i][1]]], LIGHT_BLD);
    p.m.poly([[outer[i][0], h, outer[i][1]], [outer[j][0], h, outer[j][1]], [inner[j][0], 3, inner[j][1]], [inner[i][0], 3, inner[i][1]]], [C.G3, C.G4, C.G5]);
  }
  p.m.poly(inner.map(([x, z]) => [x, 3, z]), C.LAND_L);
  p.colliders.push({ kind: 'box', x: p.cx, z: p.cz, hx: a, hz: b, y0: 0, y1: h });
}

function cityCluster(name, lat, lon, count, maxH, spread, seed, grid = 70) {
  const [cx, cz] = toWorld(lat, lon);
  const p = new Placed(name, cx, cz);
  const r = seeded(seed);
  const used = new Set();
  for (let n = 0; n < count; n++) {
    const a = r() * Math.PI * 2, d = Math.pow(r(), 0.8) * spread;
    const gx = Math.round((Math.cos(a) * d) / grid), gz = Math.round((Math.sin(a) * d) / grid);
    const key = gx + ',' + gz;
    if (used.has(key)) continue;
    used.add(key);
    const falloff = 1 - (d / spread) * 0.8;
    const h = Math.max(8, maxH * falloff * (0.25 + r() * 0.75));
    building(p, cx + gx * grid, cz + gz * grid, grid * (0.4 + r() * 0.35), grid * (0.4 + r() * 0.35), h, r() < 0.25 ? DARK_BLD : r() < 0.4 ? PALE_BLD : LIGHT_BLD);
  }
  return p;
}

function makeAirfields() {
  const out = [];
  for (const key of Object.keys(BASES)) {
    const b = BASES[key];
    const [tx, tz] = b.towerAt;
    const p = new Placed(b.title, tx, tz);
    // Control tower: shaft, flared cab, dark glass
    p.m.taper(0, 0, 0, 10, 38, 7, PALE_BLD);
    p.m.box(0, 42, 0, 13, 8, 13, DARK_BLD, [C.G5]);
    p.m.line([0, 46, 0], [0, 56, 0], C.G8);
    p.colliders.push({ kind: 'box', x: tx, z: tz, hx: 7, hz: 7, y0: 0, y1: 56 });
    const rw = RUNWAYS[b.rwy];
    const dx = rw.b[0] - rw.a[0], dz = rw.b[1] - rw.a[1];
    const len = Math.hypot(dx, dz);
    const ax = dx / len, az = dz / len;
    const nx = az, nz = -ax;
    // Which side of the runway is the tower on? Build the line of hangars there.
    const side = (tx - rw.a[0]) * nx + (tz - rw.a[1]) * nz > 0 ? 1 : -1;
    const r = seeded(key.length * 77 + 3);
    for (let i = 0; i < 9; i++) {
      const u = len * (0.12 + i * 0.09);
      const off = 330 + r() * 80;
      const x = rw.a[0] + ax * u + nx * off * side;
      const z = rw.a[1] + az * u + nz * off * side;
      building(p, x, z, 56, 48, 16 + r() * 12, i % 3 === 0 ? PALE_BLD : LIGHT_BLD);
    }
    out.push(p);
  }
  // SFO terminal crescent
  {
    const [x, z] = toWorld(37.6163, -122.3893);
    const p = new Placed('SFO TERMINAL', x, z);
    for (let i = 0; i < 7; i++) {
      const a = -0.7 + i * 0.25;
      building(p, x + Math.sin(a) * 520, z + Math.cos(a) * 280, 120, 70, 15, PALE_BLD);
    }
    out.push(p);
  }
  // Hangar One: 345 x 94 x 60 m, one of the largest free-standing structures on Earth
  {
    const { c: [x, z], heading } = LANDMARKS.hangarOne;
    const p = new Placed('HANGAR ONE', x, z);
    const th = (heading * Math.PI) / 180;
    const c = Math.cos(th), s = Math.sin(th);
    const P = (a, y, b) => [a * c + b * s, y, -a * s + b * c];
    const prof = [[-47, 0], [-41, 32], [-22, 54], [0, 60], [22, 54], [41, 32], [47, 0]];
    const metal = [C.G5, C.G6, C.G7, C.G8, C.G9];
    for (let i = 0; i + 1 < prof.length; i++) {
      const [a0, y0] = prof[i], [a1, y1] = prof[i + 1];
      p.m.poly([P(a0, y0, 172), P(a1, y1, 172), P(a1, y1, -172), P(a0, y0, -172)], metal);
    }
    for (const e of [172, -172]) p.m.poly(prof.map(([a, y]) => P(a, y, e)), [C.G4, C.G5, C.G6]);
    p.colliders.push({ kind: 'box', x, z, hx: 170, hz: 170, y0: 0, y1: 60 });
    out.push(p);
  }
  // Port of Oakland: the container cranes that line the Bay Bridge's eastern shore
  {
    const [x, z] = toWorld(37.7985, -122.3295);
    const p = new Placed('PORT OF OAKLAND', x, z);
    for (let i = 0; i < 7; i++) {
      const ox = i * 95 - 280, oz = -i * 40;
      const col = i % 2 ? C.RED : C.BLUE_T;
      for (const dz of [-14, 14]) for (const dxx of [-16, 16]) p.m.line([ox + dxx, 0, oz + dz], [ox + dxx, 42, oz + dz], col);
      p.m.line([ox - 16, 42, oz - 60], [ox - 16, 42, oz + 44], col);
      p.m.line([ox + 16, 42, oz - 60], [ox + 16, 42, oz + 44], col);
      p.m.line([ox - 16, 42, oz + 14], [ox + 16, 42, oz + 14], col);
      p.m.line([ox, 42, oz], [ox, 62, oz], col);
    }
    p.colliders.push({ kind: 'box', x, z, hx: 320, hz: 180, y0: 0, y1: 55 });
    out.push(p);
  }
  return out;
}

function makeMisc() {
  const out = [];
  // Hoover Tower at Stanford
  {
    const [x, z] = LANDMARKS.hoover;
    const p = new Placed('HOOVER TOWER', x, z);
    building(p, x, z, 16, 16, 86, PALE_BLD, [C.RED, C.RED_L]);
    p.m.taper(0, 86, 0, 12, 94, 0.5, [C.RED, C.RED_L]);
    out.push(p);
  }
  // The Campanile at Berkeley
  {
    const [x, z] = LANDMARKS.campanile;
    const p = new Placed('CAMPANILE', x, z, 70);
    p.m.taper(0, 70, 0, 11, 160, 9, PALE_BLD);
    p.m.taper(0, 160, 0, 9, 180, 0.5, [C.G6, C.G7, C.G8]);
    p.colliders.push({ kind: 'box', x, z, hx: 7, hz: 7, y0: 0, y1: 180 });
    out.push(p);
  }
  // Oakland Coliseum
  {
    const [x, z] = LANDMARKS.coliseum;
    const p = new Placed('OAKLAND COLISEUM', x, z);
    stadium(p, 110, 92, 26);
    out.push(p);
  }
  // Electronic Arts' San Mateo office, the original game's famous in-joke
  {
    const [x, z] = LANDMARKS.eaHq;
    const p = new Placed('ELECTRONIC ARTS', x, z);
    building(p, x, z, 74, 42, 20, PALE_BLD);
    p.m.box(0, 21, 0, 40, 2, 14, [C.RED_L], [C.RED_L]);
    p.m.line([26, 20, 12], [26, 38, 12], C.G8);
    out.push(p);
  }
  // Air-defence radar dome on Mt Tamalpais
  {
    const [x, z] = LANDMARKS.tamDome;
    const p = new Placed('MT TAM RADAR', x, z, 720);
    const y0 = 760;
    p.m.cyl(0, y0, 0, 12, y0 + 12, LIGHT_BLD, 6, 12);
    p.m.cyl(0, y0 + 12, 0, 13, y0 + 28, [C.G8, C.G9, C.G10, C.WHITE], 6, 5);
    p.m.poly(Array.from({ length: 6 }, (_, i) => [Math.cos((i / 6) * 6.283) * 5, y0 + 28, Math.sin((i / 6) * 6.283) * 5]), C.WHITE);
    out.push(p);
  }
  // Point Bonita and Farallon lights
  for (const [name, key, h, base] of [['POINT BONITA', 'bonita', 14, 22], ['FARALLON LIGHT', 'farallon', 14, 100]]) {
    const [x, z] = LANDMARKS[key];
    const p = new Placed(name, x, z, base);
    p.m.taper(0, base, 0, 6, base + h, 3, [C.G9, C.G10, C.WHITE]);
    p.m.point([0, base + h + 1, 0], C.YELLOW);
    out.push(p);
  }
  // Mt Diablo beacon
  {
    const [x, z] = LANDMARKS.diablo;
    const p = new Placed('MT DIABLO', x, z, 1160);
    p.m.taper(0, 1180, 0, 9, 1195, 7, LIGHT_BLD);
    out.push(p);
  }
  // Container ships riding at anchor off Alameda and Hunters Point: scale for low flying
  const rShip = seeded(88);
  for (const [lat, lon] of [[37.76, -122.34], [37.72, -122.34], [37.85, -122.39], [37.65, -122.29], [37.92, -122.43]]) {
    const [x, z] = toWorld(lat, lon);
    const p = new Placed('FREIGHTER', x, z);
    const th = rShip() * 3.14;
    const c = Math.cos(th), s = Math.sin(th);
    const P = (a, y, b) => [a * c + b * s, y, -a * s + b * c];
    const hull = [[-16, -100], [16, -100], [16, 70], [0, 110], [-16, 70]];
    for (let i = 0; i < 5; i++) {
      const [a0, b0] = hull[i], [a1, b1] = hull[(i + 1) % 5];
      p.m.poly([P(a0, 0, b0), P(a1, 0, b1), P(a1, 14, b1), P(a0, 14, b0)], [C.BLACK, C.G1, C.G2]);
    }
    p.m.poly(hull.map(([a, b]) => P(a, 14, b)), [C.RED_D, C.RED]);
    const q = P(0, 0, -74);
    p.m.box(q[0], 24, q[2], 24, 20, 18, LIGHT_BLD, LIGHT_BLD, th);
    for (let i = 0; i < 4; i++) {
      const u = P(0, 0, -36 + i * 28);
      p.m.box(u[0], 19, u[2], 22, 10, 20, i % 2 ? [C.BLUE_T, C.BLUE_L] : [C.RED, C.RED_L], undefined, th);
    }
    p.colliders.push({ kind: 'box', x, z, hx: 80, hz: 80, y0: 0, y1: 26 });
    out.push(p);
  }
  return out;
}

export function buildLandmarks() {
  const placed = [
    ...makeBridges(),
    ...makeSanFrancisco(),
    ...makeAirfields(),
    ...makeMisc(),
    cityCluster('RICHMOND DIST', 37.778, -122.468, 46, 20, 1700, 11, 120),
    cityCluster('SUNSET', 37.752, -122.482, 40, 16, 1600, 12, 130),
    cityCluster('CIVIC CENTER', 37.778, -122.421, 44, 55, 1200, 13),
    cityCluster('MISSION', 37.758, -122.415, 38, 22, 1500, 14, 110),
    cityCluster('OAKLAND', 37.806, -122.272, 42, 105, 800, 15),
    cityCluster('BERKELEY', 37.869, -122.283, 22, 28, 1400, 16, 120),
    cityCluster('SAN JOSE', 37.335, -121.889, 42, 86, 900, 17),
    cityCluster('SAN MATEO', 37.562, -122.31, 18, 30, 1300, 18, 120),
    cityCluster('REDWOOD CITY', 37.487, -122.228, 14, 28, 1000, 19, 120),
    cityCluster('PALO ALTO', 37.444, -122.162, 14, 40, 900, 20, 120),
    cityCluster('SAUSALITO', 37.862, -122.487, 12, 14, 600, 21, 90),
    cityCluster('SAN RAFAEL', 37.974, -122.53, 16, 22, 800, 22, 110),
    cityCluster('VALLEJO', 38.105, -122.255, 14, 18, 800, 23, 110),
    cityCluster('WALNUT CREEK', 37.905, -122.06, 14, 50, 700, 24, 110),
    cityCluster('HAYWARD', 37.668, -122.086, 14, 22, 900, 25, 110),
    cityCluster('SUNNYVALE', 37.385, -122.025, 18, 26, 1300, 26, 130),
    cityCluster('FREMONT', 37.548, -121.988, 14, 20, 1000, 27, 120),
  ];
  const meshes = [];
  const colliders = [];
  for (const p of placed) {
    const y = 0;
    meshes.push({ name: p.name, x: p.cx, y, z: p.cz, mesh: p.m.build(), lod: p.lodLines && p.lodLines.lines ? p.lodLines.build() : null });
    colliders.push(...p.colliders);
  }
  return { meshes, colliders };
}
