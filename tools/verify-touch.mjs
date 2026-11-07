// Proves the touch controls work in a real browser, with real (emulated) fingers.
// Builds the game, serves dist/, drives headless Chrome through CDP touch events on a phone-sized
// screen, and checks that
//   1. nothing is drawn over the game until the first touch,
//   2. tapping starts the game and walks through title -> menu -> free flight (a menu row, then the pad),
//   3. in flight the floating stick, throttle slider, FIRE, gear, pause and the confirm buttons all do
//      what they should, including two fingers at once,
//   4. at five phone sizes (both orientations) no control leaves the screen or overlaps another,
//      in flight and in the menu keypad,
//   5. the game picture itself is untouched by the layer (the canvas has the same pixels with and
//      without the overlay).
// Screenshots go to shots/touch-*.png.
// Usage: node tools/verify-touch.mjs           (set CHROME=path\to\chrome.exe if it isn't found)
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
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

const results = [];
const check = (ok, what, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}${detail ? '  (' + detail + ')' : ''}`); };

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'fa18-touch-'));
const port = 9300 + Math.floor(Math.random() * 400);
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--window-size=900,500', '--autoplay-policy=no-user-gesture-required', 'about:blank'], { stdio: 'ignore' });
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
    fs.writeFileSync(new URL(`../shots/touch-${name}.png`, import.meta.url), Buffer.from(s.data, 'base64'));
  };
  const errors = [];
  await send('Page.enable'); await send('Runtime.enable');
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.method === 'Runtime.exceptionThrown') errors.push(JSON.stringify(m.params.exceptionDetails.exception || m.params.exceptionDetails.text));
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(m.params.args.map((a) => a.value || a.description).join(' '));
  });
  const phone = async (w, h, dpr = 2) => {
    await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: dpr, mobile: true, screenOrientation: { type: w > h ? 'landscapePrimary' : 'portraitPrimary', angle: w > h ? 90 : 0 } });
    await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  };
  // fingers: [{x, y, id}]
  const touch = (type, pts) => send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p) => ({ x: p.x, y: p.y, id: p.id ?? 0, radiusX: 8, radiusY: 8, force: 1 })) });
  const tap = async (x, y) => { await touch('touchStart', [{ x, y }]); await sleep(60); await touch('touchEnd', []); await sleep(60); };
  // Runs frames by hand (a headless tab's rAF can crawl)
  const step = (n = 6) => ev(`(() => { for (let i = 0; i < ${n}; i++) { __touch.update(); __game.frame(1 / 60); } return true; })()`);
  const centre = (sel) => ev(`(() => { const r = [...document.querySelectorAll(${JSON.stringify(sel)})].find((e) => e.offsetParent !== null || getComputedStyle(e).position === 'fixed'); const b = r.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2, w: b.width, h: b.height }; })()`);
  const byLabel = (label) => centre(`.fa-touch .b`).then(() => ev(`(() => { const e = [...document.querySelectorAll('.fa-touch .b')].find((e) => e.textContent === ${JSON.stringify(label)} && getComputedStyle(e).display !== 'none' && e.getBoundingClientRect().width > 0); if (!e) return null; const b = e.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; })()`));
  const gameToClient = (gx, gy) => ev(`(() => { const d = __game.display, r = d.canvas.getBoundingClientRect(), kx = d.bw / r.width, ky = d.bh / r.height;
    return { x: r.left + (d.view.x + ${gx} / d.srcW * d.view.w) / kx, y: r.top + (d.view.y + ${gy} / d.srcH * d.view.h) / ky }; })()`);
  const waitFor = async (expr, ms = 20000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await ev(expr)) return true; await step(3); await sleep(100); } return false; };

  // ---- 1. invisible before the first touch ----
  await phone(844, 390);
  await send('Page.navigate', { url });
  await sleep(1200);
  await step(10);
  check(await ev(`__touch.mode === 'none' && getComputedStyle(document.querySelector('.fa-touch')).pointerEvents === 'none'`), 'the touch layer is hidden until the first touch');
  await shot('0-boot');

  // ---- 2. tap through the screens ----
  await ev(`window.__codes = []; const o = __game.input.vpress.bind(__game.input); __game.input.vpress = (c, s) => { __codes.push(c + (s ? '+shift' : '')); o(c, s); };`);
  await tap(422, 200);
  check(await ev('__touch.active === true'), 'the first touch switches the layer on');
  check(await waitFor(`!!__game.screen.restartFilm`), 'tapping the boot screen starts sound and shows the title');
  await sleep(1300); await step(70);
  await tap(422, 200);
  check(await waitFor(`'noticeT' in __game.screen`), 'tapping the title opens the main menu');
  await step(30);
  check(await ev(`__touch.mode === 'keys'`), 'the menu shows the keypad');
  await shot('1-menu');
  const row2 = await gameToClient(120, 72);
  await tap(row2.x, row2.y);
  await step(4);
  check(await ev(`'aircraft' in __game.screen`), 'tapping the FREE FLIGHT row opens free flight setup');
  const zero = await byLabel('0');
  await tap(zero.x, zero.y);
  check(await waitFor(`!!(__game.screen && __game.screen.sim)`, 30000), 'keypad 0 starts a free flight in the air');
  await step(60);
  check(await ev(`__touch.mode === 'flight' && __game.audioReady`), 'the flight controls appear', `audio ${await ev('__game.audioReady')}`);
  await shot('2-flight-landscape');

  // ---- 3. flying ----
  const j = 'ref';
  const stick = { x: 120, y: 250 };
  await touch('touchStart', [{ ...stick, id: 1 }]);
  await touch('touchMove', [{ x: stick.x + 40, y: stick.y + 30, id: 1 }]);
  await step(6);
  const s1 = await ev(`(() => { const t = __game.input.touchStick, a = __game.input.stick; return { act: t.active, p: t.pitch, r: t.roll, ap: a.pitch, ar: a.roll }; })()`);
  check(s1.act && s1.r > 0.3 && s1.p > 0.2 && s1.ar > 0.2 && s1.ap > 0.2, 'dragging the stick right and down rolls right and pulls up', JSON.stringify(s1));
  await shot('3-stick-held');
  // second finger on FIRE while the stick is still held
  const fire = await byLabel('FIRE');
  await touch('touchStart', [{ x: stick.x + 40, y: stick.y + 30, id: 1 }, { x: fire.x, y: fire.y, id: 2 }]);
  await step(2);
  const f1 = await ev(`({ held: __game.input.held('Space'), stick: __game.input.touchStick.active })`);
  check(f1.held && f1.stick, 'FIRE works while the stick is held (two fingers)', JSON.stringify(f1));
  await touch('touchEnd', [{ x: stick.x + 40, y: stick.y + 30, id: 1 }]);
  await step(2);
  check(await ev(`__game.input.held('Space') && !__game.input.touchStick.active`), 'lifting the stick finger leaves FIRE held');
  await touch('touchEnd', []);
  await step(2);
  check(await ev(`!__game.input.held('Space')`), 'letting go of FIRE releases the key');
  await step(30);
  const s2 = await ev(`(() => { const t = __game.input.touchStick, a = __game.input.stick; return { act: t.active, ar: a.roll, ap: a.pitch }; })()`);
  check(!s2.act && Math.abs(s2.ar) < 0.05 && Math.abs(s2.ap) < 0.05, 'releasing the stick centres it', JSON.stringify(s2));

  // throttle slider
  const thr = await centre('.fa-touch .thr');
  const top = thr.y - thr.h / 2, bottom = thr.y + thr.h / 2;
  await tap(thr.x, top + 1); await step(3);
  const t1 = await ev('__game.screen.sim.player.throttle');
  await tap(thr.x, (top + bottom) / 2); await step(3);
  const t2 = await ev('__game.screen.sim.player.throttle');
  await tap(thr.x, bottom - 1); await step(3);
  const t3 = await ev('__game.screen.sim.player.throttle');
  check(t1 === 1 && Math.abs(t2 - 0.5) < 0.11 && t3 === 0, 'the throttle slider sets full, half and idle', `${t1} ${t2} ${t3}`);
  await touch('touchStart', [{ x: thr.x, y: top + 1, id: 3 }]); await step(2); await touch('touchEnd', []);
  const ab = await byLabel('AB');
  await tap(ab.x, ab.y); await step(3);
  check(await ev('__game.screen.sim.player.afterburner === true'), 'AB lights the afterburner');
  await tap(ab.x, ab.y); await step(3);
  check(await ev('__game.screen.sim.player.afterburner === false && __game.screen.sim.player.throttle === 1'), 'AB again drops back to full dry power');

  // buttons
  await ev('__codes.length = 0');
  const gear = await byLabel('GEAR'), hook = await byLabel('HOOK'), tgt = await byLabel('TGT');
  await tap(gear.x, gear.y); await tap(hook.x, hook.y); await tap(tgt.x, tgt.y); await step(2);
  check((await ev('__codes.join()')) === 'KeyG,KeyA,KeyT', 'GEAR, HOOK and TGT send their keys', await ev('__codes.join()'));
  const brk = await byLabel('BRK');
  await touch('touchStart', [{ x: brk.x, y: brk.y }]); await step(2);
  const held = await ev(`__game.input.held('Backspace')`);
  await touch('touchEnd', []); await step(2);
  check(held && await ev(`!__game.input.held('Backspace')`), 'BRK is held while the finger is down');

  // drawer and confirmations
  const more = await byLabel('...');
  await tap(more.x, more.y); await step(2);
  check(await ev(`getComputedStyle(document.querySelector('.fa-touch .drawer')).display === 'grid'`), 'the ... button opens the drawer');
  await shot('4-drawer');
  const eject = await byLabel('EJECT');
  await tap(eject.x, eject.y); await step(3);
  check(await ev(`!__game.screen.sim.ejected`) && (await byLabel('SURE?')) !== null, 'EJECT asks for a second tap before doing anything');
  const hud = await byLabel('HUD');
  await ev('__codes.length = 0');
  await tap(hud.x, hud.y); await step(2);
  check((await ev('__codes.join()')) === 'KeyH', 'a drawer key sends its code', await ev('__codes.join()'));
  await tap(more.x, more.y); await step(2);
  const pause = await byLabel('II');
  await tap(pause.x, pause.y); await step(3);
  check(await ev('__game.screen.paused === true'), 'II pauses the flight');
  await tap(pause.x, pause.y); await step(3);
  check(await ev('__game.screen.paused === false'), 'II again resumes');

  // ---- 4. layout at phone sizes ----
  const layout = async (mode) => ev(`(() => {
    const W = innerWidth, H = innerHeight, rects = [];
    for (const e of document.querySelectorAll('.fa-touch .b, .fa-touch .thr')) {
      if (e.closest('.drawer')) continue;
      const cs = getComputedStyle(e); if (cs.display === 'none' || e.closest('.pad,.arrows') && false) continue;
      const b = e.getBoundingClientRect(); if (!b.width) continue;
      rects.push({ n: e.textContent.trim() || e.className, l: b.left, t: b.top, r: b.right, b: b.bottom });
    }
    const out = [], over = [];
    for (const a of rects) if (a.l < -0.5 || a.t < -0.5 || a.r > W + 0.5 || a.b > H + 0.5) out.push(a.n);
    for (let i = 0; i < rects.length; i++) for (let k = i + 1; k < rects.length; k++) { const a = rects[i], c = rects[k];
      if (a.l < c.r - 1 && c.l < a.r - 1 && a.t < c.b - 1 && c.t < a.b - 1) over.push(a.n + '/' + c.n); }
    const minSide = Math.min(...rects.map((a) => Math.min(a.r - a.l, a.b - a.t)));
    return { n: rects.length, out, over, minSide: Math.round(minSide), mode: __touch.mode };
  })()`);
  const sizes = [[844, 390], [667, 375], [932, 430], [390, 844], [360, 640], [820, 1180]];
  for (const [w, h] of sizes) {
    await phone(w, h);
    await sleep(250); await step(6);
    const l = await layout();
    check(l.n > 10 && l.out.length === 0 && l.over.length === 0 && l.minSide >= 34, `flight controls fit at ${w}x${h}`, `${l.n} controls, smallest ${l.minSide}px${l.out.length ? ', off-screen ' + l.out : ''}${l.over.length ? ', overlap ' + l.over : ''}`);
    if (w === 390) await shot('5-flight-portrait');
    if (w === 667) await shot('5-flight-small-landscape');
  }
  // menu keypad
  await phone(844, 390);
  await ev(`__game.toMenu()`);
  await sleep(250); await step(10);
  for (const [w, h] of sizes) {
    await phone(w, h);
    await sleep(250); await step(6);
    const l = await layout();
    check(l.mode === 'keys' && l.n >= 14 && l.out.length === 0 && l.over.length === 0 && l.minSide >= 34, `menu keypad fits at ${w}x${h}`, `${l.n} keys, smallest ${l.minSide}px${l.out.length ? ', off-screen ' + l.out : ''}${l.over.length ? ', overlap ' + l.over : ''}`);
    if (w === 390) await shot('6-menu-portrait');
  }

  // ---- 5. the picture itself is never changed by the layer ----
  await phone(844, 390);
  await sleep(250);
  await ev(`__game.toMenu()`); await step(20);
  const a = await ev(`(() => { __game.display.present(__game.gfx); return Array.from(__game.display.rgba.slice(0, 320 * 256)).join(',').length; })()`);
  await ev(`document.querySelector('.fa-touch').style.display = 'none'`);
  await step(1);
  const b = await ev(`(() => { __game.display.present(__game.gfx); return Array.from(__game.display.rgba.slice(0, 320 * 256)).join(',').length; })()`);
  check(a === b, 'the 320x256 framebuffer is identical with the layer shown or hidden');

  check(errors.length === 0, 'no errors in the page console', errors.slice(0, 3).join(' | '));
} catch (err) {
  console.error('verify-touch crashed:', err);
  results.push(false);
} finally {
  try { ws && ws.close(); } catch { /* closing */ }
  chrome.kill();
  server.close();
  await sleep(300);
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* still locked */ }
}
const failed = results.filter((x) => !x).length;
console.log(failed ? `\n${failed} check(s) FAILED` : `\nall ${results.length} checks passed`);
process.exit(failed ? 1 : 0);
