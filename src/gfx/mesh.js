// Flat-shaded polygon meshes. Faces are planar convex polygons. The z-buffer resolves
// visibility, so a face can simply flip its normal toward the viewer for lighting: a wing seen
// from above catches the sun and from below sits in shade, with no winding bookkeeping.
import { RAMP, C } from './palette.js';

export const SUN = (() => {
  const v = [-0.46, 0.78, 0.42];
  const l = Math.hypot(...v);
  return v.map((a) => a / l);
})();

export class MeshBuilder {
  constructor() { this.verts = []; this.faces = []; this.lines = []; this.points = []; }

  v(x, y, z) { this.verts.push(x, y, z); return this.verts.length / 3 - 1; }

  // points: [[x,y,z],...]. ramp: palette ramp array, or a colour index for a fixed flat colour.
  poly(points, ramp, opts = {}) {
    const idx = points.map((p) => this.v(p[0], p[1], p[2]));
    this.faces.push({ idx, ramp: typeof ramp === 'number' ? [ramp] : ramp, tag: opts.tag, cull: opts.cull || null, bias: opts.bias || 0 });
    return this;
  }
  // Mirrors in X, for symmetric airframes.
  polyM(points, ramp, opts = {}) {
    this.poly(points, ramp, opts);
    this.poly(points.map((p) => [-p[0], p[1], p[2]]), ramp, opts);
    return this;
  }
  // Rings of equal vertex count, lofted into quads.
  loft(rings, ramp, opts = {}) {
    for (let r = 0; r + 1 < rings.length; r++) {
      const a = rings[r], b = rings[r + 1];
      const n = a.length;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const pts = [a[i], a[j], b[j], b[i]];
        const faceRamp = opts.rampFor ? opts.rampFor(i, r) : ramp;
        this.poly(pts, faceRamp, opts);
      }
    }
    return this;
  }
  // Closed 2D outline (in the XZ plane) extruded from y0 to y1.
  prismXZ(outline, y0, y1, sideRamp, topRamp = sideRamp, opts = {}) {
    const n = outline.length;
    for (let i = 0; i < n; i++) {
      const [ax, az] = outline[i], [bx, bz] = outline[(i + 1) % n];
      this.poly([[ax, y0, az], [bx, y0, bz], [bx, y1, bz], [ax, y1, az]], sideRamp, opts);
    }
    this.poly(outline.map(([x, z]) => [x, y1, z]), topRamp, opts);
    return this;
  }
  box(cx, cy, cz, sx, sy, sz, ramp, topRamp = ramp, heading = 0) {
    const hx = sx / 2, hz = sz / 2;
    const c = Math.cos(heading), s = Math.sin(heading);
    const rot = ([x, z]) => [cx + x * c + z * s, cz - x * s + z * c];
    const o = [[-hx, -hz], [hx, -hz], [hx, hz], [-hx, hz]].map(rot);
    return this.prismXZ(o, cy - sy / 2, cy + sy / 2, ramp, topRamp);
  }
  // Square pyramid or tapered tower
  taper(cx, y0, cz, w0, y1, w1, ramp) {
    const r0 = w0 / 2, r1 = w1 / 2;
    const c0 = [[-r0, -r0], [r0, -r0], [r0, r0], [-r0, r0]];
    const c1 = [[-r1, -r1], [r1, -r1], [r1, r1], [-r1, r1]];
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      this.poly([
        [cx + c0[i][0], y0, cz + c0[i][1]], [cx + c0[j][0], y0, cz + c0[j][1]],
        [cx + c1[j][0], y1, cz + c1[j][1]], [cx + c1[i][0], y1, cz + c1[i][1]],
      ], ramp);
    }
    if (w1 > 0.01) this.poly(c1.map(([x, z]) => [cx + x, y1, cz + z]), ramp);
    return this;
  }
  // n-sided vertical cylinder
  cyl(cx, y0, cz, r, y1, ramp, n = 6, r1 = r) {
    const a = [], b = [];
    for (let i = 0; i < n; i++) {
      const t = (i / n) * Math.PI * 2;
      a.push([cx + Math.cos(t) * r, y0, cz + Math.sin(t) * r]);
      b.push([cx + Math.cos(t) * r1, y1, cz + Math.sin(t) * r1]);
    }
    this.loft([a, b], ramp);
    if (r1 > 0.01) this.poly(b, ramp);
    return this;
  }
  line(a, b, color) { this.lines.push({ a: this.v(...a), b: this.v(...b), color }); return this; }
  point(p, color) { this.points.push({ i: this.v(...p), color }); return this; }

  build() {
    const verts = Float64Array.from(this.verts);
    let r2 = 0;
    for (let i = 0; i < verts.length; i += 3) r2 = Math.max(r2, verts[i] ** 2 + verts[i + 1] ** 2 + verts[i + 2] ** 2);
    for (const f of this.faces) {
      // Newell's method gives a robust normal even for slightly non-planar quads.
      let nx = 0, ny = 0, nz = 0;
      const n = f.idx.length;
      for (let i = 0; i < n; i++) {
        const a = f.idx[i] * 3, b = f.idx[(i + 1) % n] * 3;
        nx += (verts[a + 1] - verts[b + 1]) * (verts[a + 2] + verts[b + 2]);
        ny += (verts[a + 2] - verts[b + 2]) * (verts[a] + verts[b]);
        nz += (verts[a] - verts[b]) * (verts[a + 1] + verts[b + 1]);
      }
      const l = Math.hypot(nx, ny, nz) || 1;
      f.nx = nx / l; f.ny = ny / l; f.nz = nz / l;
      f.d = f.nx * verts[f.idx[0] * 3] + f.ny * verts[f.idx[0] * 3 + 1] + f.nz * verts[f.idx[0] * 3 + 2];
    }
    return {
      verts,
      vcount: verts.length / 3,
      faces: this.faces,
      lines: this.lines,
      points: this.points,
      radius: Math.sqrt(r2),
      camX: new Float64Array(verts.length / 3),
      camY: new Float64Array(verts.length / 3),
      camZ: new Float64Array(verts.length / 3),
    };
  }
}

