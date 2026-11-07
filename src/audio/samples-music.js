// Instrument samples for the title theme. Synthesised once at start-up, then quantised to
// 8 bits like everything else in Paula's memory.
import { rng, midiHz, secs, biquad, filter, svfLowpass, tubeClip, softClip, normalize, to8, makeLoop, addSaw, tri, square, fadeEdges } from './dsp.js';

export const MUSIC_RATE = 16726; // ProTracker's C-3 rate: the classic Amiga sampling rate
const D3 = 50;

function sampleFrom(id, buf, loopStart = -1, loopEnd = 0) {
  return { id, data: to8(buf), loopStart, loopEnd: loopEnd || buf.length };
}

// Slow stack of detuned saws. Five open-voiced notes, the classic "sampled string chord".
function padChord(id, semis) {
  const rate = MUSIC_RATE;
  const len = secs(rate, 3.4);
  const buf = new Float32Array(len);
  const detune = [-0.007, 0.0, 0.006];
  semis.forEach((s, k) => {
    const hz = midiHz(D3 + s);
    detune.forEach((d, j) => addSaw(buf, rate, hz * (1 + d), (j === 1 ? 0.8 : 0.6) * (k === 0 ? 1.1 : 0.85), (k * 1.7 + j * 2.3) % 6.28));
  });
  svfLowpass(buf, rate, (i) => 900 + 700 * Math.sin((i / rate) * 0.9) ** 2, 0.9);
  filter(buf, biquad('hp', 90, 0.7, rate));
  normalize(buf, 0.97);
  const loopStart = secs(rate, 1.2);
  makeLoop(buf, loopStart, secs(rate, 0.5));
  return sampleFrom(id, buf, loopStart, len);
}

// A driven guitar: notes pass through a tube clipper together, so intermodulation thickens
// the chord exactly as it does in a real amp, then a speaker-cabinet shaped EQ.
function ampChain(buf, rate, drive, lpHz = 3600) {
  filter(buf, biquad('hp', 110, 0.7, rate));
  for (let i = 0; i < buf.length; i++) buf[i] = tubeClip(buf[i], drive);
  filter(buf, biquad('peak', 1500, 0.9, rate, 7));
  filter(buf, biquad('peak', 380, 1.2, rate, -4));
  filter(buf, biquad('lp', lpHz, 0.8, rate));
  filter(buf, biquad('hp', 85, 0.7, rate));
  return buf;
}

function pickNoise(buf, rate, seed, amp, ms = 6) {
  const r = rng(seed);
  const n = secs(rate, ms / 1000);
  for (let i = 0; i < n && i < buf.length; i++) buf[i] += (r() * 2 - 1) * amp * (1 - i / n);
  return buf;
}

function powerChordBody(rate, len) {
  const buf = new Float32Array(len);
  [[-12, 1], [-5, 0.8], [0, 0.65]].forEach(([s, a], k) => {
    const hz = midiHz(D3 + s);
    addSaw(buf, rate, hz, a, k * 1.2);
    addSaw(buf, rate, hz * 1.004, a * 0.8, k * 2.1 + 1);
  });
  return buf;
}

function bigChord(id, third) {
  const rate = MUSIC_RATE;
  const len = secs(rate, 2.6);
  const gtr = powerChordBody(rate, len);
  pickNoise(gtr, rate, 7, 0.9);
  ampChain(gtr, rate, 5.5);
  normalize(gtr, 0.8);
  // A brass layer on top carries the chord's third: distortion would turn it to mud.
  const brass = new Float32Array(len);
  [third, 19, 24].forEach((s, k) => {
    const hz = midiHz(D3 + s);
    addSaw(brass, rate, hz * 0.997, 0.7, k * 0.9);
    addSaw(brass, rate, hz * 1.003, 0.7, k * 1.9);
  });
  svfLowpass(brass, rate, (i) => 900 + 2400 * Math.exp(-i / (rate * 0.09)), 0.75);
  normalize(brass, 0.55);
  const buf = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    const t = i / rate;
    const sustain = 0.55 + 0.45 * Math.exp(-t * 3.5);
    buf[i] = gtr[i] * sustain + brass[i] * Math.min(1, t * 90) * (0.45 + 0.55 * Math.exp(-t * 2));
  }
  normalize(buf, 0.97);
  const loopStart = secs(rate, 1.3);
  makeLoop(buf, loopStart, secs(rate, 0.45));
  return sampleFrom(id, buf, loopStart, len);
}

function mutedPower(id) {
  const rate = MUSIC_RATE;
  const len = secs(rate, 0.3);
  const buf = powerChordBody(rate, len);
  pickNoise(buf, rate, 11, 1.4, 4);
  for (let i = 0; i < len; i++) buf[i] *= Math.exp(-(i / rate) * 15);
  ampChain(buf, rate, 7, 1500);
  normalize(buf, 0.95);
  fadeEdges(buf, 0, 200);
  return sampleFrom(id, buf);
}

