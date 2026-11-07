// The sound palette of the "Anthem" title theme, in the spirit of the original's documented character:
// atmospheric, bell-toned, drum-machine driven, with a rock lead. Everything is synthesised here and
// quantised to 8 bits like every other sample. Nothing is taken from the original or from any record.
import { rng, midiHz, secs, biquad, filter, svfLowpass, softClip, normalize, makeLoop, addSaw, fadeEdges } from './dsp.js';
import { MUSIC_RATE, ampChain, pickNoise, sampleFrom, crashBuf } from './samples-music.js';

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const TAU = Math.PI * 2;

// ---- The bell: a two-operator FM voice with an inharmonic 3.5:1 modulator, the classic metallic
// "tubular bell" colour of 80s FM keyboards. A bright strike that mellows into a long pure ring.
function bell(id, note) {
  const rate = MUSIC_RATE, len = secs(rate, 3.8), f = midiHz(note);
  const buf = new Float32Array(len);
  const ratio = 3.5;
  // keep the sidebands under Nyquist so the top of the bell is clean rather than aliased
  const iMax = clamp((6000 / f - 1) / ratio, 0.5, 4.6);
  for (let i = 0; i < len; i++) {
    const t = i / rate;
    const idx = iMax * Math.exp(-t * 1.9) + 0.35 * Math.exp(-t * 0.5);
    let s = Math.sin(TAU * f * t + idx * Math.sin(TAU * f * ratio * t)) * 0.85;
    // upper "modes" of a struck bar, ringing a little less long
    s += Math.sin(TAU * f * 2.76 * t + 0.6 * idx * Math.sin(TAU * f * 5.43 * t)) * 0.26 * Math.exp(-t * 1.7);
    buf[i] = s * Math.min(1, t * 900) * Math.exp(-t * 0.78);
  }
  filter(buf, biquad('lp', 5200, 0.7, rate));
  fadeEdges(buf, 0, secs(rate, 0.2));
  normalize(buf, 0.97);
  return sampleFrom(id, buf);
}

// ---- A cleaner, singing lead guitar than the distorted rock chords: lighter drive, long sustain.
function leadGuitar(id, note) {
  const rate = MUSIC_RATE, len = secs(rate, 1.7), hz = midiHz(note);
  const buf = new Float32Array(len);
  addSaw(buf, rate, hz, 1.0);
  addSaw(buf, rate, hz * 1.0025, 0.55, 1.3);
  addSaw(buf, rate, hz * 2, 0.16, 0.7);
  pickNoise(buf, rate, note + 200, 0.45, 5);
  ampChain(buf, rate, 3.4, 3300);
  for (let i = 0; i < len; i++) buf[i] *= 0.9 + 0.1 * Math.exp(-(i / rate) * 10);
  normalize(buf, 0.97);
  const loopStart = secs(rate, 0.72);
  makeLoop(buf, loopStart, secs(rate, 0.3));
  return sampleFrom(id, buf, loopStart, len);
}

