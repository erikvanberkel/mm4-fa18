// Renders the music and SFX offline through the real PaulaEngine, writes WAV files for
// listening, spectrogram PNGs for inspection, and prints objective measurements.
import fs from 'node:fs';
import { PNG } from 'pngjs';
import { PaulaEngine } from '../src/audio/paula-engine.js';
import { generateMusicSamples } from '../src/audio/samples-music.js';
import { generateAnthemSamples } from '../src/audio/samples-anthem.js';
import { generateSfxSamples } from '../src/audio/samples-sfx.js';
import { buildTitleSong } from '../src/audio/song-title.js';
import { buildAnthemSong } from '../src/audio/song-anthem.js';
import { buildSuccessJingle, buildFailJingle } from '../src/audio/song-jingles.js';

const RATE = 48000;
const OUT = new URL('../audio-preview/', import.meta.url);
fs.mkdirSync(OUT, { recursive: true });

function writeWav(name, l, r) {
  const n = l.length;
  const buf = Buffer.alloc(44 + n * 4);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 4, 4); buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22);
  buf.writeUInt32LE(RATE, 24); buf.writeUInt32LE(RATE * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(n * 4, 40);
  for (let i = 0; i < n; i++) {
    buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(l[i] * 32767))), 44 + i * 4);
    buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(r[i] * 32767))), 46 + i * 4);
  }
  fs.writeFileSync(new URL(name, OUT), buf);
}

function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let j = 0; j < len / 2; j++) {
        const a = i + j, b = a + len / 2;
        const xr = re[b] * cr - im[b] * ci, xi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - xr; im[b] = im[a] - xi; re[a] += xr; im[a] += xi;
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
}

function spectrogram(name, l, r, w = 1400, h = 400, maxHz = 12000) {
  const N = 2048;
  const png = new PNG({ width: w, height: h });
  const hop = Math.max(1, Math.floor((l.length - N) / w));
  const win = Float64Array.from({ length: N }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N));
  // log frequency axis, 40 Hz to maxHz
  const fmin = 40;
  for (let x = 0; x < w; x++) {
    const re = new Float64Array(N), im = new Float64Array(N);
    const off = x * hop;
    for (let i = 0; i < N; i++) re[i] = ((l[off + i] || 0) + (r[off + i] || 0)) * 0.5 * win[i];
    fft(re, im);
    for (let y = 0; y < h; y++) {
      const fr = fmin * Math.pow(maxHz / fmin, 1 - y / (h - 1));
      const bin = Math.min(N / 2 - 1, Math.round((fr / RATE) * N));
      const mag = Math.hypot(re[bin], im[bin]);
      const db = 20 * Math.log10(mag + 1e-6);
      const v = Math.max(0, Math.min(1, (db + 22) / 72));
      const i = (y * w + x) * 4;
      png.data[i] = Math.min(255, v * v * 420);
      png.data[i + 1] = Math.min(255, Math.max(0, (v - 0.35) * 330));
      png.data[i + 2] = Math.min(255, Math.max(0, 120 * (1 - v * 1.5) + Math.max(0, v - 0.75) * 900));
      png.data[i + 3] = 255;
    }
  }
  fs.writeFileSync(new URL(name, OUT), PNG.sync.write(png));
}

const rmsDb = (b, s, e) => {
  let t = 0;
  for (let i = s; i < e; i++) t += b[i] * b[i];
  return 10 * Math.log10(t / Math.max(1, e - s) + 1e-12);
};
function bandEnergy(l, s, e) {
  // Coarse tonal balance over a section: sub, low, mid, high, in dB relative to total.
  const N = 4096, bands = [[20, 120], [120, 500], [500, 2000], [2000, 8000]];
  const tot = [0, 0, 0, 0];
  const win = Float64Array.from({ length: N }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N));
  for (let off = s; off + N < e; off += N * 2) {
    const re = new Float64Array(N), im = new Float64Array(N);
    for (let i = 0; i < N; i++) re[i] = l[off + i] * win[i];
    fft(re, im);
    for (let k = 1; k < N / 2; k++) {
      const hz = (k * RATE) / N;
      const m = re[k] * re[k] + im[k] * im[k];
      bands.forEach(([a, b], bi) => { if (hz >= a && hz < b) tot[bi] += m; });
    }
  }
  const sum = tot.reduce((a, b) => a + b, 0) + 1e-12;
  return tot.map((v) => (10 * Math.log10(v / sum + 1e-12)).toFixed(1));
}

