// Cockpit instrument panel and head-up display, laid out on the 320x256 PAL screen.
// Positions were measured from reference screenshots of the original, then drawn from scratch.
import { C } from '../gfx/palette.js';
import { FONT_SMALL } from '../gfx/fonts.js';
import { toLatLon } from '../world/geo.js';
import { MI } from '../sim/sim.js';
import { MPS_PER_KT, FT_PER_M } from '../sim/jet.js';

export const VIEW_H_COCKPIT = 190; // 3D rows drawn; the glare shield covers the lowest ones
export const COCKPIT_CENTER_Y = 92;
export const VIEW_H_EXTERNAL = 214;
const TRANSPARENT = 255;

const R = {
  eject: [8, 199, 26, 13], brake: [8, 216, 26, 11], gear: [8, 232, 26, 16],
  mfd: [40, 191, 59, 62],
  fuelLabel: [103, 190], fuelBar: [106, 203, 14, 29], fuelNum: [101, 233, 25, 9],
  radar: [129, 186, 58, 56],
  msg: [103, 244, 113, 10],
  compass: [192, 191, 35, 11],
  adi: [208.5, 224.3, 16.5],
  right: [231, 193, 55, 57],
  lights: [291, 198, 17, 9], ecm: [291, 211, 20, 10], latlon: [289, 229, 30, 12],
};

const fmtAlt = (n) => {
  n = Math.max(0, Math.round(n));
  return n >= 1000 ? `${Math.floor(n / 1000)} ${String(n % 1000).padStart(3, '0')}` : String(n);
};
const wrap360 = (a) => ((a % 360) + 360) % 360;
const wrap180 = (a) => ((a + 540) % 360) - 180;
const WEAPON_CODE = { aim9: 'SW', aim120: 'AM', gun: 'GN' };

export class Cockpit {
  constructor(gfx) {
    this.g = gfx;
    this.cache = null;
    this.cacheScale = 0;
    this.cacheY = 166;
    this.msgPhase = 0;
  }

  // Call once per frame BEFORE the 3D view is drawn: rebuilds the static panel when the scale changes.
  ensureStatic() {
    const g = this.g;
    if (this.cache && this.cacheScale === g.S) return;
    const S = g.S, W = g.W;
    const y0 = this.cacheY * S, y1 = g.H;
    g.setClip(0, 0, 320, 256);
    g.fb.fill(TRANSPARENT, y0 * W, y1 * W);
    this.drawStatic();
    this.cache = g.fb.slice(y0 * W, y1 * W);
    this.cacheScale = S;
  }

  blitStatic() {
    const g = this.g, S = g.S, W = g.W;
    const cache = this.cache, fb = g.fb;
    const base = this.cacheY * S * W;
    for (let i = 0; i < cache.length; i++) { const c = cache[i]; if (c !== TRANSPARENT) fb[base + i] = c; }
  }

  bevel(x, y, w, h, fill, hi = C.G7, lo = C.G1) {
    const g = this.g;
    g.rect(x, y, w, h, lo);
    g.rect(x, y, w - 1, h - 1, hi);
    g.rect(x + 1, y + 1, w - 2, h - 2, fill);
  }
  inset(x, y, w, h, fill = C.BLACK) {
    const g = this.g;
    g.rect(x - 1, y - 1, w + 2, h + 2, C.G1);
    g.rect(x - 1, y - 1, w + 1, 1, C.G1);
    g.rect(x, y + h, w + 1, 1, C.G6);
    g.rect(x + w, y, 1, h + 1, C.G6);
    g.rect(x, y, w, h, fill);
  }
  rivets(x, y, w, h, step = 6) {
    const g = this.g;
    for (let i = 3; i < w - 2; i += step) { g.rect(x + i, y + 1, 2, 2, C.G6); g.rect(x + i, y + h - 3, 2, 2, C.G6); }
    for (let j = 3; j < h - 2; j += step) { g.rect(x + 1, y + j, 2, 2, C.G6); g.rect(x + w - 3, y + j, 2, 2, C.G6); }
  }

