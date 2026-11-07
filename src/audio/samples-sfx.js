// Sound effects, synthesised and quantised to 8 bits. Each returns {id, data, rate, loopStart, loopEnd}.
import { rng, secs, biquad, filter, svfLowpass, softClip, normalize, to8, makeLoop, fadeEdges } from './dsp.js';

const out8 = (id, buf, rate, loopStart = -1, loopEnd = 0) => ({ id, data: to8(buf), rate, loopStart, loopEnd: loopEnd || buf.length });

function noise(len, seed) {
  const r = rng(seed);
  const b = new Float32Array(len);
  for (let i = 0; i < len; i++) b[i] = r() * 2 - 1;
  return b;
}
function loopNoise(id, rate, seconds, seed, shape, xf = 0.3) {
  const len = secs(rate, seconds);
  const b = noise(len, seed);
  shape(b, rate);
  normalize(b, 0.97);
  const start = secs(rate, xf + 0.05);
  makeLoop(b, start, secs(rate, xf));
  return out8(id, b, rate, start, len);
}

// --- Continuous engine layers ---
function engineRoar() {
  return loopNoise('e_roar', 11025, 2.4, 101, (b, r) => {
    const lo = Float32Array.from(b);
    filter(lo, biquad('bp', 150, 0.6, r));
    const mid = Float32Array.from(b);
    filter(mid, biquad('bp', 620, 0.8, r));
    const hi = Float32Array.from(b);
    filter(hi, biquad('hp', 2200, 0.7, r));
    for (let i = 0; i < b.length; i++) b[i] = lo[i] * 2.4 + mid[i] * 0.9 + hi[i] * 0.09;
  });
}
function engineWhine() {
  const rate = 16726, len = secs(rate, 1.6);
  const b = new Float32Array(len);
  const n = noise(len, 103);
  const nf = biquad('bp', 3400, 1.2, rate);
  // Fan/turbine blade-pass tones: inharmonic, slightly beating, under airy broadband hiss.
  const parts = [[860, 0.35], [1720, 1], [1736, 0.6], [3440, 0.5], [3472, 0.3], [5160, 0.17]];
  for (const [hz, a] of parts) {
    const w = (2 * Math.PI * hz) / rate;
    for (let i = 0; i < len; i++) b[i] += Math.sin(i * w + 0.03 * Math.sin((i / rate) * 7)) * a;
  }
  for (let i = 0; i < len; i++) b[i] = b[i] * 0.55 + nf(n[i]) * 1.8;
  normalize(b, 0.97);
  const start = secs(rate, 0.4);
  makeLoop(b, start, secs(rate, 0.35));
  return out8('e_whine', b, rate, start, len);
}
function afterburner() {
  const rate = 11025, len = secs(rate, 2.2);
  const r = rng(107);
  const b = noise(len, 105);
  const lp = biquad('lp', 520, 0.8, rate), sub = biquad('lp', 110, 0.9, rate);
  for (let i = 0; i < len; i++) {
    const x = b[i];
    // Random combustion crackle over the rumble.
    const crackle = r() < 0.006 ? (r() * 2 - 1) * 3.5 : 0;
    b[i] = softClip(lp(x + crackle) * 2.2 + sub(x) * 5, 1.5);
  }
  normalize(b, 0.97);
  const start = secs(rate, 0.35);
  makeLoop(b, start, secs(rate, 0.3));
  return out8('e_ab', b, rate, start, len);
}
function wind() {
  return loopNoise('e_wind', 11025, 2.6, 109, (b, r) => {
    const bp = biquad('bp', 950, 0.5, r), lo = biquad('lp', 260, 0.7, r);
    for (let i = 0; i < b.length; i++) {
      const m = 0.8 + 0.2 * Math.sin((i / r) * 1.7) * Math.sin((i / r) * 0.6);
      const x = b[i];
      b[i] = (bp(x) * 1.2 + lo(x) * 1.5) * m;
    }
  });
}
function buffet() {
  const rate = 8363, len = secs(rate, 1.2);
  const b = noise(len, 111);
  const r = rng(113);
  const lp = biquad('lp', 90, 1.5, rate);
  let thump = 0;
  for (let i = 0; i < len; i++) {
    if (r() < 0.003) thump = (r() * 2 - 1) * 12;
    thump *= 0.992;
    b[i] = lp(b[i] * 3 + thump);
  }
  normalize(b, 0.97);
  const start = secs(rate, 0.25);
  makeLoop(b, start, secs(rate, 0.2));
  return out8('e_buffet', b, rate, start, len);
}
function rollRumble() {
  const rate = 8363, len = secs(rate, 1.0);
  const b = noise(len, 115);
  const lp = biquad('bp', 130, 0.7, rate);
  for (let i = 0; i < len; i++) b[i] = lp(b[i]) * (0.8 + 0.2 * Math.sin((i / rate) * 2 * Math.PI * 17));
  normalize(b, 0.95);
  const start = secs(rate, 0.2);
  makeLoop(b, start, secs(rate, 0.15));
  return out8('e_roll', b, rate, start, len);
}

