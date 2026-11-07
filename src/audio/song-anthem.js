// "Anthem": the title theme. An original piece written in the style the original game's intro is
// documented to have: atmospheric, a deep FM bell-synth hook, a drum-machine groove, and a heroic
// rock lead guitar that rings into the room, with a lift in the final chorus. The melody is new.
//
//   ch0 (L) lead: bells, then guitar   ch1 (R) pads   ch2 (R) bass   ch3 (L) drum machine
//
// 104 BPM, 16 rows per bar, 40 bars:
//   intro  bars  0-3   drum machine alone, a swell, then the bell and the pad arrive
//   A      bars  4-11  E minor: the bell tells the hook over a soft pulse
//   B      bars 12-19  E minor: the guitar states the theme, full band
//   C      bars 20-27  G major: the soaring chorus, ending on E to turn the key
//   D      bars 28-35  A major: the chorus a step higher
//   outro  bars 36-39  one long chord, one last bell ringing out
import { MUSIC_RATE } from './samples-music.js';
import { INSTRUMENTS, parseMelody, chordTrack, drumTrack, bassTrack, BAR } from './song-title.js';

export const ANTHEM_BPM = 104;
const TICKS_PER_ROW = 8;
const z = (s, base) => ({ s, base, rate: MUSIC_RATE });
const drum = (sample, gain, extra = {}) => ({ zones: [z(sample, 60)], a: 0, d: 0, s: 1, r: 0, gain, gate: -4000, ...extra });

// A channel plays one note at a time, and starting the next note cuts the last one dead. So the pads and the
// bass fade out completely in the few ticks before the next note, and a chord change never clicks.
const declick = (inst, ticks) => ({ ...inst, gate: ticks, r: ticks });
const ANTHEM_INSTRUMENTS = {
  padMaj: declick(INSTRUMENTS.padMaj, 4), padMin: declick(INSTRUMENTS.padMin, 4), padSus: declick(INSTRUMENTS.padSus, 4),
  softMaj: declick(INSTRUMENTS.softMaj, 4), softMin: declick(INSTRUMENTS.softMin, 4),
  bass: declick(INSTRUMENTS.bass, 2), softBass: declick(INSTRUMENTS.softBass, 3),
  // the bell rings for the whole note, then fades in about 60 ms so that the next strike never clicks
  bell: { zones: [z('a_bell40', 40), z('a_bell52', 52), z('a_bell64', 64), z('a_bell76', 76)], a: 0, d: 0, s: 1, r: 3, gain: 0.72, gate: 3 },
  lead: { zones: [z('a_gtr57', 57), z('a_gtr69', 69), z('a_gtr81', 81)], a: 0, d: 10, s: 0.9, r: 8, gain: 0.6, gate: 2, vib: { delay: 9, fade: 16, speed: 0.55, depth: 0.24 } },
  swell: drum('a8_sw', 0.62),
  // the drum machine
  K: drum('a8_kc', 0.95),            // kick with a crash on top
  D: drum('a8_kh', 0.85),            // kick + closed hat
  k: drum('a8_k', 0.7),              // kick alone, soft
  N: drum('a8_sch', 0.82),           // snare + clap + closed hat
  S: drum('a8_sc', 0.85),            // snare + clap
  s: drum('a8_s', 0.55),             // snare alone, soft
  H: drum('a8_h', 0.34),
  O: drum('a8_o', 0.36),
  W: drum('a8_cow', 0.42),
  C: drum('a8_kc', 0.95),
  T: { zones: [z('a8_t', 62)], a: 0, d: 0, s: 1, r: 0, gain: 0.8, gate: -4000 },
};

