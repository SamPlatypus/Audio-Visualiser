import type { SourceKind } from '../audio/engine';
import { THEMES, ThemeRuntime } from '../render/themes';
import { CATEGORIES, type Visualizer } from '../render/types';
import { SENSITIVITY_MAX, SENSITIVITY_MIN, type Settings } from '../state/settings';

export interface ControlActions {
  useMic(): void;
  openFiles(): void;
  useDemo(): void;
  stopSource(): void;
  togglePlay(): void;
  prev(): void;
  next(): void;
  seek(fraction: number): void;
  selectMode(id: string): void;
  selectTheme(id: string): void;
  playTrack(index: number): void;
  clearPlaylist(): void;
  toggleFullscreen(): void;
  update(patch: Partial<Settings>): void;
  reset(): void;
  /** Whether the controls may auto-hide right now (something is playing). */
  canAutoHide(): boolean;
}

export interface SourceState {
  source: SourceKind;
  playing: boolean;
  canPause: boolean;
  title: string;
  playlist: string[];
  index: number;
}

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} missing`);
  return el as T;
};

/** Log-scale mapping between a 0..1000 slider and sensitivity 0.25 – 4 (centre = 1×). */
export const sensToSlider = (s: number) =>
  Math.round((Math.log(s / SENSITIVITY_MIN) / Math.log(SENSITIVITY_MAX / SENSITIVITY_MIN)) * 1000);
export const sliderToSens = (x: number) => {
  const s = SENSITIVITY_MIN * Math.pow(SENSITIVITY_MAX / SENSITIVITY_MIN, x / 1000);
  return Math.abs(s - 1) < 0.04 ? 1 : Math.round(s * 100) / 100; // gentle detent at 1×
};

export const formatTime = (t: number): string => {
  if (!isFinite(t) || t < 0) t = 0;
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
};

function setFill(input: HTMLInputElement): void {
  const min = Number(input.min) || 0;
  const max = Number(input.max) || 100;
  const pct = ((Number(input.value) - min) / (max - min)) * 100;
  input.style.setProperty('--fill', `${pct}%`);
}

/**
 * All DOM wiring for the overlay controls: dock, sheets, popover, toasts,
 * welcome screen and the auto-hide behaviour.
 */
export class Controls {
  private body = document.body;
  private ui = $('ui');
  private dock = $('dock');
  private scrim = $('scrim');
  private toastEl = $('toast');
  private welcome = $('welcome');
  private popSens = $('pop-sens');
  private btnSens = $('btn-sens');
  private btnPlay = $<HTMLButtonElement>('btn-play');
  private btnPrev = $<HTMLButtonElement>('btn-prev');
  private btnNext = $<HTMLButtonElement>('btn-next');
  private btnSource = $('btn-source');
  private btnFs = $('btn-fullscreen');
  private track = $('track');
  private trackTitle = $('track-title');
  private trackTime = $('track-time');
  private seek = $<HTMLInputElement>('seek');
  private meterFill = $('meter-fill');
  private statsEl = $('stats');
  private sheets = ['sheet-modes', 'sheet-themes', 'sheet-source', 'sheet-settings'].map((id) => $(id));
  private openSheet: HTMLElement | null = null;
  private hidden = false;
  private hideTimer: number | null = null;
  private toastTimer: number | null = null;
  private seeking = false;
  private uiPointerDown = false;
  private hideDelay = 3;
  private modeButtons = new Map<string, HTMLButtonElement>();
  private themeButtons = new Map<string, HTMLButtonElement>();
  private lastTimeText = '';
  private modes: Visualizer[];
  private a: ControlActions;

  constructor(modes: Visualizer[], actions: ControlActions) {
    this.modes = modes;
    this.a = actions;
    this.buildModeList();
    this.buildThemeGrid();
    this.bindTransport();
    this.bindSheets();
    this.bindSettings();
    this.bindWelcome();

    // Any interaction with the controls keeps them visible.
    this.ui.addEventListener('pointerdown', () => {
      this.uiPointerDown = true;
      this.poke();
    });
    window.addEventListener('pointerup', () => {
      if (this.uiPointerDown) {
        this.uiPointerDown = false;
        this.poke();
      }
    });
    new ResizeObserver(() => {
      document.documentElement.style.setProperty('--dock-h', `${this.dock.offsetHeight}px`);
    }).observe(this.dock);
  }

  // ------------------------------------------------------------- building

  private buildModeList(): void {
    const host = $('mode-groups');
    for (const cat of CATEGORIES) {
      const inCat = this.modes.filter((m) => m.category === cat);
      if (!inCat.length) continue;
      const group = document.createElement('div');
      group.className = 'mode-group';
      const h = document.createElement('h4');
      h.textContent = cat;
      const list = document.createElement('div');
      list.className = 'mode-list';
      for (const m of inCat) {
        const b = document.createElement('button');
        b.className = 'mode-btn';
        b.textContent = m.name;
        b.title = m.blurb;
        b.setAttribute('aria-pressed', 'false');
        b.addEventListener('click', () => this.a.selectMode(m.id));
        this.modeButtons.set(m.id, b);
        list.appendChild(b);
      }
      group.append(h, list);
      host.appendChild(group);
    }
  }

  private buildThemeGrid(): void {
    const host = $('theme-grid');
    for (const t of THEMES) {
      const b = document.createElement('button');
      b.className = 'theme-btn';
      b.setAttribute('aria-pressed', 'false');
      const sw = document.createElement('span');
      sw.className = 'swatch';
      sw.style.background = ThemeRuntime.swatch(t);
      const name = document.createElement('span');
      name.textContent = t.name;
      b.append(sw, name);
      b.addEventListener('click', () => this.a.selectTheme(t.id));
      this.themeButtons.set(t.id, b);
      host.appendChild(b);
    }
  }

  private bindTransport(): void {
    this.btnPlay.addEventListener('click', () => this.a.togglePlay());
    this.btnPrev.addEventListener('click', () => this.a.prev());
    this.btnNext.addEventListener('click', () => this.a.next());
    this.btnFs.addEventListener('click', () => this.a.toggleFullscreen());
    $('btn-mode-chip').addEventListener('click', () => this.toggleSheet('sheet-modes'));
    $('btn-modes').addEventListener('click', () => this.toggleSheet('sheet-modes'));
    $('btn-themes').addEventListener('click', () => this.toggleSheet('sheet-themes'));
    $('btn-settings').addEventListener('click', () => this.toggleSheet('sheet-settings'));
    this.btnSource.addEventListener('click', () => this.toggleSheet('sheet-source'));
    this.btnSens.addEventListener('click', () => this.togglePopover());

    const seek = this.seek;
    seek.addEventListener('input', () => {
      this.seeking = true;
      setFill(seek);
    });
    seek.addEventListener('change', () => {
      this.a.seek(Number(seek.value) / 1000);
      this.seeking = false;
    });

    for (const btn of document.querySelectorAll<HTMLButtonElement>('.source-btn')) {
      btn.addEventListener('click', () => {
        const act = btn.dataset.action;
        if (act === 'mic') this.a.useMic();
        else if (act === 'file') this.a.openFiles();
        else if (act === 'demo') this.a.useDemo();
        else if (act === 'stop') this.a.stopSource();
        if (act !== 'file') this.closeSheet();
      });
    }
    $('btn-clear-list').addEventListener('click', () => this.a.clearPlaylist());
  }

  private bindWelcome(): void {
    for (const btn of this.welcome.querySelectorAll<HTMLButtonElement>('.big-btn')) {
      btn.addEventListener('click', () => {
        const act = btn.dataset.action;
        if (act === 'mic') this.a.useMic();
        else if (act === 'file') this.a.openFiles();
        else if (act === 'demo') this.a.useDemo();
      });
    }
  }

  private bindSheets(): void {
    this.scrim.addEventListener('click', () => this.closeSheet());
    for (const sheet of this.sheets) {
      sheet.querySelector('[data-close]')?.addEventListener('click', () => this.closeSheet());
      // Drag the grabber / header down to dismiss.
      const head = sheet.querySelector<HTMLElement>('.grabber')!;
      const handle = [head, sheet.querySelector<HTMLElement>('.sheet-head')!];
      let y0 = 0;
      let dragging = false;
      for (const h of handle) {
        h.style.touchAction = 'none';
        h.addEventListener('pointerdown', (e) => {
          if ((e.target as HTMLElement).closest('button')) return;
          dragging = true;
          y0 = e.clientY;
          sheet.style.transition = 'none';
          h.setPointerCapture(e.pointerId);
        });
        h.addEventListener('pointermove', (e) => {
          if (!dragging) return;
          const dy = Math.max(0, e.clientY - y0);
          sheet.style.transform = `translate(-50%, ${dy}px)`;
        });
        const end = (e: PointerEvent) => {
          if (!dragging) return;
          dragging = false;
          sheet.style.transition = '';
          sheet.style.transform = '';
          if (e.clientY - y0 > 70) this.closeSheet();
        };
        h.addEventListener('pointerup', end);
        h.addEventListener('pointercancel', end);
      }
    }
  }

  private bindRange(
    id: string,
    toSlider: (s: Settings) => number,
    fromSlider: (v: number) => Partial<Settings>,
  ): (s: Settings) => void {
    const input = $<HTMLInputElement>(id);
    input.addEventListener('input', () => {
      setFill(input);
      this.a.update(fromSlider(Number(input.value)));
    });
    return (s) => {
      if (document.activeElement !== input || !this.uiPointerDown) input.value = String(toSlider(s));
      setFill(input);
    };
  }

  private bindSwitch(id: string, key: 'autoLevel' | 'glow' | 'showStats' | 'keepAwake'): (s: Settings) => void {
    const el = $(id);
    el.addEventListener('click', () => {
      this.a.update({ [key]: el.getAttribute('aria-checked') !== 'true' } as Partial<Settings>);
    });
    return (s) => el.setAttribute('aria-checked', String(s[key]));
  }

  private bindSeg(id: string, apply: (value: string) => void): (value: string) => void {
    const host = $(id);
    const buttons = [...host.querySelectorAll<HTMLButtonElement>('button')];
    for (const b of buttons) {
      b.setAttribute('role', 'radio');
      b.addEventListener('click', () => apply(b.dataset.value!));
    }
    return (value) => {
      for (const b of buttons) b.setAttribute('aria-checked', String(b.dataset.value === value));
    };
  }

  private syncers: ((s: Settings) => void)[] = [];

  private bindSettings(): void {
    const pct = (x: number) => `${Math.round(x * 100)}%`;
    const out = (id: string, text: string) => ($(id).textContent = text);
    this.syncers.push(
      this.bindRange('sens', (s) => sensToSlider(s.sensitivity), (v) => ({ sensitivity: sliderToSens(v) })),
      this.bindRange('set-sens', (s) => sensToSlider(s.sensitivity), (v) => ({ sensitivity: sliderToSens(v) })),
      (s) => {
        const text = `${s.sensitivity.toFixed(2)}×`;
        out('sens-value', text);
        out('set-sens-value', text);
      },
      this.bindSwitch('sens-auto', 'autoLevel'),
      this.bindSwitch('set-auto', 'autoLevel'),
      this.bindRange('set-smooth', (s) => Math.round(s.smoothing * 100), (v) => ({ smoothing: v / 100 })),
      (s) => out('set-smooth-value', pct(s.smoothing)),
      this.bindRange('set-trails', (s) => Math.round(s.trails * 100), (v) => ({ trails: v / 100 })),
      (s) => out('set-trails-value', s.trails === 0 ? 'Off' : pct(s.trails)),
      this.bindRange('set-beat', (s) => Math.round(s.beatReact * 100), (v) => ({ beatReact: v / 100 })),
      (s) => out('set-beat-value', s.beatReact === 0 ? 'Off' : pct(s.beatReact)),
      this.bindSwitch('set-glow', 'glow'),
      this.bindSwitch('set-stats', 'showStats'),
      this.bindSwitch('set-awake', 'keepAwake'),
      this.bindRange('set-hide', (s) => Math.round(s.hideDelay * 10), (v) => ({ hideDelay: v / 10 })),
      (s) => out('set-hide-value', `${s.hideDelay.toFixed(1)} s`),
      this.bindRange('cycle', (s) => Math.round(s.colorCycle * 100), (v) => ({ colorCycle: v / 100 })),
      (s) => out('cycle-value', s.colorCycle === 0 ? 'Off' : pct(s.colorCycle)),
    );
    const segQ = this.bindSeg('seg-quality', (v) => this.a.update({ quality: v as Settings['quality'] }));
    const segA = this.bindSeg('seg-autocycle', (v) => this.a.update({ autoCycle: v as Settings['autoCycle'] }));
    this.syncers.push((s) => segQ(s.quality), (s) => segA(s.autoCycle));
    $('btn-reset').addEventListener('click', () => this.a.reset());
  }

  // ---------------------------------------------------------------- state

  syncSettings(s: Settings): void {
    this.hideDelay = s.hideDelay;
    for (const fn of this.syncers) fn(s);
    for (const [id, b] of this.modeButtons) b.setAttribute('aria-pressed', String(id === s.mode));
    for (const [id, b] of this.themeButtons) b.setAttribute('aria-pressed', String(id === s.theme));
    const mode = this.modes.find((m) => m.id === s.mode);
    if (mode) {
      $('mode-name').textContent = mode.name;
      $('mode-cat').textContent = mode.category;
      $('mode-blurb').textContent = mode.blurb;
    }
    this.statsEl.hidden = !s.showStats;
  }

  syncSource(st: SourceState): void {
    const { source } = st;
    const file = source === 'file';
    const transport = st.canPause;
    this.btnPlay.hidden = !transport;
    this.btnPrev.hidden = this.btnNext.hidden = !file;
    this.btnPrev.disabled = !file || st.index <= 0;
    this.btnNext.disabled = !file || st.index >= st.playlist.length - 1;
    this.btnPlay.querySelector('use')!.setAttribute('href', st.playing ? '#i-pause' : '#i-play');
    this.btnPlay.setAttribute('aria-label', st.playing ? 'Pause' : 'Play');

    const icon = source === 'file' ? '#i-file' : source === 'demo' ? '#i-wave' : '#i-mic';
    this.btnSource.querySelector('use')!.setAttribute('href', icon);
    this.btnSource.classList.toggle('live', source === 'mic');

    this.track.hidden = !(file || source === 'demo');
    this.trackTitle.textContent = st.title;
    this.seek.hidden = !file;
    if (!file) this.trackTime.textContent = source === 'demo' ? 'Synth loop' : '';

    for (const b of document.querySelectorAll<HTMLButtonElement>('.source-btn')) {
      const act = b.dataset.action;
      b.setAttribute('aria-pressed', String(act === source));
      if (act === 'stop') b.disabled = source === 'none';
    }

    // Playlist.
    const list = $('playlist');
    $('playlist-head').hidden = st.playlist.length === 0;
    list.replaceChildren(
      ...st.playlist.map((name, i) => {
        const li = document.createElement('li');
        const b = document.createElement('button');
        const span = document.createElement('span');
        span.textContent = name;
        b.appendChild(span);
        if (i === st.index && file) b.setAttribute('aria-current', 'true');
        b.addEventListener('click', () => this.a.playTrack(i));
        li.appendChild(b);
        return li;
      }),
    );

    this.setWelcome(source === 'none');
    this.poke();
  }

  syncTime(current: number, duration: number): void {
    if (this.track.hidden || this.seek.hidden) return;
    const text = `${formatTime(current)} / ${formatTime(duration)}`;
    if (text !== this.lastTimeText) {
      this.lastTimeText = text;
      this.trackTime.textContent = text;
    }
    if (!this.seeking && duration > 0) {
      this.seek.value = String(Math.round((current / duration) * 1000));
      setFill(this.seek);
    }
  }

  setMeter(level: number): void {
    if (this.popSens.hidden) return;
    this.meterFill.style.transform = `scaleX(${Math.min(1, level).toFixed(3)})`;
  }

  setStats(text: string): void {
    if (!this.statsEl.hidden) this.statsEl.textContent = text;
  }

  setFullscreenIcon(active: boolean): void {
    this.btnFs.querySelector('use')!.setAttribute('href', active ? '#i-shrink' : '#i-expand');
    this.btnFs.setAttribute('aria-label', active ? 'Exit fullscreen' : 'Fullscreen');
  }

  // -------------------------------------------------------------- welcome

  private setWelcome(show: boolean): void {
    if (show) {
      this.welcome.hidden = false;
      requestAnimationFrame(() => this.welcome.classList.remove('leaving'));
    } else if (!this.welcome.hidden) {
      this.welcome.classList.add('leaving');
      window.setTimeout(() => {
        if (this.welcome.classList.contains('leaving')) this.welcome.hidden = true;
      }, 400);
    }
  }

  get welcomeVisible(): boolean {
    return !this.welcome.hidden && !this.welcome.classList.contains('leaving');
  }

  // --------------------------------------------------------- sheets & pop

  toggleSheet(id: string): void {
    const sheet = $(id);
    if (this.openSheet === sheet) this.closeSheet();
    else this.showSheet(sheet);
  }

  private showSheet(sheet: HTMLElement): void {
    this.closePopover();
    if (this.openSheet && this.openSheet !== sheet) this.hideSheetEl(this.openSheet);
    this.openSheet = sheet;
    sheet.hidden = false;
    this.scrim.hidden = false;
    void sheet.offsetHeight;
    sheet.classList.add('open');
    this.poke();
    // Bring the selected item into view.
    sheet.querySelector<HTMLElement>('[aria-pressed="true"]')?.scrollIntoView({ block: 'nearest' });
  }

  private hideSheetEl(sheet: HTMLElement): void {
    sheet.classList.remove('open');
    const done = () => {
      if (!sheet.classList.contains('open')) sheet.hidden = true;
    };
    sheet.addEventListener('transitionend', done, { once: true });
    window.setTimeout(done, 450);
  }

  closeSheet(): boolean {
    if (!this.openSheet) return false;
    this.hideSheetEl(this.openSheet);
    this.openSheet = null;
    this.scrim.hidden = true;
    this.poke();
    return true;
  }

  private togglePopover(): void {
    if (this.popSens.hidden) {
      this.closeSheet();
      this.popSens.hidden = false;
      this.btnSens.setAttribute('aria-expanded', 'true');
    } else this.closePopover();
    this.poke();
  }

  closePopover(): boolean {
    if (this.popSens.hidden) return false;
    this.popSens.hidden = true;
    this.btnSens.setAttribute('aria-expanded', 'false');
    return true;
  }

  get overlayOpen(): boolean {
    return !!this.openSheet || !this.popSens.hidden;
  }

  // ------------------------------------------------------------ auto-hide

  /** Show the controls and restart the auto-hide timer. */
  poke(): void {
    if (this.hidden) this.setHidden(false);
    if (this.hideTimer !== null) clearTimeout(this.hideTimer);
    this.hideTimer = window.setTimeout(() => this.tryHide(), this.hideDelay * 1000);
  }

  private tryHide(): void {
    this.hideTimer = null;
    if (this.overlayOpen || this.uiPointerDown || this.welcomeVisible || this.seeking || !this.a.canAutoHide()) {
      this.poke();
      return;
    }
    this.setHidden(true);
  }

  setHidden(hide: boolean): void {
    this.hidden = hide;
    this.body.classList.toggle('ui-hidden', hide);
    if (hide) {
      this.closePopover();
      if (document.activeElement instanceof HTMLElement && this.ui.contains(document.activeElement)) {
        document.activeElement.blur();
      }
    }
  }

  get isHidden(): boolean {
    return this.hidden;
  }

  /** Tap on the visualizer: dismiss overlays first, otherwise toggle the controls. */
  stageTap(): void {
    if (this.closePopover() || this.closeSheet()) return;
    if (this.welcomeVisible) return;
    if (this.hidden) this.poke();
    else if (this.a.canAutoHide()) this.setHidden(true);
    else this.poke();
  }

  /** Hide immediately (immersive mode). */
  hideNow(): void {
    this.closePopover();
    this.closeSheet();
    if (this.hideTimer !== null) clearTimeout(this.hideTimer);
    this.setHidden(true);
  }

  // --------------------------------------------------------------- toasts

  /** Large, brief title in the upper middle (mode / theme changes). */
  title(main: string, sub = ''): void {
    const t = this.toastEl;
    t.className = 'toast title';
    t.replaceChildren(document.createTextNode(main));
    if (sub) {
      const s = document.createElement('small');
      s.textContent = sub;
      t.appendChild(s);
    }
    this.flash(1100);
  }

  /** Pill message near the bottom; optional tap action. */
  message(text: string, opts: { error?: boolean; duration?: number; action?: () => void } = {}): void {
    const t = this.toastEl;
    t.className = `toast msg${opts.error ? ' error' : ''}${opts.action ? ' action' : ''}`;
    t.textContent = text;
    t.onclick = opts.action
      ? () => {
          t.classList.remove('show');
          opts.action!();
        }
      : null;
    this.flash(opts.duration ?? (opts.error ? 4500 : 2600));
  }

  private flash(ms: number): void {
    const t = this.toastEl;
    void t.offsetWidth;
    t.classList.add('show');
    if (this.toastTimer !== null) clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => t.classList.remove('show'), ms);
  }

  setOfflineStatus(text: string): void {
    $('offline-status').textContent = text;
  }
}
