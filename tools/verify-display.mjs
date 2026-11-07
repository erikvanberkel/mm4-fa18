// Proves the picture is never interpolated. Builds the game, serves dist/, drives headless Chrome
// through to the flight screen at several device pixel ratios on both the WebGL and the 2D-canvas
// paths, screenshots it, and checks that
//   1. every game pixel is one solid block of identical screen pixels (no blending between neighbours),
//   2. every colour on screen belongs to the game's 32-colour palette.
// Usage: node tools/verify-display.mjs           (set CHROME=path\to\chrome.exe if it isn't found)
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn, execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { pickScale } from '../src/gfx/display.js';
import { FLIGHT_PALETTE } from '../src/gfx/palette.js';
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

const palette = new Set(FLIGHT_PALETTE.map(([r, g, b]) => `${r},${g},${b}`));
const HARNESS = `
  window.__press = (code, frames = 2) => { const o = { code, key: code, bubbles: true }; window.dispatchEvent(new KeyboardEvent('keydown', o)); for (let i = 0; i < frames; i++) __game.frame(1/60); window.dispatchEvent(new KeyboardEvent('keyup', o)); };
  window.__run = (s) => { const n = Math.round(s * 60); for (let i = 0; i < n; i++) __game.frame(1/60); };
  (async () => { __run(0.6); __press('Space'); __run(0.6); for (let i = 0; i < 120 && !__game.audioReady && !__game.sfx.muted; i++) await new Promise(r => setTimeout(r, 50)); await new Promise(r => setTimeout(r, 300));
    __run(1.6); __press('Enter'); __run(1.2); __press('Digit2'); __run(0.5); __press('Digit0'); __run(3.0);
    __game.display.mode = 0; __game.fade = 1; __game.flash = 0; __run(0.1);
    return JSON.stringify({ screen: __game.screen.constructor.name, gl: !!__game.display.gl, w: __game.gfx.W, h: __game.gfx.H }); })()
`;

async function session(label, flags, ratios) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'fa18-verify-'));
  const port = 9300 + Math.floor(Math.random() * 400);
  const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--window-size=1440,900', '--autoplay-policy=no-user-gesture-required', ...flags, 'about:blank'], { stdio: 'ignore' });
  let ws, failures = 0;
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
    await send('Page.enable'); await send('Runtime.enable');
    for (const dpr of ratios) {
      await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 765, deviceScaleFactor: dpr, mobile: false });
      await send('Page.navigate', { url });
      await sleep(1200);
      const r = await send('Runtime.evaluate', { expression: HARNESS, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
      const info = JSON.parse(r.result.value);
      await sleep(200);
      const shot = await send('Page.captureScreenshot', { format: 'png' });
      const png = PNG.sync.read(Buffer.from(shot.data, 'base64'));
      const s = pickScale(png.width, png.height);
      const px = (x, y) => { const i = (y * png.width + x) * 4; return (png.data[i] << 16) | (png.data[i + 1] << 8) | png.data[i + 2]; };
      const blocksAt = (ox, oy) => {
        let bad = 0, n = 0;
        for (let sy = 0; sy < 256; sy++) for (let sx = 0; sx < 320; sx++) {
          const x0 = ox + sx * s.kx, y0 = oy + sy * s.ky;
          if (x0 < 0 || y0 < 0 || x0 + s.kx > png.width || y0 + s.ky > png.height) continue; // trimmed by the 2% overshoot
          const c = px(x0, y0); let u = true;
          for (let dy = 0; dy < s.ky && u; dy++) for (let dx = 0; dx < s.kx; dx++) if (px(x0 + dx, y0 + dy) !== c) { u = false; break; }
          n++; if (!u) bad++;
        }
        return { bad, n };
      };
      const ex = Math.round((png.width - s.w) / 2), ey = Math.round((png.height - s.h) / 2);
      let best = null;
      for (let oy = ey - s.ky; oy <= ey + s.ky; oy++) for (let ox = ex - 2; ox <= ex + 2; ox++) { const b = blocksAt(ox, oy); if (!best || b.bad < best.bad) best = { ...b, ox, oy }; }
      const seen = new Set();
      for (let y = Math.max(0, best.oy); y < Math.min(png.height, best.oy + s.h); y++) for (let x = Math.max(0, best.ox); x < Math.min(png.width, best.ox + s.w); x++) {
        const v = px(x, y); seen.add(`${v >> 16},${(v >> 8) & 255},${v & 255}`);
      }
      let off = 0; for (const c of seen) if (!palette.has(c)) off++;
      const ok = info.screen && best.bad === 0 && off === 0 && s.integer;
      if (!ok) failures++;
      console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}  ratio ${dpr}  ${png.width}x${png.height}  ${s.kx}x${s.ky} screen pixels per game pixel  non-uniform blocks ${best.bad}/${best.n}  colours ${seen.size} (off-palette ${off})`);
    }
  } finally {
    try { ws && ws.close(); } catch { /* ignore */ }
    try { execSync(process.platform === 'win32' ? `taskkill /PID ${chrome.pid} /T /F` : `kill -9 ${chrome.pid}`, { stdio: 'ignore' }); } catch { /* already gone */ }
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* ignore */ }
  }
  return failures;
}

const ratios = [1, 1.25, 1.5, 1.75, 2, 2.5];
let failed = 0;
failed += await session('WebGL      ', ['--enable-unsafe-swiftshader'], ratios);
failed += await session('2D canvas  ', ['--disable-gpu', '--disable-webgl', '--disable-3d-apis'], ratios);
server.close();
console.log(failed ? `\n${failed} check(s) FAILED: some pixels are being interpolated or recoloured.` : '\nAll checks passed: every game pixel is an exact solid block and only palette colours appear.');
process.exit(failed ? 1 : 0);
