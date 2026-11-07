// A software model of the Amiga's Paula sound chip plus a tracker-style music player.
//
// The class is deliberately self-contained (no imports, no outer references): the browser
// build stringifies it into an AudioWorklet, and tools/render-audio.mjs runs the very same
// code offline in Node so the audio can be measured and exported to WAV.
//
// What it models:
//  - 8-bit signed sample playback at an integer hardware period (pitch quantisation included)
//  - zero-order-hold output, area-sampled to the output rate (Paula's DAC is a stairstep)
//  - the A500 output stage: fixed 1-pole RC low-pass at ~4.5 kHz, optional 2-pole "LED" filter
//  - hard-panned LRRL music channels with a configurable separation
// What it adds beyond the hardware (all optional): extra SFX voices and a small room reverb.

export class PaulaEngine {
  constructor(outRate = 48000, voiceCount = 14) {
    this.rate = outRate;
    this.clock = 3546895; // PAL colour clock
    this.minPeriod = 124;
    this.samples = new Map();
    this.voices = [];
    for (let i = 0; i < voiceCount; i++) {
      this.voices.push({
        data: null, pos: 0, end: 0, loopStart: -1, loopEnd: 0, step: 0, on: false,
        vol: 0, volTarget: 0, panL: 1, panR: 1, lp: 1, lpz: 0, stopAtFade: false,
      });
    }
    // Music occupies voices 0-3, exactly like the four hardware channels.
    this.separation = 0.3;
    this.setPan(0, 1, this.separation);
    this.setPan(1, this.separation, 1);
    this.setPan(2, this.separation, 1);
    this.setPan(3, 1, this.separation);

    this.master = 1.75;
    this.musicGain = 1;
    this.sfxGain = 1;
    this.fade = 1;
    this.fadeStep = 0;

    // Output filter state
    this.setFilterCutoffs(4500, 3300);
    this.led = false;
    this.rcL = 0; this.rcR = 0;
    this.led1L = 0; this.led2L = 0; this.led1R = 0; this.led2R = 0;
    this.dcL = 0; this.dcR = 0; this.dcPrevL = 0; this.dcPrevR = 0;

    // Reverb: four cross-coupled damped comb lines
    this.wet = 0;
    const scale = outRate / 44100;
    this.combs = [1557, 1617, 1491, 1422].map((n, i) => ({
      buf: new Float32Array(Math.floor(n * scale) + i * 3),
      pos: 0, store: 0,
    }));
    this.apL = { buf: new Float32Array(Math.floor(556 * scale)), pos: 0 };
    this.apR = { buf: new Float32Array(Math.floor(579 * scale)), pos: 0 };
    this.reverbFeedback = 0.8;

    // A tempo-sized stereo echo on voice 0 only (the lead). It is what makes a lone bell or guitar
    // note ring on into the room, the signature of 80s anthem leads. Off by default.
    this.echoMix = 0;
    this.echoFb = 0;
    this.echoLen = 1;
    this.echoPos = 0;
    this.echoBuf = new Float32Array(8);
    this.reverbDamp = 0.32;

    // Sequencer
    this.song = null;
    this.playing = false;
    this.tickSamples = 0;
    this.tickAcc = 0;
    this.samplesLeftInTick = 0;
    this.tickCount = 0;
    this.row = 0;
    this.rowTick = 0;
    this.ch = [];
    for (let i = 0; i < 4; i++) {
      this.ch.push({
        ptr: 0, inst: null, note: 0, vel: 1, active: false, ticks: 0, endTick: 0, env: 0,
        released: false, bend: 0, bendStep: 0, vibPhase: 0, arp: null, slideTo: null, slideStep: 0, zone: null, gain: 1, vib: null,
      });
    }
    this.onRow = null; // offline tools hook this
  }

  setFilterCutoffs(rc, led) {
    this.rcA = 1 - Math.exp((-2 * Math.PI * rc) / this.rate);
    // 2-pole Butterworth-ish via two cascaded one-poles with feedback-free coefficients
    this.ledA = 1 - Math.exp((-2 * Math.PI * led) / this.rate);
  }

  setPan(v, l, r) { this.voices[v].panL = l; this.voices[v].panR = r; }
  setWet(w) { this.wet = w; }
  // time in seconds between repeats, feedback 0..0.9, mix 0..1. mix 0 switches the echo off.
  setEcho(time, feedback, mix) {
    const len = Math.max(1, Math.floor(time * this.rate));
    if (len !== this.echoLen || this.echoBuf.length < len * 2 + 8) {
      this.echoLen = len;
      this.echoBuf = new Float32Array(len * 2 + 8);
      this.echoPos = 0;
    }
    this.echoFb = Math.min(0.9, Math.max(0, feedback));
    this.echoMix = Math.max(0, mix);
    if (this.echoMix === 0) this.echoBuf.fill(0);
  }
  setLed(on) { this.led = !!on; }
  setGains(music, sfx, master) {
    if (music != null) this.musicGain = music;
    if (sfx != null) this.sfxGain = sfx;
    if (master != null) this.master = master;
  }
  silenceAll() { for (const v of this.voices) v.on = false; this.silenceMusic(); }