  drawStatic() {
    const g = this.g;
    // Glare shield: a grey dome that rises toward the middle of the screen.
    for (let x = 0; x < 320; x++) {
      const t = (x - 160) / 160;
      const top = Math.round(172 + 15 * t * t);
      g.rect(x, top, 1, 1, C.G5);
      g.rect(x, top + 1, 1, 2, C.G8);
      g.rect(x, top + 3, 1, 2, C.G7);
      g.rect(x, top + 5, 1, 2, C.G6);
      g.rect(x, top + 7, 1, 1, C.G2);
      g.rect(x, top + 8, 1, 256 - top - 8, C.G3);
    }
    // Gunsight nub on the shield
    g.rect(158, 170, 4, 4, C.G9);
    g.rect(159, 169, 2, 1, C.G10);
    // Left status buttons
    for (const [key, label] of [['eject', 'EJECT'], ['brake', 'BRAKE'], ['gear', 'GEAR']]) {
      const [x, y, w, h] = R[key];
      this.bevel(x - 2, y - 1, w + 4, h + 2, C.G2, C.G7, C.BLACK);
      void label;
    }
    // Weapons display frame
    this.bevel(R.mfd[0] - 2, R.mfd[1] - 2, R.mfd[2] + 4, R.mfd[3] + 4, C.G3, C.G6, C.BLACK);
    this.inset(R.mfd[0] + 4, R.mfd[1] + 3, R.mfd[2] - 8, R.mfd[3] - 6, C.G1);
    this.rivets(R.mfd[0] - 2, R.mfd[1] - 2, R.mfd[2] + 4, R.mfd[3] + 4);
    // Fuel
    g.text('FUEL', R.fuelLabel[0] + 1, R.fuelLabel[1], C.G9, FONT_SMALL);
    this.inset(R.fuelBar[0], R.fuelBar[1], R.fuelBar[2], R.fuelBar[3], C.G1);
    this.inset(R.fuelNum[0], R.fuelNum[1], R.fuelNum[2], R.fuelNum[3], C.G1);
    // Radar scope
    this.bevel(R.radar[0] - 3, R.radar[1] - 1, R.radar[2] + 6, R.radar[3] + 4, C.G3, C.G6, C.BLACK);
    g.rect(R.radar[0], R.radar[1], R.radar[2], R.radar[3], C.BLACK);
    // Message line
    this.inset(R.msg[0], R.msg[1], R.msg[2], R.msg[3], C.G1);
    // Compass
    this.inset(R.compass[0], R.compass[1], R.compass[2], R.compass[3], C.G1);
    // ADI bezel
    const [ax, ay, ar] = R.adi;
    g.fillEllipse(ax, ay, ar + 3, (ar + 3) * 0.94, C.G1);
    g.fillEllipse(ax, ay - 0.4, ar + 2.2, (ar + 2.2) * 0.94, C.G6);
    g.fillEllipse(ax, ay, ar + 1, (ar + 1) * 0.94, C.G2);
    // Right display
    this.bevel(R.right[0] - 3, R.right[1] - 2, R.right[2] + 6, R.right[3] + 4, C.G3, C.G6, C.BLACK);
    this.inset(R.right[0] + 4, R.right[1] + 3, R.right[2] - 8, R.right[3] - 6, C.G1);
    this.rivets(R.right[0] - 3, R.right[1] - 2, R.right[2] + 6, R.right[3] + 4);
    // Lights, ECM, position
    this.inset(R.lights[0], R.lights[1], R.lights[2], R.lights[3], C.G1);
    this.bevel(R.ecm[0] - 1, R.ecm[1] - 1, R.ecm[2] + 2, R.ecm[3] + 2, C.G2, C.G7, C.BLACK);
    this.inset(R.latlon[0], R.latlon[1], R.latlon[2], R.latlon[3], C.BLUE_D);
  }

