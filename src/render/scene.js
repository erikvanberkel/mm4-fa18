// Draws one view of the world: sky, painted ground layers, terrain, structures, entities, FX.
import { C } from '../gfx/palette.js';
import { drawMesh, SUN } from '../gfx/mesh.js';

export class SceneRenderer {
  constructor(gfx, world, models) {
    this.g = gfx;
    this.world = world;
    this.models = models;
    this._vbuf = new Float64Array(64);
    this.enhanced = false;
  }

  // Draws the 3D view into the top `viewH` rows. `sim` may be null (attract screens).
  render(cam, viewH, sim, centerY = viewH / 2, opts = {}) {
    const g = this.g;
    g.setCamera(cam, viewH, centerY);
    g.clearZ();
    const sky = C.SKY;
    {
      // Sky is one flat tone like the original. Only the view rows need clearing.
      const rows = Math.min(g.H, Math.round(viewH * g.S));
      g.fb.fill(sky, 0, rows * g.W);
    }
    this.groundPass(cam);
    this.terrainPass(cam);
    this.specks(cam);
    this.landmarkPass(cam, opts.noLandmarkLines);
    if (sim) this.entityPass(cam, sim, opts);
  }

  _groundTri(ax, az, bx, bz, cx, cz, color, y = 0) {
    const g = this.g;
    g.polyWorld3(ax, y, az, bx, y, bz, cx, y, cz, color, false);
  }

  groundPass(cam) {
    const g = this.g, w = this.world;
    // Sea: an enormous quad under everything.
    const R = 2400000;
    const X = cam.x, Z = cam.z;
    g.polyWorld4(X - R, 0, Z - R, X + R, 0, Z - R, X + R, 0, Z + R, X - R, 0, Z + R, C.SEA, false);
    // Continent beyond the terrain data
    const o = w.outer;
    for (let i = 0; i < o.length; i++) {
      const q = o[i];
      g.polyWorld4(q[0], 0, q[1], q[2], 0, q[3], q[4], 0, q[5], q[6], 0, q[7], C.LAND, false);
    }
    // Painted layers, each triangulated. All are flat, so a fast reject avoids most work.
    const cx0 = g.camX, cz0 = g.camZ;
    const fx = g.fx, fy = g.fy, fz = g.fz, near = g.near;
    const camY = g.camY;
    for (let li = 0; li < w.groundLayers.length; li++) {
      const { color, v, t } = w.groundLayers[li];
      for (let i = 0; i < t.length; i += 3) {
        const a = t[i] * 2, b = t[i + 1] * 2, c = t[i + 2] * 2;
        const ax = v[a], az = v[a + 1], bx = v[b], bz = v[b + 1], ccx = v[c], ccz = v[c + 1];
        // All three behind the camera plane?
        const dy = -camY * fy;
        const za = (ax - cx0) * fx + dy + (az - cz0) * fz;
        const zb = (bx - cx0) * fx + dy + (bz - cz0) * fz;
        const zc = (ccx - cx0) * fx + dy + (ccz - cz0) * fz;
        if (za < near && zb < near && zc < near) continue;
        g.polyWorld3(ax, 0, az, bx, 0, bz, ccx, 0, ccz, color, false);
      }
    }
    // Runways: bodies always, markings only when close enough to resolve.
    const near2 = 14000 * 14000;
    for (let i = 0; i < w.runwayBodies.length; i++) {
      const rb = w.runwayBodies[i];
      this._quads(rb.polys);
      const r = rb.r;
      if ((r.cx - cam.x) ** 2 + (r.cz - cam.z) ** 2 + cam.y ** 2 < near2) this._quads(w.runwayDetail[i].polys);
    }
  }

  _quads(p) {
    const g = this.g;
    for (let i = 0; i < p.length; i += 9) {
      g.polyWorld4(p[i + 1], 0, p[i + 2], p[i + 3], 0, p[i + 4], p[i + 5], 0, p[i + 6], p[i + 7], 0, p[i + 8], p[i], false);
    }
  }

  terrainPass(cam) {
    const g = this.g, w = this.world;
    const { tv, tt, tColor, tCamX, tCamY, tCamZ, tStamp } = w;
    w.frameStamp++;
    const stamp = w.frameStamp;
    const { rx, ry, rz, ux, uy, uz, fx, fy, fz, camX, camY, camZ, near } = g;
    const cx = g.cx, cy = g.cy, cz = g.cz;
    for (let ci = 0; ci < w.chunks.length; ci++) {
      const ch = w.chunks[ci];
      if (!g.sphereVisible(ch.cx, ch.cy, ch.cz, ch.r)) continue;
      const tris = ch.tris;
      for (let n = 0; n < tris.length; n++) {
        const tri = tris[n];
        const i = tri * 3;
        for (let k = 0; k < 3; k++) {
          const vi = tt[i + k];
          if (tStamp[vi] !== stamp) {
            tStamp[vi] = stamp;
            const q = vi * 3;
            const dx = tv[q] - camX, dy = tv[q + 1] - camY, dz = tv[q + 2] - camZ;
            tCamX[vi] = dx * rx + dy * ry + dz * rz;
            tCamY[vi] = dx * ux + dy * uy + dz * uz;
            tCamZ[vi] = dx * fx + dy * fy + dz * fz;
          }
          cx[k] = tCamX[vi]; cy[k] = tCamY[vi]; cz[k] = tCamZ[vi];
        }
        if (cz[0] < near && cz[1] < near && cz[2] < near) continue;
        g.polyCamera(3, tColor[tri], true);
      }
    }
  }

