import { AudioEngine, AudioError } from './audio/engine';
import { WakeLock, fullscreen, haptic, isStandalone, mediaSession } from './platform/platform';
import { createModes } from './render/modes';
import { Renderer } from './render/renderer';
import { THEMES, ThemeRuntime, findTheme } from './render/themes';
import type { AudioFrame, Visualizer } from './render/types';
import { DEFAULTS, SettingsStore, type Settings } from './state/settings';
import { Controls, sensToSlider, sliderToSens, type SourceState } from './ui/controls';
import { attachGestures } from './ui/gestures';

const AUDIO_EXT = /\.(mp3|m4a|aac|wav|wave|ogg|oga|opus|flac|weba|webm|mp4|caf|aif|aiff)$/i;

const prettyName = (file: File) =>
  file.name.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').trim() || file.name;

/** Wires audio, rendering, settings and the touch UI together and runs the frame loop. */
export class App {
  readonly engine = new AudioEngine();
  readonly theme: ThemeRuntime;
  readonly renderer: Renderer;
  readonly modes: Visualizer[];
  readonly settings: SettingsStore;
  readonly controls: Controls;

  private wake = new WakeLock();
  private fileInput = document.getElementById('file-input') as HTMLInputElement;
  private playlist: File[] = [];
  private trackIndex = -1;
  private lastT = 0;
  private lastUi = 0;
  private lastStats = 0;
  private cycleElapsed = 0;
  private cycleEnergy = 0;
  private lastBeatCount = 0;
  private immersive = false;