  // ------------------------------------------------------------------
  panel(sim, st, mapView = null) {
    const g = this.g, j = sim.player;
    this.mapView = mapView;
    g.setClip(0, 0, 320, 256);
    this.blitStatic();
    if (!j) return;
    const t = sim.time;
    const blink = Math.floor(t * 3) & 1;

    // --- Status buttons ---
    const lampText = (key, text, on, color, off = C.G5) => {
      const [x, y, w, h] = R[key];
      g.rect(x, y, w, h, on ? C.G1 : C.G2);
      g.textC(text, x + w / 2, y + (h - 6) / 2 + (key === 'gear' ? -3 : 0), on ? color : off, FONT_SMALL);
    };
    lampText('eject', 'EJECT', true, C.GREEN, C.GREEN);
    lampText('brake', 'BRAKE', j.brake, C.YELLOW);
    {
      const [x, y, w, h] = R.gear;
      const moving = j.gear > 0.02 && j.gear < 0.98;
      const col = moving || sim.alerts.gearWarn ? (blink ? C.RED_L : C.G3) : j.gear > 0.5 ? C.GREEN : C.G5;
      g.rect(x, y, w, h, C.G1);
      g.textC('GEAR', x + w / 2, y + 2, col, FONT_SMALL);
      // wheel glyph
      const wx = x + w / 2;
      g.rect(wx - 6, y + 10, 13, 1, col);
      if (j.gear > 0.5) { g.rect(wx - 6, y + 11, 2, 2, col); g.rect(wx + 5, y + 11, 2, 2, col); g.rect(wx, y + 11, 1, 2, col); }
    }

    // --- Weapons display ---
    {
      const [x, y, w] = R.mfd;
      const cx = x + w / 2;
      const gcol = C.GREEN;
      // Top view of the jet
      g.rect(cx - 1, y + 8, 2, 20, gcol);
      g.line(cx - 15, y + 24, cx, y + 14, gcol);
      g.line(cx + 15, y + 24, cx, y + 14, gcol);
      g.rect(cx - 6, y + 26, 12, 1, gcol);
      g.line(cx - 15, y + 24, cx - 15, y + 20, gcol);
      g.line(cx + 15, y + 24, cx + 15, y + 20, gcol);
      // Stations: left and right Sidewinders at the tips, AMRAAMs inboard
      const st9 = j.stores.aim9, st12 = j.stores.aim120;
      const mark = (px, py, have, selected) => {
        const col = !have ? C.G3 : selected && (sim.selected === 'aim9' || sim.selected === 'aim120') ? C.RED_L : C.RED;
        g.rect(px, py, 2, 5, col);
      };
      mark(cx - 17, y + 18, st9 > 0, sim.selected === 'aim9');
      mark(cx + 16, y + 18, st9 > 1, sim.selected === 'aim9');
      for (let k = 0; k < 4; k++) mark(cx + (k < 2 ? -11 + k * 5 : 6 + (k - 2) * 5), y + 21, st12 > k, sim.selected === 'aim120');
      const armed = !j.onGround;
      g.textC(armed ? 'ARM' : 'SAFE', cx, y + 34, armed ? gcol : C.YELLOW, FONT_SMALL);
      const code = WEAPON_CODE[sim.selected];
      g.textC(code, cx, y + 43, sim.selected === 'gun' ? C.YELLOW : gcol, FONT_SMALL);
      const n = sim.selected === 'gun' ? j.stores.gun : j.stores[sim.selected];
      g.textC(String(n), cx, y + 51, n > 0 ? gcol : C.RED_L, FONT_SMALL);
    }

    // --- Fuel ---
    {
      const [x, y, w, h] = R.fuelBar;
      const frac = Math.max(0, Math.min(1, j.fuel / j.spec.fuel));
      const hh = Math.round(h * frac);
      const low = frac < 0.12;
      g.rect(x, y, w, h, C.G1);
      g.rect(x + 2, y + h - hh, w - 4, hh, low ? (blink ? C.RED_L : C.RED_D) : C.GREEN);
      for (let k = 1; k < 4; k++) g.rect(x, y + Math.round((h * k) / 4), 3, 1, C.G7);
      g.textC(String(Math.round(j.fuel)), R.fuelNum[0] + R.fuelNum[2] / 2, R.fuelNum[1] + 2, C.G10, FONT_SMALL);
    }

    // --- Radar ---
    this.drawRadar(sim, st, blink);

    // --- Message line ---
    {
      const [x, y, w] = R.msg;
      let text = '', col = C.RED_L;
      if (sim.message) { text = sim.message.text; col = sim.message.color === 'green' ? C.GREEN : sim.message.color === 'yellow' ? C.YELLOW : C.RED_L; }
      else if (sim.target) {
        const tg = sim.target;
        const phase = Math.floor(t / 2) & 1;
        const nm = tg.identified || tg.side === 'red' ? tg.name || 'CONTACT' : 'UNKNOWN';
        const hdg = Math.round(wrap360((Math.atan2(tg.vx || 0, tg.vz || 0) * 180) / Math.PI));
        const spd = Math.round((tg.speed || 0) / MPS_PER_KT);
        text = phase ? `${nm} SPD: ${spd}` : `${nm} HDG: ${String(hdg).padStart(3, '0')}`;
      }
      if (text) {
        const tw = text.length * 5, boxW = w - 4;
        if (tw <= boxW) g.textC(text, x + w / 2, y + 2, col, FONT_SMALL);
        else {
          // a ticker, restarting from the first word when a new message arrives
          const age = sim.message ? t - sim.message.start : t;
          const gap = 36, period = tw + gap;
          const off = (Math.max(0, age - 0.8) * 30) % period;
          g.setClip(x + 1, y, x + w - 1, y + R.msg[3]);
          g.text(text, x + 3 - off, y + 2, col, FONT_SMALL);
          if (off > 0) g.text(text, x + 3 - off + period, y + 2, col, FONT_SMALL);
          g.setClip(0, 0, 320, 256);
        }
      }
    }

    // --- Compass strip ---
    {
      const [x, y, w, h] = R.compass;
      const hd = j.headingDeg();
      const cx = x + w / 2;
      g.rect(x, y, w, h, C.G1);
      const letters = [[0, 'N'], [90, 'E'], [180, 'S'], [270, 'W']];
      g.setClip(x, y, x + w, y + h);
      for (let k = -1; k <= 1; k++) {
        for (const [deg, ch] of letters) {
          const d = wrap180(deg - hd) + k * 360;
          if (k !== 0) continue;
          const px = cx + d * 0.167;
          if (px > x - 6 && px < x + w + 6) g.text(ch, px - 2, y + 2, C.G10, FONT_SMALL);
        }
        for (let deg = 45; deg < 360; deg += 90) {
          const px = cx + wrap180(deg - hd) * 0.167;
          if (px > x && px < x + w) g.rect(px - 0.5, y + 4, 1.5, 1.5, C.G7);
        }
      }
      g.setClip(0, 0, 320, 256);
      g.rect(cx - 0.5, y + h - 4, 1.2, 4, C.RED_L);
      g.rect(cx - 0.5, y, 1.2, 2, C.RED_L);
    }

    // --- Attitude ball ---
    this.drawBall(j);

    // --- Right display ---
    {
      const [x, y, w] = R.right;
      const alt = j.altitudeFt(), kts = j.knots();
      const tx = x + 6;
      const col = C.GREEN;
      g.text(`${fmtAlt(alt)} FT`, tx, y + 8, col, FONT_SMALL);
      g.text(`${Math.round(kts)} KTS`, tx, y + 18, col, FONT_SMALL);
      const thr = j.afterburner && j.rpm > 0.9 ? 100 : Math.round(j.throttle * 100);
      g.text(`${thr}%`, tx, y + 28, col, FONT_SMALL);
      g.text('THRST', tx + (String(thr).length + 1) * 5, y + 28, col, FONT_SMALL);
      g.text(`${j.mach.toFixed(1)} X MAG`, tx, y + 38, col, FONT_SMALL);
      // Throttle bar
      g.rect(tx, y + 47, 42, 2, C.G3);
      g.rect(tx, y + 47, Math.round(42 * j.throttle), 2, thr >= 100 ? C.ORANGE : C.YELLOW);
      g.rect(tx + 42 * 0.9, y + 45, 1, 6, C.G8);
    }

    // --- Lights, ECM, position ---
    {
      const [x, y] = R.lights;
      const a = sim.alerts;
      const lamp = (cx, cy, on, col) => g.rect(x + cx, y + cy, 4, 3, on ? col : C.G3);
      lamp(2, 1, a.friend, C.GREEN);
      lamp(7, 1, a.enemy, C.RED_L);
      lamp(12, 1, a.stall && blink, C.RED_L);
      lamp(2, 5, sim.incoming.radar && blink, C.WHITE);
      lamp(7, 5, sim.incoming.ir && blink, C.WHITE);
      lamp(12, 5, a.pullUp && blink, C.YELLOW);
      const [ex, ey, ew, eh] = R.ecm;
      g.rect(ex, ey, ew, eh, sim.ecm ? C.YELLOW : C.G2);
      g.textC('ECM', ex + ew / 2, ey + 2, sim.ecm ? C.BLACK : C.G9, FONT_SMALL);
      const [lat, lon] = toLatLon(j.x, j.z);
      const [lx, ly] = R.latlon;
      g.text(`${Math.abs(lat).toFixed(1)}${lat >= 0 ? 'N' : 'S'}`, lx + 1, ly + 1, C.BLUE_L, FONT_SMALL);
      g.text(`${Math.abs(lon).toFixed(1)}${lon >= 0 ? 'E' : 'W'}`, lx, ly + 6, C.BLUE_L, FONT_SMALL);
    }
  }