// Lead guitar, sampled once per octave so its cabinet "formant" doesn't chipmunk.
function leadGuitar(id, note) {
  const rate = MUSIC_RATE;
  const len = secs(rate, 1.5);
  const hz = midiHz(note);
  const buf = new Float32Array(len);
  addSaw(buf, rate, hz, 1.0);
  addSaw(buf, rate, hz * 1.003, 0.7, 1.1);
  addSaw(buf, rate, hz * 0.5, 0.25, 2.4);
  pickNoise(buf, rate, note, 0.8, 5);
  ampChain(buf, rate, 7.5, 4200);
  // Pick attack, then sustained singing tone
  for (let i = 0; i < len; i++) {
    const t = i / rate;
    buf[i] *= 0.82 + 0.18 * Math.exp(-t * 14);
  }
  normalize(buf, 0.97);
  const loopStart = secs(rate, 0.65);
  makeLoop(buf, loopStart, secs(rate, 0.25));
  return sampleFrom(id, buf, loopStart, len);
}

// Warm synth horn for the quiet statement of the theme.
function horn(id, note) {
  const rate = MUSIC_RATE;
  const len = secs(rate, 1.4);
  const hz = midiHz(note);
  const buf = new Float32Array(len);
  addSaw(buf, rate, hz * 0.998, 0.6);
  addSaw(buf, rate, hz * 1.002, 0.6, 1);
  let ph = 0;
  for (let i = 0; i < len; i++) { ph += hz / rate; buf[i] += tri(ph) * 0.55; }
  svfLowpass(buf, rate, (i) => hz * 2.2 + 900 * Math.exp(-i / (rate * 0.12)) + 180 * Math.sin((i / rate) * 11), 0.85);
  normalize(buf, 0.97);
  const loopStart = secs(rate, 0.6);
  makeLoop(buf, loopStart, secs(rate, 0.3));
  return sampleFrom(id, buf, loopStart, len);
}

function pluck(id, note) {
  const rate = MUSIC_RATE;
  const len = secs(rate, 0.6);
  const hz = midiHz(note);
  const buf = new Float32Array(len);
  let ph = 0;
  for (let i = 0; i < len; i++) { ph += hz / rate; buf[i] = square(ph, 0.33) * 0.7 + square(ph * 1.004, 0.5) * 0.3; }
  svfLowpass(buf, rate, () => hz * 5, 0.5);
  normalize(buf, 0.95);
  const loopStart = secs(rate, 0.2);
  makeLoop(buf, loopStart, secs(rate, 0.12));
  return sampleFrom(id, buf, loopStart, len);
}

function bass(id, note) {
  const rate = 8363; // ProTracker's C-2 rate
  const len = secs(rate, 1.4);
  const hz = midiHz(note);
  const buf = new Float32Array(len);
  addSaw(buf, rate, hz, 1);
  let ph = 0;
  for (let i = 0; i < len; i++) { ph += hz / rate; buf[i] += square(ph, 0.5) * 0.3; }
  svfLowpass(buf, rate, (i) => 260 + 1300 * Math.exp(-i / (rate * 0.05)), 0.75);
  for (let i = 0; i < len; i++) buf[i] = softClip(buf[i], 1.6);
  pickNoise(buf, rate, 3, 0.5, 3);
  normalize(buf, 0.97);
  const loopStart = secs(rate, 0.5);
  makeLoop(buf, loopStart, secs(rate, 0.25));
  return { ...sampleFrom(id, buf, loopStart, len), rate };
}