// --- Weapons ---
// M61 Vulcan at 6,000 rpm: exactly 100 cartridges per second, so the loop has real pitch.
function gunLoop() {
  const rate = 16726;
  const rounds = 24;
  const per = Math.floor(rate / 100);
  const len = rounds * per;
  const b = new Float32Array(len);
  const r = rng(201);
  for (let k = 0; k < rounds; k++) {
    const gain = 0.82 + r() * 0.18;
    const jitter = Math.floor(r() * 6);
    const lp = biquad('lp', 2000 + r() * 1400, 0.9, rate);
    const body = biquad('bp', 310, 1.2, rate);
    for (let i = 0; i < per * 1.7; i++) {
      const idx = (k * per + i + jitter) % len;
      const t = i / rate;
      const n = r() * 2 - 1;
      b[idx] += (lp(n) * Math.exp(-t * 340) * 1.7 + body(n) * 2.8 * Math.exp(-t * 190)) * gain;
    }
  }
  for (let i = 0; i < len; i++) b[i] = softClip(b[i], 1.5);
  normalize(b, 0.98);
  return out8('w_gun', b, rate, 0, len);
}
function gunStop() {
  const rate = 11025, len = secs(rate, 0.5);
  const b = noise(len, 203);
  const f = biquad('bp', 1100, 1, rate);
  let ph = 0;
  for (let i = 0; i < len; i++) {
    const t = i / rate;
    ph += ((95 * Math.exp(-t * 5)) / rate) * 2 * Math.PI;
    b[i] = f(b[i]) * 0.5 * Math.exp(-t * 8) * (Math.sin(ph) > 0 ? 1 : 0.4);
  }
  normalize(b, 0.8);
  return out8('w_gunstop', b, rate);
}
function missileLaunch(id, seed, tone) {
  const rate = 16726, len = secs(rate, 2.4);
  const b = noise(len, seed);
  let thunk = 0;
  const lp = biquad('lp', 3800, 0.7, rate);
  const hp = biquad('hp', 240, 0.7, rate);
  for (let i = 0; i < len; i++) {
    const t = i / rate;
    // Rail clunk
    thunk = t < 0.05 ? Math.sin(2 * Math.PI * 95 * t) * (1 - t / 0.05) * 1.4 : 0;
    // Ignition: fast swell, a searing "fwoosh", then falling away as it leaves.
    const swell = t < 0.09 ? 0 : Math.min(1, (t - 0.09) / 0.05);
    const decay = Math.exp(-Math.max(0, t - 0.25) * 1.85);
    const sweep = 0.5 + 0.5 * Math.sin(t * tone);
    b[i] = thunk + softClip(hp(lp(b[i])) * 2.5 * swell * decay * (0.7 + 0.3 * sweep), 1.7);
  }
  normalize(b, 0.98);
  fadeEdges(b, 0, 600);
  return out8(id, b, rate);
}
function chaffPop(id, hz, seed) {
  const rate = 11025, len = secs(rate, 0.55);
  const b = noise(len, seed);
  const bp = biquad('bp', hz, 0.8, rate), lp = biquad('lp', 900, 0.8, rate);
  for (let i = 0; i < len; i++) {
    const t = i / rate;
    b[i] = lp(b[i]) * 2.5 * Math.exp(-t * 28) + bp(b[i]) * 1.6 * Math.exp(-t * 7);
  }
  normalize(b, 0.95);
  return out8(id, b, rate);
}

