// Bakes src/world/data.gen.js: real Bay Area coastline + low-poly terrain.
// Pipeline: DEM -> blurred land mask -> contour -> simplify -> clip land-use -> earcut,
//           DEM -> height grid -> RTIN adaptive triangle mesh with a per-triangle cover class.
import fs from 'node:fs';
import { contours } from 'd3-contour';
import earcut from 'earcut';
import polygonClipping from 'polygon-clipping';
import simplify from 'simplify-js';
import { PNG } from 'pngjs';
import { loadDem } from './fetch-terrain.mjs';
import { toWorld, URBAN_OUTLINES, PARK_OUTLINES, DOWNTOWN_OUTLINE, APRONS, FLATTEN, RUNWAYS, LANDMARKS } from '../src/world/geo.js';

const COAST_TOLERANCE_M = 130;
const MAP_TOLERANCE_M = 450;
const MIN_ISLAND_KM2 = 0.09;
const MIN_LAKE_KM2 = 1.6;
const GRID = 257; // RTIN grid size, must be 2^k+1
const MAX_ERROR_M = 62;
const MIN_TRI_HEIGHT_M = 14;
const HEIGHT_FLOOR_M = 30;
const HEIGHT_SCALE = 1.12;

const { dem, W, H, pxLon, pyLat } = await loadDem();

// --- Land mask, box-blurred to remove pixel noise, then contoured at 0.5 ---
const DS = 2;
const mw = Math.floor(W / DS), mh = Math.floor(H / DS);
const mask = new Float64Array(mw * mh);
for (let y = 0; y < mh; y++)
  for (let x = 0; x < mw; x++) {
    let land = 0;
    for (let j = 0; j < DS; j++) for (let i = 0; i < DS; i++) if (dem[(y * DS + j) * W + x * DS + i] > 0) land++;
    mask[y * mw + x] = land / (DS * DS);
  }
function blur(src, w, h, r) {
  const a = new Float64Array(w * h), b = new Float64Array(w * h);
  const n = 2 * r + 1;
  for (let y = 0; y < h; y++) {
    let s = 0;
    for (let x = -r; x <= r; x++) s += src[y * w + Math.max(0, Math.min(w - 1, x))];
    for (let x = 0; x < w; x++) {
      a[y * w + x] = s / n;
      s += src[y * w + Math.min(w - 1, x + r + 1)] - src[y * w + Math.max(0, x - r)];
    }
  }
  for (let x = 0; x < w; x++) {
    let s = 0;
    for (let y = -r; y <= r; y++) s += a[Math.max(0, Math.min(h - 1, y)) * w + x];
    for (let y = 0; y < h; y++) {
      b[y * w + x] = s / n;
      s += a[Math.min(h - 1, y + r + 1) * w + x] - a[Math.max(0, y - r) * w + x];
    }
  }
  return b;
}
const smooth = blur(mask, mw, mh, 1);

const pxToWorld = (px, py) => {
  const lon = pxLon(px * DS), lat = pyLat(py * DS);
  return toWorld(lat, lon);
};
const worldW = toWorld(pyLat(H / 2), pxLon(0))[0], worldE = toWorld(pyLat(H / 2), pxLon(W - 1))[0];
const worldN = toWorld(pyLat(0), pxLon(W / 2))[1], worldS = toWorld(pyLat(H - 1), pxLon(W / 2))[1];
console.log('world extents km', (worldW / 1e3) | 0, (worldE / 1e3) | 0, (worldS / 1e3) | 0, (worldN / 1e3) | 0);

