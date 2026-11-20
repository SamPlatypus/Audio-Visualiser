# Auralis — offline music visualizer

Auralis is a mobile-first music visualizer that reacts to your **microphone** or to **audio files on your device**, with 16 visualizers, 10 colour themes and controls that fade away while the music plays. It works fully offline. It installs to your home screen as a web app (PWA), and it can also be packaged as a native Android app with Capacitor.

Your audio never leaves the device. There is no network access, analytics or tracking.

## Features

**Sound sources**
- **Microphone**: reacts to music playing around you. Echo cancellation, noise suppression and auto-gain are switched off so the music isn't filtered.
- **Audio files**: pick one or more tracks (MP3, M4A/AAC, WAV, OGG/Opus, FLAC, WebM, and anything else the platform can decode). They play as a playlist with play/pause, previous/next and a seek bar. You can also drag and drop files on desktop.
- **Demo beat**: a generative synth loop built from Web Audio oscillators, so you can try the app without a mic or files.
- Lock-screen and notification media controls (Media Session API) for file playback.

**Visualizers** (swipe left or right to change)

| Family | Modes |
| --- | --- |
| Bars | **Spectrum** (falling peaks and a floor reflection), **Mirror** (symmetric, from a glowing centre line), **Equalizer** (segmented LED columns) |
| Circular | **Radial** (bars around a core that pulses with the bass), **Halo** (rings, one per frequency range), **Bloom** (layered kaleidoscopic petals) |
| Spiral | **Galaxy** (star-filled arms that spin faster as the music builds), **Sunflower** (golden-angle seeds whose spiral shifts with the mids), **Vortex** (the spectrum wound into a twin spiral) |
| Fractal | **Fractal Tree** (each branching level follows a different frequency range), **Julia** (a GPU Julia set that splinters and re-forms on the bass), **Kaleido** (a folding kaleidoscope fractal) |
| Waveform | **Oscilloscope** (a stable triggered trace), **Ring Wave** (the waveform bent into loops), **Lissajous** (an XY vectorscope: mid/side for stereo, a phase plot for mono), **Terrain** (ridgelines of recent sound) |

**Colour themes** (swipe up or down): Neon, Sunset, Ocean, Aurora, Inferno, Vaporwave, Prism, Lime, Rose Gold and Mono. Optional colour cycling slides the palette over time. Themes also recolour the UI and the background.

**Controls**
- **Sensitivity**: a log-scale slider from 0.25× to 4× with a live input meter, plus an **Auto level** switch that keeps both quiet and loud input filling the screen.
- **Fullscreen**: double-tap, or use the button. iPhone Safari has no Fullscreen API, so there the button switches to an immersive mode that hides every control; added to the home screen, the app opens full screen.
- **Auto-cycle**: switch visualizers every 15, 30 or 60 seconds, or on big beats ("On drops").
- **Settings**: smoothing, motion trails, beat reaction, glow, quality (Auto, High, Balanced, Battery at 30 fps), stats overlay (fps, render scale, estimated BPM), how long before controls hide, and keep screen awake.
- Settings are saved on the device.

**Gestures and keys**

| Touch | Keyboard | Action |
| --- | --- | --- |
| Tap | H | Show or hide controls |
| Swipe ← → | ← → | Previous or next visualizer |
| Swipe ↑ ↓ | ↑ ↓ | Change colour theme |
| Double-tap | F | Fullscreen |
| | Space | Play or pause |
| | + / − | Sensitivity |
| | M / O | Microphone / open files |

## How the controls stay out of the way

The top bar and dock are small translucent "glass" panels. They fade out a few seconds after your last touch while something is playing (you can set the delay), and the mouse cursor hides too. A tap anywhere brings them back. Pickers open as bottom sheets that cover only part of the screen, so the visuals stay in view while you choose. Mode and theme changes show a brief title that fades out on its own.

## Smoothness