// --- Explosions ---
function explosion(id, seed, seconds, lpHz, crackleRate, subHz) {
  const rate = 11025, len = secs(rate, seconds);
  const b = noise(len, seed);
  const r = rng(seed + 1);
  const lp = biquad('lp', lpHz, 0.7, rate), lpSlow = biquad('lp', lpHz * 0.3, 0.8, rate);
  let ph = 0;
  for (let i = 0; i < len; i++) {
    const t = i / rate;
    const x = b[i];
    const cr = r() < crackleRate * Math.exp(-t * 2) ? (r() * 2 - 1) * 5 : 0;
    ph += ((subHz * (1 + 2 * Math.exp(-t * 16))) / rate) * 2 * Math.PI;
    const sub = Math.sin(ph) * Math.exp(-t * (3.4 / seconds)) * 1.4;
    const body = lp(x + cr) * 2.4 * Math.exp(-t * (4.6 / seconds));
    const rumble = lpSlow(x) * 5 * Math.exp(-t * (2.8 / seconds));
    const crack = t < 0.03 ? x * 1.2 * (1 - t / 0.03) : 0;
    b[i] = softClip(body + rumble + sub + crack, 1.8);
  }
  normalize(b, 0.99);
  fadeEdges(b, 0, 800);
  return out8(id, b, rate);
}
function metalHit() {
  const rate = 16726, len = secs(rate, 0.8);
  const b = noise(len, 301);
  const parts = [[410, 1], [1033, 0.7], [1771, 0.6], [2537, 0.4], [3390, 0.3]];
  for (let i = 0; i < len; i++) {
    const t = i / rate;
    let m = 0;
    for (const [hz, a] of parts) m += Math.sin(2 * Math.PI * hz * t) * a * Math.exp(-t * (5 + hz / 500));
    b[i] = m * 0.9 + b[i] * Math.exp(-t * 38) * 1.1;
  }
  normalize(b, 0.98);
  return out8('x_hit', b, rate);
}
function splash() {
  const rate = 11025, len = secs(rate, 1.9);
  const b = noise(len, 303);
  const lp = biquad('lp', 2600, 0.7, rate), bp = biquad('bp', 500, 0.6, rate);
  for (let i = 0; i < len; i++) {
    const t = i / rate;
    b[i] = lp(b[i]) * Math.exp(-t * 3.3) * 1.2 + bp(b[i]) * 2 * Math.exp(-t * 1.6);
  }
  normalize(b, 0.98);
  fadeEdges(b, 0, 500);
  return out8('x_splash', b, rate);
}

