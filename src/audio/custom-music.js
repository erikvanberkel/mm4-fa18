// Title music from a recording of your own: drag any audio file onto the game window.
//
// The game never ships, downloads or converts copyrighted audio. You provide the file, the browser's
// own decoder plays it, and it is remembered in this browser only (IndexedDB). It loops while the title
// and menus are up, and it is silent in flight like the built-in themes.
const DB_NAME = 'fa18-interceptor';
const STORE = 'custom-music';
const KEY = 'title';

// One IndexedDB request in its own short transaction. Rejects if storage is unavailable.
const withStore = (mode, op) => new Promise((resolve, reject) => {
  let open;
  try { open = indexedDB.open(DB_NAME, 1); } catch (err) { reject(err); return; }
  open.onupgradeneeded = () => open.result.createObjectStore(STORE);
  open.onerror = () => reject(open.error);
  open.onblocked = () => reject(new Error('storage blocked'));
  open.onsuccess = () => {
    const db = open.result;
    try {
      const req = op(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => { db.close(); resolve(req.result); };
      req.onerror = () => { db.close(); reject(req.error); };
    } catch (err) { db.close(); reject(err); }
  };
});

export class CustomMusic {
  constructor(backend) {
    this.backend = backend; // AudioBackend: owns the AudioContext
    this.buffer = null;     // decoded AudioBuffer
    this.name = '';
    this.src = null;
    this.gain = null;
    this.level = 0.9;
  }

  get ready() { return !!this.buffer; }

  // file: a File (or any Blob with a name). Throws if the browser can't decode it.
  async setFile(file) {
    if (!file || file.size === 0) throw new Error('empty file');
    if (file.size > 80 * 1024 * 1024) throw new Error('file too large');
    const bytes = await file.arrayBuffer();
    await this._decode(bytes.slice(0), file.name || 'RECORDING');
    withStore('readwrite', (s) => s.put({ name: this.name, bytes }, KEY)).catch(() => {}); // best effort
  }

  // Brings back last time's file, if the browser kept it.
  async restore() {
    try {
      const rec = await withStore('readonly', (s) => s.get(KEY));
      if (rec && rec.bytes) await this._decode(rec.bytes.slice(0), rec.name || 'RECORDING');
    } catch (err) { /* nothing stored, or storage is off: the built-in themes still work */ }
    return this.ready;
  }

  async clear() {
    this.stop(0);
    this.buffer = null;
    this.name = '';
    await withStore('readwrite', (s) => s.delete(KEY)).catch(() => {});
  }

  async _decode(bytes, name) {
    const Offline = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    const ctx = this.backend.ctx || new Offline(2, 1, 44100); // the real context once sound has started
    const buf = await new Promise((resolve, reject) => {
      const p = ctx.decodeAudioData(bytes, resolve, reject); // callbacks for older Safari, promise elsewhere
      if (p && p.catch) p.catch(reject);
    });
    if (!buf || buf.length < 1024) throw new Error('nothing to play');
    this.buffer = buf;
    this.name = name;
  }

  play(fadeIn = 0.4) {
    const ctx = this.backend.ctx;
    if (!this.buffer || !ctx) return false;
    this.stop(0);
    const src = ctx.createBufferSource();
    src.buffer = this.buffer;
    src.loop = true;
    const gain = ctx.createGain();
    const t = ctx.currentTime;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(this.level, t + Math.max(0.01, fadeIn));
    src.connect(gain);
    gain.connect(ctx.destination);
    src.start();
    this.src = src;
    this.gain = gain;
    return true;
  }

  stop(fade = 0.7) {
    const { src, gain } = this;
    if (!src) return;
    this.src = null;
    this.gain = null;
    const ctx = this.backend.ctx;
    const done = () => { try { src.disconnect(); gain.disconnect(); } catch (err) { /* already gone */ } };
    try {
      if (fade > 0 && ctx) {
        const t = ctx.currentTime;
        gain.gain.cancelScheduledValues(t);
        gain.gain.setValueAtTime(gain.gain.value, t);
        gain.gain.linearRampToValueAtTime(0, t + fade);
        src.stop(t + fade + 0.05);
        src.onended = done;
      } else {
        src.stop();
        done();
      }
    } catch (err) { done(); }
  }
}