  constructor() {
    const stage = document.getElementById('stage')!;
    const all = createModes();
    // Renderer probes WebGL; shader modes are dropped if it's unavailable.
    this.renderer = new Renderer(stage, all[0]);
    this.modes = all.filter((m) => m.kind === '2d' || this.renderer.glAvailable);

    this.settings = new SettingsStore(
      this.modes.map((m) => m.id),
      THEMES.map((t) => t.id),
    );
    const s = this.settings.value;
    this.theme = new ThemeRuntime(findTheme(s.theme));

    this.controls = new Controls(this.modes, {
      useMic: () => void this.useMic(),
      openFiles: () => this.openFiles(),
      useDemo: () => this.useDemo(),
      stopSource: () => this.engine.stop(),
      togglePlay: () => this.togglePlay(),
      prev: () => this.stepTrack(-1),
      next: () => this.stepTrack(1),
      seek: (x) => this.engine.seek(x * this.engine.duration),
      selectMode: (id) => this.selectMode(id),
      selectTheme: (id) => this.selectTheme(id),
      playTrack: (i) => void this.playTrack(i),
      clearPlaylist: () => this.clearPlaylist(),
      toggleFullscreen: () => void this.toggleFullscreen(),
      update: (patch) => this.settings.update(patch),
      reset: () => this.settings.update({ ...DEFAULTS, hintsSeen: true }),
      canAutoHide: () => this.engine.playing,
    });

    this.settings.onChange((v, changed) => this.applySettings(v, changed));
    this.applySettings(s, Object.keys(s) as (keyof Settings)[]);
    this.renderer.setMode(this.currentMode(), false);

    this.engine.addEventListener('change', () => this.onEngineChange());
    this.engine.media.addEventListener('ended', () => this.onTrackEnded());
    this.engine.addEventListener('mediaerror', () => this.onMediaError());
    this.onEngineChange();

    attachGestures(
      stage,
      {
        tap: () => this.controls.stageTap(),
        doubleTap: () => void this.toggleFullscreen(),
        swipe: (dir) => this.onSwipe(dir),
        activity: () => {
          if (this.engine.contextSuspended) void this.engine.wake();
        },
      },
      () => !this.controls.isHidden,
    );

    this.fileInput.addEventListener('change', () => {
      const files = [...(this.fileInput.files ?? [])];
      this.fileInput.value = '';
      if (files.length) void this.addFiles(files);
    });
    this.bindDragDrop();
    this.bindKeyboard();
    fullscreen.onChange(() => this.controls.setFullscreenIcon(fullscreen.active));
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') void this.engine.wake();
    });

    mediaSession.bind({
      play: () => void this.engine.play(),
      pause: () => this.engine.pause(),
      next: () => this.stepTrack(1),
      previous: () => this.stepTrack(-1),
      seek: (t) => this.engine.seek(t),
    });

    requestAnimationFrame(this.loop);
  }

  // --------------------------------------------------------------- settings

  private currentMode(): Visualizer {
    return this.modes.find((m) => m.id === this.settings.value.mode) ?? this.modes[0];
  }

  private applySettings(s: Settings, changed: (keyof Settings)[]): void {
    const has = (k: keyof Settings) => changed.includes(k);
    this.engine.spectrum.settings = {
      sensitivity: s.sensitivity,
      autoLevel: s.autoLevel,
      smoothing: s.smoothing,
    };
    this.renderer.options = { trails: s.trails, glow: s.glow, beatReact: s.beatReact };
    this.theme.cycleSpeed = s.colorCycle * s.colorCycle * 0.3;
    if (has('quality')) this.renderer.setQuality(s.quality);
    if (has('mode')) this.renderer.setMode(this.currentMode());
    if (has('theme')) {
      this.theme.set(findTheme(s.theme));
      this.applyThemeCss();
    }
    if (has('keepAwake')) this.updateWakeLock();
    if (has('autoCycle')) this.cycleElapsed = 0;
    this.controls.syncSettings(s);
  }

  private applyThemeCss(): void {
    const t = this.theme.theme;
    const root = document.documentElement.style;
    root.setProperty('--bg1', t.bg[0]);
    root.setProperty('--bg2', t.bg[1]);
    root.setProperty('--accent', t.stops[Math.min(1, t.stops.length - 1)]);
    root.setProperty('--accent2', t.stops[t.stops.length - 1]);
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', t.bg[1]);
  }

  selectMode(id: string, toast = true): void {
    const mode = this.modes.find((m) => m.id === id);
    if (!mode) return;
    this.settings.update({ mode: id });
    this.cycleElapsed = 0;
    if (toast) this.controls.title(mode.name, mode.category);
  }

  private stepMode(dir: number): void {
    const i = this.modes.indexOf(this.currentMode());
    const next = this.modes[(i + dir + this.modes.length) % this.modes.length];
    this.selectMode(next.id);
  }

  selectTheme(id: string, toast = true): void {
    this.settings.update({ theme: id });
    if (toast) this.controls.title(findTheme(id).name, 'Colours');
  }

  private stepTheme(dir: number): void {
    const i = THEMES.findIndex((t) => t.id === this.settings.value.theme);
    const next = THEMES[(i + dir + THEMES.length) % THEMES.length];
    this.selectTheme(next.id);
  }

  private onSwipe(dir: 'left' | 'right' | 'up' | 'down'): void {
    if (this.controls.closeSheet()) return;
    haptic();
    if (dir === 'left') this.stepMode(1);
    else if (dir === 'right') this.stepMode(-1);
    else if (dir === 'up') this.stepTheme(1);
    else this.stepTheme(-1);
  }

  // ---------------------------------------------------------------- sources

  private async useMic(): Promise<void> {
    try {
      await this.engine.useMicrophone();
      this.controls.message('Listening — play some music nearby');
      this.markStarted();
    } catch (err) {
      this.showError(err);
    }
  }

  private useDemo(): void {
    try {
      this.engine.useDemo();
      this.markStarted();
    } catch (err) {
      this.showError(err);
    }
  }

  private openFiles(): void {
    this.fileInput.click();
  }

  private async addFiles(files: File[]): Promise<void> {
    const audio = files.filter((f) => f.type.startsWith('audio/') || AUDIO_EXT.test(f.name) || f.type === 'video/mp4');
    if (!audio.length) {
      this.controls.message('Those files don’t look like audio.', { error: true });
      return;
    }
    const start = this.playlist.length;
    this.playlist.push(...audio);
    if (this.engine.source !== 'file' || !this.engine.playing) {
      await this.playTrack(start);
    } else {
      this.controls.message(`Added ${audio.length} track${audio.length > 1 ? 's' : ''} to the playlist`);
      this.onEngineChange();
    }
  }

  private async playTrack(i: number): Promise<void> {
    const file = this.playlist[i];
    if (!file) return;
    this.trackIndex = i;
    try {
      await this.engine.playFile(file);
      this.markStarted();
    } catch (err) {
      this.showError(err);
    }
    this.onEngineChange();
  }

  private stepTrack(dir: number): void {
    if (this.engine.source !== 'file') return;
    if (dir < 0 && this.engine.currentTime > 3) {
      this.engine.seek(0);
      return;
    }
    const next = this.trackIndex + dir;
    if (next >= 0 && next < this.playlist.length) void this.playTrack(next);
  }

  private onTrackEnded(): void {
    if (this.engine.source === 'file' && this.trackIndex < this.playlist.length - 1) {
      void this.playTrack(this.trackIndex + 1);
    }
  }

  private onMediaError(): void {
    const name = this.playlist[this.trackIndex]?.name ?? 'This file';
    this.controls.message(`“${name}” can’t be played on this device.`, { error: true });
    if (this.trackIndex < this.playlist.length - 1) void this.playTrack(this.trackIndex + 1);
  }

  private clearPlaylist(): void {
    if (this.engine.source === 'file') this.engine.stop();
    this.playlist = [];
    this.trackIndex = -1;
    this.onEngineChange();
  }

  private togglePlay(): void {
    if (this.engine.source === 'none') {
      if (this.playlist.length) void this.playTrack(Math.max(0, this.trackIndex));
      return;
    }
    this.engine.togglePlay();
  }

  private markStarted(): void {
    if (!this.settings.value.hintsSeen) {
      this.settings.update({ hintsSeen: true });
      window.setTimeout(() => this.controls.message('Tip: swipe sideways to change visualizer, up/down for colours', { duration: 4200 }), 1600);
    }
  }

  private showError(err: unknown): void {
    const msg = err instanceof AudioError ? err.message : 'Something went wrong starting audio.';
    if (!(err instanceof AudioError)) console.error(err);
    this.controls.message(msg, { error: true });
  }

  private onEngineChange(): void {
    const e = this.engine;
    const file = e.source === 'file';
    const title = file
      ? this.playlist[this.trackIndex]
        ? prettyName(this.playlist[this.trackIndex])
        : 'Audio file'
      : e.source === 'demo'
        ? 'Demo beat'
        : '';
    const st: SourceState = {
      source: e.source,
      playing: e.playing,
      canPause: e.canPause || (e.source === 'none' && this.playlist.length > 0),
      title,
      playlist: this.playlist.map(prettyName),
      index: this.trackIndex,
    };
    this.controls.syncSource(st);

    if (file || e.source === 'demo') {
      mediaSession.setTrack(title, file ? `Track ${this.trackIndex + 1} of ${this.playlist.length}` : 'Auralis');
      mediaSession.setState(e.playing ? 'playing' : 'paused');
    } else {
      mediaSession.setState('none');
    }
    this.updateWakeLock();
  }

  private updateWakeLock(): void {
    void this.wake.set(this.settings.value.keepAwake && this.engine.source !== 'none' && this.engine.playing);
  }

  // ------------------------------------------------------------- fullscreen

  private async toggleFullscreen(): Promise<void> {
    if (fullscreen.supported) {
      if (fullscreen.active) await fullscreen.exit();
      else {
        const ok = await fullscreen.enter(document.documentElement);
        if (ok) this.controls.hideNow();
      }
      return;
    }
    // iPhone Safari has no Fullscreen API: fall back to an immersive mode
    // that hides every control until the next tap.
    this.immersive = !this.immersive;
    if (this.immersive) {
      this.controls.hideNow();
      if (!isStandalone()) {
        this.controls.message('For true fullscreen, use Share → Add to Home Screen', { duration: 3800 });
      }
    } else this.controls.poke();
  }

  // ----------------------------------------------------------------- input

  private bindDragDrop(): void {
    window.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    });
    window.addEventListener('drop', (e) => {
      e.preventDefault();
      const files = [...(e.dataTransfer?.files ?? [])];
      if (files.length) void this.addFiles(files);
    });
  }

  private bindKeyboard(): void {
    window.addEventListener('keydown', (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement;
      if (target instanceof HTMLInputElement) return;
      const s = this.settings.value;
      const nudge = (d: number) => {
        const sens = sliderToSens(Math.max(0, Math.min(1000, sensToSlider(s.sensitivity) + d)));
        this.settings.update({ sensitivity: sens });
        this.controls.message(`Sensitivity ${sens.toFixed(2)}×`, { duration: 900 });
      };
      let handled = true;
      switch (e.key) {
        case ' ':
          if (target instanceof HTMLButtonElement) return;
          this.togglePlay();
          break;
        case 'ArrowRight':
          this.stepMode(1);
          break;
        case 'ArrowLeft':
          this.stepMode(-1);
          break;
        case 'ArrowUp':
          this.stepTheme(-1);
          break;
        case 'ArrowDown':
          this.stepTheme(1);
          break;
        case '+':
        case '=':
          nudge(50);
          break;
        case '-':
        case '_':
          nudge(-50);
          break;
        case 'f':
        case 'F':
          void this.toggleFullscreen();
          break;
        case 'h':
        case 'H':
          if (this.controls.isHidden) this.controls.poke();
          else this.controls.hideNow();
          break;
        case 'm':
        case 'M':
          void this.useMic();
          break;
        case 'o':
        case 'O':
          this.openFiles();
          break;
        case 'Escape':
          if (!this.controls.closeSheet() && !this.controls.closePopover()) handled = false;
          break;
        default:
          handled = false;
      }
      if (handled) {
        e.preventDefault();
        if (e.key !== 'h' && e.key !== 'H') this.controls.poke();
      }
    });
  }

  // -------------------------------------------------------------- the loop

  private loop = (now: number): void => {
    requestAnimationFrame(this.loop);
    if (!this.renderer.shouldRender(now)) return;
    const t = now / 1000;
    const dt = this.lastT ? Math.min(0.1, Math.max(0.001, t - this.lastT)) : 1 / 60;
    this.lastT = t;

    this.theme.update(dt);
    const frame = this.engine.analyse(t, dt, !!this.renderer.mode.needsStereo);
    this.renderer.render(frame, this.theme, now);
    this.autoCycle(frame, dt);

    if (now - this.lastUi > 200) {
      this.lastUi = now;
      if (this.engine.source === 'file') {
        this.controls.syncTime(this.engine.currentTime, this.engine.duration);
        mediaSession.setPosition(this.engine.currentTime, this.engine.duration);
      }
    }
    this.controls.setMeter(frame.level);
    if (this.settings.value.showStats && now - this.lastStats > 500) {
      this.lastStats = now;
      const r = this.renderer;
      this.controls.setStats(
        `${r.fps} fps · ${Math.round(r.renderScale * 100)}% res\n` +
          `${frame.bpm ? `${frame.bpm} BPM` : '— BPM'} · lvl ${Math.round(frame.level * 100)}`,
      );
    }
  };

  private autoCycle(f: AudioFrame, dt: number): void {
    const mode = this.settings.value.autoCycle;
    if (mode === 'off' || !f.active) return;
    this.cycleElapsed += dt;
    this.cycleEnergy += (f.energy - this.cycleEnergy) * Math.min(1, dt / 6);
    const beatNow = f.beatCount !== this.lastBeatCount;
    this.lastBeatCount = f.beatCount;
    let go = false;
    if (mode === 'beat') {
      // Switch on a strong beat after a while — "drops" make the best moments.
      go =
        beatNow &&
        ((this.cycleElapsed > 12 && f.energy > this.cycleEnergy * 1.2 + 0.03) || this.cycleElapsed > 45);
    } else {
      go = this.cycleElapsed >= Number(mode) && (beatNow || this.cycleElapsed >= Number(mode) + 3);
    }
    if (!go) return;
    const others = this.modes.filter((m) => m.id !== this.settings.value.mode);
    const next = others[Math.floor(Math.random() * others.length)];
    this.selectMode(next.id, !this.controls.isHidden);
  }
}