// --- Aircraft handling ---
function hydraulic(id, seconds, seed, thunkAt) {
  const rate = 11025, len = secs(rate, seconds);
  const b = noise(len, seed);
  const bp = biquad('bp', 520, 2.5, rate);
  let ph = 0;
  for (let i = 0; i < len; i++) {
    const t = i / rate;
    const env = Math.min(1, t * 10) * Math.min(1, Math.max(0, (seconds - t)) * 5);
    ph += ((260 + 60 * Math.min(1, t * 1.3)) / rate) * 2 * Math.PI;
    let s = (bp(b[i]) * 1.3 + Math.sin(ph) * 0.14 + Math.sin(ph * 2.01) * 0.1) * env * 0.65;
    if (thunkAt !== undefined && t >= thunkAt) {
      const u = t - thunkAt;
      s += Math.sin(2 * Math.PI * 70 * u) * Math.exp(-u * 26) * 1.5;
    }
    b[i] = s;
  }
  normalize(b, 0.92);
  fadeEdges(b, 0, 300);
  return out8(id, b, rate);
}
function thunk(id, hz, decay, noiseAmt, seed) {
  const rate = 11025, len = secs(rate, Math.min(1.2, 6 / decay));
  const b = noise(len, seed);
  const lp = biquad('lp', 1400, 0.8, rate);
  for (let i = 0; i < len; i++) {
    const t = i / rate;
    b[i] = Math.sin(2 * Math.PI * hz * t * (1 + 0.5 * Math.exp(-t * 60))) * Math.exp(-t * decay) + lp(b[i]) * noiseAmt * Math.exp(-t * decay * 1.8);
  }
  normalize(b, 0.97);
  return out8(id, b, rate);
}
function catapult() {
  const rate = 11025, len = secs(rate, 3.2);
  const b = noise(len, 401);
  const r = (i) => i / rate;
  svfLowpass(b, rate, (i) => 500 + 3400 * Math.min(1, r(i) / 1.0), 0.7);
  for (let i = 0; i < len; i++) {
    const t = r(i);
    // Steam hiss rises, shuttle slam at the deck edge (t = 2.0 s), then the wind takes over.
    const hiss = Math.min(1, t * 2.4) * (t < 2.0 ? 1 : Math.exp(-(t - 2.0) * 3.4));
    let s = b[i] * 1.4 * hiss;
    if (t > 2.0) {
      const u = t - 2.0;
      s += Math.sin(2 * Math.PI * 58 * u) * Math.exp(-u * 11) * 1.7;
    }
    if (t < 0.12) s += Math.sin(2 * Math.PI * 80 * t) * (1 - t / 0.12) * 1.2;
    b[i] = softClip(s, 1.3);
  }
  normalize(b, 0.98);
  fadeEdges(b, 0, 400);
  return out8('a_cat', b, rate);
}
function wireTrap() {
  const rate = 11025, len = secs(rate, 2.2);
  const b = noise(len, 403);
  const lp = biquad('lp', 1900, 0.9, rate);
  let ph = 0;
  for (let i = 0; i < len; i++) {
    const t = i / rate;
    // Hook slam, then the wire's long hydraulic groan running down in pitch.
    const slam = Math.exp(-t * 18) * (Math.sin(2 * Math.PI * 66 * t) * 1.6 + lp(b[i]) * 1.6);
    ph += ((210 * Math.exp(-t * 0.9)) / rate) * 2 * Math.PI;
    const groan = (Math.sin(ph) + 0.6 * Math.sin(ph * 2.03) + 0.35 * Math.sin(ph * 3.07)) * 0.28 * Math.min(1, t * 12) * Math.exp(-t * 1.25);
    b[i] = softClip(slam + groan + lp(b[i]) * 0.3 * Math.exp(-t * 2), 1.2);
  }
  normalize(b, 0.98);
  fadeEdges(b, 0, 400);
  return out8('a_trap', b, rate);
}
function tireChirp() {
  const rate = 11025, len = secs(rate, 0.55);
  const b = noise(len, 405);
  const bp = biquad('bp', 1700, 3, rate);
  for (let i = 0; i < len; i++) {
    const t = i / rate;
    b[i] = bp(b[i]) * 2.4 * Math.exp(-t * 9) + Math.sin(2 * Math.PI * 58 * t) * Math.exp(-t * 15) * 1.2;
  }
  normalize(b, 0.95);
  return out8('a_chirp', b, rate);
}
function ejection() {
  const rate = 11025, len = secs(rate, 2.8);
  const b = noise(len, 407);
  const lp = biquad('lp', 2500, 0.7, rate), hp = biquad('hp', 500, 0.7, rate);
  for (let i = 0; i < len; i++) {
    const t = i / rate;
    const bang = t < 0.08 ? (1 - t / 0.08) * 1.4 : 0;
    const rocket = t > 0.1 ? hp(lp(b[i])) * 1.8 * Math.exp(-(t - 0.1) * 3.2) : 0;
    const blast = lp(b[i]) * 0.65 * Math.min(1, t * 3);
    b[i] = softClip(bang * Math.sin(2 * Math.PI * 80 * t) + rocket + blast * Math.exp(-t * 0.6), 1.3);
  }
  normalize(b, 0.97);
  fadeEdges(b, 0, 2500);
  return out8('a_eject', b, rate);
}

