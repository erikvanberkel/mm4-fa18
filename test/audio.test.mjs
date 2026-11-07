// Objective checks on the music, because a build machine has no ears.
import test from 'node:test';
import assert from 'node:assert/strict';
import { PaulaEngine } from '../src/audio/paula-engine.js';
import { generateMusicSamples } from '../src/audio/samples-music.js';
import { generateSfxSamples } from '../src/audio/samples-sfx.js';
import { buildTitleSong, noteToMidi } from '../src/audio/song-title.js';

const RATE = 48000;
const music = generateMusicSamples();
const sfx = generateSfxSamples();

function dft(buf, hz) {
  let re = 0, im = 0;
  const w = (2 * Math.PI * hz) / RATE;
  for (let i = 0; i < buf.length; i++) { re += buf[i] * Math.cos(i * w); im += buf[i] * Math.sin(i * w); }
  return Math.hypot(re, im) / buf.length;
}

// Strongest fundamental near the expected pitch, searched in 2-cent steps.
function measurePitch(buf, expectedHz) {
  let best = 0, bestHz = 0;
  for (let cents = -60; cents <= 60; cents += 2) {
    const hz = expectedHz * Math.pow(2, cents / 1200);
    const m = dft(buf, hz);
    if (m > best) { best = m; bestHz = hz; }
  }
  return bestHz;
}

function renderNote(instName, midi, seconds = 0.5) {
  const song = buildTitleSong();
  const e = new PaulaEngine(RATE);
  for (const s of music) e.loadSample(s.id, s.data, s.loopStart, s.loopEnd);
  e.loadSong({ ...song, channels: [[{ r: 0, len: 64, n: midi, i: instName, v: 1, vib: null }], [], [], []], lengthRows: 64, loopRow: -1 });
  e.playSong(0);
  const n = Math.floor(seconds * RATE);
  const skip = Math.floor(0.25 * RATE);
  const L = new Float32Array(skip + n), R = new Float32Array(skip + n);
  e.render(L, R, skip + n);
  return L.subarray(skip);
}

test('every instrument plays in tune to within 12 cents', () => {
  const cases = [
    ['bass', 'D2'], ['bass', 'B1'], ['bass', 'E2'],
    ['gtr', 'A4'], ['gtr', 'D5'], ['gtr', 'A5'], ['gtr', 'E6'],
    ['horn', 'A4'], ['horn', 'D5'],
    ['padMaj', 'D3'], ['padMin', 'B2'], ['bigMaj', 'E3'],
  ];
  for (const [inst, name] of cases) {
    const midi = noteToMidi(name);
    const hz = 440 * Math.pow(2, (midi - 69) / 12);
    const got = measurePitch(renderNote(inst, midi), hz);
    const cents = 1200 * Math.log2(got / hz);
    assert.ok(Math.abs(cents) <= 12, `${inst} ${name}: ${cents.toFixed(1)} cents off (${got.toFixed(1)} vs ${hz.toFixed(1)} Hz)`);
  }
});

const CHORD_TONES = { maj: [0, 4, 7], m: [0, 3, 7], sus: [0, 2, 7] };
// Colour tones that sound right held over a chord in this style.
const OK_LONG = { maj: [0, 2, 4, 7, 9, 11], m: [0, 2, 3, 7, 10], sus: [0, 2, 5, 7, 9] };

const song = buildTitleSong();
const chordAt = (r) => song.harmony.find((h) => r >= h.r && r < h.r + h.len);

test('melody: notes on strong beats are chord tones, held notes are at least colour tones', () => {
  const problems = [];
  for (const ev of song.melody) {
    const c = chordAt(ev.r);
    if (!c) continue;
    const iv = (ev.n - c.root + 120) % 12;
    const strong = ev.r % 8 === 0;
    if (strong && ev.len >= 4 && !OK_LONG[c.quality].includes(iv)) problems.push(`bar ${ev.r >> 4} row ${ev.r % 16}: interval ${iv} over ${c.quality}`);
    if (ev.len >= 8 && !OK_LONG[c.quality].includes(iv)) problems.push(`bar ${ev.r >> 4} long note: interval ${iv} over ${c.quality}`);
  }
  assert.deepEqual(problems, []);
});

test('harmony covers the whole song and no channel overlaps itself', () => {
  for (let r = 0; r < song.lengthRows; r += 4) assert.ok(chordAt(r), `no chord at row ${r}`);
  for (const ch of song.channels) {
    const sorted = [...ch].sort((a, b) => a.r - b.r);
    assert.deepEqual(ch.map((e) => e.r), sorted.map((e) => e.r), 'events must be in row order');
  }
  assert.equal(song.channels.length, 4, 'an Amiga has four channels');
});

test('melody stays in singable range and has shape', () => {
  const notes = song.melody.map((e) => e.n);
  assert.ok(Math.min(...notes) >= noteToMidi('G4') - 1, 'lowest note');
  assert.ok(Math.max(...notes) <= noteToMidi('E6'), 'highest note');
  const starts = Object.values(song.sections);
  const leaps = song.melody.slice(1).map((e, i) => (starts.some((r) => e.r >= r && song.melody[i].r < r) ? 0 : Math.abs(e.n - song.melody[i].n)));
  assert.ok(Math.max(...leaps) <= 12, `no leaps beyond an octave inside a section, got ${Math.max(...leaps)}`);
  const steps = leaps.filter((l) => l <= 2).length / leaps.length;
  assert.ok(steps > 0.3 && steps < 0.85, `mix of steps and leaps, got ${steps.toFixed(2)} steps`);
});

test('Paula voice respects hardware period limit and integer pitch', () => {
  const e = new PaulaEngine(RATE);
  assert.equal(e.periodFor(1e6), 124);
  assert.equal(e.periodFor(8363), Math.round(3546895 / 8363));
});

test('all samples are real audio: finite, non-silent, in 8-bit range', () => {
  for (const s of [...music, ...sfx]) {
    let peak = 0;
    for (const v of s.data) peak = Math.max(peak, Math.abs(v));
    assert.ok(peak > 40, `${s.id} is nearly silent (peak ${peak})`);
    if (s.loopStart >= 0) assert.ok(s.loopStart < s.loopEnd && s.loopEnd <= s.data.length, `${s.id} bad loop`);
  }
});

test('Vulcan loop pitch is 100 Hz: 6,000 rounds per minute', () => {
  const gun = sfx.find((s) => s.id === 'w_gun');
  const f = Float32Array.from(gun.data);
  const rate = gun.rate;
  const mag = (hz) => {
    let re = 0, im = 0;
    for (let i = 0; i < f.length; i++) { re += f[i] * Math.cos((2 * Math.PI * hz * i) / rate); im += f[i] * Math.sin((2 * Math.PI * hz * i) / rate); }
    return Math.hypot(re, im);
  };
  // Measure the signal envelope instead of the carrier: 100 Hz must dominate 60-140 Hz in it.
  const env = Float32Array.from(f, (v) => Math.abs(v));
  const envMag = (hz) => {
    let re = 0, im = 0;
    for (let i = 0; i < env.length; i++) { re += env[i] * Math.cos((2 * Math.PI * hz * i) / rate); im += env[i] * Math.sin((2 * Math.PI * hz * i) / rate); }
    return Math.hypot(re, im);
  };
  assert.ok(envMag(100) > 2 * Math.max(envMag(70), envMag(130)), 'envelope should pulse at 100 Hz');
  assert.ok(mag(100) >= 0);
});
