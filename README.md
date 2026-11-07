# F/A-18 Interceptor (remake)

A from-scratch remake of **F/A-18 Interceptor**, the 1988 Amiga flight simulator by Bob Dinnerman (Intellisoft / Electronic Arts). It is built with plain JavaScript and a canvas: a software 3D rasteriser, a model of the Amiga's Paula sound chip, and the real San Francisco Bay generated from public elevation data. No original code, art or sound is used. Everything on screen and in your ears is made by this project.

The goal is the *feel* of the original: flat-shaded filled polygons on a 32-colour palette, the instrument panel on a 320x256 PAL screen, a game you fly with the keyboard, carrier landings that matter, and a title theme with the weight of an 80s anthem.

## Run it

```
npm install
npm run dev        # http://localhost:8080  (rebuilds on save)
npm run build      # dist/index.html + dist/game.js, and dist/fa18-interceptor.html (one file)
npm test           # audio, flight model, missions, camera handedness, scaling, input fuzzing
npm run verify:display   # headless Chrome check that no pixel is ever interpolated
npm run verify:music     # headless Chrome check of the title music through the real audio path
npm run verify:touch     # headless Chrome check of the touch controls with emulated fingers
```

`dist/fa18-interceptor.html` is a single self-contained file: put it on any static web server. (Opening it directly from disk should work in Chrome too, but I could only verify it over http. If the browser refuses audio worklets there, the game falls back to a slower audio path.) Turn the sound up. Browsers only start audio after a key press, so the first screen waits for one.

URL options: `?fps` shows a frame counter, `?unlock` opens every mission. Shift-L toggles scanlines. Shift-M changes the title music (on the title screen and menus; in flight M is the map). You can also **drop a sound file on the window** to use your own recording as the title music, for example a recording of the original game's intro that you own. It is played by the browser's own decoder, kept only in your browser, and never uploaded.

## How to play

The main menu is the original's:

| | |
| --- | --- |
| 1 DEMO | An ace flies an intercept for you |
| 2 FREE FLIGHT | No enemies. Start at SFO, Alameda, Moffett Field, the carrier, or in the air. Choose F-16 or F/A-18 |
| 3 DEMO OF MANEUVERS | Ride along while the instructor flies seven real aerobatic maneuvers |
| 4 PRACTICE MANEUVERS | Follow him. Press fire for the next maneuver |
| 5 QUALIFICATION | Carrier take-off, fly the bay, deal with two bogeys, land on the carrier |
| 6 / 7 MISSIONS | Unlocked by qualifying (Shift-U at the menu unlocks them at once) |
| 8 FLIGHT LOG | Missions, weapons fired, hits, flight time, crashes |

Press **Tab** in flight for the controls overlay.

### Controls

The keys follow the original manual. Alternates are there for keyboards without a numeric keypad.

| Key | Action |
| --- | --- |
| Cursor up / down | Nose down / nose up (hold a key and the deflection builds) |
| Cursor left / right | Roll |
| `,` and `.` | Rudder |
| F1-F10, or PgUp/PgDn | Throttle in 10% steps. F10 twice lights the afterburner, F1 twice shuts the engine down |
| Backspace | Brakes on the ground, speed brake in the air |
| G, A | Landing gear, arrestor hook |
| H, M, R | HUD on/off, map on the HSI, radar range (2, 10, 40 miles) |
| T, Enter, Space | Next target, select weapon (AIM-9, AIM-120, cannon), fire (hold for the cannon) |
| J, C, F | ECM jammer, chaff, flare |
| Shift-F, Shift-E | Drop the rescue pod, eject |
| V or keypad Enter | Cockpit / chase view. Shift-keypad Enter or B for the tower view |
| `[` and `]` | Zoom |
| Keypad 4 6 2 1 7 8 | Look left, right, back, down, up, forward (5 locks the head). In chase view they choose the camera angle. Q and E also look or orbit |
| P, Esc, Shift-Esc | Pause, restart the flight, back to the menu |

### Touch screens

