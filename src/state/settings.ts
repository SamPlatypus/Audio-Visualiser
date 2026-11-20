import type { QualityPref } from '../render/renderer';

export type AutoCycle = 'off' | '15' | '30' | '60' | 'beat';

export interface Settings {
  mode: string;
  theme: string;
  /** Linear input gain, 0.25 – 4. */
  sensitivity: number;
  autoLevel: boolean;
  /** 0 = snappy, 1 = very smooth. */
  smoothing: number;
  /** 0 – 1 motion trails. */
  trails: number;
  glow: boolean;
  /** 0 – 1 how much visuals punch on beats. */
  beatReact: number;
  /** 0 – 1 colour cycling speed. */
  colorCycle: number;
  autoCycle: AutoCycle;
  quality: QualityPref;
  showStats: boolean;
  /** Seconds before the on-screen controls fade out. */
  hideDelay: number;
  keepAwake: boolean;
  hintsSeen: boolean;
}

export const DEFAULTS: Settings = {
  mode: 'radial',
  theme: 'neon',
  sensitivity: 1,
  autoLevel: true,
  smoothing: 0.5,
  trails: 0.55,
  glow: true,
  beatReact: 0.7,
  colorCycle: 0,
  autoCycle: 'off',
  quality: 'auto',
  showStats: false,
  hideDelay: 3,
  keepAwake: true,
  hintsSeen: false,
};

export const SENSITIVITY_MIN = 0.25;
export const SENSITIVITY_MAX = 4;

const AUTO_CYCLES: AutoCycle[] = ['off', '15', '30', '60', 'beat'];
const QUALITIES: QualityPref[] = ['auto', 'high', 'balanced', 'saver'];

const num = (v: unknown, lo: number, hi: number, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;
const bool = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback);
const oneOf = <T extends string>(v: unknown, list: readonly T[], fallback: T): T =>
  typeof v === 'string' && (list as readonly string[]).includes(v) ? (v as T) : fallback;

/** Validate untrusted (stored) data into a complete Settings object. */
export function sanitize(raw: unknown, modeIds: string[], themeIds: string[]): Settings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    mode: oneOf(r.mode, modeIds, modeIds.includes(DEFAULTS.mode) ? DEFAULTS.mode : modeIds[0]),
    theme: oneOf(r.theme, themeIds, DEFAULTS.theme),
    sensitivity: num(r.sensitivity, SENSITIVITY_MIN, SENSITIVITY_MAX, DEFAULTS.sensitivity),
    autoLevel: bool(r.autoLevel, DEFAULTS.autoLevel),
    smoothing: num(r.smoothing, 0, 1, DEFAULTS.smoothing),
    trails: num(r.trails, 0, 1, DEFAULTS.trails),
    glow: bool(r.glow, DEFAULTS.glow),
    beatReact: num(r.beatReact, 0, 1, DEFAULTS.beatReact),
    colorCycle: num(r.colorCycle, 0, 1, DEFAULTS.colorCycle),
    autoCycle: oneOf(r.autoCycle, AUTO_CYCLES, DEFAULTS.autoCycle),
    quality: oneOf(r.quality, QUALITIES, DEFAULTS.quality),
    showStats: bool(r.showStats, DEFAULTS.showStats),
    hideDelay: num(r.hideDelay, 1.5, 10, DEFAULTS.hideDelay),
    keepAwake: bool(r.keepAwake, DEFAULTS.keepAwake),
    hintsSeen: bool(r.hintsSeen, DEFAULTS.hintsSeen),
  };
}

const KEY = 'auralis.settings.v1';

/** Settings persisted to localStorage (silently in-memory if storage is unavailable). */
export class SettingsStore {
  value: Settings;
  private saveTimer: number | null = null;
  private listeners = new Set<(s: Settings, changed: (keyof Settings)[]) => void>();

  constructor(modeIds: string[], themeIds: string[]) {
    let raw: unknown = null;
    try {
      const text = localStorage.getItem(KEY);
      raw = text ? JSON.parse(text) : null;
    } catch {
      raw = null;
    }
    this.value = sanitize(raw, modeIds, themeIds);
  }

  update(patch: Partial<Settings>): void {
    const changed: (keyof Settings)[] = [];
    for (const k of Object.keys(patch) as (keyof Settings)[]) {
      if (this.value[k] !== patch[k]) changed.push(k);
    }
    if (!changed.length) return;
    this.value = { ...this.value, ...patch };
    for (const l of this.listeners) l(this.value, changed);
    this.scheduleSave();
  }

  onChange(fn: (s: Settings, changed: (keyof Settings)[]) => void): void {
    this.listeners.add(fn);
  }

  private scheduleSave(): void {
    if (this.saveTimer !== null) clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => {
      this.saveTimer = null;
      try {
        localStorage.setItem(KEY, JSON.stringify(this.value));
      } catch {
        /* private mode / quota: settings just won't persist */
      }
    }, 250);
  }
}