// --- Cockpit tones: pure square-wave beepers, the way an Amiga would do it ---
function tone(id, hz, rate = 11025) {
  // An exact number of cycles for a perfect loop.
  const cycles = Math.max(1, Math.round((hz * 0.2)));
  const per = rate / hz;
  const len = Math.round(cycles * per);
  const b = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    const ph = (i / len) * cycles;
    const f = ph - Math.floor(ph);
    b[i] = (f < 0.5 ? 0.85 : -0.85) * 0.8 + Math.sin(2 * Math.PI * ph) * 0.2;
  }
  return out8(id, b, rate, 0, len);
}
// Sidewinder seeker growl: a pulsing, rough low tone that sings when it finds heat.
function seekerGrowl() {
  const rate = 11025, len = secs(rate, 0.8);
  const b = new Float32Array(len);
  const r = rng(501);
  const hz = 380;
  const wobble = [];
  for (let k = 0; k < 16; k++) wobble.push(0.65 + r() * 0.35);
  for (let i = 0; i < len; i++) {
    const t = i / len;
    const ph = t * Math.round(hz * 0.8);
    const f = ph - Math.floor(ph);
    const am = wobble[Math.floor(t * 16) % 16] * (0.7 + 0.3 * Math.sin(t * Math.PI * 2 * 44));
    b[i] = (f < 0.4 ? 1 : -1) * am * 0.75 + (r() * 2 - 1) * 0.1;
  }
  return out8('t_growl', b, rate, 0, len);
}
function seekerLock() {
  const rate = 16726, len = secs(rate, 0.5);
  const b = new Float32Array(len);
  const hz = 1160;
  for (let i = 0; i < len; i++) {
    const t = i / len;
    const ph = t * Math.round(hz * 0.5);
    const f = ph - Math.floor(ph);
    b[i] = (f < 0.5 ? 1 : -1) * 0.65 + Math.sin(2 * Math.PI * ph) * 0.3;
  }
  return out8('t_lock', b, rate, 0, len);
}

// --- Radio, UI, floppy ---
function squelch(id, seconds, seed) {
  const rate = 11025, len = secs(rate, seconds);
  const b = noise(len, seed);
  const f = biquad('bp', 1800, 0.9, rate);
  for (let i = 0; i < len; i++) b[i] = f(b[i]) * 2 * Math.exp(-(i / rate) * (3 / seconds));
  normalize(b, 0.9);
  return out8(id, b, rate);
}
function uiClick() {
  const rate = 11025, len = secs(rate, 0.06);
  const b = new Float32Array(len);
  for (let i = 0; i < len; i++) { const t = i / rate; b[i] = Math.sin(2 * Math.PI * 1400 * t) * Math.exp(-t * 90); }
  return out8('u_click', b, rate);
}
function uiBlip() {
  const rate = 11025, len = secs(rate, 0.14);
  const b = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    const t = i / rate;
    b[i] = (Math.sin(2 * Math.PI * (t < 0.05 ? 880 : 1320) * t) > 0 ? 0.8 : -0.8) * Math.exp(-t * 18);
  }
  return out8('u_blip', b, rate);
}
function teletypeTick() {
  const rate = 11025, len = secs(rate, 0.035);
  const b = noise(len, 601);
  const f = biquad('bp', 2400, 1.5, rate);
  for (let i = 0; i < len; i++) { const t = i / rate; b[i] = f(b[i]) * 2.2 * Math.exp(-t * 170) + Math.sin(2 * Math.PI * 240 * t) * 0.4 * Math.exp(-t * 130); }
  normalize(b, 0.95);
  return out8('u_tty', b, rate);
}
// The unmistakable Amiga floppy: head-step clack, and the "click of death" when idle.
function floppyStep() {
  const rate = 11025, len = secs(rate, 0.05);
  const b = noise(len, 603);
  const f = biquad('bp', 900, 1.1, rate);
  for (let i = 0; i < len; i++) { const t = i / rate; b[i] = f(b[i]) * 2.4 * Math.exp(-t * 95) + Math.sin(2 * Math.PI * 180 * t) * Math.exp(-t * 110) * 0.8; }
  normalize(b, 0.98);
  return out8('u_step', b, rate);
}
function floppySpin() {
  return loopNoise('u_spin', 8363, 1.0, 605, (b, r) => {
    const f = biquad('bp', 310, 1.1, r);
    for (let i = 0; i < b.length; i++) b[i] = f(b[i]) * (0.8 + 0.2 * Math.sin((i / r) * 2 * Math.PI * 5));
  }, 0.2);
}
function floppyInsert() {
  const rate = 11025, len = secs(rate, 0.4);
  const b = noise(len, 607);
  const f = biquad('lp', 2200, 0.8, rate);
  for (let i = 0; i < len; i++) {
    const t = i / rate;
    const clack = t > 0.2 ? Math.exp(-(t - 0.2) * 55) * 1.5 : 0;
    b[i] = f(b[i]) * (Math.exp(-t * 28) * 0.8 + clack) + (t > 0.2 ? Math.sin(2 * Math.PI * 125 * t) * clack * 0.6 : 0);
  }
  normalize(b, 0.95);
  return out8('u_insert', b, rate);
}