export function buildAnthemSong() {
  const lead = [], chords = [], bass = [], drums = [], harmony = [], melody = [];
  const L = (text, bar, inst, vel = 1) => parseMelody(text, lead, bar, inst, vel, melody);

  // ---- intro: the drum machine alone, then a rising swell, the bell, and the pad ----
  harmony.push({ r: 0, len: 3 * BAR, root: 4, quality: 'm' });
  drumTrack(['D.H.N.H.H.D.N.H.', 'D.H.N.H.H.D.N.O.', 'D.H.N.H.H.D.N.H.', 'D.H.N.H.D.1.2.3.'], drums, 0, 0.95);
  chords.push({ r: 2 * BAR, len: BAR, n: 60, i: 'swell', v: 1 }); // bars 0-1 are silent, so this is still in row order
  chordTrack('Em:16', chords, 3, 'pad', harmony);
  bassTrack(['E2', 'E2'], '0:4 0:4 0:4 0:4', bass, 2, 'softBass');
  L('B3:8 E4:8 | G4:12 F#4:4', 2, 'bell', 0.95);

  // ---- A: the bell tells the hook over a soft pulse ----
  chordTrack('Em:16 | Em:16 | C:16 | D:16 | Em:16 | Em:16 | C:16 | Bm:16', chords, 4, 'soft', harmony);
  bassTrack(['E2', 'E2', 'C2', 'D2', 'E2', 'E2', 'C2', 'B1'], '0:4 0:4 0:4 0:4', bass, 4, 'softBass');
  drumTrack([
    'D.H.s.H.H.k.s.W.', 'D.H.s.H.H.k.s.H.', 'D.H.s.H.H.k.s.W.', 'D.H.s.H.k.1.2.3.',
    'D.H.s.H.H.k.s.W.', 'D.H.s.H.H.k.s.H.', 'D.H.s.H.H.k.s.W.', 'D.H.s.H.D.1.2.3.',
  ], drums, 4, 0.9);
  L('E4:8 B4:8 | G4:8 F#4:4 E4:4 | E4:8 G4:8 | F#4:8 A4:8 | B4:16 | E5:12 D5:4 | C5:8 G4:8 | B4:8 A4:4 F#4:4', 4, 'bell', 0.95);

  // ---- B: the guitar states the theme, full band ----
  chordTrack('Em:16 | Em:16 | C:16 | D:16 | Em:16 | Em:16 | C:16 | D:16', chords, 12, 'pad', harmony);
  bassTrack(['E2', 'E2', 'C2', 'D2', 'E2', 'E2', 'C2', 'D2'], '0:2 0:2 0:2 0:2 0:2 0:2 12:2 0:2', bass, 12, 'bass');
  drumTrack([
    'C.H.N.H.H.D.N.H.', 'D.H.N.H.H.D.N.O.', 'D.H.N.H.H.D.N.H.', 'D.H.N.H.D.1.2.3.',
    'D.H.N.H.H.D.N.H.', 'D.H.N.H.H.D.N.O.', 'D.H.N.H.H.D.N.H.', 'D.H.N.H.D.1.2.3.',
  ], drums, 12, 1);
  L('~B4:12 A4:2 B4:2 | ~E5:8 D5:4 B4:4 | C5:12 B4:2 C5:2 | D5:4 C5:2 B4:2 A4:8 | ~B4:12 A4:2 B4:2 | ~E5:8 G5:4 F#5:4 | G5:12 E5:4 | F#5:8 D5:4 B4:4', 12, 'lead');

  // ---- C: the chorus in G major, turning the key on its last bar ----
  chordTrack('G:16 | D:16 | Em:16 | C:16 | G:16 | D:16 | C:16 | E:16', chords, 20, 'pad', harmony);
  bassTrack(['G2', 'D2', 'E2', 'C2', 'G2', 'D2', 'C2', 'E2'], '0:2 0:2 12:2 0:2 0:2 0:2 12:2 0:2', bass, 20, 'bass');
  drumTrack([
    'C.HHN.HHH.DHN.HO', 'D.HHN.HHH.DHN.HO', 'D.HHN.HHH.DHN.HO', 'D.HHN.HHD.1.2.3.',
    'C.HHN.HHH.DHN.HO', 'D.HHN.HHH.DHN.HO', 'D.HHN.HHH.DHN.HO', 'N.N.N.N.NNNNNNNN',
  ], drums, 20, 1);
  L('D5:4 G5:4 ~B5:8 | A5:8 F#5:4 D5:4 | G5:4 E5:4 ~B5:8 | G5:8 E5:4 C5:4 | D5:4 G5:4 ~B5:8 | A5:4 B5:4 D6:8 | C6:8 B5:4 G5:4 | ~B5:12 G#5:4', 20, 'lead');

  // ---- D: the chorus a step higher, in A major ----
  chordTrack('A:16 | E:16 | F#m:16 | D:16 | A:16 | E:16 | D:16 | E:16', chords, 28, 'pad', harmony);
  bassTrack(['A1', 'E2', 'F#2', 'D2', 'A1', 'E2', 'D2', 'E2'], '0:2 0:2 12:2 0:2 0:2 0:2 12:2 0:2', bass, 28, 'bass');
  drumTrack([
    'C.HHN.HHH.DHN.HO', 'D.HHN.HHH.DHN.HO', 'D.HHN.HHH.DHN.HO', 'D.HHN.HHD.1.2.3.',
    'C.HHN.HHH.DHN.HO', 'D.HHN.HHH.DHN.HO', 'D.HHN.HHH.DHN.HO', 'N.N.N.N.NNNNNNNN',
  ], drums, 28, 1);
  L('E5:4 A5:4 ~C#6:8 | B5:8 G#5:4 E5:4 | A5:4 F#5:4 ~C#6:8 | A5:8 F#5:4 D5:4 | E5:4 A5:4 ~C#6:8 | B5:4 C#6:4 E6:8 | D6:8 C#6:4 A5:4 | B5:8 E6:8', 28, 'lead');

  // ---- outro: one long chord, and the bell rings out into the echo ----
  chordTrack('Asus:16 | A:16 | A:16 | A:16', chords, 36, 'pad', harmony);
  bassTrack(['A1', 'A1', 'A1', 'A1'], '0:16', bass, 36, 'softBass');
  drumTrack(['C.......H.......', 'D.H.N.H.........', 'D...............', 'k...............'], drums, 36, 0.9);
  L('~A5:16 | E6:8 C#6:8 | A5:16', 36, 'lead');
  L('A4:16', 39, 'bell', 0.95);

  return {
    name: 'ANTHEM',
    bpm: ANTHEM_BPM,
    ticksPerRow: TICKS_PER_ROW,
    lengthRows: 40 * BAR,
    loopRow: 0,
    channels: [lead, chords, bass, drums],
    instruments: ANTHEM_INSTRUMENTS,
    harmony,
    melody,
    sections: { intro: 0, A: 4 * BAR, B: 12 * BAR, C: 20 * BAR, D: 28 * BAR, outro: 36 * BAR },
    // the room the lead rings into: a dotted-eighth echo that ping-pongs, and a bigger reverb
    echo: { time: (60 / ANTHEM_BPM) * 0.75, feedback: 0.42, mix: 0.48 },
    wet: 0.22,
  };
}