  drawRadar(sim, st, blink) {
    const g = this.g, j = sim.player;
    const [x, y, w, h] = R.radar;
    const cx = x + w / 2, cy = y + h / 2 - 3, rad = 24;
    const range = sim.radarRange;
    g.rect(x, y, w, h, C.BLACK);
    let mapProj = null;
    if (st.mapOn && this.mapView) {
      // M key: the HSI shows a north-up map of the Bay at the radar range's scale
      mapProj = this.mapView.draw(g, x, y, w, h, j.x, j.z, (range * 1.05) / (w / 2), C.LAND_DD, C.BLUE_D, C.LAND_D);
    }
    g.setClip(x, y, x + w, y + h);
    if (mapProj) {
      const hd2 = Math.atan2(j.fx, j.fz);
      // own aircraft arrow
      const L = 5;
      g.line(cx, cy, cx + Math.sin(hd2) * L * 1.4, cy - Math.cos(hd2) * L * 1.4, C.WHITE);
      g.line(cx + Math.sin(hd2) * L * 1.4, cy - Math.cos(hd2) * L * 1.4, cx + Math.sin(hd2 + 2.6) * L, cy - Math.cos(hd2 + 2.6) * L, C.WHITE);
      g.line(cx + Math.sin(hd2) * L * 1.4, cy - Math.cos(hd2) * L * 1.4, cx + Math.sin(hd2 - 2.6) * L, cy - Math.cos(hd2 - 2.6) * L, C.WHITE);
      for (const e of sim.radarContacts()) {
        if (e.isMissile) continue;
        const [px, py] = mapProj.project(e.x, e.z);
        if (px < x || px > x + w || py < y || py > y + h) continue;
        const col = e.identified || e.side === 'blue' ? (e.side === 'red' ? C.RED_L : e.side === 'blue' ? C.GREEN : C.YELLOW) : C.WHITE;
        g.rect(px - 1, py - 1, 3, 3, col);
      }
      for (const c of sim.carriers) {
        if (!c.alive) continue;
        const [px, py] = mapProj.project(c.x, c.z);
        if (px >= x && px <= x + w && py >= y && py <= y + h) g.rect(px - 1.5, py - 1.5, 4, 4, c.enemy ? C.RED_L : C.G10);
      }
      g.setClip(0, 0, 320, 256);
      g.textC(`MAP ${Math.round(range / MI)} MI`, x + w / 2, y + h - 8, C.G10, FONT_SMALL, C.BLACK);
      return;
    }
    // Forward cone
    g.line(cx, cy, cx - rad * 0.9, cy - rad * 0.9, C.G4);
    g.line(cx, cy, cx + rad * 0.9, cy - rad * 0.9, C.G4);
    g.ellipse(cx, cy, rad * 0.5, rad * 0.5 * 0.94, C.G2);
    const hd = Math.atan2(j.fx, j.fz);
    const contacts = sim.radarContacts();
    for (let i = 0; i < contacts.length; i++) {
      const e = contacts[i];
      const dx = e.x - j.x, dz = e.z - j.z;
      const d = Math.hypot(dx, dz);
      const ang = Math.atan2(dx, dz) - hd;
      let k = Math.min(1, d / range);
      const out = d > range;
      if (out && !e.isMissile && !(e === sim.target)) k = 1;
      const px = cx + Math.sin(ang) * k * rad, py = cy - Math.cos(ang) * k * rad * 0.94;
      if (e.isMissile) {
        if (e.target === j) g.rect(px - 0.5, py - 0.5, 1.5, 1.5, blink ? C.RED_L : C.RED_D);
        else if (!out) g.rect(px, py, 1, 1, C.G7);
        continue;
      }
      let col = e.identified || e.side === 'blue' ? (e.side === 'red' ? C.RED_L : e.side === 'blue' ? C.GREEN : C.YELLOW) : C.WHITE;
      if (out) col = C.G5;
      const sz = e === sim.target ? 3 : 2;
      if (e === sim.target && !blink) col = C.G9;
      g.rect(px - sz / 2, py - sz / 2, sz, sz, col);
    }
    // Own aircraft
    g.rect(cx - 1, cy - 1, 3, 3, C.GREEN);
    g.rect(cx, cy - 3, 1, 2, C.GREEN);
    g.setClip(0, 0, 320, 256);
    g.textC(`${Math.round(range / MI)} MI`, x + w / 2, y + h - 8, C.GREEN, FONT_SMALL);
  }