const t0 = performance.now();
const samples = [...generateMusicSamples(), ...generateAnthemSamples(), ...generateSfxSamples()];
console.log(`generated ${samples.length} samples, ${((samples.reduce((a, s) => a + s.data.length, 0) / 1024) | 0)} KB of "chip RAM" in ${(performance.now() - t0) | 0} ms`);
for (const s of samples) {
  let bad = false;
  for (let i = 0; i < s.data.length; i++) if (!Number.isFinite(s.data[i])) { bad = true; break; }
  if (bad) throw new Error('non-finite sample ' + s.id);
}

// An engine set up the way the game sets it up for a song: its own reverb and echo.
function makeEngine(song) {
  const e = new PaulaEngine(RATE);
  e.wet = song && song.wet !== undefined ? song.wet : 0.14;
  if (song && song.echo) e.setEcho(song.echo.time, song.echo.feedback, song.echo.mix);
  for (const s of samples) e.loadSample(s.id, s.data, s.loopStart, s.loopEnd);
  return e;
}
const BLOCK = 128;

function renderTheme(id, song) {
  const engine = makeEngine(song);
  engine.loadSong({ ...song, loopRow: -1 }); // play it once; the tail is the last bell and echo ringing out
  engine.playSong(0);
  const secondsPerRow = 60 / (song.bpm * 4);
  const totalSec = song.lengthRows * secondsPerRow + 3; // a few seconds for the last bell and echo to die away
  const total = Math.ceil(totalSec * RATE);
  const L = new Float32Array(total), R = new Float32Array(total);
  const t1 = performance.now();
  for (let i = 0; i < total; i += BLOCK) {
    const n = Math.min(BLOCK, total - i);
    engine.render(L.subarray(i, i + n), R.subarray(i, i + n), n);
  }
  const ms = performance.now() - t1;
  console.log(`
== ${song.name} (${song.bpm} BPM): ${totalSec.toFixed(1)} s rendered in ${ms | 0} ms, ${(totalSec * 1000 / ms).toFixed(1)}x realtime`);
  writeWav(`title-${id}.wav`, L, R);
  spectrogram(`title-${id}.png`, L, R);

  let peak = 0, clipped = 0;
  for (let i = 0; i < total; i++) { const a = Math.max(Math.abs(L[i]), Math.abs(R[i])); if (a > peak) peak = a; if (a > 0.985) clipped++; }
  console.log(`peak ${peak.toFixed(3)}, samples near ceiling: ${clipped} (${((100 * clipped) / total).toFixed(3)}%)`);
  console.log('section             start  rmsL dB rmsR dB  bands[sub low mid high] dB');
  const secNames = Object.entries(song.sections).concat([['end', song.lengthRows]]);
  for (let i = 0; i < secNames.length - 1; i++) {
    const s = Math.floor(secNames[i][1] * secondsPerRow * RATE), e = Math.floor(secNames[i + 1][1] * secondsPerRow * RATE);
    console.log(secNames[i][0].padEnd(18), (s / RATE).toFixed(1).padStart(6), rmsDb(L, s, e).toFixed(1).padStart(8), rmsDb(R, s, e).toFixed(1).padStart(7), ' ', bandEnergy(L, s, e).join(' '));
  }
  // Stems: how loud is each channel on its own, in each section? This is the mix sheet.
  console.log('stem rms dB        ' + secNames.slice(0, -1).map(([n]) => n.padStart(8)).join(''));
  const stemNames = ['lead', 'chords', 'bass', 'drums'];
  for (let ch = 0; ch < 4; ch++) {
    const e = makeEngine(song);
    e.loadSong({ ...song, channels: song.channels.map((c, i) => (i === ch ? c : [])), loopRow: -1 });
    e.playSong(0);
    const sl = new Float32Array(total), sr = new Float32Array(total);
    for (let i = 0; i < total; i += BLOCK) { const n = Math.min(BLOCK, total - i); e.render(sl.subarray(i, i + n), sr.subarray(i, i + n), n); }
    const mono = sl.map((v, i) => v + sr[i]);
    const row = secNames.slice(0, -1).map(([, startRow], i) => {
      const s = Math.floor(startRow * secondsPerRow * RATE), en = Math.floor(secNames[i + 1][1] * secondsPerRow * RATE);
      return rmsDb(mono, s, en).toFixed(1).padStart(8);
    });
    console.log(stemNames[ch].padEnd(19) + row.join(''));
  }
}

