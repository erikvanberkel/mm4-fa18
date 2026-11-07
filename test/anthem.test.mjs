// Objective checks on the "Anthem" title theme and the engine features it relies on (echo, drum kit).
import test from 'node:test';
import assert from 'node:assert/strict';
import { PaulaEngine } from '../src/audio/paula-engine.js';
import { generateMusicSamples } from '../src/audio/samples-music.js';
import { generateAnthemSamples } from '../src/audio/samples-anthem.js';
import { buildAnthemSong, ANTHEM_BPM } from '../src/audio/song-anthem.js';
import { buildTitleSong, noteToMidi, BAR } from '../src/audio/song-title.js';
import { sceneLengths, titleLoopSeconds } from '../src/screens/title.js';

const RATE = 48000;
const samples = [...generateMusicSamples(), ...generateAnthemSamples()];
const song = buildAnthemSong();
const byId = new Map(samples.map((s) => [s.id, s]));

function engineFor(s) {
  const e = new PaulaEngine(RATE);
  e.wet = s.wet === undefined ? 0 : s.wet;
  if (s.echo) e.setEcho(s.echo.time, s.echo.feedback, s.echo.mix);
  for (const smp of samples) e.loadSample(smp.id, smp.data, smp.loopStart, smp.loopEnd);
  return e;
}
function renderSong(s, seconds, e = engineFor(s)) {
  e.loadSong(s);
  e.playSong(0);
  const n = Math.floor(seconds * RATE);
  const L = new Float32Array(n), R = new Float32Array(n);
  for (let i = 0; i < n; i += 128) e.render(L.subarray(i, Math.min(n, i + 128)), R.subarray(i, Math.min(n, i + 128)), Math.min(128, n - i));
  return [L, R];
}
const rms = (b, from, to) => {
  let t = 0;
  for (let i = from; i < to; i++) t += b[i] * b[i];
  return Math.sqrt(t / Math.max(1, to - from));
};
const dft = (buf, hz) => {
  let re = 0, im = 0;
  const w = (2 * Math.PI * hz) / RATE;
  for (let i = 0; i < buf.length; i++) { re += buf[i] * Math.cos(i * w); im += buf[i] * Math.sin(i * w); }
  return Math.hypot(re, im) / buf.length;
};
function measurePitch(buf, expectedHz) {
  let best = 0, bestHz = 0;
  for (let cents = -60; cents <= 60; cents += 2) {
    const hz = expectedHz * Math.pow(2, cents / 1200);
    const m = dft(buf, hz);
    if (m > best) { best = m; bestHz = hz; }
  }
  return bestHz;
}

test('every sample an instrument or drum refers to exists', () => {
  for (const [name, inst] of Object.entries(song.instruments)) {
    for (const z of inst.zones) assert.ok(byId.has(z.s), `instrument ${name} uses missing sample ${z.s}`);
  }
  for (const ch of song.channels) {
    for (const ev of ch) if (!ev.rest) assert.ok(song.instruments[ev.i], `event at row ${ev.r} uses unknown instrument ${ev.i}`);
  }
});

test('the bell and the lead guitar play in tune to within 12 cents', () => {
  const cases = [['bell', 'E4'], ['bell', 'B4'], ['bell', 'A4'], ['bell', 'E5'], ['lead', 'B4'], ['lead', 'E5'], ['lead', 'B5'], ['lead', 'E6']];
  for (const [inst, name] of cases) {
    const midi = noteToMidi(name);
    const hz = 440 * Math.pow(2, (midi - 69) / 12);
    const e = engineFor({});
    const one = { ...song, channels: [[{ r: 0, len: 64, n: midi, i: inst, v: 1, vib: null }], [], [], []], lengthRows: 64, loopRow: -1, echo: null, wet: 0 };
    const [L] = renderSong(one, 0.75, e);
    const got = measurePitch(L.subarray(Math.floor(0.25 * RATE)), hz);
    const cents = 1200 * Math.log2(got / hz);
    assert.ok(Math.abs(cents) <= 12, `${inst} ${name}: ${cents.toFixed(1)} cents off`);
  }
});