// ---- The drum machine: a TR-808-style kit.
function kick808() {
  const rate = MUSIC_RATE, len = secs(rate, 0.62);
  const b = new Float32Array(len);
  const r = rng(808);
  let ph = 0;
  for (let i = 0; i < len; i++) {
    const t = i / rate;
    ph += ((46 + 150 * Math.exp(-t * 38)) / rate) * TAU; // a fast pitch drop into a deep sine
    const click = t < 0.003 ? (r() * 2 - 1) * (1 - t / 0.003) * 0.5 : 0;
    b[i] = softClip(Math.sin(ph) * Math.exp(-t * 6.2) * 1.5 + click, 1.3);
  }
  fadeEdges(b, 0, 300);
  return normalize(b, 0.98);
}
function snare808() {
  const rate = MUSIC_RATE, len = secs(rate, 0.3);
  const b = new Float32Array(len);
  const r = rng(809);
  const bp = biquad('bp', 3300, 0.6, rate), hp = biquad('hp', 900, 0.7, rate);
  for (let i = 0; i < len; i++) {
    const t = i / rate;
    const tone = Math.sin(TAU * (178 + 60 * Math.exp(-t * 60)) * t) * Math.exp(-t * 26) + 0.55 * Math.sin(TAU * 332 * t) * Math.exp(-t * 38);
    const n = r() * 2 - 1;
    b[i] = softClip(tone * 0.95 + hp(bp(n)) * 1.7 * Math.exp(-t * 17), 1.2);
  }
  return normalize(b, 0.97);
}
function clap808() {
  const rate = MUSIC_RATE, len = secs(rate, 0.34);
  const b = new Float32Array(len);
  const r = rng(810);
  const bp = biquad('bp', 1400, 0.9, rate);
  for (let i = 0; i < len; i++) {
    const t = i / rate;
    let env = Math.exp(-t * 20) * 0.45;
    for (const burst of [0, 0.011, 0.022, 0.034]) if (t >= burst) env += Math.exp(-(t - burst) * 190) * 0.8; // the four hands
    b[i] = bp(r() * 2 - 1) * env * 2.2;
  }
  return normalize(b, 0.95);
}
// Six square oscillators at the 808's inharmonic frequencies, high-passed: the metallic hat.
const HAT_FREQS = [205.3, 304.4, 369.6, 522.7, 540.0, 800.0];
function hatBuf(decay, seed) {
  const rate = MUSIC_RATE, len = secs(rate, Math.min(0.6, decay * 7));
  const b = new Float32Array(len);
  const r = rng(seed);
  const hp = biquad('hp', 6500, 0.8, rate);
  for (let i = 0; i < len; i++) {
    const t = i / rate;
    let m = 0;
    for (const f of HAT_FREQS) m += Math.sin(TAU * f * 2.6 * t) > 0 ? 1 : -1;
    b[i] = hp(m * 0.1 + (r() * 2 - 1) * 0.5) * Math.exp(-t / decay);
  }
  fadeEdges(b, 0, 120);
  return normalize(b, 0.9);
}
function cowbell808() {
  const rate = MUSIC_RATE, len = secs(rate, 0.32);
  const b = new Float32Array(len);
  const bp = biquad('bp', 2640, 0.8, rate);
  for (let i = 0; i < len; i++) {
    const t = i / rate;
    const sq = (Math.sin(TAU * 540 * t) > 0 ? 1 : -1) + (Math.sin(TAU * 800 * t) > 0 ? 1 : -1);
    b[i] = bp(sq * 0.5) * (Math.exp(-t * 17) * 0.9 + Math.exp(-t * 5) * 0.14) * Math.min(1, t * 1500);
  }
  fadeEdges(b, 0, 200);
  return normalize(b, 0.9);
}
function tom808() {
  const rate = MUSIC_RATE, len = secs(rate, 0.55);
  const b = new Float32Array(len);
  let ph = 0;
  for (let i = 0; i < len; i++) {
    const t = i / rate;
    ph += ((118 + 70 * Math.exp(-t * 26)) / rate) * TAU;
    b[i] = softClip(Math.sin(ph) * Math.exp(-t * 7.5) * 1.3, 1.2);
  }
  fadeEdges(b, 0, 200);
  return normalize(b, 0.97);
}
// A reverse-cymbal style rise: filtered noise that opens up and swells, then stops dead on the bar line.
function swell() {
  const rate = MUSIC_RATE, T = 2.3, len = secs(rate, T);
  const b = noise(len, 812);
  svfLowpass(b, rate, (i) => 260 * Math.pow(26, i / len), 0.9);
  for (let i = 0; i < len; i++) { const u = i / len; b[i] *= u * u * (0.35 + 0.65 * u); }
  fadeEdges(b, 0, 60);
  return normalize(b, 0.9);
}
function noise(len, seed) { const r = rng(seed); const b = new Float32Array(len); for (let i = 0; i < len; i++) b[i] = r() * 2 - 1; return b; }

const mix = (parts) => {
  const len = Math.max(...parts.map(([b]) => b.length));
  const out = new Float32Array(len);
  for (const [b, g] of parts) for (let i = 0; i < b.length; i++) out[i] += b[i] * g;
  return normalize(out, 0.98);
};

export function generateAnthemSamples() {
  const out = [];
  for (const n of [40, 52, 64, 76]) out.push(bell('a_bell' + n, n));
  for (const n of [57, 69, 81]) out.push(leadGuitar('a_gtr' + n, n));
  const kick = kick808(), snare = snare808(), clap = clap808(), hat = hatBuf(0.03, 811), open = hatBuf(0.12, 812);
  const raw = (id, buf) => out.push(sampleFrom(id, buf));
  raw('a8_k', kick); raw('a8_s', snare); raw('a8_cl', clap); raw('a8_h', hat); raw('a8_o', open);
  const crash = crashBuf(MUSIC_RATE);
  raw('a8_cow', cowbell808()); raw('a8_t', tom808()); raw('a8_sw', swell()); raw('a8_c', crash);
  raw('a8_kc', mix([[kick, 1], [crash, 0.7]]));
  // simultaneous hits share the drum channel, so the common pairs are pre-mixed
  raw('a8_kh', mix([[kick, 1], [hat, 0.3]]));
  raw('a8_sc', mix([[snare, 1], [clap, 0.75]]));
  raw('a8_sch', mix([[snare, 1], [clap, 0.75], [hat, 0.3]]));
  return out;
}
