// The framebuffer and software rasteriser: an indexed 320x256 PAL screen (or an integer multiple),
// scanline polygon fill with a 1/z buffer, and 2D drawing in virtual 320x200 coordinates.
import { FONT_SMALL, FONT_MENU } from './fonts.js';

const MAX_CLIP = 32;

export class Gfx {
  constructor(scale = 1) {
    this.setScale(scale);
    this.palette = new Uint32Array(256);
    this.tint = null;
    // Clip scratch space
    this.cx = new Float64Array(MAX_CLIP); this.cy = new Float64Array(MAX_CLIP); this.cz = new Float64Array(MAX_CLIP);
    this.ox = new Float64Array(MAX_CLIP); this.oy = new Float64Array(MAX_CLIP); this.oz = new Float64Array(MAX_CLIP);
    this.sx = new Float64Array(MAX_CLIP); this.sy = new Float64Array(MAX_CLIP); this.iz = new Float64Array(MAX_CLIP);
    this.stats = { polys: 0, pixels: 0 };
  }

  setScale(scale) {
    this.S = scale;
    this.W = 320 * scale;
    this.H = 256 * scale;
    this.fb = new Uint8Array(this.W * this.H);
    this.zb = new Float32Array(this.W * this.H);
    this.spanL = new Float64Array(this.H);
    this.spanR = new Float64Array(this.H);
    this.viewH = this.H;
    this.setClip(0, 0, 320, 256);
  }

  setClip(x0, y0, x1, y1) {
    this.clipX0 = x0 * this.S; this.clipY0 = y0 * this.S;
    this.clipX1 = x1 * this.S; this.clipY1 = y1 * this.S;
  }

  // Sets up the 3D camera. `viewH` virtual rows of 3D view, optical centre in the middle of it.
  setCamera(cam, viewH = 184, centerY = viewH / 2) {
    const S = this.S;
    this.camX = cam.x; this.camY = cam.y; this.camZ = cam.z;
    this.rx = cam.rx; this.ry = cam.ry; this.rz = cam.rz;
    this.ux = cam.ux; this.uy = cam.uy; this.uz = cam.uz;
    this.fx = cam.fx; this.fy = cam.fy; this.fz = cam.fz;
    this.viewH = viewH * S;
    this.centerX = this.W / 2;
    this.centerY = centerY * S;
    // 320x256 stretched over a 4:3 tube gives pixels slightly wider than tall,
    // so a radian spans (4/3)*(256/320) = 1.0667 times as many rows as columns.
    const f = (this.W * 0.86) * (cam.zoom || 1);
    this.focalX = f;
    this.focalY = f * 1.0667;
    this.near = cam.near || 1.0;
    // Frustum half-tangents for sphere culling
    this.tanX = this.W / 2 / this.focalX;
    this.tanY = Math.max(this.centerY, this.viewH - this.centerY) / this.focalY;
    this.nlx = 1 / Math.sqrt(1 + this.tanX * this.tanX);
    this.nly = 1 / Math.sqrt(1 + this.tanY * this.tanY);
    this.setClip(0, 0, 320, viewH);
  }

  clear(color) { this.fb.fill(color); }
  clearZ() { this.zb.fill(0); }

  // True if a sphere may be visible; also leaves camera-space Z in this.lastZ.
  sphereVisible(x, y, z, r) {
    const dx = x - this.camX, dy = y - this.camY, dz = z - this.camZ;
    const zc = dx * this.fx + dy * this.fy + dz * this.fz;
    this.lastZ = zc;
    if (zc < -r) return false;
    const xc = dx * this.rx + dy * this.ry + dz * this.rz;
    if ((Math.abs(xc) - zc * this.tanX) * this.nlx > r) return false;
    const yc = dx * this.ux + dy * this.uy + dz * this.uz;
    if ((Math.abs(yc) - zc * this.tanY) * this.nly > r) return false;
    return true;
  }

  // Projects a world point; returns false if behind the near plane. Result in this.px, py, pw (1/z).
  project(x, y, z) {
    const dx = x - this.camX, dy = y - this.camY, dz = z - this.camZ;
    const zc = dx * this.fx + dy * this.fy + dz * this.fz;
    if (zc < this.near) return false;
    const iz = 1 / zc;
    this.px = this.centerX + (dx * this.rx + dy * this.ry + dz * this.rz) * this.focalX * iz;
    this.py = this.centerY - (dx * this.ux + dy * this.uy + dz * this.uz) * this.focalY * iz;
    this.pw = iz;
    return true;
  }