  loadSample(id, data, loopStart = -1, loopEnd = 0) {
    this.samples.set(id, { data, loopStart, loopEnd: loopEnd || data.length });
  }

  periodFor(rateHz) {
    const p = Math.round(this.clock / Math.max(1, rateHz));
    return p < this.minPeriod ? this.minPeriod : p;
  }

  // --- Voice control (used directly for SFX) ---
  voicePlay(v, sampleId, rateHz, vol = 1, opts) {
    const s = this.samples.get(sampleId);
    if (!s) return;
    const vc = this.voices[v];
    vc.data = s.data;
    vc.pos = opts && opts.offset ? opts.offset : 0;
    vc.end = s.data.length;
    const noLoop = opts && opts.noLoop;
    vc.loopStart = noLoop ? -1 : s.loopStart;
    vc.loopEnd = s.loopEnd;
    vc.step = this.clock / this.periodFor(rateHz) / this.rate;
    vc.on = true;
    vc.volTarget = vol;
    vc.vol = opts && opts.ramp ? 0 : vol; // ramping avoids a click when starting loops mid-air
    vc.lp = 1; vc.lpz = 0;
    vc.stopAtFade = false;
  }
  voiceSet(v, rateHz, vol, lp) {
    const vc = this.voices[v];
    if (rateHz != null) vc.step = this.clock / this.periodFor(rateHz) / this.rate;
    if (vol != null) vc.volTarget = vol;
    if (lp != null) vc.lp = lp;
  }
  voiceStop(v, fadeOut = true) {
    const vc = this.voices[v];
    if (fadeOut) { vc.volTarget = 0; vc.stopAtFade = true; } else { vc.on = false; }
  }

  // --- Music ---
  loadSong(song) { this.song = song; }
  playSong(startRow = 0) {
    if (!this.song) return;
    const s = this.song;
    this.tickSamples = this.rate / ((s.bpm / 60) * 4 * s.ticksPerRow);
    this.samplesLeftInTick = 0;
    this.tickAcc = 0;
    this.row = startRow;
    this.rowTick = 0;
    this.tickCount = 0;
    this.playing = true;
    this.fade = 1; this.fadeStep = 0;
    for (let i = 0; i < 4; i++) {
      const c = this.ch[i];
      c.active = false;
      c.ptr = 0;
      const evs = s.channels[i];
      while (c.ptr < evs.length && evs[c.ptr].r < startRow) c.ptr++;
    }
  }
  stopSong(fadeSeconds = 0) {
    if (fadeSeconds > 0) this.fadeStep = 1 / (fadeSeconds * this.rate);
    else this.silenceMusic();
  }
  silenceMusic() {
    this.playing = false;
    for (let i = 0; i < 4; i++) { this.voices[i].on = false; this.ch[i].active = false; }
  }

