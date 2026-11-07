// "Bay Patrol": the title theme. An original 80s rock anthem written for four Amiga channels.
//
//   ch0 (L) lead   ch1 (R) chords   ch2 (R) bass   ch3 (L) drums
//
// Compact notation, 16 rows per bar. A bar that doesn't sum to 16 throws at compile time.
//   A4:4     note, 4 rows      .:8    rest
//   ~A4:4    bend up a semitone into the note      ~~A4:4   bend up a whole tone
//   ^A4:4    slide from the previous note (legato)
// Chord tokens:  D:8  Bm:8  (major/minor quality picks the sampled voicing), x:2 = muted chug.
import { MUSIC_RATE } from './samples-music.js';

const NOTE = { C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11 };
export const noteToMidi = (s) => {
  const m = /^([A-G][#b]?)(-?\d)$/.exec(s);
  if (!m) throw new Error('bad note ' + s);
  return NOTE[m[1]] + (Number(m[2]) + 1) * 12;
};

const BAR = 16;
const TICKS_PER_ROW = 8; // at 92 BPM this is a 49 Hz tick, about the Amiga's 50 Hz VBlank
const BPM = 92;

const vibLead = { delay: 7, fade: 12, speed: 0.62, depth: 0.2 };
const vibHorn = { delay: 12, fade: 16, speed: 0.45, depth: 0.14 };

const zone = (s, base, rate = MUSIC_RATE) => ({ s, base, rate });
const INSTRUMENTS = {
  gtr: { zones: [zone('m_gtr57', 57), zone('m_gtr69', 69), zone('m_gtr81', 81)], a: 0, d: 8, s: 0.82, r: 4, gain: 0.78, vib: vibLead },
  horn: { zones: [zone('m_horn57', 57), zone('m_horn69', 69), zone('m_horn81', 81)], a: 6, d: 6, s: 0.85, r: 12, gain: 0.72, gate: 3, vib: vibHorn },
  padMaj: { zones: [zone('m_padMaj', 50)], a: 40, d: 0, s: 1, r: 36, gain: 1.0, gate: 0 },
  padMin: { zones: [zone('m_padMin', 50)], a: 40, d: 0, s: 1, r: 36, gain: 1.0, gate: 0 },
  padSus: { zones: [zone('m_padSus', 50)], a: 60, d: 0, s: 1, r: 36, gain: 1.0, gate: 0 },
  softMaj: { zones: [zone('m_padMaj', 50)], a: 14, d: 0, s: 1, r: 24, gain: 0.9, gate: 0 },
  softMin: { zones: [zone('m_padMin', 50)], a: 14, d: 0, s: 1, r: 24, gain: 0.9, gate: 0 },
  bigMaj: { zones: [zone('m_bigMaj', 50)], a: 0, d: 30, s: 0.85, r: 5, gain: 1.05, gate: 1 },
  bigMin: { zones: [zone('m_bigMin', 50)], a: 0, d: 30, s: 0.85, r: 5, gain: 1.05, gate: 1 },
  mute: { zones: [zone('m_mute', 50)], a: 0, d: 0, s: 1, r: 2, gain: 0.95, gate: 0 },
  arp: { zones: [zone('m_pluck', 69)], a: 0, d: 7, s: 0.62, r: 2, gain: 0.85, gate: 1, arpTicks: 2 },
  bass: { zones: [zone('m_bass', 38, 8363)], a: 0, d: 10, s: 0.78, r: 2, gain: 0.46, gate: 1 },
  softBass: { zones: [zone('m_bass', 38, 8363)], a: 3, d: 16, s: 0.7, r: 12, gain: 0.42, gate: 2 },
  K: { zones: [zone('m_kh', 60)], a: 0, d: 0, s: 1, r: 0, gain: 0.92, gate: -40 },
  k: { zones: [zone('m_k', 60)], a: 0, d: 0, s: 1, r: 0, gain: 0.72, gate: -40 },
  S: { zones: [zone('m_sh', 60)], a: 0, d: 0, s: 1, r: 0, gain: 0.82, gate: -40 },
  s: { zones: [zone('m_s', 60)], a: 0, d: 0, s: 1, r: 0, gain: 0.62, gate: -40 },
  H: { zones: [zone('m_h', 60)], a: 0, d: 0, s: 1, r: 0, gain: 0.34, gate: -40 },
  O: { zones: [zone('m_o', 60)], a: 0, d: 0, s: 1, r: 0, gain: 0.34, gate: -40 },
  C: { zones: [zone('m_kc', 60)], a: 0, d: 0, s: 1, r: 0, gain: 0.82, gate: -400 },
  c: { zones: [zone('m_c', 60)], a: 0, d: 0, s: 1, r: 0, gain: 0.55, gate: -400 },
  B: { zones: [zone('m_kb', 60)], a: 0, d: 0, s: 1, r: 0, gain: 0.95, gate: -400 },
  T: { zones: [zone('m_t', 62)], a: 0, d: 0, s: 1, r: 0, gain: 0.78, gate: -30 },
};

function parseMelody(text, channel, startBar, inst, velocity, log) {
  const bars = text.split('|').map((b) => b.trim()).filter(Boolean);
  let row = startBar * BAR;
  bars.forEach((bar, bi) => {
    let sum = 0;
    for (const tok of bar.split(/\s+/)) {
      const m = /^(~~|~|\^)?([A-G][#b]?-?\d|\.):(\d+)$/.exec(tok);
      if (!m) throw new Error('bad token ' + tok);
      const len = Number(m[3]);
      if (m[2] !== '.') {
        const ev = { r: row, len, n: noteToMidi(m[2]), i: inst, v: velocity };
        if (m[1] === '~') { ev.bend = -1; ev.bendTicks = 7; }
        if (m[1] === '~~') { ev.bend = -2; ev.bendTicks = 10; }
        if (m[1] === '^') { ev.tie = true; ev.slide = 4; }
        channel.push(ev);
        if (log) log.push(ev);
      } else {
        channel.push({ r: row, rest: true, len });
      }
      row += len;
      sum += len;
    }
    if (sum !== BAR) throw new Error(`bar ${startBar + bi} of "${text.slice(0, 24)}..." has ${sum} rows`);
  });
  return row;
}

const CHORD_ROOT = { C: 48, 'C#': 49, D: 50, E: 52, F: 41, 'F#': 42, G: 43, 'G#': 44, A: 45, Bb: 46, B: 47 };
const parseChord = (name) => {
  const m = /^([A-G][#b]?)(m|sus)?$/.exec(name);
  if (!m) throw new Error('bad chord ' + name);
  return { root: CHORD_ROOT[m[1]], quality: m[2] || 'maj' };
};

// Records the harmony so tests can check the melody against it.
function chordTrack(text, channel, startBar, style, harmony) {
  const bars = text.split('|').map((b) => b.trim()).filter(Boolean);
  let row = startBar * BAR;
  bars.forEach((bar) => {
    let sum = 0;
    let last = null;
    for (const tok of bar.split(/\s+/)) {
      const [name, lenS] = tok.split(':');
      const len = Number(lenS);
      if (name === '.') { channel.push({ r: row, rest: true, len }); row += len; sum += len; continue; }
      if (name === 'x') {
        channel.push({ r: row, len, n: last.root, i: 'mute', v: 1 });
        harmony[harmony.length - 1].len += len; // a chug keeps sounding the chord it follows
      } else {
        const c = parseChord(name);
        last = c;
        const n = c.root;
        harmony.push({ r: row, len, root: n % 12, quality: c.quality });
        const pick = (() => {
          if (style === 'big') return c.quality === 'm' ? 'bigMin' : 'bigMaj';
          if (style === 'pad') return c.quality === 'm' ? 'padMin' : c.quality === 'sus' ? 'padSus' : 'padMaj';
          if (style === 'soft') return c.quality === 'm' ? 'softMin' : c.quality === 'sus' ? 'padSus' : 'softMaj';
          throw new Error(style);
        })();
        channel.push({ r: row, len, n, i: pick, v: 1 });
      }
      row += len;
      sum += len;
    }
    if (sum !== BAR) throw new Error(`chord bar "${bar}" has ${sum} rows`);
  });
}

// 16-char drum strings. K kick+hat, k kick, S snare+hat, s snare, H hat, O open hat,
// C kick+crash, c crash, B boom, 1/2/3/4 toms high to low, . nothing.
const TOMS = { 1: 67, 2: 62, 3: 57, 4: 52 };
function drumTrack(lines, channel, startBar, vel = 1) {
  lines.forEach((line, bi) => {
    if (line.length !== BAR) throw new Error('drum bar length: ' + line);
    for (let i = 0; i < BAR; i++) {
      const ch = line[i];
      if (ch === '.') continue;
      const r = (startBar + bi) * BAR + i;
      if (TOMS[ch]) channel.push({ r, len: 4, n: TOMS[ch], i: 'T', v: vel });
      else channel.push({ r, len: 4, n: 60, i: ch, v: vel });
    }
  });
}

// Per-bar roots with a repeating rhythm.
function bassTrack(roots, pattern, channel, startBar, inst = 'bass', vel = 1) {
  const tokens = pattern.trim().split(/\s+/);
  roots.forEach((root, bi) => {
    let r = (startBar + bi) * BAR;
    const halves = Array.isArray(root) ? root : [root];
    let sum = 0;
    for (const t of tokens) {
      const [offset, lenS] = t.split(':');
      const len = Number(lenS);
      const name = halves[Math.min(halves.length - 1, Math.floor((sum / BAR) * halves.length))];
      if (offset !== '.') channel.push({ r, len, n: noteToMidi(name) + Number(offset), i: inst, v: vel });
      r += len;
      sum += len;
    }
    if (sum !== BAR) throw new Error('bass pattern sums to ' + sum);
  });
}

export function buildTitleSong() {
  const lead = [], chords = [], bass = [], drums = [];
  const harmony = [];
  const melody = [];
  const L = (bar, text, inst, vel = 1) => parseMelody(text, lead, bar, inst, vel, melody);

  // --- INTRO, bars 0-3: distant call over rising pads. A jet passes overhead at the start.
  chordTrack('Dsus:16 | Bb:16 | C:16 | D:16', chords, 0, 'pad', harmony);
  bassTrack(['D2', 'Bb1', 'C2', 'D2'], '0:16', bass, 0, 'softBass');
  drumTrack(['B...............', '................', '............3...', '4...4...3.3.2211'], drums, 0, 0.9);
  L(0, '.:4 A4:4 D5:8 | .:4 F5:4 D5:8 | .:4 G5:4 E5:8 | .:4 A5:4 D6:8', 'horn', 0.82);

  // --- A, bars 4-11: the theme, quietly.
  chordTrack('D:16 | Bm:16 | G:16 | A:16 | D:16 | Bm:16 | Em:8 A:8 | D:16', chords, 4, 'soft', harmony);
  bassTrack(['D2', 'B1', 'G1', 'A1', 'D2', 'B1', ['E2', 'A1'], 'D2'], '0:12 0:4', bass, 4, 'softBass');
  drumTrack([
    'C.......k.k.....', 'k.......k.k.....', 'k.......k.k.....', 'k.......k.k...H.',
    'k.......s.k.....', 'k.......s.k.....', 'k.......s.k.....', 'k.......s...3322',
  ], drums, 4, 0.85);
  L(4, `A4:3 D5:3 F#5:10 | E5:2 F#5:2 D5:4 B4:8 | G4:3 B4:3 D5:6 E5:2 D5:2 | C#5:4 A4:12 |
        A4:3 D5:3 F#5:6 G5:2 A5:2 | B5:8 A5:2 F#5:6 | G5:3 F#5:1 E5:4 E5:2 F#5:2 C#5:4 | D5:16`, 'horn', 0.95);

  // --- B, bars 12-19: full band, lead guitar.
  const chug = (a) => `${a}:4 x:2 x:2 ${a}:4 x:2 x:2`;
  const chugB = (a, b) => `${a}:4 x:2 x:2 ${b}:4 x:2 x:2`;
  const secB = (k) => [chug(k[0]), chug(k[1]), chug(k[2]), chug(k[3]), chug(k[4]), chug(k[5]), chugB(k[6], k[7]), `${k[8]}:16`].join(' | ');
  chordTrack(secB(['D', 'Bm', 'G', 'A', 'D', 'Bm', 'Em', 'A', 'D']), chords, 12, 'big', harmony);
  const driveBass = '0:2 0:2 0:2 0:2 0:2 0:2 0:2 12:2';
  bassTrack(['D2', 'B1', 'G1', 'A1', 'D2', 'B1', ['E2', 'A1'], 'D2'], driveBass, bass, 12);
  const rock = 'K.H.S.H.K.K.S.H.';
  const rockFill = 'K.H.S.H.K.S.2233';
  drumTrack(['C.H.S.H.K.K.S.H.', rock, rock, rockFill, 'C.H.S.H.K.K.S.H.', rock, rock, 'K.H.S.H.S.3.3322'], drums, 12);
  const themeB = (t) => `~${t[0]}:6 ${t[1]}:2 ${t[0]}:2 ${t[2]}:2 ${t[0]}:4 | ${t[1]}:4 ${t[3]}:4 ~${t[4]}:8 | ${t[3]}:2 ${t[5]}:4 ${t[0]}:2 ${t[2]}:4 ${t[0]}:2 ${t[5]}:2 | ~${t[6]}:4 ${t[0]}:4 ${t[7]}:8 | ~${t[8]}:8 ${t[7]}:2 ${t[8]}:2 ${t[0]}:4 | ${t[2]}:4 ${t[0]}:2 ${t[1]}:2 ${t[3]}:8 | ${t[5]}:2 ${t[1]}:2 ${t[6]}:4 ${t[7]}:2 ${t[2]}:2 ${t[0]}:4 | ~${t[8]}:12 ${t[0]}:2 ${t[1]}:2`;
  //                          0     1     2     3     4     5     6     7     8
  L(12, themeB(['A5', 'F#5', 'B5', 'D5', 'B4', 'G5', 'E5', 'C#6', 'D6']), 'gtr');

  // --- C, bars 20-27: the bridge. Tick-rate arpeggios in the chord channel, a very Amiga sound.
  const arp = (root, q, bar) => {
    const intervals = q === 'm' ? [0, 3, 7, 12] : [0, 4, 7, 12];
    for (let i = 0; i < 16; i += 2) chords.push({ r: bar * BAR + i, len: 2, n: root, i: 'arp', v: i % 4 === 0 ? 1 : 0.75, arp: intervals });
    harmony.push({ r: bar * BAR, len: BAR, root: root % 12, quality: q === 'm' ? 'm' : 'maj' });
  };
  [[59, 'm'], [55, ''], [62, ''], [57, ''], [59, 'm'], [55, ''], [60, ''], [62, '']].forEach(([r, q], i) => arp(r, q, 20 + i));
  bassTrack(['B1', 'G1', 'D2', 'A1', 'B1', 'G1', 'C2', 'D2'], '0:3 0:3 0:2 12:2 0:3 0:3', bass, 20);
  drumTrack([
    'C.....H.S.....H.', 'K.....H.S.....H.', 'K.....H.S.....H.', 'K.....H.S.K.2.3.',
    'C.H.H.H.S.H.K.H.', 'K.H.H.H.S.H.K.H.', 'K.H.K.H.S.H.K.H.', 'K.S.K.S.1.1.2.2.',
  ], drums, 20);
  L(20, `F#5:12 E5:2 D5:2 | D5:4 B4:4 G5:8 | F#5:12 A5:4 | ~E5:6 C#5:2 A5:8 |
         F#5:6 G5:2 A5:8 | B5:6 A5:2 G5:8 | E5:4 G5:4 C6:8 | F#5:4 A5:4 D6:8`, 'gtr');

  // --- D, bars 28-35: the last chorus, up a whole step.
  chordTrack(secB(['E', 'C#m', 'A', 'B', 'E', 'C#m', 'F#m', 'B', 'E']), chords, 28, 'big', harmony);
  bassTrack(['E2', 'C#2', 'A1', 'B1', 'E2', 'C#2', ['F#2', 'B1'], 'E2'], driveBass, bass, 28);
  drumTrack(['C.H.S.H.K.K.S.H.', rock, rock, rockFill, 'C.H.S.H.K.K.S.H.', rock, rock, 'K.H.S.H.1.1.2.3.'], drums, 28);
  L(28, themeB(['B5', 'G#5', 'C#6', 'E5', 'C#5', 'A5', 'F#5', 'D#6', 'E6']), 'gtr');

  // --- OUTRO, bars 36-39: bVI, bVII, I. Then the chord drops back to D for the loop.
  chordTrack('C:8 D:8 | E:16 | E:16 | Dsus:16', chords, 36, 'big', harmony);
  chords[chords.length - 1].i = 'padSus';
  bassTrack([['C2', 'D2'], 'E2', 'E2'], '0:2 0:2 0:2 0:2 0:2 0:2 0:2 0:2', bass, 36);
  bass.push({ r: 39 * BAR, len: 16, n: noteToMidi('D2'), i: 'softBass', v: 1 });
  drumTrack(['K.S.K.S.1.2.3.4.', 'C...............', 'C...........1234', 'B...............'], drums, 36);
  L(36, 'G5:4 E5:4 A5:4 F#5:4 | ~B5:8 E6:8 | E6:16 | .:16', 'gtr');

  const lengthRows = 40 * BAR;
  return {
    name: 'BAY PATROL',
    bpm: BPM,
    ticksPerRow: TICKS_PER_ROW,
    lengthRows,
    loopRow: 0,
    channels: [lead, chords, bass, drums],
    instruments: INSTRUMENTS,
    // Metadata for the title screen's visual sync and for the music tests.
    harmony,
    melody,
    sections: { intro: 0, theme: 4 * BAR, band: 12 * BAR, bridge: 20 * BAR, finale: 28 * BAR, outro: 36 * BAR },
  };
}

export { INSTRUMENTS, parseMelody, chordTrack, drumTrack, bassTrack, BAR };
