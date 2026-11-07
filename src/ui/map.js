// A coastline map of the Bay, rasterised straight into the framebuffer with an even-odd scanline
// fill. Used for the briefing screens and the cockpit's HSI map (M key).
import { C } from '../gfx/palette.js';

export class MapView {
  constructor(world) {
    this.rings = world.mapRings.map((flat) => {
      const a = Float64Array.from(flat);
      let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      for (let i = 0; i < a.length; i += 2) {
        if (a[i] < x0) x0 = a[i]; if (a[i] > x1) x1 = a[i];
        if (a[i + 1] < z0) z0 = a[i + 1]; if (a[i + 1] > z1) z1 = a[i + 1];
      }
      return { a, x0, x1, z0, z1 };
    });
    this.xs = new Float64Array(4096);
    this.extent = world.extents;
  }

  // Draws into virtual rectangle (x,y,w,h), centred on world (cx,cz), north up,
  // `metersPerPx` virtual pixels. land/sea are palette indices.
  draw(g, x, y, w, h, cx, cz, metersPerPx, land = C.LAND_D, sea = C.BLACK, edge = C.LAND) {
    const S = g.S;
    const X0 = Math.round(x * S), Y0 = Math.round(y * S), X1 = Math.round((x + w) * S), Y1 = Math.round((y + h) * S);
    const mpp = metersPerPx / S; // metres per device pixel
    const midX = (X0 + X1) / 2, midY = (Y0 + Y1) / 2;
    const worldXmin = cx - (midX - X0) * mpp, worldXmax = cx + (X1 - midX) * mpp;
    const worldZmin = cz - (Y1 - midY) * mpp, worldZmax = cz + (midY - Y0) * mpp;
    const { fb, W } = g;
    for (let r = Y0; r < Y1; r++) fb.fill(sea, r * W + X0, r * W + X1);
    // The continent beyond the data edge: everything east of the data's west edge on the far rows is land,
    // which the outer rings already cover, so only the rings need drawing.
    const rings = this.rings.filter((q) => q.x1 >= worldXmin && q.x0 <= worldXmax && q.z1 >= worldZmin && q.z0 <= worldZmax);
    const xs = this.xs;
    for (let row = Y0; row < Y1; row++) {
      const wz = cz + (midY - (row + 0.5)) * mpp;
      let n = 0;
      for (let k = 0; k < rings.length; k++) {
        const q = rings[k];
        if (wz < q.z0 || wz > q.z1) continue;
        const a = q.a, len = a.length;
        let px = a[len - 2], pz = a[len - 1];
        for (let i = 0; i < len; i += 2) {
          const qx = a[i], qz = a[i + 1];
          if ((pz > wz) !== (qz > wz)) {
            if (n < xs.length) xs[n++] = px + ((wz - pz) / (qz - pz)) * (qx - px);
          }
          px = qx; pz = qz;
        }
      }
      if (n < 2) continue;
      const list = Array.from(xs.subarray(0, n)).sort((p, q) => p - q);
      for (let i = 0; i + 1 < n; i += 2) {
        let xa = Math.ceil(midX + (list[i] - cx) / mpp), xb = Math.ceil(midX + (list[i + 1] - cx) / mpp);
        if (xa < X0) xa = X0;
        if (xb > X1) xb = X1;
        if (xa < xb) {
          fb.fill(land, row * W + xa, row * W + xb);
          if (edge !== land) { fb[row * W + xa] = edge; fb[row * W + xb - 1] = edge; }
        }
      }
    }
    // return a projector for markers
    return {
      project: (wx, wz) => [(midX + (wx - cx) / mpp) / S, (midY - (wz - cz) / mpp) / S],
    };
  }
}