// A jet passes the microphone: whine falls in pitch (Doppler) as the roar peaks and fades.
function jetFlyby() {
  const rate = 11025, len = secs(rate, 8);
  const b = noise(len, 701);
  const r = (i) => i / rate;
  const CENTER = 3.2;
  const roarLP = biquad('lp', 1100, 0.7, rate), subLP = biquad('lp', 130, 0.9, rate);
  const hiss = biquad('hp', 2600, 0.7, rate);
  let ph1 = 0, ph2 = 0;
  for (let i = 0; i < len; i++) {
    const t = r(i);
    const dt = t - CENTER;
    const near = 1 / (1 + dt * dt * 0.42);
    const after = dt > 0 ? 1 : 0.55; // the exhaust is louder going away than the intake coming in
    const doppler = 1 + 0.42 * Math.atan(-dt * 1.3) * 0.64;
    ph1 += ((1320 * doppler) / rate) * 2 * Math.PI;
    ph2 += ((2110 * doppler) / rate) * 2 * Math.PI;
    const whine = (Math.sin(ph1) * 0.17 + Math.sin(ph2) * 0.09) * near * (dt < 0 ? 1.1 : 0.45);
    const x = b[i];
    const roar = roarLP(x) * 1.7 * near * after;
    const sub = subLP(x) * 4.4 * near * near * after;
    const air = hiss(x) * 0.22 * near;
    b[i] = softClip(whine + roar + sub + air, 1.2);
  }
  normalize(b, 0.98);
  fadeEdges(b, secs(rate, 0.6), secs(rate, 1.2));
  return out8('j_flyby', b, rate);
}

export function generateSfxSamples() {
  return [
    engineRoar(), engineWhine(), afterburner(), wind(), buffet(), rollRumble(),
    gunLoop(), gunStop(), missileLaunch('w_aim9', 205, 9), missileLaunch('w_aim120', 207, 5),
    chaffPop('w_chaff', 3100, 209), chaffPop('w_flare', 1400, 211),
    explosion('x_near', 311, 2.8, 1900, 0.012, 42), explosion('x_far', 313, 2.2, 480, 0.002, 34), explosion('x_big', 315, 5.0, 1300, 0.018, 28),
    metalHit(), splash(),
    hydraulic('a_gear', 1.9, 411, 1.65), hydraulic('a_brake', 0.75, 413), thunk('a_hook', 62, 18, 0.9, 415), thunk('a_thump', 64, 14, 0.7, 417),
    thunk('a_pod', 110, 16, 0.8, 419), catapult(), wireTrap(), tireChirp(), ejection(),
    tone('t_stall', 620), tone('t_warn', 960), tone('t_pull', 480), tone('t_hi', 1320), tone('t_lo', 880), tone('t_rwr', 1960), seekerGrowl(), seekerLock(),
    squelch('r_open', 0.09, 621), squelch('r_close', 0.16, 623), uiClick(), uiBlip(), teletypeTick(), floppyStep(), floppySpin(), floppyInsert(),
    jetFlyby(),
  ];
}