  drawBall(j) {
    const g = this.g, S = g.S;
    const [ax, ay, ar] = R.adi;
    const pitch = j.pitchDeg(), bank = (j.bankDeg() * Math.PI) / 180;
    const sinB = Math.sin(bank), cosB = Math.cos(bank);
    const hOff = Math.max(-1.15, Math.min(1.15, pitch / 45));
    const cx = ax * S, cy = ay * S, rx = ar * S, ry = ar * S * 0.94;
    const { fb, W } = g;
    const y0 = Math.floor(cy - ry), y1 = Math.ceil(cy + ry);
    for (let y = y0; y <= y1; y++) {
      const v = (y + 0.5 - cy) / ry;
      if (Math.abs(v) > 1) continue;
      const hw = rx * Math.sqrt(1 - v * v);
      const xa = Math.ceil(cx - hw), xb = Math.floor(cx + hw);
      for (let x = xa; x <= xb; x++) {
        const u = (x + 0.5 - cx) / rx;
        // Distance from the horizon line, in instrument radii; sky above it
        const s = v * cosB + u * sinB - hOff;
        const tick = Math.abs(s) < 0.06;
        fb[y * W + x] = tick ? C.G10 : s < 0 ? C.BLUE_T : C.RED;
      }
    }
    // Fixed reference aircraft
    g.rect(ax - 7, ay, 5, 1, C.G10);
    g.rect(ax + 3, ay, 5, 1, C.G10);
    g.rect(ax - 1, ay - 1, 3, 3, C.G10);
    // Bank pointer
    g.rect(ax - 0.5, ay - ar - 2, 1.5, 2, C.G9);
  }

