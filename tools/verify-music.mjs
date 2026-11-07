// Proves the title music works in a real browser, through the real AudioWorklet path.
// Builds the game, serves dist/, drives headless Chrome, taps everything that reaches the speakers
// with an AnalyserNode, and checks that
//   1. the Anthem plays: audible, finite, never clipping, with the loudness the offline render predicts,
//   2. Shift-M cycles the themes (Anthem, Bay Patrol, back) and each one is audible,
//   3. a sound file dropped on the window becomes the title music (a 440 Hz test tone stands in), the
//      synthesised song stops, and the file is still the music after a reload (IndexedDB),
//   4. nothing throws or logs an error on the way.
// Usage: node tools/verify-music.mjs           (set CHROME=path\to\chrome.exe if it isn't found)
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { PaulaEngine } from '../src/audio/paula-engine.js';
import { generateMusicSamples } from '../src/audio/samples-music.js';
import { generateAnthemSamples } from '../src/audio/samples-anthem.js';
import { buildAnthemSong } from '../src/audio/song-anthem.js';
import { build } from './build.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const candidates = [
  process.env.CHROME,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);
const CHROME = candidates.find((p) => fs.existsSync(p));
if (!CHROME) { console.error('Chrome not found. Set CHROME to its executable path.'); process.exit(2); }

