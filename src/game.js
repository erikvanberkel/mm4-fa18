// The game controller: owns the screen stack, shared resources and the audio lifecycle.
import { FLIGHT_PALETTE, C } from './gfx/palette.js';
import { FONT_SMALL } from './gfx/fonts.js';
import { MenuScreen, BootScreen, LoadingScreen, DebriefScreen } from './screens/menus.js';
import { FlightScreen } from './screens/flight.js';
import { TitleScreen } from './screens/title.js';
import { AudioBackend } from './audio/backend.js';
import { Sfx } from './audio/sfx.js';
import { CustomMusic } from './audio/custom-music.js';
import { generateMusicSamples } from './audio/samples-music.js';
import { generateAnthemSamples } from './audio/samples-anthem.js';
import { generateSfxSamples } from './audio/samples-sfx.js';
import { buildTitleSong } from './audio/song-title.js';
import { buildAnthemSong } from './audio/song-anthem.js';
import { buildSuccessJingle, buildFailJingle } from './audio/song-jingles.js';
import WORKLET_SOURCE from './audio/worklet.gen.js';

// Title themes, in the order Shift-M cycles through them. 'custom' only exists once a recording was supplied.
const THEME_PREF = 'fa18.titleTheme';
const readPref = () => { try { return localStorage.getItem(THEME_PREF); } catch (err) { return null; } };
const writePref = (v) => { try { localStorage.setItem(THEME_PREF, v); } catch (err) { /* private window */ } };
const shortName = (s, n = 24) => {
  s = String(s).replace(/\.[A-Za-z0-9]{2,5}$/, '').toUpperCase().replace(/[^A-Z0-9 .'&!?+-]/g, ' ').replace(/\s+/g, ' ').trim() || 'RECORDING';
  return s.length > n ? s.slice(0, n - 1) + '.' : s;
};

export class Game {
  constructor({ gfx, display, input, world, models, scene, map, log }) {
    Object.assign(this, { gfx, display, input, world, models, scene, map, log });
    this.audio = new AudioBackend();
    this.sfx = new Sfx(this.audio);
    this.custom = new CustomMusic(this.audio);
    this.screen = null;
    this.fade = 1;
    this.flash = 0;
    this.whiteFlash = 0;
    this.fps = 60;
    this.showFps = false;
    this.music = null;
    this.songs = {};          // built-in themes by id, once sound has started
    this.themeId = 'anthem';
    this.pendingDrop = null;  // a file dropped before sound could start
    this.toastText = '';
    this.toastT = 0;
    this.loadingText = null;
    this.audioStarting = false;
    this.audioReady = false;
  }

  setScreen(s) {
    if (this.screen && this.screen.leave) this.screen.leave();
    this.screen = s;
    if (s.enter) s.enter();
  }
  start() { this.setScreen(new BootScreen(this)); }
  toMenu() { this.fade = 1; this.setScreen(new MenuScreen(this)); }
  launch(spec) { this.setScreen(new LoadingScreen(this, spec)); }
  beginFlight(spec) { this.setScreen(new FlightScreen(this, spec)); }
  restartFlight(spec) { this.launch(spec); }
  showDebrief(info) { this.setScreen(new DebriefScreen(this, info)); }

  // ---- title music ----
  // The theme plays on the title and menus; flights are scored by their sound effects.
  themeList() { return this.custom.ready ? ['custom', 'anthem', 'baypatrol'] : ['anthem', 'baypatrol']; }
  themeName(id = this.themeId) { return id === 'custom' ? shortName(this.custom.name) : (this.songs[id] ? this.songs[id].name : ''); }
  // The title film is cut to a bar grid. A recording of unknown tempo gets the Anthem's.
  get titleBpm() { const s = this.songs[this.themeId] || this.songs.anthem; return s ? s.bpm : 104; }

  _playTheme() {
    if (this.themeId === 'custom' && this.custom.ready) {
      this.sfx.stopSong(0.3);
      this.custom.play();
    } else {
      this.custom.stop(0.3);
      const song = this.songs[this.themeId] || this.songs.anthem;
      if (song) this.sfx.playSong(song);
    }
    this.music = 'title';
  }
  musicFor(which) {
    if (which === 'menu') {
      if (this.music !== 'title' && this.audioReady) this._playTheme();
    } else if (this.music) {
      this.sfx.stopSong(0.7);
      this.custom.stop(0.7);
      this.music = null;
    }
  }
  // restart=true is the title film looping back to its first shot. A recording just keeps playing.
  startTitleMusic(restart = false) {
    if (!this.audioReady) return;
    if (this.music === 'title' && (!restart || this.themeId === 'custom')) return;
    this._playTheme();
  }

  cycleTheme() {
    if (!this.audioReady) return;
    const list = this.themeList();
    this.themeId = list[(list.indexOf(this.themeId) + 1) % list.length];
    writePref(this.themeId);
    this.toast('MUSIC: ' + this.themeName());
    this._themeChanged();
  }
  _themeChanged() {
    const wasOn = this.music === 'title';
    this.music = null; // force the new theme to start from its top
    if (this.screen && this.screen.restartFilm) this.screen.restartFilm(); // the film is cut to the tune's tempo
    else if (wasOn) this._playTheme();
  }

  // A file dropped on the window becomes the title music.
  async dropMusicFile(file) {
    if (!file) return;
    if (!this.audioReady) {
      this.pendingDrop = file;
      this.toast('YOUR MUSIC LOADS WHEN SOUND STARTS');
      return;
    }
    try {
      await this.custom.setFile(file);
    } catch (err) {
      this.toast('CANNOT PLAY THAT FILE');
      return;
    }
    this.themeId = 'custom';
    writePref('custom');
    this.toast('TITLE MUSIC: ' + this.themeName());
    this._themeChanged();
  }

  toast(text, seconds = 3.2) { this.toastText = text; this.toastT = seconds; }

  // Audio can only start after a user gesture, so it begins on the first key press.
  async startAudioThenTitle() {
    if (this.audioStarting) return;
    this.audioStarting = true;
    this.loadingText = 'SYNTHESISING SOUND...';
    await new Promise((r) => setTimeout(r, 30));
    try {
      const samples = [...generateMusicSamples(), ...generateAnthemSamples(), ...generateSfxSamples()];
      const anthem = buildAnthemSong(), bayPatrol = buildTitleSong();
      this.songs = { anthem, baypatrol: bayPatrol };
      this.sfx.jingles = { success: buildSuccessJingle(), fail: buildFailJingle() };
      this.sfx.setSamples(samples);
      const ok = await this.audio.start(WORKLET_SOURCE, samples);
      if (!ok) this.sfx.muted = true;
      this.audioReady = ok;
      if (ok) {
        const pref = readPref();
        await this.custom.restore();
        if (this.pendingDrop) {
          const f = this.pendingDrop;
          this.pendingDrop = null;
          await this.custom.setFile(f).then(() => { this.themeId = 'custom'; writePref('custom'); }, () => this.toast('CANNOT PLAY THAT FILE'));
        } else if (pref === 'custom' && this.custom.ready) this.themeId = 'custom';
        else if (pref === 'baypatrol') this.themeId = 'baypatrol';
      }
    } catch (err) {
      console.error('audio failed', err);
      this.sfx.muted = true;
    }
    this.setScreen(new TitleScreen(this));
  }

  // ---- frame ----
  frame(dt) {
    this.fps += (1 / Math.max(dt, 1e-3) - this.fps) * 0.05;
    const s = this.screen;
    if (s) s.update(dt);
    this.flash = Math.max(0, this.flash - dt * 2.4);
    if (s) {
      this.gfx.setClip(0, 0, 320, 256);
      s.render(this.gfx);
    }
    if (this.toastT > 0) {
      this.toastT -= dt;
      this.gfx.setClip(0, 0, 320, 256);
      this.gfx.rect(0, 239, 320, 17, C.BLACK);
      this.gfx.textC(this.toastText, 160, 246, C.YELLOW, FONT_SMALL);
    }
    this.gfx.setPalette(FLIGHT_PALETTE, this.fade, this.flash, this.whiteFlash);
    this.display.present(this.gfx);
    this.input.endFrame();
  }
}