const areaOf = (ring) => {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += (ring[j][0] + ring[i][0]) * (ring[j][1] - ring[i][1]);
  return a / 2;
};
const simplifyRing = (ring, tol) => {
  const pts = ring.slice(0, -1).map(([x, y]) => ({ x, y }));
  // Split closed ring at two far points so Douglas-Peucker has stable anchors.
  let far = 0, best = -1;
  for (let i = 0; i < pts.length; i++) {
    const d = (pts[i].x - pts[0].x) ** 2 + (pts[i].y - pts[0].y) ** 2;
    if (d > best) { best = d; far = i; }
  }
  const a = simplify(pts.slice(0, far + 1), tol, true);
  const b = simplify(pts.slice(far).concat([pts[0]]), tol, true);
  const out = a.concat(b.slice(1, -1)).map((p) => [Math.round(p.x), Math.round(p.y)]);
  return out;
};

const raw = contours().size([mw, mh]).smooth(true).thresholds([0.5])(smooth)[0].coordinates;
console.log('raw polygons', raw.length);

function buildPolys(tol, minIsland, minLake) {
  const polys = [];
  for (const poly of raw) {
    const outer = poly[0].map(([x, y]) => pxToWorld(x, y));
    const aOuter = Math.abs(areaOf(outer)) / 1e6;
    if (aOuter < minIsland) continue;
    const s = simplifyRing(outer, tol);
    if (s.length < 3) continue;
    const rings = [s];
    for (let i = 1; i < poly.length; i++) {
      const hole = poly[i].map(([x, y]) => pxToWorld(x, y));
      if (Math.abs(areaOf(hole)) / 1e6 < minLake) continue;
      const h = simplifyRing(hole, tol);
      if (h.length >= 3) rings.push(h);
    }
    polys.push(rings);
  }
  return polys;
}
const closeRing = (r) => (r[0][0] === r[r.length - 1][0] && r[0][1] === r[r.length - 1][1] ? r : r.concat([r[0]]));
let land = buildPolys(COAST_TOLERANCE_M, MIN_ISLAND_KM2, MIN_LAKE_KM2);
let mapRings = buildPolys(MAP_TOLERANCE_M, 0.25, 6).flat();
const cleaned = polygonClipping.union(land.map((p) => p.map(closeRing)));
land = cleaned;
console.log('land polys', land.length, 'verts', land.flat(2).length);

// --- Land use ---
const fromLatLon = (ol) => [closeRing(ol.map(([la, lo]) => toWorld(la, lo).map(Math.round)))];
const urbanRaw = polygonClipping.union(...URBAN_OUTLINES.map((o) => [fromLatLon(o)]));
const parksRaw = polygonClipping.union(...PARK_OUTLINES.map((o) => [fromLatLon(o)]));
const urban = polygonClipping.difference(polygonClipping.intersection(urbanRaw, land), parksRaw);
const downtown = polygonClipping.intersection([fromLatLon(DOWNTOWN_OUTLINE)], land);
const aprons = polygonClipping.union(...APRONS.map((o) => [fromLatLon(o)]));

function triangulate(multi) {
  const verts = [], tris = [];
  for (const poly of multi) {
    const flat = [], holes = [];
    for (let r = 0; r < poly.length; r++) {
      if (r > 0) holes.push(flat.length / 2);
      const ring = poly[r];
      const n = ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1] ? ring.length - 1 : ring.length;
      for (let i = 0; i < n; i++) flat.push(Math.round(ring[i][0]), Math.round(ring[i][1]));
    }
    const idx = earcut(flat, holes.length ? holes : null);
    const base = verts.length / 2;
    for (const v of flat) verts.push(v);
    for (const i of idx) tris.push(i + base);
  }
  return { v: verts, t: tris };
}
const layers = {
  land: triangulate(land),
  urban: triangulate(urban),
  downtown: triangulate(downtown),
  apron: triangulate(aprons),
};
for (const k in layers) console.log(k, 'verts', layers[k].v.length / 2, 'tris', layers[k].t.length / 3);

