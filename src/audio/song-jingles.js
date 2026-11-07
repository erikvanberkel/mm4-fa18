// Two short stingers written for the same four-channel setup: a bright brass fanfare for a
// successful mission and a slow descending dirge for a lost one.
import { INSTRUMENTS, parseMelody, chordTrack, drumTrack, bassTrack, BAR } from './song-title.js';

function shell(name, bpm, bars) {
  return {
    name, bpm, ticksPerRow: 8, lengthRows: bars * BAR, loopRow: -1,
    channels: [[], [], [], []], instruments: INSTRUMENTS, harmony: [], melody: [], sections: { start: 0 },
  };
}

export function buildSuccessJingle() {
  const s = shell('MISSION COMPLETE', 112, 3);
  const [lead, chords, bass, drums] = s.channels;
  parseMelody('A4:2 D5:2 F#5:2 A5:2 D6:8 | B5:4 A5:4 G5:4 F#5:4 | D6:16', lead, 0, 'gtr', 1, s.melody);
  chordTrack('D:16 | G:8 A:8 | D:16', chords, 0, 'big', s.harmony);
  bassTrack(['D2', ['G1', 'A1'], 'D2'], '0:2 0:2 0:2 0:2 0:2 0:2 0:2 12:2', bass, 0);
  drumTrack(['C.H.S.H.K.K.S.H.', 'K.H.S.H.K.S.2233', 'C...............'], drums, 0);
  return s;
}

export function buildFailJingle() {
  const s = shell('MISSION FAILED', 66, 2);
  const [lead, chords, bass, drums] = s.channels;
  parseMelody('A4:8 G4:4 F4:4 | E4:6 F4:2 D4:8', lead, 0, 'horn', 0.95, s.melody);
  chordTrack('Dm:16 | Bb:6 A:10', chords, 0, 'pad', s.harmony);
  bassTrack(['D2', 'D2'], '0:16', bass, 0, 'softBass');
  drumTrack(['B...............', '4...............'], drums, 0, 0.7);
  return s;
}