test('structure: 40 bars, the film is cut to the same grid, harmony covers every row, channels are in order', () => {
  assert.equal(song.lengthRows, 40 * BAR);
  assert.equal(song.channels.length, 4, 'an Amiga has four channels');
  assert.equal(song.bpm, ANTHEM_BPM);
  const barLens = sceneLengths(song.bpm);
  const filmSeconds = barLens.reduce((a, b) => a + b, 0);
  const songSeconds = (song.lengthRows * 60) / (song.bpm * 4);
  assert.ok(Math.abs(filmSeconds - songSeconds) < 1e-9, `film ${filmSeconds} s vs music ${songSeconds} s`);
  assert.ok(Math.abs(titleLoopSeconds(song.bpm) - songSeconds) < 1e-9);
  for (let r = 0; r < song.lengthRows; r += 4) assert.ok(song.harmony.find((h) => r >= h.r && r < h.r + h.len), `no chord at row ${r}`);
  for (const ch of song.channels) {
    for (let i = 1; i < ch.length; i++) assert.ok(ch[i].r >= ch[i - 1].r, `events out of order at row ${ch[i].r}`);
  }
  // the film's shots start exactly on the song's section boundaries
  const starts = [0, 4, 12, 20, 28, 36].map((b) => b * BAR);
  const cuts = [];
  let acc = 0;
  for (const l of barLens) { cuts.push(Math.round((acc * song.bpm * 4) / 60)); acc += l; }
  assert.deepEqual(cuts, starts);
  assert.deepEqual(Object.values(song.sections), starts);
});

const OK_LONG = { maj: [0, 2, 4, 7, 9, 11], m: [0, 2, 3, 7, 10], sus: [0, 2, 5, 7, 9] };
test('melody: notes on strong beats are chord tones or colour tones, long notes too', () => {
  const problems = [];
  for (const ev of song.melody) {
    const c = song.harmony.find((h) => ev.r >= h.r && ev.r < h.r + h.len);
    assert.ok(c, `no chord under melody row ${ev.r}`);
    const iv = (ev.n - c.root + 120) % 12;
    const strong = ev.r % 8 === 0;
    if ((strong && ev.len >= 4) || ev.len >= 8) if (!OK_LONG[c.quality].includes(iv)) problems.push(`bar ${ev.r >> 4} row ${ev.r % 16}: interval ${iv} over ${c.quality}`);
  }
  assert.deepEqual(problems, []);
});

test('melody has a range and an arc: it climbs from the bell hook to the last chorus', () => {
  const notes = song.melody.map((e) => e.n);
  assert.ok(Math.min(...notes) >= noteToMidi('B3'), 'lowest note');
  assert.ok(Math.max(...notes) <= noteToMidi('E6'), 'highest note');
  const mean = (a, b) => {
    const ns = song.melody.filter((e) => e.r >= a * BAR && e.r < b * BAR).map((e) => e.n);
    return ns.reduce((x, y) => x + y, 0) / ns.length;
  };
  const A = mean(4, 12), B = mean(12, 20), C = mean(20, 28), D = mean(28, 36);
  assert.ok(A < B && B < C && C < D, `means ${[A, B, C, D].map((x) => x.toFixed(1))} should rise section by section`);
  // inside a section nothing leaps more than an octave
  const starts = Object.values(song.sections);
  let worst = 0;
  for (let i = 1; i < song.melody.length; i++) {
    const a = song.melody[i - 1], b = song.melody[i];
    if (starts.some((r) => b.r >= r && a.r < r)) continue;
    worst = Math.max(worst, Math.abs(b.n - a.n));
  }
  assert.ok(worst <= 12, `largest leap inside a section: ${worst} semitones`);
});

test('the key changes up a tone for the last chorus, through a dominant', () => {
  const rootAt = (bar) => song.harmony.find((h) => bar * BAR >= h.r && bar * BAR < h.r + h.len);
  assert.equal(rootAt(20).root, 7, 'chorus starts on G');
  assert.equal(rootAt(27).root, 4, 'the chorus ends on E, the dominant of A');
  assert.equal(rootAt(28).root, 9, 'last chorus starts on A');
  assert.equal(rootAt(28).quality, 'maj');
});