  // ------------------------------------------------------------------
  // HUD: drawn over the 3D view; clip is set to the view by setCamera().
  hud(sim, st) {
    const g = this.g, j = sim.player;
    if (!j) return;
    const t = sim.time;
    const blink = Math.floor(t * 4) & 1;
    const n = sim.selected === 'gun' ? j.stores.gun : j.stores[sim.selected];
    const code = WEAPON_CODE[sim.selected];
    const hudCol = C.G10, dim = C.G8;

    if (!st.hudOn) {
      // Only the selected weapon remains when the HUD is blanked.
      g.text(`${code} ${n}`, 97, 163, hudCol, FONT_SMALL);
      return;
    }
    const cx = 159.5, cy = 92;
    // Glass outline
    g.line(84, 54, 96, 47, C.G5);
    g.line(96, 47, 223, 47, C.G5);
    g.line(223, 47, 235, 54, C.G5);
    g.vline(84, 54, 130, C.G3);
    g.vline(235, 54, 130, C.G3);

    // Heading tape
    {
      const hd = j.headingDeg();
      const base = Math.round(hd / 5) * 5;
      for (let k = -9; k <= 9; k++) {
        const deg = base + k * 5;
        const x = cx + (deg - hd) * 2.2;
        if (x < 104 || x > 216) continue;
        const major = ((deg % 10) + 10) % 10 === 0;
        g.vline(x, major ? 73 : 75, major ? 5 : 3, dim);
        if (major) {
          let num = Math.round(wrap360(deg) / 10);
          if (num === 0) num = 36;
          g.text(String(num).padStart(2, '0'), x - 4.5, 66, hudCol, FONT_SMALL);
        }
      }
      g.rect(cx - 1, 80, 2, 2, C.G10);
      g.rect(cx - 2, 79, 4, 1, C.G10);
    }
    // Airspeed (left) and altitude (right)
    g.text(`${Math.round(j.knots())}`, 97, 107, hudCol, FONT_SMALL);
    g.text('KT', 97, 114, dim, FONT_SMALL);
    g.textR(fmtAlt(j.altitudeFt()), 229, 107, hudCol, FONT_SMALL);
    g.textR('FT', 229, 114, dim, FONT_SMALL);
    // Ground-proximity radar altitude below 1,500 ft
    const agl = (j.y - sim.world.heightAt(j.x, j.z)) * FT_PER_M;
    if (agl < 1500 && !j.onGround) g.textR(`R ${Math.round(agl)}`, 229, 122, agl < 300 && blink ? C.RED_L : dim, FONT_SMALL);
    // G meter
    g.text(`${j.gLoad.toFixed(1)} G`, 97, 153, j.gLoad > j.spec.gMax - 0.5 && blink ? C.RED_L : hudCol, FONT_SMALL);
    g.text(`${code} ${n}`, 97, 163, hudCol, FONT_SMALL);
    // Range to selected target, tens of feet
    if (sim.target) {
      const d = Math.hypot(sim.target.x - j.x, sim.target.y - j.y, sim.target.z - j.z) * FT_PER_M / 10;
      g.text(String(Math.min(9999, Math.round(d))).padStart(4, '0'), 191, 159, sim.inRange ? C.GREEN : hudCol, FONT_SMALL);
    }
    // Boresight
    g.rect(cx - 3, cy, 7, 1, hudCol);
    g.rect(cx, cy - 3, 1, 7, hudCol);
    // Weapon reticle
    const missile = sim.selected !== 'gun';
    const tg = sim.target;
    if (missile) {
      const col = sim.locked ? (blink ? C.RED_L : C.WHITE) : sim.inRange ? C.GREEN : dim;
      g.ellipse(cx, cy, 11, 11 * 0.94, col);
    }
    if (tg && g.project(tg.x, tg.y, tg.z)) {
      const px = g.px / g.S, py = g.py / g.S;
      const inView = px > 86 && px < 233 && py > 49 && py < 183;
      const col = sim.locked ? C.RED_L : tg.side === 'blue' ? C.GREEN : hudCol;
      if (inView) {
        g.line(px - 4, py - 4, px + 4, py - 4, col);
        g.line(px - 4, py + 4, px + 4, py + 4, col);
        g.line(px - 4, py - 4, px - 4, py + 4, col);
        g.line(px + 4, py - 4, px + 4, py + 4, col);
      } else {
        // Off-screen: an arrow on the HUD edge toward the target
        const dx = px - cx, dy = py - cy;
        const l = Math.hypot(dx, dy) || 1;
        const ex = cx + (dx / l) * 52, ey = cy + (dy / l) * 44;
        g.rect(ex - 1.5, ey - 1.5, 3, 3, col);
      }
    }
    // Gun pipper with lead computation
    if (sim.selected === 'gun' && tg) {
      const rx = tg.x - j.x, ry = tg.y - j.y, rz = tg.z - j.z;
      const range = Math.hypot(rx, ry, rz);
      const tgo = range / 1040;
      const ax = rx + ((tg.vx || 0) - j.vx) * tgo, ay = ry + ((tg.vy || 0) - j.vy) * tgo, az = rz + ((tg.vz || 0) - j.vz) * tgo;
      const al = Math.hypot(ax, ay, az) || 1;
      if (g.project(j.x + (ax / al) * 800, j.y + (ay / al) * 800, j.z + (az / al) * 800)) {
        const px = g.px / g.S, py = g.py / g.S;
        const col = range < 1100 ? C.RED_L : hudCol;
        g.ellipse(px, py, 4, 4, col);
        g.rect(px - 0.5, py - 0.5, 1.5, 1.5, col);
      }
    }
    // Carrier approach aid: the "meatball" (glideslope, 1 unit = 1 degree) and a line-up needle
    {
      const ship = sim.carriers.find((c) => !c.enemy && c.alive);
      const lens = ship && !j.onGround && j.gear > 0.5 ? ship.lens(j) : null;
      if (lens && lens.range < 6000 && Math.abs(lens.lineup) < 25) {
        const bx = 244, by = 104;
        for (let k = -2; k <= 2; k++) { g.rect(bx - 6, by + k * 11, 2, 2, C.GREEN); g.rect(bx + 5, by + k * 11, 2, 2, C.GREEN); }
        const off = Math.max(-2.4, Math.min(2.4, lens.ball)) * 11;
        const high = lens.ball > 0.25, low = lens.ball < -0.25;
        const col = Math.abs(lens.ball) > 2.2 ? (blink ? C.RED_L : C.RED_D) : high || low ? C.ORANGE : C.YELLOW;
        g.rect(bx - 2, by - off - 2, 5, 5, col);
        g.text('BALL', bx - 9, by - 36, C.G8, FONT_SMALL);
        // line-up: a needle under the heading tape, centred = on the centreline
        const lu = Math.max(-12, Math.min(12, lens.lineup * 5));
        g.rect(cx - 20, 142, 41, 1, C.G5);
        g.rect(cx - 0.5, 140, 1.4, 5, C.G7);
        g.rect(cx + lu - 1, 140, 2.4, 5, Math.abs(lens.lineup) < 0.6 ? C.GREEN : C.ORANGE);
        g.textC(`${Math.round(lens.range)} M`, cx, 148, C.G8, FONT_SMALL);
        if (!j.hook && lens.range < 3500 && blink) g.textC('HOOK', cx, 156, C.RED_L, FONT_SMALL);
      }
    }
    // Flight-path warnings
    if (sim.alerts.gearWarn && blink) g.textC('GEAR', cx, 120, C.YELLOW, FONT_SMALL);
    if (sim.alerts.pullUp && blink) g.textC('PULL UP', cx, 128, C.RED_L, FONT_SMALL);
    if (sim.alerts.stall && !blink) g.textC('STALL', cx, 136, C.RED_L, FONT_SMALL);
  }