  // Polygon in camera space (arrays in this.cx/cy/cz, n verts). Clips to the near plane.
  polyCamera(n, color, zTest = true, bias = 0) {
    const near = this.near;
    let cx = this.cx, cy = this.cy, cz = this.cz;
    let anyBehind = false, allBehind = true;
    for (let i = 0; i < n; i++) { if (cz[i] < near) anyBehind = true; else allBehind = false; }
    if (allBehind) return;
    if (anyBehind) {
      const ox = this.ox, oy = this.oy, oz = this.oz;
      let m = 0;
      for (let i = 0; i < n; i++) {
        const j = i + 1 === n ? 0 : i + 1;
        const zi = cz[i], zj = cz[j];
        const inI = zi >= near, inJ = zj >= near;
        if (inI) { ox[m] = cx[i]; oy[m] = cy[i]; oz[m] = zi; m++; }
        if (inI !== inJ) {
          const t = (near - zi) / (zj - zi);
          ox[m] = cx[i] + (cx[j] - cx[i]) * t;
          oy[m] = cy[i] + (cy[j] - cy[i]) * t;
          oz[m] = near;
          m++;
        }
      }
      n = m;
      cx = ox; cy = oy; cz = oz;
      if (n < 3) return;
    }
    const sx = this.sx, sy = this.sy, iz = this.iz;
    const fx = this.focalX, fy = this.focalY, ccx = this.centerX, ccy = this.centerY;
    for (let i = 0; i < n; i++) {
      const w = 1 / cz[i];
      sx[i] = ccx + cx[i] * fx * w;
      sy[i] = ccy - cy[i] * fy * w;
      iz[i] = w;
    }
    if (zTest) this._fillZ(n, color, bias);
    else this._fill(n, color);
  }

  // World-space triangle/quad helpers
  polyWorld3(ax, ay, az, bx, by, bz, cx, cy, cz, color, zTest = true, bias = 0) {
    this._toCam(0, ax, ay, az);
    this._toCam(1, bx, by, bz);
    this._toCam(2, cx, cy, cz);
    this.polyCamera(3, color, zTest, bias);
  }
  polyWorld4(ax, ay, az, bx, by, bz, cx, cy, cz, dx, dy, dz, color, zTest = true, bias = 0) {
    this._toCam(0, ax, ay, az);
    this._toCam(1, bx, by, bz);
    this._toCam(2, cx, cy, cz);
    this._toCam(3, dx, dy, dz);
    this.polyCamera(4, color, zTest, bias);
  }
  _toCam(i, x, y, z) {
    const dx = x - this.camX, dy = y - this.camY, dz = z - this.camZ;
    this.cx[i] = dx * this.rx + dy * this.ry + dz * this.rz;
    this.cy[i] = dx * this.ux + dy * this.uy + dz * this.uz;
    this.cz[i] = dx * this.fx + dy * this.fy + dz * this.fz;
  }

  // Convex polygon fill with no depth test: the ground is painted back-to-front in layers.
  _fill(n, color) {
    const sx = this.sx, sy = this.sy;
    if (!this._edges(n)) return;
    const { spanL, spanR, fb, W, clipX0, clipX1 } = this;
    for (let y = this.yMin; y < this.yMax; y++) {
      let xa = Math.ceil(spanL[y]), xb = Math.ceil(spanR[y]);
      if (xa < clipX0) xa = clipX0;
      if (xb > clipX1) xb = clipX1;
      if (xa < xb) { const o = y * W; fb.fill(color, o + xa, o + xb); }
    }
    this.stats.polys++;
    void sx; void sy;
  }

  _fillZ(n, color, bias) {
    const sx = this.sx, sy = this.sy, iz = this.iz;
    // Depth gradient from the polygon's largest-area vertex triple.
    const x0 = sx[0], y0 = sy[0], z0 = iz[0];
    let dzdx = 0, dzdy = 0, ok = false;
    for (let i = 1; i + 1 < n; i++) {
      const ax = sx[i] - x0, ay = sy[i] - y0, bx = sx[i + 1] - x0, by = sy[i + 1] - y0;
      const d = ax * by - bx * ay;
      if (Math.abs(d) > 1e-3) {
        const za = iz[i] - z0, zb = iz[i + 1] - z0;
        dzdx = (za * by - zb * ay) / d;
        dzdy = (zb * ax - za * bx) / d;
        ok = true;
        break;
      }
    }
    if (!ok) return;
    if (!this._edges(n)) return;
    const { spanL, spanR, fb, zb, W, clipX0, clipX1 } = this;
    const offs = 1 + bias;
    for (let y = this.yMin; y < this.yMax; y++) {
      let xa = Math.ceil(spanL[y]), xb = Math.ceil(spanR[y]);
      if (xa < clipX0) xa = clipX0;
      if (xb > clipX1) xb = clipX1;
      if (xa >= xb) continue;
      const o = y * W;
      let z = (z0 + (xa - x0) * dzdx + (y - y0) * dzdy) * offs;
      const stepZ = dzdx * offs;
      for (let i = o + xa, e = o + xb; i < e; i++) {
        if (z > zb[i]) { zb[i] = z; fb[i] = color; }
        z += stepZ;
      }
    }
    this.stats.polys++;
  }