Phones and tablets work. Touch the screen once and the controls appear on top of the game (they stay hidden on a desktop, and hide again when you press a key). The picture itself is never changed.

In flight: put a finger anywhere on the left half and drag for a floating stick (pull down to climb, like a real stick). `<` `>` are the rudder, BRK the brake. The slider on the right is the throttle, AB the afterburner. FIRE (hold it for the cannon), WPN, TGT, GEAR, HOOK, FLARE and CHAFF do what their keys do, and you can use several at once. `II` pauses, `FULL` goes fullscreen (not on iPhone), and `...` opens a drawer with HUD, MAP, RADAR, views, zoom, look, ECM, pod, help, restart and menu. EJECT, RESTART and MENU ask for a second tap. In menus a number pad appears, and tapping a menu line picks it. Landscape is best. On iPhone, the ringer switch mutes web audio.

`npm run verify:touch` drives headless Chrome with emulated fingers at six phone and tablet sizes.

Basic gamepad support is included but has not been tried on real hardware: stick to fly, triggers for rudder, A fire, B weapon, X target, Y view, bumpers for gear and hook.

### The missions

1. **Visual Confirmation.** Find and identify an unknown aircraft. Do not fire unless fired upon. It might be MiGs, or it might be an airliner you must not shoot.
2. **Emergency Defense Operation.** Keep hostile fighters off Air Force One until it lands at SFO.
3. **Intercept Stolen Aircraft.** Two stolen F-16s with ECM and MiG escorts are running for the coast. Fly in front of them to signal surrender, or stop them.
4. **Search and Rescue.** Find a downed pilot near the Farallon Islands and drop the pod within his reach.
5. **Intercept Incoming Cruise Missile.** A small target at 200 feet, following the terrain, headed for San Francisco.
6. **Carrier Sub Mission.** A submersible aircraft carrier and its air wing. It can be sunk.

Every mission ends with a landing on a runway or the carrier. Repeating a mission makes the enemy harder.

### Carrier landings

Come in from astern on the angled deck, gear and hook down, around 150 knots, on a 3.5 degree glideslope. Catch a wire. The Enterprise is moving, the deck is only 17 m either side of the line, and a hard or crooked arrival ends the flight.

## How it works

**Rendering.** The whole picture, 3D view, instruments and text alike, is one native 320x256 PAL screen with a 32-colour palette sampled from screenshots of the original, so every pixel is the same size, as on the Amiga. The 3D is drawn by a small scanline rasteriser in JavaScript: filled convex polygons with a 1/z buffer. The picture is only ever scaled up, and never interpolated: every game pixel becomes an identical whole-number block of screen pixels (nearest-neighbour), the canvas is sized to the exact device pixels of the window so the browser never resamples it, and the pixel shape is chosen to land near a 4:3 tube. `npm run verify:display` proves it: it drives headless Chrome through a flight at six display scales, on both the WebGL and the 2D-canvas paths, and checks that every game pixel is a solid block and only palette colours appear. Fonts are hand-made bitmaps, and the cockpit panel is laid out from measurements of reference screenshots.

**The world.** `npm run world` downloads AWS terrain tiles, contours the real coastline, and builds an adaptive low-poly terrain mesh clipped to the shore. Runway positions, bridges and landmarks come from OpenStreetMap. Golden Gate and Bay Bridge cables, Hangar One, Sutro Tower, the Transamerica Pyramid and the Farallones are all at their real coordinates. The result is checked in as `src/world/data.gen.js`, so building the game needs no network.

**Flight model.** Fly-by-wire: the stick commands load factor, so letting go holds the flight path. Aerodynamics have lift, induced and transonic drag, stalls, ceiling and a hard-landing limit. A "classic" tuning gives the original's missile-like acceleration. Autopilots fly the same model: the instructor's loops and split-S are real, as are the demo pilot's dogfights and a carrier-landing pilot that the tests use to check the arresting gear.

**Sound.** `src/audio/paula-engine.js` models the Amiga's Paula chip: four hard-panned channels playing 8-bit samples at integer hardware periods, the A500's output filter, and extra voices for effects. It runs inside an AudioWorklet, and the same class renders offline in Node for tests. Every sample is synthesised at start-up and quantised to 8 bits.