- Every animation and smoothing step is time-based (`dt`), so motion looks the same at 30, 60 or 120 Hz.
- The analyser uses a 4096-point FFT folded into 96 log-spaced bands, with a +3 dB/octave tilt so treble is visible. Each band has fast-attack/slow-release smoothing and peak markers that fall under gravity.
- Beat detection compares the instant bass level with time-based running statistics, and the tempo comes from the gaps between beats.
- The frame loop does not allocate: buffers, colour strings and glow sprites are reused, and lines are batched by colour, so a frame takes only a handful of draw calls.
- Motion trails fade a transparent canvas over a CSS background (`destination-out`), which costs much less than repainting a gradient every frame.
- Shader modes render at reduced resolution, and changing visualizer cross-fades from a snapshot of the last frame.
- **Adaptive quality** watches frame pacing. If frames start dropping it lowers the render resolution, and it raises it again when there is headroom.

## Install on a phone

The app has to be served over **HTTPS** (or from `localhost`), because browsers only allow microphone access and offline caching in a secure context.

1. Build it with `npm run build` and host the `dist/` folder on any static host (GitHub Pages, Netlify, your own server). Paths are relative, so a sub-folder works.
2. Open the address on your phone:
   - **Android (Chrome)**: menu → *Install app* (or *Add to Home screen*).
   - **iPhone (Safari)**: Share → *Add to Home Screen*.
3. Open it once while online. After that it runs **fully offline**. When a new version has been downloaded, the app shows a "tap to update" message instead of reloading under you.

## Native Android app (Capacitor)

The `android/` folder is a ready Capacitor project with the microphone permission, Auralis icons and a dark splash screen. It runs edge-to-edge in immersive mode.

Requirements: JDK 21 and the Android SDK (Android Studio installs both).

```bash
npm install
npm run cap:sync          # build the web app and copy it into android/
npx cap open android      # open in Android Studio, then Run ▶
# or build a debug APK from the command line:
npm run android:apk       # → android/app/build/outputs/apk/debug/app-debug.apk
```

`npm run android:assets` regenerates the launcher icons and splash screens from `public/icons/icon.svg`. For iOS, run `npx cap add ios` on a Mac with Xcode. You will also need to add `NSMicrophoneUsageDescription` to `ios/App/App/Info.plist`.

## Development

```bash
npm install
npm run dev        # dev server (service worker disabled)
npm test           # unit tests (analysis, beat detection, settings, themes)
npm run build      # type-check + production build into dist/
npm run e2e        # end-to-end test in headless Chromium (phone emulation)
```

`npm run e2e` serves the production build and drives it like a phone. It feeds a generated stereo music loop into a fake microphone, uploads the same loop as a file, and then exercises every visualizer, the gestures, the sheets, the sensitivity control, play/pause/seek, a corrupt file, settings persistence and an offline reload. Screenshots are written to `test-output/`. It uses the Playwright + Chromium available on the machine (it is not a project dependency).

### Project layout

```
src/
  audio/
    analysis.ts     FFT → log bands, auto level, smoothing, peaks, waveform normalisation
    beat.ts         beat detection and tempo estimate
    demo.ts         built-in generative synth loop
    engine.ts       AudioContext, sources (mic / file / demo), analysis frame
  render/
    renderer.ts     canvases, render loop, trails, cross-fades, adaptive quality
    themes.ts       palettes, lookup tables, colour cycling
    gl.ts           WebGL helpers (shader pass, palette texture)
    modes/          the 16 visualizers, grouped by family
  ui/
    controls.ts     dock, sheets, popover, toasts, auto-hide
    gestures.ts     tap / double-tap / swipe recognition
  state/settings.ts persisted, validated settings
  platform/         fullscreen, wake lock, media session helpers
  app.ts            wires everything together; main loop, playlist, auto-cycle
sw/sw-template.js   offline service worker (asset list injected at build time)
android/            Capacitor Android project
scripts/            icon generation, end-to-end test, test-track generator
```

### Adding a visualizer

Write a factory in `src/render/modes/` that returns a `Visualizer2D` (or a `VisualizerGL` for a shader), and add it to `createModes()` in `src/render/modes/index.ts`. The `AudioFrame` it receives includes `bands` (96 smoothed values from 0 to 1, bass first), `peaks`, `wave`, `waveL`/`waveR`, `bass`, `mid`, `treble`, `energy`, a decaying `beat` pulse and `dt`. Use `theme.color(t)` to pick colours from the active palette.

## Browser support

Current Chrome, Edge, Firefox and Safari on Android, iOS and desktop. WebGL is only needed for the Julia and Kaleido modes; they are hidden automatically if WebGL is unavailable. Wake lock and Media Session are used where the browser supports them.