  _noteRate(c, note) {
    const z = c.zone;
    return z.rate * Math.pow(2, (note - z.base) / 12);
  }
  _pickZone(inst, note) {
    const zones = inst.zones;
    let best = zones[0], bestD = 1e9;
    for (let i = 0; i < zones.length; i++) {
      const d = Math.abs(zones[i].base - note);
      if (d < bestD) { bestD = d; best = zones[i]; }
    }
    return best;
  }
  _trigger(i, ev) {
    const s = this.song;
    const c = this.ch[i];
    if (ev.rest) { c.released = true; return; }
    const inst = s.instruments[ev.i];
    if (!inst) return;
    const legato = ev.tie && c.active && c.inst === inst;
    c.inst = inst;
    c.vel = ev.v === undefined ? 1 : ev.v;
    c.gain = inst.gain === undefined ? 1 : inst.gain;
    c.ticks = legato ? c.ticks : 0;
    c.released = false;
    c.endTick = (ev.len * s.ticksPerRow) - (inst.gate === undefined ? 1 : inst.gate);
    c.noteTicks = 0;
    c.arp = ev.arp || inst.arp || null;
    c.vib = ev.vib === undefined ? inst.vib : ev.vib;
    if (legato) {
      c.slideTo = ev.n;
      const slideTicks = Math.max(1, ev.slide === undefined ? 3 : ev.slide);
      c.slideStep = (ev.n - c.note) / slideTicks;
      c.endTick = (ev.len * s.ticksPerRow) - (inst.gate === undefined ? 1 : inst.gate);
      return;
    }
    c.note = ev.n;
    c.slideTo = null;
    c.zone = this._pickZone(inst, ev.n);
    c.bend = ev.bend || 0;
    c.bendStep = ev.bend ? -ev.bend / Math.max(1, ev.bendTicks || 4) : 0;
    c.vibPhase = 0;
    c.env = inst.a > 0 ? 0 : 1;
    c.active = true;
    this.voicePlay(i, c.zone.s, this._noteRate(c, c.note + c.bend), 0);
    this.voices[i].vol = 0;
  }
  _tick() {
    const s = this.song;
    if (this.rowTick === 0) {
      for (let i = 0; i < 4; i++) {
        const c = this.ch[i];
        const evs = s.channels[i];
        while (c.ptr < evs.length && evs[c.ptr].r <= this.row) {
          this._trigger(i, evs[c.ptr]);
          c.ptr++;
        }
      }
      if (this.onRow) this.onRow(this.row);
    }
    for (let i = 0; i < 4; i++) {
      const c = this.ch[i];
      if (!c.active) continue;
      const inst = c.inst;
      // Envelope, in ticks. a/d/s/r: attack ticks, decay ticks, sustain level, release ticks.
      c.ticks++;
      c.noteTicks++;
      if (!c.released && c.noteTicks >= c.endTick) c.released = true;
      if (c.released) {
        c.env -= inst.r > 0 ? 1 / inst.r : 1;
        if (c.env <= 0) { c.env = 0; c.active = false; this.voices[i].on = false; continue; }
      } else if (c.ticks <= inst.a) {
        c.env = c.ticks / Math.max(1, inst.a);
      } else if (c.ticks <= inst.a + inst.d) {
        const t = (c.ticks - inst.a) / Math.max(1, inst.d);
        c.env = 1 + (inst.s - 1) * t;
      } else {
        c.env = inst.s;
      }
      // Pitch: bend + slide + vibrato + arpeggio
      if (c.bendStep !== 0) {
        c.bend += c.bendStep;
        if ((c.bendStep > 0 && c.bend >= 0) || (c.bendStep < 0 && c.bend <= 0)) { c.bend = 0; c.bendStep = 0; }
      }
      if (c.slideTo !== null) {
        c.note += c.slideStep;
        if ((c.slideStep > 0 && c.note >= c.slideTo) || (c.slideStep < 0 && c.note <= c.slideTo) || c.slideStep === 0) {
          c.note = c.slideTo; c.slideTo = null;
        }
      }
      let pitch = c.note + c.bend;
      const vib = c.vib;
      if (vib && c.noteTicks > vib.delay) {
        const fadeIn = Math.min(1, (c.noteTicks - vib.delay) / (vib.fade || 1));
        c.vibPhase += vib.speed;
        pitch += Math.sin(c.vibPhase) * vib.depth * fadeIn;
      }
      if (c.arp) pitch += c.arp[Math.floor(c.noteTicks / (inst.arpTicks || 2)) % c.arp.length];
      const v = this.voices[i];
      v.step = this.clock / this.periodFor(this._noteRate(c, pitch)) / this.rate;
      v.volTarget = c.env * c.vel * c.gain;
    }
    this.rowTick++;
    if (this.rowTick >= s.ticksPerRow) {
      this.rowTick = 0;
      this.row++;
      if (this.row >= s.lengthRows) {
        if (s.loopRow >= 0) {
          this.row = s.loopRow;
          for (let i = 0; i < 4; i++) {
            const c = this.ch[i];
            c.ptr = 0;
            const evs = s.channels[i];
            while (c.ptr < evs.length && evs[c.ptr].r < this.row) c.ptr++;
          }
        } else {
          this.playing = false;
        }
      }
    }
  }

  // --- Mixer ---
  render(outL, outR, n) {
    const voices = this.voices;
    const nv = voices.length;
    let offset = 0;
    while (offset < n) {
      let chunk = n - offset;
      if (this.playing) {
        if (this.samplesLeftInTick <= 0) {
          this._tick();
          this.tickAcc += this.tickSamples;
          const whole = Math.floor(this.tickAcc);
          this.tickAcc -= whole;
          this.samplesLeftInTick = whole;
        }
        if (chunk > this.samplesLeftInTick) chunk = this.samplesLeftInTick;
        this.samplesLeftInTick -= chunk;
      }
      this._mix(outL, outR, offset, chunk, voices, nv);
      offset += chunk;
    }
  }