// --- Outer continent, so land reaches the horizon past the data edge ---
function coastCrossing(rowPx) {
  // Westernmost long land run on this row of the mask.
  for (let x = 0; x < mw - 5; x++) if (smooth[rowPx * mw + x] > 0.5 && smooth[rowPx * mw + x + 4] > 0.5) return pxToWorld(x, rowPx)[0];
  return worldE;
}
const R = 3000000;
const northX = coastCrossing(1), southX = coastCrossing(mh - 2);
const outer = [
  // north strip: real coast trends NW, south strip trends SE
  [Math.round(northX), Math.round(worldN), Math.round(worldE), Math.round(worldN), R, R, Math.round(northX - R * 0.5), R],
  [Math.round(worldE), Math.round(worldN), Math.round(worldE), Math.round(worldS), R, -R, R, R],
  [Math.round(worldE), Math.round(worldS), Math.round(southX), Math.round(worldS), Math.round(southX + R * 0.45), -R, R, -R],
];

// --- Terrain heights ---
const rasterIndex = (wx, wz) => {
  // Invert the world projection through the raster's Mercator rows.
  const lon = wx / (111320 * Math.cos((37.75 * Math.PI) / 180)) - 122.4;
  const lat = wz / 110990 + 37.75;
  const px = ((lon - pxLon(0)) / (pxLon(W) - pxLon(0))) * W;
  const merc = (la) => Math.log(Math.tan(Math.PI / 4 + (la * Math.PI) / 360));
  const py = ((merc(pyLat(0)) - merc(lat)) / (merc(pyLat(0)) - merc(pyLat(H)))) * H;
  return [px, py];
};
const worldSpan = Math.min(worldE - worldW, worldN - worldS);
const gridW = worldE - worldW, gridH = worldN - worldS;
const dx = gridW / (GRID - 1), dz = gridH / (GRID - 1);
const heights = new Float32Array(GRID * GRID);
const smoothstep = (a, b, t) => { const u = Math.max(0, Math.min(1, (t - a) / (b - a))); return u * u * (3 - 2 * u); };
for (let j = 0; j < GRID; j++)
  for (let i = 0; i < GRID; i++) {
    const wx = worldW + i * dx, wz = worldS + j * dz;
    const [px, py] = rasterIndex(wx, wz);
    const r = Math.max(1, Math.round((dx / 60) * 0.6));
    let sum = 0, n = 0, max = -1e9, waterHits = 0;
    for (let v = -r; v <= r; v++)
      for (let u = -r; u <= r; u++) {
        const ix = Math.round(px) + u, iy = Math.round(py) + v;
        if (ix < 0 || iy < 0 || ix >= W || iy >= H) continue;
        const e = dem[iy * W + ix];
        sum += Math.max(0, e);
        if (e > max) max = e;
        if (e <= 0) waterHits++;
        n++;
      }
    if (!n) continue;
    let h = sum / n * 0.55 + Math.max(0, max) * 0.45;
    if (waterHits / n > 0.2) h *= 0.15; // keep channels open: coast cells collapse toward sea level
    h = Math.max(0, h - HEIGHT_FLOOR_M) * HEIGHT_SCALE;
    for (const f of FLATTEN) {
      const d = Math.hypot(wx - f.at[0], wz - f.at[1]);
      h *= smoothstep(f.r, f.r * 1.6, d);
    }
    heights[j * GRID + i] = h;
  }

