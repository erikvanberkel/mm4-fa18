// Owns the AudioContext. Prefers an AudioWorklet (glitch-free, off the main thread) and falls
// back to a ScriptProcessor running the same PaulaEngine when worklets aren't available.
import { PaulaEngine } from './paula-engine.js';

export class AudioBackend {
  constructor() {
    this.ctx = null;
    this.node = null;
    this.engine = null;
    this.mode = 'none';
    this.onRow = null;
    this.ready = false;
    this.pending = [];
  }

  // workletSource: JS text of the bundled worklet. samples: [{id,data,loopStart,loopEnd}]
  async start(workletSource, samples) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) { this.mode = 'unsupported'; return false; }
    if (!this.ctx) this.ctx = new Ctx({ latencyHint: 'interactive' });
    if (this.ctx.state === 'suspended') await this.ctx.resume().catch(() => {});
    try {
      if (!this.ctx.audioWorklet || !workletSource) throw new Error('no worklet');
      const url = URL.createObjectURL(new Blob([workletSource], { type: 'application/javascript' }));
      await this.ctx.audioWorklet.addModule(url);
      URL.revokeObjectURL(url);
      this.node = new AudioWorkletNode(this.ctx, 'paula', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2] });
      this.node.port.onmessage = (e) => { if (e.data && e.data.row !== undefined && this.onRow) this.onRow(e.data.row); };
      this.node.connect(this.ctx.destination);
      this.mode = 'worklet';
      const list = samples.map((s) => ({ id: s.id, data: s.data.slice(), loopStart: s.loopStart, loopEnd: s.loopEnd }));
      this.node.port.postMessage({ c: 'load', samples: list }, list.map((s) => s.data.buffer));
    } catch (err) {
      console.warn('AudioWorklet unavailable, using ScriptProcessor:', err && err.message);
      this.engine = new PaulaEngine(this.ctx.sampleRate, 16);
      for (const s of samples) this.engine.loadSample(s.id, s.data, s.loopStart, s.loopEnd);
      this.engine.onRow = (row) => { if (this.onRow) this.onRow(row); };
      const sp = this.ctx.createScriptProcessor(2048, 0, 2);
      sp.onaudioprocess = (e) => {
        const L = e.outputBuffer.getChannelData(0), R = e.outputBuffer.getChannelData(1);
        this.engine.render(L, R, L.length);
      };
      sp.connect(this.ctx.destination);
      this.node = sp;
      this.mode = 'scriptprocessor';
    }
    this.ready = true;
    for (const [c, a] of this.pending) this.cmd(c, ...a);
    this.pending = [];
    return true;
  }

  // iOS only lets an AudioContext start from inside a touch handler, but the sound is built a moment
  // later. So the first touch creates and resumes the context, and start() picks it up.
  prime() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {}); return; }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    try {
      this.ctx = new Ctx({ latencyHint: 'interactive' });
      this.ctx.resume().catch(() => {});
    } catch (err) { this.ctx = null; }
  }

  cmd(c, ...a) {
    if (!this.ready) { this.pending.push([c, a]); return; }
    if (this.mode === 'worklet') this.node.port.postMessage({ c, a });
    else if (this.engine) this.engine[c](...a);
  }

  get sampleRate() { return this.ctx ? this.ctx.sampleRate : 48000; }
  resume() { if (this.ctx && this.ctx.state !== 'running') return this.ctx.resume(); return Promise.resolve(); }
  suspend() { if (this.ctx && this.ctx.state === 'running') return this.ctx.suspend(); return Promise.resolve(); }
}