await build({ watchMode: false });
const root = path.resolve(fileURLToPath(new URL('../dist/', import.meta.url)));
const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]) === '/' ? '/index.html' : decodeURIComponent(req.url.split('?')[0]);
  const f = path.join(root, rel);
  if (!f.startsWith(root) || !fs.existsSync(f)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': f.endsWith('.js') ? 'text/javascript' : 'text/html', 'Cache-Control': 'no-store' });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/`;

// What the offline engine predicts for the first seconds of the Anthem, as mono RMS per 200 ms.
function offlineWindows(seconds) {
  const RATE = 48000, song = buildAnthemSong();
  const e = new PaulaEngine(RATE);
  e.wet = song.wet;
  e.setEcho(song.echo.time, song.echo.feedback, song.echo.mix);
  for (const s of [...generateMusicSamples(), ...generateAnthemSamples()]) e.loadSample(s.id, s.data, s.loopStart, s.loopEnd);
  e.loadSong({ ...song, loopRow: -1 });
  e.playSong(0);
  const n = seconds * RATE, L = new Float32Array(n), R = new Float32Array(n);
  for (let i = 0; i < n; i += 128) e.render(L.subarray(i, i + 128), R.subarray(i, i + 128), 128);
  const w = Math.floor(0.2 * RATE), out = [];
  for (let i = 0; i + w <= n; i += w) { let t = 0; for (let k = i; k < i + w; k++) { const m = (L[k] + R[k]) / 2; t += m * m; } out.push(Math.sqrt(t / w)); }
  return out;
}

// Runs in the page before anything else: everything that connects to the speakers also feeds an analyser.
const TAP = `(() => {
  const orig = AudioNode.prototype.connect;
  AudioNode.prototype.connect = function (dest, ...rest) {
    const r = orig.call(this, dest, ...rest);
    try {
      if (dest instanceof AudioDestinationNode) {
        const ctx = dest.context;
        if (!window.__an || window.__an.context !== ctx) { window.__an = ctx.createAnalyser(); window.__an.fftSize = 32768; window.__an.smoothingTimeConstant = 0; }
        orig.call(this, window.__an);
      }
    } catch (e) { /* tapping must never break the game */ }
    return r;
  };
  window.__errors = [];
  window.addEventListener('error', (e) => window.__errors.push(String(e.message)));
  window.addEventListener('unhandledrejection', (e) => window.__errors.push('rejection: ' + String(e.reason)));
  const ce = console.error; console.error = (...a) => { window.__errors.push(a.map(String).join(' ')); ce.apply(console, a); };
  window.__listen = async (seconds, stepMs = 200) => {
    const out = [], t0 = performance.now(), buf = new Float32Array(window.__an.fftSize), rate = window.__an.context.sampleRate;
    const n = Math.floor(0.2 * rate);
    while ((performance.now() - t0) / 1000 < seconds) {
      await new Promise((r) => setTimeout(r, stepMs));
      window.__an.getFloatTimeDomainData(buf);
      let s = 0, pk = 0, bad = 0;
      for (let i = buf.length - n; i < buf.length; i++) { const v = buf[i]; if (!Number.isFinite(v)) { bad++; continue; } s += v * v; if (Math.abs(v) > pk) pk = Math.abs(v); }
      out.push({ t: (performance.now() - t0) / 1000, rms: Math.sqrt(s / n), peak: pk, bad });
    }
    return out;
  };
  // strongest frequency now, and how far it stands above the median bin, in dB
  window.__tone = () => {
    const an = window.__an, f = new Float32Array(an.frequencyBinCount);
    an.getFloatFrequencyData(f);
    let best = 0;
    for (let i = 2; i < f.length; i++) if (f[i] > f[best]) best = i;
    const sorted = Float32Array.from(f).sort();
    return { hz: best * an.context.sampleRate / an.fftSize, above: f[best] - sorted[sorted.length >> 1] };
  };
  window.__press = (code, frames = 2, shift = false) => {
    const o = { code, key: code, shiftKey: shift, bubbles: true };
    window.dispatchEvent(new KeyboardEvent('keydown', o));
    for (let i = 0; i < frames; i++) __game.frame(1 / 60);
    window.dispatchEvent(new KeyboardEvent('keyup', { ...o, shiftKey: false }));
  };
  window.__run = (s) => { const n = Math.round(s * 60); for (let i = 0; i < n; i++) __game.frame(1 / 60); };
  window.__wavFile = (hz, seconds) => {
    const rate = 44100, n = Math.floor(rate * seconds), b = new ArrayBuffer(44 + n * 2), v = new DataView(b);
    const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    str(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); str(8, 'WAVEfmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); str(36, 'data'); v.setUint32(40, n * 2, true);
    for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, Math.round(Math.sin(2 * Math.PI * hz * i / rate) * 0.5 * 32767), true);
    return new File([b], 'My Recording of the Intro.wav', { type: 'audio/wav' });
  };
  window.__drop = (file) => { const dt = new DataTransfer(); dt.items.add(file); window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true })); };
  // from a cold page to the title screen with sound running
  window.__boot = async () => {
    for (let i = 0; i < 100 && !window.__game; i++) await new Promise((r) => setTimeout(r, 50));
    __run(0.6); __press('Space'); __run(0.6);
    // (the bundle is minified, so screens are told apart by what they have rather than by class name)
    const isTitle = () => !!(__game.screen && __game.screen.restartFilm);
    for (let i = 0; i < 200 && !isTitle(); i++) { await new Promise((r) => setTimeout(r, 50)); __run(0.05); }
    return JSON.stringify({ title: isTitle(), audioReady: __game.audioReady, theme: __game.themeId });
  };
})();`;

const results = [];
const check = (ok, what, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}${detail ? '  (' + detail + ')' : ''}`); };
const db = (x) => 20 * Math.log10(x + 1e-9);

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'fa18-music-'));
const port = 9300 + Math.floor(Math.random() * 400);
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--window-size=1440,900', '--autoplay-policy=no-user-gesture-required', 'about:blank'], { stdio: 'ignore' });
let ws;
try {
  let page;
  for (let i = 0; i < 50 && !page; i++) {
    await sleep(300);
    try { page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === 'page'); } catch { /* not up yet */ }
  }
  if (!page) throw new Error('Chrome did not start');
  ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0; const pending = new Map();
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); } };
  await new Promise((r) => { ws.onopen = r; });
  const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails.exception || r.exceptionDetails));
    return r.result.value;
  };
  const shot = async (name) => {
    const s = await send('Page.captureScreenshot', { format: 'png' });
    fs.mkdirSync(new URL('../shots/', import.meta.url), { recursive: true });
    fs.writeFileSync(new URL(`../shots/${name}.png`, import.meta.url), Buffer.from(s.data, 'base64'));
    return PNG.sync.read(Buffer.from(s.data, 'base64'));
  };
  await send('Page.enable'); await send('Runtime.enable');
  await send('Page.addScriptToEvaluateOnNewDocument', { source: TAP });
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });

  // ---- 1. the Anthem plays ----
  await send('Page.navigate', { url });
  await sleep(800);
  const boot = JSON.parse(await ev('__boot()'));
  check(boot.title && boot.audioReady, 'sound starts and the title screen appears', JSON.stringify(boot));
  check(boot.theme === 'anthem', 'the Anthem is the default theme');
  const win = await ev('__listen(14)');
  const bad = win.reduce((a, w) => a + w.bad, 0);
  const peak = Math.max(...win.map((w) => w.peak));
  const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  const lit = win.filter((w) => w.rms > 0.003).length / win.length;
  check(bad === 0, 'every sample reaching the speakers is a finite number', `${bad} bad`);
  check(peak > 0.15 && peak < 0.99, 'loud enough and never clipping', `peak ${peak.toFixed(3)}`);
  check(lit > 0.9, 'music is playing for the whole listening window', `${(lit * 100).toFixed(0)}% of windows audible`);
  const off = offlineWindows(16);
  const offMean = mean(off.slice(0, 70)), liveMean = mean(win.map((w) => w.rms));
  check(Math.abs(db(liveMean) - db(offMean)) < 4, 'the browser matches the offline render in loudness', `live ${db(liveMean).toFixed(1)} dB, offline ${db(offMean).toFixed(1)} dB`);
  const early = mean(win.slice(0, 20).map((w) => w.rms)), later = mean(win.slice(-25).map((w) => w.rms));
  console.log(`      level in the first 4 s ${db(early).toFixed(1)} dB, in the last 5 s ${db(later).toFixed(1)} dB`);
  await shot('music-title');

  // ---- 2. Shift-M cycles the themes ----
  await ev("__press('KeyM', 2, true)");
  let th = await ev('__game.themeId');
  check(th === 'baypatrol', 'Shift-M switches to Bay Patrol', th);
  let w2 = await ev('__listen(4)');
  check(w2.some((w) => w.rms > 0.003) && w2.every((w) => w.bad === 0), 'Bay Patrol is audible');
  await shot('music-toast');
  await ev("__press('KeyM', 2, true)");
  th = await ev('__game.themeId');
  check(th === 'anthem', 'Shift-M wraps back to the Anthem', th);
  w2 = await ev('__listen(4)');
  check(w2.some((w) => w.rms > 0.003), 'the Anthem is audible again');

  // ---- 3. a dropped recording becomes the title music ----
  await ev("__drop(__wavFile(440, 3))");
  await sleep(1200);
  th = await ev('__game.themeId');
  check(th === 'custom', 'a dropped sound file becomes the title music', th);
  await ev('__run(0.5)');
  await sleep(1800);
  const tone = await ev('__tone()');
  check(Math.abs(tone.hz - 440) < 4 && tone.above > 35, 'the recording itself is what plays', `${tone.hz.toFixed(1)} Hz, ${tone.above.toFixed(0)} dB above the noise floor`);
  const name = await ev('__game.themeName()');
  check(/MY RECORDING/.test(name), 'its name is shown', name);
  await ev("__press('KeyM', 2, true)");
  th = await ev('__game.themeId');
  check(th === 'anthem', 'Shift-M leaves the recording for the Anthem', th);
  await sleep(1500);
  const tone2 = await ev('__tone()');
  check(!(Math.abs(tone2.hz - 440) < 4 && tone2.above > 35), 'the recording stops when another theme is chosen', `${tone2.hz.toFixed(0)} Hz, ${tone2.above.toFixed(0)} dB`);
  await ev("__press('KeyM', 2, true)"); await ev("__press('KeyM', 2, true)"); // anthem -> baypatrol -> custom
  th = await ev('__game.themeId');
  check(th === 'custom', 'the recording is part of the Shift-M cycle', th);
  await sleep(600);

  // ---- the menu screen offers the same controls ----
  await ev("__press('Space', 2); 0");
  await ev('__run(0.5)'); await ev("__press('Space', 2); 0"); await ev('__run(1.2)');
  const onMenu = await ev("'noticeT' in __game.screen");
  check(onMenu, 'pressing fire on the title screen leads to the menu');
  if (onMenu) {
    await ev('__run(0.5)');
    await shot('music-menu');
    const t = await ev('__game.music');
    check(t === 'title', 'the menu keeps the title music going', t);
  }

  // ---- 4. it is still the music after a reload ----
  await sleep(500);
  await send('Page.navigate', { url });
  await sleep(1000);
  const boot2 = JSON.parse(await ev('__boot()'));
  check(boot2.theme === 'custom', 'after a reload the recording is remembered', JSON.stringify(boot2));
  await ev('__run(0.5)');
  await sleep(2200);
  const tone3 = await ev('__tone()');
  check(Math.abs(tone3.hz - 440) < 4 && tone3.above > 35, 'and it plays', `${tone3.hz.toFixed(1)} Hz, ${tone3.above.toFixed(0)} dB above the noise floor`);

  // ---- 5. a file dropped before sound has started is picked up when it does; junk is refused politely ----
  await ev("localStorage.clear(); new Promise((r) => { const q = indexedDB.deleteDatabase('fa18-interceptor'); q.onsuccess = q.onerror = q.onblocked = () => r(1); })");
  await send('Page.navigate', { url });
  await sleep(1000);
  await ev("(async () => { for (let i = 0; i < 100 && !window.__game; i++) await new Promise((r) => setTimeout(r, 50)); __drop(__wavFile(880, 3)); return 1; })()");
  const waiting = await ev('__game.toastText');
  check(/LOADS WHEN SOUND STARTS/.test(waiting), 'a file dropped on the boot screen is held until sound starts', waiting);
  const boot3 = JSON.parse(await ev('__boot()'));
  check(boot3.theme === 'custom', 'then it becomes the title music', JSON.stringify(boot3));
  await ev('__run(0.5)');
  await sleep(2200);
  const tone4 = await ev('__tone()');
  check(Math.abs(tone4.hz - 880) < 5 && tone4.above > 35, 'and it plays', `${tone4.hz.toFixed(1)} Hz, ${tone4.above.toFixed(0)} dB above the noise floor`);
  await ev("__drop(new File([new Uint8Array(5000).map((_, i) => (i * 37) & 255)], 'notes.txt', { type: 'text/plain' }))");
  await sleep(800);
  const refused = await ev('({ toast: __game.toastText, theme: __game.themeId, name: __game.themeName() })');
  check(/CANNOT PLAY/.test(refused.toast) && refused.theme === 'custom' && /^MY RECORDING/.test(refused.name), 'a file that is not sound is refused and the recording stays', JSON.stringify(refused));

  const errors = await ev('window.__errors');
  check(errors.length === 0, 'no errors were logged', errors.slice(0, 3).join(' | '));
} finally {
  try { ws && ws.close(); } catch { /* ignore */ }
  chrome.kill();
  server.close();
  await sleep(300);
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* Chrome may still hold files */ }
}
const failed = results.filter((r) => !r).length;
console.log(failed ? `\n${failed} check(s) FAILED` : `\nall ${results.length} checks passed`);
process.exit(failed ? 1 : 0);