  // World-locked specks, the original's pixel "dust" that sells speed and height over flat colour.
  specks(cam) {
    const g = this.g;
    const alt = Math.max(1, cam.y);
    // Coarser grid with altitude, so the density on screen stays about the same.
    const level = Math.max(0, Math.ceil(Math.log2(alt / 160)));
    const cell = 200 * Math.pow(2, level);
    const reach = 14;
    const ci = Math.floor(cam.x / cell), cj = Math.floor(cam.z / cell);
    const hashMul = 2654435761;
    const { rx, ry, rz, ux, uy, uz, fx, fy, fz, camX, camY, camZ, centerX, centerY, focalX, focalY, W, near, clipY1, zb, fb } = g;
    const S = g.S;
    for (let j = cj - reach; j <= cj + reach; j++) {
      for (let i = ci - reach; i <= ci + reach; i++) {
        let h = Math.imul(i * 73856093 ^ j * 19349663, hashMul) >>> 0;
        if ((h & 7) > 2) continue; // Only 3 of 8 cells have a speck.
        const px = (i + ((h >>> 8) & 255) / 256) * cell;
        h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
        const pz = (j + ((h >>> 8) & 255) / 256) * cell;
        const dx = px - camX, dy = -camY, dz = pz - camZ;
        const zc = dx * fx + dy * fy + dz * fz;
        if (zc < near + 5) continue;
        const sx = (centerX + ((dx * rx + dy * ry + dz * rz) * focalX) / zc) | 0;
        const sy = (centerY - ((dx * ux + dy * uy + dz * uz) * focalY) / zc) | 0;
        if (sx < 0 || sx >= W || sy < 0 || sy >= clipY1) continue;
        const o = sy * W + sx;
        if (zb[o] > 0) continue; // Hidden by terrain or a structure
        const under = fb[o];
        const col = under === C.SEA ? C.G8 : under === C.LAND ? C.LAND_DD : under === C.G4 || under === C.G5 ? C.G2 : under === C.G2 ? C.G5 : C.LAND_D;
        fb[o] = col;
        if (S > 1) { fb[o + 1] = col; fb[o + W] = col; fb[o + W + 1] = col; }
      }
    }
    void ry; void rz; void uy; void uz; void fy; void rx; void ux;
  }

  landmarkPass(cam) {
    const g = this.g;
    const lm = this.world.landmarks;
    const MAX2 = 70000 * 70000, LOD2 = 7000 * 7000;
    for (let i = 0; i < lm.length; i++) {
      const L = lm[i];
      const d2 = (L.x - cam.x) ** 2 + (L.z - cam.z) ** 2 + cam.y * cam.y;
      if (d2 > MAX2) continue;
      drawMesh(g, L.mesh, L.x, L.y, L.z, undefined, { dotColor: C.G5, dotBelow: 0.3 });
      if (L.lod && d2 < LOD2) drawMesh(g, L.lod, L.x, L.y, L.z);
    }
  }

  // Entities carry a `model` key and an orientation basis.
  entityPass(cam, sim, opts) {
    const g = this.g;
    const ents = sim.entities;
    for (let i = 0; i < ents.length; i++) {
      const e = ents[i];
      if (!e.alive || !e.model || (opts.hide && opts.hide === e)) continue;
      if (e.hiddenInCockpit && opts.cockpit) continue;
      const mesh = this.models[e.model];
      if (!mesh) continue;
      if (e.castShadow && e.y < 900) this.shadow(mesh, e, sim);
      const hide = e.hideParts ? e.hideParts() : undefined;
      drawMesh(g, mesh, e.x, e.y, e.z, e, { hide, dotColor: e.dotColor !== undefined ? e.dotColor : C.G2 });
    }
    // Trails, tracers, decoys and fire
    sim.fx.draw(g, cam);
  }

  // Black shadow projected along the sun onto the surface below.
  shadow(mesh, e, sim) {
    const g = this.g;
    const surf = sim.surfaceUnder(e);
    const y0 = surf.y + 0.4;
    const h = e.y - y0;
    if (h < 0) return;
    if (!g.sphereVisible(e.x, y0, e.z, mesh.radius + h)) return;
    if ((mesh.radius * g.focalX) / Math.max(1, g.lastZ) < 1.2) return;
    const verts = mesh.verts, faces = mesh.faces;
    const sx = -SUN[0] / SUN[1], sz = -SUN[2] / SUN[1];
    const { rx, ry, rz, ux, uy, uz, fx, fy, fz } = e;
    const cx = g.cx, cy = g.cy, cz = g.cz;
    const dx0 = e.x - g.camX, dz0 = e.z - g.camZ, dy0 = y0 - g.camY;
    const { rx: Rx, ry: Ry, rz: Rz, ux: Ux, uy: Uy, uz: Uz, fx: Fx, fy: Fy, fz: Fz } = g;
    for (let f = 0; f < faces.length; f++) {
      const face = faces[f];
      if (face.tag) continue;
      const idx = face.idx;
      for (let i = 0; i < idx.length; i++) {
        const k = idx[i] * 3;
        const x = verts[k], y = verts[k + 1], z = verts[k + 2];
        const wy = x * ry + y * uy + z * fy + h;
        const wx = x * rx + y * ux + z * fx + wy * sx;
        const wz = x * rz + y * uz + z * fz + wy * sz;
        const dx = wx + dx0, dz = wz + dz0, dy = dy0;
        cx[i] = dx * Rx + dy * Ry + dz * Rz;
        cy[i] = dx * Ux + dy * Uy + dz * Uz;
        cz[i] = dx * Fx + dy * Fy + dz * Fz;
      }
      g.polyCamera(idx.length, C.BLACK, surf.onDeck === true, 0.0005);
    }
  }
}
