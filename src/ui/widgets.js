// Small drawing helpers shared by the menu and title screens.
import { FONT_MENU, FONT_SMALL } from '../gfx/fonts.js';
import { C } from '../gfx/palette.js';

export const MENU_FONT = FONT_MENU;

// Big stencil lettering: every font pixel becomes a scale x scale block, sheared for an italic slant
// and filled from a vertical colour ramp. `ramp` runs top to bottom of the glyph.
export function bigText(g, str, x, y, scale, ramp, { shear = 0.28, shadow = C.BLACK, shadowOff = 2, pitch = null } = {}) {
  const font = FONT_MENU;
  str = String(str).toUpperCase();
  const S = g.S;
  let cx = x;
  const rows = font.h;
  const step = pitch || font.pitch * scale;
  const block = (px, py, col) => {
    const X = Math.round(px * S), Y = Math.round(py * S), W = Math.max(1, Math.round(scale * S));
    g._blockAt(X, Y, W, col);
  };
  for (let i = 0; i < str.length; i++) {
    const gl = font.glyphs[str[i]];
    if (gl) {
      for (let r = 0; r < rows; r++) {
        const bits = gl[r];
        if (!bits) continue;
        const slant = (rows - 1 - r) * scale * shear;
        const col = ramp[Math.min(ramp.length - 1, Math.floor((r / rows) * ramp.length))];
        for (let b = 0; b < font.w; b++) {
          if (!(bits & (1 << b))) continue;
          const px = cx + b * scale + slant, py = y + r * scale;
          if (shadow !== null) block(px + shadowOff, py + shadowOff, shadow);
        }
      }
      for (let r = 0; r < rows; r++) {
        const bits = gl[r];
        if (!bits) continue;
        const slant = (rows - 1 - r) * scale * shear;
        const col = ramp[Math.min(ramp.length - 1, Math.floor((r / rows) * ramp.length))];
        for (let b = 0; b < font.w; b++) if (bits & (1 << b)) block(cx + b * scale + slant, y + r * scale, col);
      }
    }
    cx += step;
  }
  return cx - x;
}

export const bigWidth = (str, scale) => String(str).length * FONT_MENU.pitch * scale;

export const LOGO_RAMP = [C.PALE, C.YELLOW, C.YELLOW, C.ORANGE, C.ORANGE, C.RED_L, C.RED, C.RED_D];

// Reveals text a few characters per second; returns the visible prefix.
export function typed(str, t, cps = 38) { return str.slice(0, Math.max(0, Math.floor(t * cps))); }

export function blink(t, rate = 2) { return (Math.floor(t * rate) & 1) === 0; }

export { FONT_SMALL };