test('the lead has an echo, and the echo repeats at the dotted eighth then ping-pongs and decays', () => {
  const e = engineFor({});
  // a click on voice 0 (the lead channel)
  e.loadSample('click', Float32Array.from({ length: 64 }, (_, i) => (i === 0 ? 100 : 0)), -1, 0);
  const T = (60 / ANTHEM_BPM) * 0.75;
  e.setEcho(T, 0.42, 0.48);
  e.setPan(0, 1, 0); // the lead is hard left, like channel 0 on the hardware
  e.voicePlay(0, 'click', 3546895 / 124, 1, { noLoop: true });
  const n = Math.floor(RATE * T * 4.3);
  const L = new Float32Array(n), R = new Float32Array(n);
  e.render(L, R, n);
  const peakNear = (b, centre, half = 40) => {
    let p = 0;
    for (let i = Math.max(0, centre - half); i < Math.min(n, centre + half); i++) p = Math.max(p, Math.abs(b[i]));
    return p;
  };
  const d = Math.floor(RATE * T);
  const first = peakNear(L, d), second = peakNear(R, 2 * d), third = peakNear(L, 3 * d);
  assert.ok(first > 0.0005, `first repeat on the left: ${first}`);
  assert.ok(second > 0.0005, `second repeat on the right: ${second}`);
  assert.ok(peakNear(R, d) < first * 0.6, 'the first repeat is mostly left');
  assert.ok(third < second, 'the repeats decay');
  assert.ok(peakNear(L, Math.floor(d * 0.5)) < first * 0.2, 'silence between the repeats');
  // switching the echo off silences it
  e.setEcho(0, 0, 0);
  const L2 = new Float32Array(RATE), R2 = new Float32Array(RATE);
  e.render(L2, R2, RATE);
  // (the output filters still ring for a few milliseconds, so look past them, and relative to a real repeat)
  const after = Math.max(...L2.subarray(4000).map(Math.abs), ...R2.subarray(4000).map(Math.abs));
  assert.ok(after < first * 0.001, `echo off means no repeats, but ${after} remains (repeat was ${first})`);
});

test('rendered through the engine: finite, never clips, and it builds from the intro to the last chorus', () => {
  const secondsPerBar = (60 / song.bpm) * 4;
  const [L, R] = renderSong({ ...song, loopRow: -1 }, 40 * secondsPerBar + 3);
  const total = L.length;
  let peak = 0;
  for (let i = 0; i < total; i++) {
    assert.ok(Number.isFinite(L[i]) && Number.isFinite(R[i]), `non-finite output at ${i}`);
    peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
  }
  assert.ok(peak < 0.95, `peak ${peak}`);
  assert.ok(peak > 0.3, `peak ${peak} suspiciously quiet`);
  const sec = (a, b) => rms(L, Math.floor(a * secondsPerBar * RATE), Math.floor(b * secondsPerBar * RATE));
  const intro = sec(0, 4), A = sec(4, 12), B = sec(12, 20), C = sec(20, 28), D = sec(28, 36), outro = sec(36, 40);
  assert.ok(intro < B * 0.9, 'the intro is quieter than the band section');
  assert.ok(A < D, 'the quiet hook is softer than the last chorus');
  assert.ok(D > 0.5 * C && C > 0.5 * B, 'the choruses stay at full strength');
  assert.ok(outro < D, 'the outro relaxes');
});

test('the intro opens on the drum machine alone, with the bell arriving in bar 3', () => {
  const firstNote = (ch) => (song.channels[ch].filter((e) => !e.rest)[0] || { r: 1e9 }).r;
  assert.equal(firstNote(3), 0, 'drums start at the very first row');
  assert.ok(firstNote(0) >= 2 * BAR, 'no melody in the first two bars');
  assert.ok(firstNote(2) >= 2 * BAR, 'no bass in the first two bars');
  const [L] = renderSong({ ...song, loopRow: -1 }, 3);
  const beat = (60 / song.bpm);
  assert.ok(rms(L, 0, Math.floor(beat * RATE)) > 0.02, 'the first beat is audible');
});

test('the Anthem does not borrow the old theme: different tempo, different notes', () => {
  const old = buildTitleSong();
  assert.notEqual(old.bpm, song.bpm);
  const key = (s) => s.melody.slice(0, 8).map((e) => e.n - s.melody[0].n).join(',');
  assert.notEqual(key(old), key(song));
});