const IDENT = { rx: 1, ry: 0, rz: 0, ux: 0, uy: 1, uz: 0, fx: 0, fy: 0, fz: 1 };

// Draws a mesh at world position with basis `b` (rx..fz). `hidden(tag)` can skip tagged faces.
export function drawMesh(g, mesh, px, py, pz, b = IDENT, opts = null) {
  if (!g.sphereVisible(px, py, pz, mesh.radius)) return false;
  const zDist = g.lastZ;
  const minDot = opts && opts.dotBelow !== undefined ? opts.dotBelow : 0.8;
  // Tiny and far away: a single pixel, like the specks on the original's horizon.
  const projected = (mesh.radius * g.focalX) / Math.max(1, zDist);
  if (projected < minDot) {
    if (opts && opts.noDot) return true;
    g.point3D(px, py, pz, opts && opts.dotColor !== undefined ? opts.dotColor : C.G2);
    return true;
  }
  const { verts, vcount, camX, camY, camZ, faces } = mesh;
  // Basis as camera-space rows. Object point -> world -> camera.
  const dx = px - g.camX, dy = py - g.camY, dz = pz - g.camZ;
  const { rx: Rx, ry: Ry, rz: Rz, ux: Ux, uy: Uy, uz: Uz, fx: Fx, fy: Fy, fz: Fz } = g;
  const a00 = b.rx * Rx + b.ry * Ry + b.rz * Rz, a01 = b.ux * Rx + b.uy * Ry + b.uz * Rz, a02 = b.fx * Rx + b.fy * Ry + b.fz * Rz;
  const a10 = b.rx * Ux + b.ry * Uy + b.rz * Uz, a11 = b.ux * Ux + b.uy * Uy + b.uz * Uz, a12 = b.fx * Ux + b.fy * Uy + b.fz * Uz;
  const a20 = b.rx * Fx + b.ry * Fy + b.rz * Fz, a21 = b.ux * Fx + b.uy * Fy + b.uz * Fz, a22 = b.fx * Fx + b.fy * Fy + b.fz * Fz;
  const tx = dx * Rx + dy * Ry + dz * Rz, ty = dx * Ux + dy * Uy + dz * Uz, tz = dx * Fx + dy * Fy + dz * Fz;
  for (let i = 0, k = 0; i < vcount; i++, k += 3) {
    const x = verts[k], y = verts[k + 1], z = verts[k + 2];
    camX[i] = a00 * x + a01 * y + a02 * z + tx;
    camY[i] = a10 * x + a11 * y + a12 * z + ty;
    camZ[i] = a20 * x + a21 * y + a22 * z + tz;
  }
  // Viewer in object space, for normal flipping.
  const ox = -(dx * b.rx + dy * b.ry + dz * b.rz), oy = -(dx * b.ux + dy * b.uy + dz * b.uz), oz = -(dx * b.fx + dy * b.fy + dz * b.fz);
  // Sun in object space
  const sx = SUN[0] * b.rx + SUN[1] * b.ry + SUN[2] * b.rz;
  const sy = SUN[0] * b.ux + SUN[1] * b.uy + SUN[2] * b.uz;
  const sz = SUN[0] * b.fx + SUN[1] * b.fy + SUN[2] * b.fz;
  const hide = opts && opts.hide;
  const cx = g.cx, cy = g.cy, cz = g.cz;
  for (let f = 0; f < faces.length; f++) {
    const face = faces[f];
    if (hide && face.tag && hide[face.tag]) continue;
    const facing = face.nx * ox + face.ny * oy + face.nz * oz - face.d;
    const flip = facing < 0 ? -1 : 1;
    const ramp = face.ramp;
    let color;
    if (ramp.length === 1) color = ramp[0];
    else {
      const lit = (face.nx * sx + face.ny * sy + face.nz * sz) * flip; // -1..1
      const l = 0.5 + lit * 0.5;
      let ci = (l * ramp.length) | 0;
      if (ci >= ramp.length) ci = ramp.length - 1;
      color = ramp[ci];
    }
    const idx = face.idx;
    const n = idx.length;
    for (let i = 0; i < n; i++) { const v = idx[i]; cx[i] = camX[v]; cy[i] = camY[v]; cz[i] = camZ[v]; }
    g.polyCamera(n, color, true, face.bias);
  }
  const lines = mesh.lines;
  if (lines.length && !(opts && opts.noLines)) {
    for (let l = 0; l < lines.length; l++) {
      const ln = lines[l];
      const a = ln.a, c = ln.b;
      _camLine(g, camX[a], camY[a], camZ[a], camX[c], camY[c], camZ[c], ln.color);
    }
  }
  const points = mesh.points;
  if (points.length) {
    for (let p = 0; p < points.length; p++) {
      const pt = points[p], i = pt.i;
      const z = camZ[i];
      if (z < g.near) continue;
      const sxp = (g.centerX + camX[i] * g.focalX / z) | 0, syp = (g.centerY - camY[i] * g.focalY / z) | 0;
      if (sxp >= g.clipX0 && sxp < g.clipX1 && syp >= g.clipY0 && syp < g.clipY1) {
        const o = syp * g.W + sxp;
        const w = (1 / z) * 1.002;
        if (w > g.zb[o]) { g.zb[o] = w; g.fb[o] = pt.color; }
      }
    }
  }
  return true;
}

function _camLine(g, x0, y0, z0, x1, y1, z1, color) {
  const near = g.near;
  if (z0 < near && z1 < near) return;
  if (z0 < near) { const t = (near - z0) / (z1 - z0); x0 += (x1 - x0) * t; y0 += (y1 - y0) * t; z0 = near; }
  else if (z1 < near) { const t = (near - z1) / (z0 - z1); x1 += (x0 - x1) * t; y1 += (y0 - y1) * t; z1 = near; }
  const w0 = 1 / z0, w1 = 1 / z1;
  g._lineZ(g.centerX + x0 * g.focalX * w0, g.centerY - y0 * g.focalY * w0, w0, g.centerX + x1 * g.focalX * w1, g.centerY - y1 * g.focalY * w1, w1, color, 0);
}

export { RAMP };