- *Title theme, "Anthem" (the default).* The original's intro is remembered as an atmospheric title track in the vein of the Top Gun anthem: a deep FM bell hook, a drum-machine groove and a heroic rock lead. No note of it is available to copy, so this is an original piece written to that character, for four channels at 104 BPM: a lone 808 loop and a rising swell, a tubular-bell hook over pads in E minor, a singing lead guitar stating the theme, a chorus in G, and a last chorus lifted a tone into A major. The bell and the guitar ring into a dotted-eighth stereo echo (`setEcho` in the engine, applied to the lead channel only, like a keyboard player's delay pedal). The samples are two-operator FM bells, a cleaner lead guitar and a TR-808-style kit (`src/audio/samples-anthem.js`), the song is in `src/audio/song-anthem.js`, and `test/anthem.test.mjs` checks tuning, that held notes are chord tones, the key change, the echo timing and that the shots of the title film start exactly on the song's sections.
- *Alternate theme, "Bay Patrol".* The earlier 92 BPM rock anthem (horn call, driven guitars, gated-reverb snare, an arpeggio bridge) in `src/audio/song-title.js`. Shift-M cycles Anthem, Bay Patrol and your own recording if you dropped one in; the title film re-cuts itself to the tempo of the tune that is playing.
- *Your own recording.* `src/audio/custom-music.js` plays a dropped sound file (anything the browser can decode) on the title and menus and remembers it in IndexedDB. Nothing is bundled or downloaded. `npm run verify:music` drives headless Chrome through all of this and taps the speaker output.
- *Effects.* (The tests also check the 100 Hz buzz of the Vulcan cannon.) Throttle-driven engine layers with Doppler in the external views, afterburner, wind, stall buffet, 6000 rpm cannon, missiles, chaff, explosions delayed by the speed of sound, hydraulics, catapult, arresting wire, cockpit warning tones and a seeker growl, radio squelch and the floppy-drive clicks of the loading screen.
- `npm run audio` renders both themes and every effect to WAV files and spectrograms in `audio-preview/`, with a mix sheet (level and tone balance per section, level per channel). `node tools/render-audio.mjs anthem` renders only the Anthem.

## Project layout

```
src/sim/       flight model, carrier, weapons, AI, autopilots, simulation core (no DOM)
src/missions/  the six missions and the qualification flight
src/world/     geography, generated terrain, landmark models, collision
src/gfx/       framebuffer and rasteriser, palette, fonts, models, display
src/ui/        cockpit panel and HUD, coastline map, widgets
src/screens/   title cinematic, menus, flight screen
src/audio/     Paula engine, synthesis, songs, sound director
tools/         build, dev server, world and audio generators, headless screenshot tools
test/          node --test suites
```

Handy headless tools (no browser needed): `node tools/shot-screens.mjs 2` renders every screen to `shots/`, `node tools/shot-title.mjs <scene> <t...>` renders title-sequence frames, `node tools/shot-models.mjs` makes a contact sheet of every model.

## Credits and data

- The original F/A-18 Interceptor: Bob Dinnerman (design, programming), Intellisoft, Electronic Arts, 1988. Music by David Warhol. This is a tribute and shares none of their assets.
- Terrain: [AWS Open Data Terrain Tiles](https://registry.opendata.aws/terrain-tiles/), which combine USGS 3DEP, SRTM, ETOPO1 and other public elevation sources.
- Runways, bridges and landmark positions: OpenStreetMap contributors, ODbL.
- Game facts (weapons, key map, mission premises) are from the original manual and published reviews, rewritten here.

## Known limits

- Mission 6's original carrier famously could not be destroyed. This one can.
- No copy-protection code wheel, on purpose.
- Aircraft damage is simple: hit points with degraded engine and handling, not per-system failures.
- Only tested in current Chrome. Audio needs AudioWorklet or falls back to a main-thread ScriptProcessor.
