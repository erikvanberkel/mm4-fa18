// Small DSP toolkit for synthesising 8-bit samples. Everything is deterministic.

export function rng(seed = 1) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

export const midiHz = (n) => 440 * Math.pow(2, (n - 69) / 12);
export const secs = (rate, t) => Math.floor(rate * t);

export function biquad(type, freq, q, rate, gainDb = 0) {
  const w = (2 * Math.PI * Math.min(freq, rate * 0.49)) / rate;
  const cw = Math.cos(w), sw = Math.sin(w), alpha = sw / (2 * q);
  let b0, b1, b2, a0, a1, a2;
  if (type === 'lp') { b0 = (1 - cw) / 2; b1 = 1 - cw; b2 = b0; a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha; }
  else if (type === 'hp') { b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = b0; a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha; }
  else if (type === 'bp') { b0 = alpha; b1 = 0; b2 = -alpha; a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha; }
  else { // peak
    const A = Math.pow(10, gainDb / 40);
    b0 = 1 + alpha * A; b1 = -2 * cw; b2 = 1 - alpha * A; a0 = 1 + alpha / A; a1 = -2 * cw; a2 = 1 - alpha / A;
  }
  b0 /= a0; b1 /= a0; b2 /= a0; a1 /= a0; a2 /= a0;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  return (x) => {
    const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = x; y2 = y1; y1 = y;
    return y;
  };
}

export function filter(buf, f) {
  for (let i = 0; i < buf.length; i++) buf[i] = f(buf[i]);
  return buf;
}

// Sweepable state-variable low-pass; `cutoff(i)` is evaluated per sample.
export function svfLowpass(buf, rate, cutoff, q = 0.8) {
  let lp = 0, bp = 0;
  for (let i = 0; i < buf.length; i++) {
    const f = 2 * Math.sin((Math.PI * Math.min(cutoff(i), rate * 0.22)) / rate);
    lp += f * bp;
    const hp = buf[i] - lp - q * bp;
    bp += f * hp;
    buf[i] = lp;
  }
  return buf;
}

export const softClip = (x, drive = 1) => Math.tanh(x * drive);
// Asymmetric clip adds even harmonics, like a driven tube stage.
export const tubeClip = (x, drive = 1) => {
  const y = x * drive;
  return y >= 0 ? Math.tanh(y) : Math.tanh(y * 0.8) * 1.05;
};

export function normalize(buf, peak = 0.98) {
  let m = 0;
  for (let i = 0; i < buf.length; i++) { const a = Math.abs(buf[i]); if (a > m) m = a; }
  if (m > 0) { const g = peak / m; for (let i = 0; i < buf.length; i++) buf[i] *= g; }
  return buf;
}

export function to8(buf) {
  const out = new Int8Array(buf.length);
  for (let i = 0; i < buf.length; i++) {
    let v = Math.round(buf[i] * 127);
    out[i] = v > 127 ? 127 : v < -128 ? -128 : v;
  }
  return out;
}

export function fadeEdges(buf, inS = 0, outS = 0) {
  for (let i = 0; i < inS; i++) buf[i] *= i / inS;
  for (let i = 0; i < outS; i++) buf[buf.length - 1 - i] *= i / outS;
  return buf;
}

// Equal-power crossfade so a segment loops seamlessly. Returns a buffer with the loop point
// [loopStart, length). The last `xf` samples blend into the samples just before loopStart.
export function makeLoop(buf, loopStart, xf) {
  const end = buf.length;
  for (let i = 0; i < xf; i++) {
    const t = i / xf;
    const a = Math.cos((t * Math.PI) / 2), b = Math.sin((t * Math.PI) / 2);
    const idx = end - xf + i;
    buf[idx] = buf[idx] * a + buf[loopStart - xf + i] * b;
  }
  return buf;
}

export function saw(phase) { const p = phase - Math.floor(phase); return 2 * p - 1; }
export function square(phase, duty = 0.5) { const p = phase - Math.floor(phase); return p < duty ? 1 : -1; }
export function tri(phase) { const p = phase - Math.floor(phase); return p < 0.5 ? 4 * p - 1 : 3 - 4 * p; }

// Band-limited saw by additive partials; keeps high notes from aliasing at low sample rates.
export function addSaw(buf, rate, hz, amp, phase0 = 0, startI = 0) {
  const maxH = Math.floor(rate * 0.45 / hz);
  const w = (2 * Math.PI * hz) / rate;
  for (let h = 1; h <= maxH; h++) {
    const a = amp * (2 / Math.PI) / h;
    const wh = w * h;
    let ph = phase0 * h;
    // Recursive oscillator is far faster than calling sin per sample.
    let c = 2 * Math.cos(wh), s1 = Math.sin(ph - wh), s2 = Math.sin(ph - 2 * wh);
    for (let i = startI; i < buf.length; i++) {
      const s0 = c * s1 - s2;
      s2 = s1; s1 = s0;
      buf[i] += a * s0;
    }
  }
  return buf;
}
