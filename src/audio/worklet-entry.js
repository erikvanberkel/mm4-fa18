// Runs inside the AudioWorklet thread. Bundled to a string by tools/build.mjs.
import { PaulaEngine } from './paula-engine.js';

const COMMANDS = new Set([
  'voicePlay', 'voiceSet', 'voiceStop', 'setPan', 'setWet', 'setEcho', 'setLed', 'setGains',
  'loadSong', 'playSong', 'stopSong', 'silenceMusic', 'silenceAll',
]);

class PaulaProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.engine = new PaulaEngine(sampleRate, 16);
    this.engine.onRow = (row) => this.port.postMessage({ row });
    this.port.onmessage = (e) => {
      const m = e.data;
      if (m.c === 'load') {
        for (const s of m.samples) this.engine.loadSample(s.id, s.data, s.loopStart, s.loopEnd);
      } else if (COMMANDS.has(m.c)) {
        this.engine[m.c](...m.a);
      }
    };
  }
  process(_inputs, outputs) {
    const out = outputs[0];
    this.engine.render(out[0], out[1] || out[0], out[0].length);
    return true;
  }
}
registerProcessor('paula', PaulaProcessor);