// --- RTIN (right-triangulated irregular network): adaptive low-poly mesh ---
const tile = GRID - 1;
const numTriangles = tile * tile * 2 - 2;
const numParents = numTriangles - tile * tile;
const coords = new Uint16Array(numTriangles * 4);
for (let i = 0; i < numTriangles; i++) {
  let id = i + 2, ax = 0, ay = 0, bx = 0, by = 0, cx = 0, cy = 0;
  if (id & 1) { bx = by = cx = tile; } else { ax = ay = cy = tile; }
  while ((id >>= 1) > 1) {
    const mx = (ax + bx) >> 1, my = (ay + by) >> 1;
    if (id & 1) { bx = ax; by = ay; ax = cx; ay = cy; } else { ax = bx; ay = by; bx = cx; by = cy; }
    cx = mx; cy = my;
  }
  const k = i * 4;
  coords[k] = ax; coords[k + 1] = ay; coords[k + 2] = bx; coords[k + 3] = by;
}
const errors = new Float32Array(GRID * GRID);
for (let i = numTriangles - 1; i >= 0; i--) {
  const k = i * 4;
  const ax = coords[k], ay = coords[k + 1], bx = coords[k + 2], by = coords[k + 3];
  const mx = (ax + bx) >> 1, my = (ay + by) >> 1;
  const cx = mx + my - ay, cy = my + ax - mx;
  const interp = (heights[ay * GRID + ax] + heights[by * GRID + bx]) / 2;
  const mid = my * GRID + mx;
  errors[mid] = Math.max(errors[mid], Math.abs(interp - heights[mid]));
  if (i < numParents) {
    const l = ((ay + cy) >> 1) * GRID + ((ax + cx) >> 1);
    const r = ((by + cy) >> 1) * GRID + ((bx + cx) >> 1);
    errors[mid] = Math.max(errors[mid], errors[l], errors[r]);
  }
}
function pointInMulti(multi, x, z) {
  for (const poly of multi) {
    let inside = false;
    for (let r = 0; r < poly.length; r++) {
      const ring = poly[r];
      let c = false;
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, zi] = ring[i], [xj, zj] = ring[j];
        if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
      }
      if (r === 0) inside = c; else if (c) inside = false;
    }
    if (inside) return true;
  }
  return false;
}
const rawTris = [];
const emit = (ax, ay, bx, by, cx, cy) => {
  const ha = heights[ay * GRID + ax], hb = heights[by * GRID + bx], hc = heights[cy * GRID + cx];
  if (Math.max(ha, hb, hc) < MIN_TRI_HEIGHT_M) return;
  rawTris.push([worldW + ax * dx, ha, worldS + ay * dz, worldW + bx * dx, hb, worldS + by * dz, worldW + cx * dx, hc, worldS + cy * dz]);
};
const process_ = (ax, ay, bx, by, cx, cy) => {
  const mx = (ax + bx) >> 1, my = (ay + by) >> 1;
  if (Math.abs(ax - cx) + Math.abs(ay - cy) > 1 && errors[my * GRID + mx] > MAX_ERROR_M) {
    process_(cx, cy, ax, ay, mx, my);
    process_(bx, by, cx, cy, mx, my);
  } else emit(ax, ay, bx, by, cx, cy);
};
process_(0, 0, tile, tile, tile, 0);
process_(tile, tile, 0, 0, 0, tile);
console.log('raw terrain tris', rawTris.length);