// --- Drums ---
function kickBuf(rate) {
  const len = secs(rate, 0.32);
  const buf = new Float32Array(len);
  const r = rng(21);
  let ph = 0;
  for (let i = 0; i < len; i++) {
    const t = i / rate;
    const hz = 48 + 130 * Math.exp(-t * 34);
    ph += (hz / rate) * 2 * Math.PI;
    buf[i] = Math.sin(ph) * Math.exp(-t * 9) * 1.1 + (i < rate * 0.004 ? (r() * 2 - 1) * 0.7 : 0);
    buf[i] = softClip(buf[i], 1.8);
  }
  return normalize(buf, 0.98);
}
// The 1980s gated-reverb snare: a burst of body and noise, a dense bloom, then a hard gate.
function snareBuf(rate) {
  const len = secs(rate, 0.34);
  const buf = new Float32Array(len);
  const r = rng(33);
  const nf = biquad('bp', 3100, 0.5, rate);
  let ph = 0;
  for (let i = 0; i < len; i++) {
    const t = i / rate;
    ph += ((175 + 60 * Math.exp(-t * 60)) / rate) * 2 * Math.PI;
    const body = Math.sin(ph) * Math.exp(-t * 28);
    const n = r() * 2 - 1;
    const burst = nf(n) * 1.5 * Math.exp(-t * 22);
    // Reverb tail holds roughly level, then the gate slams shut at ~260 ms.
    const gate = t < 0.24 ? 1 : Math.max(0, 1 - (t - 0.24) / 0.035);
    const tail = (n * 0.33 + nf(n) * 0.2) * Math.min(1, t * 60) * (0.75 + 0.25 * Math.exp(-t * 7)) * gate;
    buf[i] = softClip(body * 1.05 + burst + tail, 1.4);
  }
  filter(buf, biquad('hp', 120, 0.7, rate));
  return normalize(buf, 0.97);
}
function hatBuf(rate, decay) {
  const len = secs(rate, Math.min(0.5, decay * 6));
  const buf = new Float32Array(len);
  const r = rng(44);
  const hp = biquad('hp', 6200, 0.9, rate);
  for (let i = 0; i < len; i++) buf[i] = hp(r() * 2 - 1) * Math.exp(-(i / rate) / decay);
  return normalize(buf, 0.9);
}
function crashBuf(rate) {
  const len = secs(rate, 3);
  const buf = new Float32Array(len);
  const r = rng(55);
  const hp = biquad('hp', 2100, 0.7, rate), pk = biquad('peak', 5200, 0.6, rate, 7);
  const partials = Array.from({ length: 28 }, () => [1800 + r() * 5200, r() * 6.28, 0.3 + r()]);
  for (let i = 0; i < len; i++) {
    const t = i / rate;
    let s = (r() * 2 - 1) * 0.6;
    for (let p = 0; p < 28; p += 3) s += Math.sin(2 * Math.PI * partials[p][0] * t + partials[p][1]) * 0.05 * partials[p][2];
    buf[i] = pk(hp(s)) * (Math.exp(-t * 1.6) * 0.8 + Math.exp(-t * 16) * 0.5);
  }
  return normalize(buf, 0.97);
}
function tomBuf(rate) {
  const len = secs(rate, 0.6);
  const buf = new Float32Array(len);
  const r = rng(66);
  let ph = 0;
  for (let i = 0; i < len; i++) {
    const t = i / rate;
    ph += ((120 + 70 * Math.exp(-t * 22)) / rate) * 2 * Math.PI;
    buf[i] = softClip(Math.sin(ph) * Math.exp(-t * 6.5) * 1.2 + (r() * 2 - 1) * 0.35 * Math.exp(-t * 40), 1.5);
  }
  return normalize(buf, 0.98);
}
// Huge sub impact for the opening hit.
function boomBuf(rate) {
  const len = secs(rate, 2.6);
  const buf = new Float32Array(len);
  const r = rng(77);
  const lp = biquad('lp', 700, 0.7, rate);
  let ph = 0;
  for (let i = 0; i < len; i++) {
    const t = i / rate;
    ph += ((38 + 70 * Math.exp(-t * 11)) / rate) * 2 * Math.PI;
    buf[i] = softClip(Math.sin(ph) * Math.exp(-t * 1.5) * 1.6 + lp(r() * 2 - 1) * 1.2 * Math.exp(-t * 3.4), 1.4);
  }
  return normalize(buf, 0.98);
}
const mix = (a, b, ga = 1, gb = 1) => {
  const out = new Float32Array(Math.max(a.length, b.length));
  for (let i = 0; i < a.length; i++) out[i] += a[i] * ga;
  for (let i = 0; i < b.length; i++) out[i] += b[i] * gb;
  return normalize(out, 0.98);
};

export function generateMusicSamples() {
  const r = MUSIC_RATE;
  const out = [];
  out.push(padChord('m_padMaj', [0, 7, 12, 16, 19]));
  out.push(padChord('m_padMin', [0, 7, 12, 15, 19]));
  out.push(padChord('m_padSus', [0, 7, 12, 14, 19]));
  out.push(bigChord('m_bigMaj', 16));
  out.push(bigChord('m_bigMin', 15));
  out.push(mutedPower('m_mute'));
  for (const n of [57, 69, 81]) out.push(leadGuitar('m_gtr' + n, n));
  for (const n of [57, 69, 81]) out.push(horn('m_horn' + n, n));
  out.push(pluck('m_pluck', 69));
  out.push(bass('m_bass', 38));

  const kick = kickBuf(r), snare = snareBuf(r), hat = hatBuf(r, 0.022), oh = hatBuf(r, 0.09), crash = crashBuf(r), tom = tomBuf(r), boom = boomBuf(r);
  const drum = (id, buf) => out.push(sampleFrom(id, buf));
  drum('m_k', kick);
  drum('m_s', snare);
  drum('m_h', hat);
  drum('m_o', oh);
  drum('m_c', crash);
  drum('m_t', tom);
  drum('m_b', boom);
  drum('m_kh', mix(kick, hat, 1, 0.3));
  drum('m_sh', mix(snare, hat, 1, 0.22));
  drum('m_kc', mix(kick, crash, 0.95, 0.7));
  drum('m_kb', mix(boom, crash, 1, 0.5));
  return out;
}

export { ampChain, pickNoise, sampleFrom, crashBuf };