  // Walks the polygon's edges to build per-scanline spans. Returns false if off-screen.
  _edges(n) {
    const sx = this.sx, sy = this.sy, spanL = this.spanL, spanR = this.spanR;
    let minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < n; i++) { const y = sy[i]; if (y < minY) minY = y; if (y > maxY) maxY = y; }
    let yMin = Math.ceil(minY), yMax = Math.ceil(maxY);
    if (yMin < this.clipY0) yMin = this.clipY0;
    if (yMax > this.clipY1) yMax = this.clipY1;
    if (yMin >= yMax) return false;
    for (let y = yMin; y < yMax; y++) { spanL[y] = Infinity; spanR[y] = -Infinity; }
    for (let i = 0; i < n; i++) {
      const j = i + 1 === n ? 0 : i + 1;
      let x0 = sx[i], y0 = sy[i], x1 = sx[j], y1 = sy[j];
      if (y0 > y1) { let t = x0; x0 = x1; x1 = t; t = y0; y0 = y1; y1 = t; }
      if (y1 === y0) continue;
      let ya = Math.ceil(y0), yb = Math.ceil(y1);
      if (ya < yMin) ya = yMin;
      if (yb > yMax) yb = yMax;
      const slope = (x1 - x0) / (y1 - y0);
      let x = x0 + (ya - y0) * slope;
      for (let y = ya; y < yb; y++) {
        if (x < spanL[y]) spanL[y] = x;
        if (x > spanR[y]) spanR[y] = x;
        x += slope;
      }
    }
    this.yMin = yMin; this.yMax = yMax;
    return true;
  }

  // 3D line with depth test, clipped to near plane. World coords.
  line3D(ax, ay, az, bx, by, bz, color, thick = 0) {
    this._toCam(0, ax, ay, az);
    this._toCam(1, bx, by, bz);
    let z0 = this.cz[0], z1 = this.cz[1];
    let x0 = this.cx[0], y0 = this.cy[0], x1 = this.cx[1], y1 = this.cy[1];
    const near = this.near;
    if (z0 < near && z1 < near) return;
    if (z0 < near) { const t = (near - z0) / (z1 - z0); x0 += (x1 - x0) * t; y0 += (y1 - y0) * t; z0 = near; }
    else if (z1 < near) { const t = (near - z1) / (z0 - z1); x1 += (x0 - x1) * t; y1 += (y0 - y1) * t; z1 = near; }
    const w0 = 1 / z0, w1 = 1 / z1;
    const sx0 = this.centerX + x0 * this.focalX * w0, sy0 = this.centerY - y0 * this.focalY * w0;
    const sx1 = this.centerX + x1 * this.focalX * w1, sy1 = this.centerY - y1 * this.focalY * w1;
    this._lineZ(sx0, sy0, w0, sx1, sy1, w1, color, thick);
  }
  _lineZ(x0, y0, w0, x1, y1, w1, color, thick) {
    // Reject and clip to the view rectangle, with Liang-Barsky.
    const xa = this.clipX0, xb = this.clipX1 - 1, ya = this.clipY0, yb = this.clipY1 - 1;
    const dx = x1 - x0, dy = y1 - y0;
    let t0 = 0, t1 = 1;
    const clip = (p, q) => {
      if (p === 0) return q >= 0;
      const r = q / p;
      if (p < 0) { if (r > t1) return false; if (r > t0) t0 = r; }
      else { if (r < t0) return false; if (r < t1) t1 = r; }
      return true;
    };
    if (!clip(-dx, x0 - xa) || !clip(dx, xb - x0) || !clip(-dy, y0 - ya) || !clip(dy, yb - y0)) return;
    const X0 = x0 + t0 * dx, Y0 = y0 + t0 * dy, X1 = x0 + t1 * dx, Y1 = y0 + t1 * dy;
    const W0 = w0 + t0 * (w1 - w0), W1 = w0 + t1 * (w1 - w0);
    const steps = Math.max(Math.abs(X1 - X0), Math.abs(Y1 - Y0));
    const n = Math.ceil(steps) + 1;
    const ix = (X1 - X0) / n, iy = (Y1 - Y0) / n, iw = (W1 - W0) / n;
    const { fb, zb, W } = this;
    let x = X0, y = Y0, w = W0;
    for (let i = 0; i <= n; i++) {
      const px = x | 0, py = y | 0;
      const o = py * W + px;
      const bw = w * 1.001;
      if (bw > zb[o]) { zb[o] = bw; fb[o] = color; }
      if (thick && px + 1 < W) { const o2 = o + 1; if (bw > zb[o2]) { zb[o2] = bw; fb[o2] = color; } }
      x += ix; y += iy; w += iw;
    }
  }

  // Single pixel at world position with depth test; `size` in screen pixels.
  point3D(x, y, z, color, size = 1) {
    if (!this.project(x, y, z)) return;
    const s = size * this.S;
    const px = (this.px - s / 2) | 0, py = (this.py - s / 2) | 0;
    const { fb, zb, W, clipX0, clipX1, clipY0, clipY1 } = this;
    const bw = this.pw * 1.001;
    for (let v = 0; v < s; v++) {
      const yy = py + v;
      if (yy < clipY0 || yy >= clipY1) continue;
      for (let u = 0; u < s; u++) {
        const xx = px + u;
        if (xx < clipX0 || xx >= clipX1) continue;
        const o = yy * W + xx;
        if (bw > zb[o]) { zb[o] = bw; fb[o] = color; }
      }
    }
  }

  // --- 2D, in virtual 320x256 coordinates ---
  rect(x, y, w, h, c) {
    const S = this.S;
    let x0 = Math.round(x * S), y0 = Math.round(y * S), x1 = Math.round((x + w) * S), y1 = Math.round((y + h) * S);
    if (x0 < this.clipX0) x0 = this.clipX0;
    if (y0 < this.clipY0) y0 = this.clipY0;
    if (x1 > this.clipX1) x1 = this.clipX1;
    if (y1 > this.clipY1) y1 = this.clipY1;
    for (let yy = y0; yy < y1; yy++) { const o = yy * this.W; this.fb.fill(c, o + x0, o + x1); }
  }
  hline(x, y, w, c) { this.rect(x, y, w, 1 / this.S, c); }
  vline(x, y, h, c) { this.rect(x, y, 1 / this.S, h, c); }

  // A thin line in hardware pixels; at higher scales HUD symbols stay crisp instead of blocky.
  line(x0, y0, x1, y1, c, weight = 1) {
    const S = this.S;
    x0 *= S; y0 *= S; x1 *= S; y1 *= S;
    const dx = x1 - x0, dy = y1 - y0;
    const n = Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)));
    const { fb, W, clipX0, clipX1, clipY0, clipY1 } = this;
    if (n === 0) { this.plotRaw(x0 | 0, y0 | 0, c); return; }
    const ix = dx / n, iy = dy / n;
    let x = x0, y = y0;
    for (let i = 0; i <= n; i++) {
      const px = Math.floor(x), py = Math.floor(y);
      for (let k = 0; k < weight; k++) {
        const xx = Math.abs(dy) > Math.abs(dx) ? px + k : px;
        const yy = Math.abs(dy) > Math.abs(dx) ? py : py + k;
        if (xx >= clipX0 && xx < clipX1 && yy >= clipY0 && yy < clipY1) fb[yy * W + xx] = c;
      }
      x += ix; y += iy;
    }
  }
  plotRaw(x, y, c) {
    if (x >= this.clipX0 && x < this.clipX1 && y >= this.clipY0 && y < this.clipY1) this.fb[y * this.W + x] = c;
  }
  plot(x, y, c) { this.rect(x, y, 1, 1, c); }

  ellipse(cx, cy, rx, ry, c, weight = 1) {
    const n = Math.max(12, Math.ceil((rx + ry) * 2 * this.S));
    let px = cx + rx, py = cy;
    for (let i = 1; i <= n; i++) {
      const a = (i / n) * Math.PI * 2;
      const x = cx + Math.cos(a) * rx, y = cy + Math.sin(a) * ry;
      this.line(px, py, x, y, c, weight);
      px = x; py = y;
    }
  }
  fillEllipse(cx, cy, rx, ry, c) {
    const S = this.S;
    const yc = cy * S, xc = cx * S, Rx = rx * S, Ry = ry * S;
    for (let y = Math.ceil(yc - Ry); y <= yc + Ry; y++) {
      const t = (y - yc) / Ry;
      const hw = Rx * Math.sqrt(Math.max(0, 1 - t * t));
      this._hspan(Math.ceil(xc - hw), Math.ceil(xc + hw), y, c);
    }
  }
  _hspan(xa, xb, y, c) {
    if (y < this.clipY0 || y >= this.clipY1) return;
    if (xa < this.clipX0) xa = this.clipX0;
    if (xb > this.clipX1) xb = this.clipX1;
    if (xa < xb) this.fb.fill(c, y * this.W + xa, y * this.W + xb);
  }
  // Filled convex polygon in virtual coords.
  poly2D(pts, c) {
    const S = this.S, n = pts.length / 2;
    for (let i = 0; i < n; i++) { this.sx[i] = pts[i * 2] * S; this.sy[i] = pts[i * 2 + 1] * S; }
    this._fill(n, c);
  }

  text(str, x, y, c, font = FONT_SMALL, shadow = -1) {
    str = String(str).toUpperCase();
    const S = this.S;
    let cx = x;
    for (let i = 0; i < str.length; i++) {
      const g = font.glyphs[str[i]];
      if (g) {
        for (let r = 0; r < font.h; r++) {
          const bits = g[r];
          if (!bits) continue;
          for (let b = 0; b < font.w; b++) {
            if (bits & (1 << b)) {
              if (shadow >= 0) this._blockAt(Math.round((cx + b + 1) * S), Math.round((y + r + 1) * S), S, shadow);
              this._blockAt(Math.round((cx + b) * S), Math.round((y + r) * S), S, c);
            }
          }
        }
      }
      cx += font.pitch;
    }
  }
  _blockAt(px, py, size, c) {
    const x1 = Math.min(this.clipX1, px + size), y1 = Math.min(this.clipY1, py + size);
    const x0 = Math.max(this.clipX0, px), y0 = Math.max(this.clipY0, py);
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) this.fb[y * this.W + x] = c;
  }
  textWidth(str, font = FONT_SMALL) { return String(str).length * font.pitch; }
  textC(str, cx, y, c, font = FONT_SMALL, shadow = -1) { this.text(str, cx - this.textWidth(str, font) / 2, y, c, font, shadow); }
  textR(str, rx, y, c, font = FONT_SMALL, shadow = -1) { this.text(str, rx - this.textWidth(str, font), y, c, font, shadow); }
  menuText(str, x, y, c, shadow = -1) { this.text(str, x, y, c, FONT_MENU, shadow); }

  // Blits an indexed bitmap with a transparent key, scaled by S. Used for the panel.
  blit(src, srcW, srcH, x, y, key = -1) {
    const S = this.S, { fb, W, H } = this;
    const X = Math.round(x * S), Y = Math.round(y * S);
    for (let sy = 0; sy < srcH; sy++) {
      const row = sy * srcW;
      for (let v = 0; v < S; v++) {
        const yy = Y + sy * S + v;
        if (yy < 0 || yy >= H) continue;
        for (let sx = 0; sx < srcW; sx++) {
          const c = src[row + sx];
          if (c === key) continue;
          const xStart = X + sx * S;
          for (let u = 0; u < S; u++) {
            const xx = xStart + u;
            if (xx >= 0 && xx < W) fb[yy * W + xx] = c;
          }
        }
      }
    }
  }

  // Palette maths: fade < 1 darkens, `flash` adds a red tint when the jet takes a hit.
  setPalette(rgbList, fade = 1, flash = 0, white = 0) {
    const p = this.palette;
    for (let i = 0; i < rgbList.length; i++) {
      const c = rgbList[i];
      let r = c[0] * fade, g = c[1] * fade, b = c[2] * fade;
      if (flash > 0) { r += (255 - r) * flash; g *= 1 - flash; b *= 1 - flash; }
      if (white > 0) { r += (255 - r) * white; g += (255 - g) * white; b += (255 - b) * white; }
      r = r | 0; g = g | 0; b = b | 0;
      p[i] = 0xff000000 | (b << 16) | (g << 8) | r;
    }
  }

  writeRGBA(out) {
    const { fb, palette } = this;
    for (let i = 0, n = fb.length; i < n; i++) out[i] = palette[fb[i]];
  }
}