// Clip each terrain triangle to the real coastline and land-use outlines, so hills never
// spill over the water and city edges stay crisp. Heights come from the source triangle's plane.
const nonUrbanLand = polygonClipping.difference(land, urban);
const tv = [], tt = [], tc = [], indices = new Map();
const addVertex = (x, y, z) => {
  const key = `${Math.round(x)},${Math.round(z)}`;
  let id = indices.get(key);
  if (id === undefined) {
    id = tv.length / 3;
    tv.push(Math.round(x), Math.round(y), Math.round(z));
    indices.set(key, id);
  }
  return id;
};
const planeOf = (t) => {
  const [ax, ay, az, bx, by, bz, cx, cy, cz] = t;
  const ux = bx - ax, uy = by - ay, uz = bz - az, vx = cx - ax, vy = cy - ay, vz = cz - az;
  const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  return (x, z) => ay - (nx * (x - ax) + nz * (z - az)) / ny;
};
const emitPiece = (multi, height, cover) => {
  const r = triangulate(multi);
  for (let i = 0; i < r.t.length; i += 3) {
    const ids = [r.t[i], r.t[i + 1], r.t[i + 2]];
    const pts = ids.map((k) => [r.v[k * 2], r.v[k * 2 + 1]]);
    const area = Math.abs((pts[1][0] - pts[0][0]) * (pts[2][1] - pts[0][1]) - (pts[2][0] - pts[0][0]) * (pts[1][1] - pts[0][1])) / 2;
    if (area < 400) continue; // drop slivers
    const hs = pts.map(([x, z]) => Math.max(0, height(x, z)));
    if (Math.max(...hs) < MIN_TRI_HEIGHT_M) continue;
    tt.push(addVertex(pts[0][0], hs[0], pts[0][1]), addVertex(pts[1][0], hs[1], pts[1][1]), addVertex(pts[2][0], hs[2], pts[2][1]));
    tc.push(cover);
  }
};
let whole = 0, clipped = 0;
for (const t of rawTris) {
  const ring = [[t[0], t[2]], [t[3], t[5]], [t[6], t[8]]];
  const height = planeOf(t);
  const samples = [
    ...ring,
    [(t[0] + t[3]) / 2, (t[2] + t[5]) / 2], [(t[3] + t[6]) / 2, (t[5] + t[8]) / 2], [(t[6] + t[0]) / 2, (t[8] + t[2]) / 2],
    [(t[0] + t[3] + t[6]) / 3, (t[2] + t[5] + t[8]) / 3],
  ];
  const inLand = samples.map(([x, z]) => pointInMulti(land, x, z));
  const inUrban = samples.map(([x, z]) => pointInMulti(urban, x, z));
  const size = Math.max(Math.abs(t[0] - t[3]), Math.abs(t[2] - t[5]), Math.abs(t[3] - t[6]), Math.abs(t[5] - t[8]));
  // Small triangles can be classified by samples alone; big ones may hide a coastline wiggle.
  if (size < 1500 && inLand.every(Boolean) && inUrban.every((v) => !v)) { emitPiece([[[...ring, ring[0]]]], height, 0); whole++; continue; }
  if (size < 1500 && inUrban.every(Boolean)) { emitPiece([[[...ring, ring[0]]]], height, 1); whole++; continue; }
  const poly = [[[...ring, ring[0]]]];
  try {
    emitPiece(polygonClipping.intersection(poly, nonUrbanLand), height, 0);
    emitPiece(polygonClipping.intersection(poly, urban), height, 1);
    clipped++;
  } catch { /* degenerate sliver from robust predicates: skip it */ }
}
console.log('whole', whole, 'clipped', clipped, 'terrain verts', tv.length / 3, 'tris', tt.length / 3);

// --- Emit ---
const data = {
  extents: { w: Math.round(worldW), e: Math.round(worldE), s: Math.round(worldS), n: Math.round(worldN) },
  layers,
  outer,
  terrain: { v: tv, t: tt, c: tc },
  map: mapRings.map((p) => p.flat()),
};
const out = `// GENERATED by tools/build-world.mjs from real elevation data. Do not edit.\n// Terrain: AWS Open Data Terrain Tiles (USGS 3DEP, SRTM, ETOPO1, NOAA). Runways and landmarks: OpenStreetMap contributors (ODbL).\nexport const WORLD = ${JSON.stringify(data)};\n`;
fs.writeFileSync(new URL('../src/world/data.gen.js', import.meta.url), out);
console.log('data.gen.js', (out.length / 1024) | 0, 'KB');