  _mix(outL, outR, start, count, voices, nv) {
    const volA = 1 - Math.exp(-1 / (0.0015 * this.rate)); // 1.5 ms de-zipper
    const end = start + count;
    const rcA = this.rcA, ledA = this.ledA;
    const useLed = this.led;
    const wet = this.wet;
    for (let i = start; i < end; i++) {
      let mixL = 0, mixR = 0, echoIn = 0;
      for (let k = 0; k < nv; k++) {
        const v = voices[k];
        if (!v.on) continue;
        // Area-sample the stairstep over one output period.
        let acc = 0;
        let remaining = v.step;
        let p = v.pos;
        const d = v.data;
        let alive = true;
        while (remaining > 1e-9) {
          const ip = p | 0;
          const frac = ip + 1 - p;
          const take = frac < remaining ? frac : remaining;
          acc += d[ip] * take;
          p += take;
          remaining -= take;
          if (p >= v.loopEnd && v.loopStart >= 0) p = v.loopStart + (p - v.loopEnd);
          else if (p >= v.end) { alive = false; break; }
        }
        v.pos = p;
        v.vol += (v.volTarget - v.vol) * volA;
        let s = (acc / v.step) * v.vol;
        if (v.lp < 1) { v.lpz += (s - v.lpz) * v.lp; s = v.lpz; }
        const g = k < 4 ? this.musicGain * this.fade : this.sfxGain;
        s *= g;
        if (k === 0) echoIn = s;
        mixL += s * v.panL;
        mixR += s * v.panR;
        if (!alive) v.on = false;
        else if (v.stopAtFade && v.vol < 0.002) v.on = false;
      }
      if (this.echoMix > 0) {
        const eb = this.echoBuf, en = eb.length;
        const d1 = eb[(this.echoPos - this.echoLen + en) % en];
        const d2 = eb[(this.echoPos - 2 * this.echoLen + 2 * en) % en];
        eb[this.echoPos] = echoIn + d1 * this.echoFb;
        if (++this.echoPos >= en) this.echoPos = 0;
        // first repeat on the left, second on the right: the repeats ping-pong across the stereo field
        mixL += (d1 + d2 * 0.25) * this.echoMix;
        mixR += (d2 + d1 * 0.25) * this.echoMix;
      }
      if (this.fadeStep > 0) {
        this.fade -= this.fadeStep;
        if (this.fade <= 0) { this.fade = 0; this.fadeStep = 0; this.silenceMusic(); this.fade = 1; }
      }
      // 8-bit full scale is 128; four channels at full scale reach ~1.0 like the real mix.
      let l = mixL / 512, r = mixR / 512;

      // The A500's fixed RC filter (always in circuit)
      this.rcL += (l - this.rcL) * rcA;
      this.rcR += (r - this.rcR) * rcA;
      l = this.rcL; r = this.rcR;

      // The power-LED filter
      if (useLed) {
        this.led1L += (l - this.led1L) * ledA; this.led2L += (this.led1L - this.led2L) * ledA;
        this.led1R += (r - this.led1R) * ledA; this.led2R += (this.led1R - this.led2R) * ledA;
        l = this.led2L; r = this.led2R;
      }

      // AC-coupling at the output jack
      const dl = l - this.dcPrevL + 0.9995 * this.dcL; this.dcPrevL = l; this.dcL = dl;
      const dr = r - this.dcPrevR + 0.9995 * this.dcR; this.dcPrevR = r; this.dcR = dr;
      l = dl; r = dr;

      if (wet > 0) {
        const input = (l + r) * 0.5;
        let rl = 0, rr = 0;
        for (let c = 0; c < 4; c++) {
          const cb = this.combs[c];
          const out = cb.buf[cb.pos];
          cb.store = out * (1 - this.reverbDamp) + cb.store * this.reverbDamp;
          cb.buf[cb.pos] = input * 0.5 + cb.store * this.reverbFeedback;
          if (++cb.pos >= cb.buf.length) cb.pos = 0;
          if (c & 1) rr += out; else rl += out;
        }
        rl = this._allpass(this.apL, rl);
        rr = this._allpass(this.apR, rr);
        l = l * (1 - wet * 0.3) + rl * wet;
        r = r * (1 - wet * 0.3) + rr * wet;
      }

      l *= this.master; r *= this.master;
      // Soft ceiling, so simultaneous explosions saturate instead of hard clipping.
      l = l > 0.8 ? 0.8 + (l - 0.8) / (1 + ((l - 0.8) / 0.2) ** 2) : l < -0.8 ? -0.8 + (l + 0.8) / (1 + ((l + 0.8) / 0.2) ** 2) : l;
      r = r > 0.8 ? 0.8 + (r - 0.8) / (1 + ((r - 0.8) / 0.2) ** 2) : r < -0.8 ? -0.8 + (r + 0.8) / (1 + ((r + 0.8) / 0.2) ** 2) : r;
      outL[i] = l; outR[i] = r;
    }
  }
  _allpass(ap, x) {
    const y = ap.buf[ap.pos];
    const v = x + y * 0.5;
    ap.buf[ap.pos] = v;
    if (++ap.pos >= ap.buf.length) ap.pos = 0;
    return y - v * 0.5;
  }
}