const which = process.argv[2] || 'all';
if (which === 'all' || which === 'anthem') renderTheme('anthem', buildAnthemSong());
if (which === 'all' || which === 'baypatrol') renderTheme('baypatrol', buildTitleSong());

// The two stingers
for (const [name, song2] of [['jingle-success', buildSuccessJingle()], ['jingle-fail', buildFailJingle()]]) {
  const e2 = new PaulaEngine(RATE);
  e2.wet = 0.14;
  for (const smp of samples) e2.loadSample(smp.id, smp.data, smp.loopStart, smp.loopEnd);
  e2.loadSong(song2); e2.playSong(0);
  const secs2 = (song2.lengthRows * 60) / (song2.bpm * 4) + 2.5;
  const n2 = Math.ceil(secs2 * RATE);
  const l2 = new Float32Array(n2), r2 = new Float32Array(n2);
  for (let i = 0; i < n2; i += BLOCK) { const n = Math.min(BLOCK, n2 - i); e2.render(l2.subarray(i, i + n), r2.subarray(i, i + n), n); }
  writeWav(name + '.wav', l2, r2);
  let pk2 = 0; for (let i = 0; i < n2; i++) pk2 = Math.max(pk2, Math.abs(l2[i]), Math.abs(r2[i]));
  console.log(`${name}: ${secs2.toFixed(1)} s, peak ${pk2.toFixed(2)}`);
}

// SFX: one short file each, plus a contact sheet WAV that plays them in sequence.
const sfxOnly = samples.filter((s) => !/^(m_|a_|a8_)/.test(s.id));
const sheetLen = sfxOnly.reduce((a, s) => a + Math.ceil(Math.min(2.5, s.data.length / (s.rate || 11025)) * RATE) + RATE / 3, 0);
const sL = new Float32Array(sheetLen), sR = new Float32Array(sheetLen);
const sfxEngine = new PaulaEngine(RATE);
for (const s of sfxOnly) sfxEngine.loadSample(s.id, s.data, s.loopStart, s.loopEnd);
let pos = 0;
const table = [];
for (const s of sfxOnly) {
  const dur = Math.ceil(Math.min(2.5, s.data.length / (s.rate || 11025)) * RATE);
  sfxEngine.voicePlay(5, s.id, s.rate || 11025, 1);
  sfxEngine.render(sL.subarray(pos, pos + dur), sR.subarray(pos, pos + dur), dur);
  const pk = sL.subarray(pos, pos + dur).reduce((a, v) => Math.max(a, Math.abs(v)), 0);
  table.push(`${s.id.padEnd(11)} ${(s.data.length / (s.rate || 11025)).toFixed(2).padStart(5)} s  ${String(s.rate).padStart(5)} Hz  rms ${rmsDb(sL, pos, pos + dur).toFixed(1).padStart(6)} dB  peak ${pk.toFixed(2)}`);
  pos += dur;
  sfxEngine.voiceStop(5, false);
  pos += RATE / 3;
}
writeWav('sfx-contact-sheet.wav', sL, sR);
spectrogram('sfx-contact-sheet.png', sL, sR, 1400, 300);
console.log(table.join('\n'));