// --- Debug top-down preview ---
const PW = 1100, PH = Math.round((PW * (worldN - worldS)) / (worldE - worldW));
const png = new PNG({ width: PW, height: PH });
const pxOf = (x, z) => [((x - worldW) / (worldE - worldW)) * PW, ((worldN - z) / (worldN - worldS)) * PH];
const fillTri = (a, b, c, col) => {
  const pts = [a, b, c].sort((p, q) => p[1] - q[1]);
  const [p0, p1, p2] = pts;
  for (let y = Math.max(0, Math.ceil(p0[1])); y < Math.min(PH, Math.ceil(p2[1])); y++) {
    const xa = p0[0] + ((y - p0[1]) * (p2[0] - p0[0])) / (p2[1] - p0[1] || 1);
    const xb = y < p1[1] ? p0[0] + ((y - p0[1]) * (p1[0] - p0[0])) / (p1[1] - p0[1] || 1) : p1[0] + ((y - p1[1]) * (p2[0] - p1[0])) / (p2[1] - p1[1] || 1);
    for (let x = Math.max(0, Math.ceil(Math.min(xa, xb))); x < Math.min(PW, Math.ceil(Math.max(xa, xb))); x++) {
      const i = (y * PW + x) * 4;
      png.data[i] = col[0]; png.data[i + 1] = col[1]; png.data[i + 2] = col[2]; png.data[i + 3] = 255;
    }
  }
};
for (let i = 0; i < png.data.length; i += 4) { png.data[i] = 0; png.data[i + 1] = 0x33; png.data[i + 2] = 0x66; png.data[i + 3] = 255; }
const drawLayer = (l, col) => {
  for (let i = 0; i < l.t.length; i += 3) {
    const p = [l.t[i], l.t[i + 1], l.t[i + 2]].map((k) => pxOf(l.v[k * 2], l.v[k * 2 + 1]));
    fillTri(p[0], p[1], p[2], col);
  }
};
drawLayer(layers.land, [0x11, 0x55, 0x11]);
drawLayer(layers.urban, [0x55, 0x55, 0x55]);
drawLayer(layers.downtown, [0x33, 0x33, 0x33]);
drawLayer(layers.apron, [0x77, 0x77, 0x77]);
for (let i = 0; i < tt.length; i += 3) {
  const k = [tt[i], tt[i + 1], tt[i + 2]];
  const h = (tv[k[0] * 3 + 1] + tv[k[1] * 3 + 1] + tv[k[2] * 3 + 1]) / 3;
  const p = k.map((q) => pxOf(tv[q * 3], tv[q * 3 + 2]));
  const n = Math.min(1, h / 900);
  const col = tc[i / 3] ? [0x66 + n * 80, 0x66 + n * 80, 0x66 + n * 80] : [0x22 + n * 150, 0x77 + n * 100, 0x22 + n * 40];
  fillTri(p[0], p[1], p[2], col.map((v) => (v + ((i * 7) % 16)) | 0));
}
for (const r of RUNWAYS) {
  const a = pxOf(r.a[0], r.a[1]), b = pxOf(r.b[0], r.b[1]);
  for (let t = 0; t <= 1; t += 0.005) {
    const x = Math.round(a[0] + (b[0] - a[0]) * t), y = Math.round(a[1] + (b[1] - a[1]) * t);
    const i = (y * PW + x) * 4;
    if (i >= 0 && i < png.data.length) { png.data[i] = 255; png.data[i + 1] = 255; png.data[i + 2] = 255; }
  }
}
for (const key of ['goldenGate', 'bayBridgeW', 'bayBridgeE', 'sanMateo', 'dumbarton', 'richmond', 'carquinez']) {
  const l = LANDMARKS[key];
  const a0 = l.s || l.a, b0 = l.n || l.b;
  const a = pxOf(a0[0], a0[1]), b = pxOf(b0[0], b0[1]);
  for (let t = 0; t <= 1; t += 0.005) {
    const x = Math.round(a[0] + (b[0] - a[0]) * t), y = Math.round(a[1] + (b[1] - a[1]) * t);
    const i = (y * PW + x) * 4;
    if (i >= 0 && i < png.data.length) { png.data[i] = 255; png.data[i + 1] = 40; png.data[i + 2] = 40; }
  }
}
fs.writeFileSync(new URL('../.cache/world-preview.png', import.meta.url), PNG.sync.write(png));
console.log('preview', PW, PH);