  // The plain data bar shown under the external views.
  externalBar(sim) {
    const g = this.g, j = sim.player;
    g.setClip(0, 0, 320, 256);
    g.rect(0, VIEW_H_EXTERNAL, 320, 256 - VIEW_H_EXTERNAL, C.G1);
    if (!j) return;
    const col = C.G7;
    g.text(`HDG ${String(Math.round(j.headingDeg())).padStart(3, '0')}`, 83, 237, col, FONT_SMALL);
    g.text(`${Math.round(j.knots())} KTS`, 150, 237, col, FONT_SMALL);
    g.text(`${Math.round(j.altitudeFt())} FT`, 222, 237, col, FONT_SMALL);
    if (sim.message) {
      // wrap onto at most two lines of 60 characters
      const col = sim.message.color === 'green' ? C.GREEN : sim.message.color === 'yellow' ? C.YELLOW : C.RED_L;
      const lines = [''];
      for (const word of String(sim.message.text).split(' ')) {
        const cur = lines[lines.length - 1];
        if ((cur + ' ' + word).trim().length <= 60) lines[lines.length - 1] = (cur + ' ' + word).trim();
        else if (lines.length < 2) lines.push(word);
        else break;
      }
      lines.forEach((ln, i) => g.textC(ln, 160, 217 + i * 8, col, FONT_SMALL));
    }
  }
}
