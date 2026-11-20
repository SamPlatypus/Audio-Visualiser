/**
 * Colour themes. Each theme is a gradient palette (sampled into a 256-entry
 * lookup table for speed) plus background colours. Optional colour cycling
 * slides along the palette over time in a ping-pong so there are no seams.
 */

export interface Theme {
  id: string;
  name: string;
  /** Palette stops from "low" (bass / inner) to "high" (treble / outer). */
  stops: string[];
  /** Background: centre and edge of the vignette. */
  bg: [string, string];
}

export const THEMES: Theme[] = [
  { id: 'neon', name: 'Neon', stops: ['#00f0ff', '#4d7cff', '#9b4dff', '#ff3fd2'], bg: ['#0d0820', '#020107'] },
  { id: 'sunset', name: 'Sunset', stops: ['#ffd166', '#ff8c5a', '#ef476f', '#a03fd0'], bg: ['#1f0a18', '#060206'] },
  { id: 'ocean', name: 'Ocean', stops: ['#0077ff', '#00b4d8', '#48e5c2', '#d8fff6'], bg: ['#03162a', '#01060c'] },
  { id: 'aurora', name: 'Aurora', stops: ['#00ff9d', '#00e0ff', '#7f7bff', '#e86bff'], bg: ['#05141a', '#010508'] },
  { id: 'inferno', name: 'Inferno', stops: ['#ff2a1f', '#ff6a1a', '#ffb21f', '#fff2a8'], bg: ['#1d0603', '#070100'] },
  { id: 'vapor', name: 'Vaporwave', stops: ['#ff71ce', '#b967ff', '#01cdfe', '#05ffa1'], bg: ['#170a26', '#05020a'] },
  { id: 'prism', name: 'Prism', stops: ['#ff3b3b', '#ffb000', '#d9ff00', '#00e676', '#00d0ff', '#5b5bff', '#d14dff'], bg: ['#111114', '#030304'] },
  { id: 'lime', name: 'Lime', stops: ['#1fd1a5', '#62e87a', '#c6f75d', '#fffbb0'], bg: ['#06170f', '#010603'] },
  { id: 'rose', name: 'Rose Gold', stops: ['#ff8fa3', '#ffb4a2', '#ffd6a5', '#fff1e6'], bg: ['#1e0e12', '#070304'] },
  { id: 'mono', name: 'Mono', stops: ['#6f8296', '#a9bacb', '#dfe8f1', '#ffffff'], bg: ['#111418', '#030405'] },
];

export function findTheme(id: string): Theme {
  return THEMES.find((t) => t.id === id) ?? THEMES[0];
}

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Build a 256×RGB lookup table by linearly interpolating the stops. */
export function buildLut(stops: string[], size = 256): Uint8Array {
  const rgb = stops.map(hexToRgb);
  const lut = new Uint8Array(size * 3);
  for (let i = 0; i < size; i++) {
    const x = (i / (size - 1)) * (rgb.length - 1);
    const k = Math.min(rgb.length - 2, Math.floor(x));
    const t = x - k;
    for (let c = 0; c < 3; c++) {
      lut[i * 3 + c] = Math.round(rgb[k][c] + (rgb[k + 1][c] - rgb[k][c]) * t);
    }
  }
  return lut;
}

/** Ping-pong wrap of any real number into 0..1. */
export function pingPong(x: number): number {
  const m = x - 2 * Math.floor(x / 2);
  return m > 1 ? 2 - m : m;
}

/**
 * Live theme state shared by every visualizer: palette lookups, pre-built
 * CSS colour strings (so drawing code does not allocate), and cycling.
 */
export class ThemeRuntime {
  theme: Theme;
  lut: Uint8Array;
  /** "rgb(r,g,b)" for each LUT entry. */
  css: string[];
  /** Increments whenever colours change (lets caches rebuild). */
  version = 0;
  /** Current colour-cycle offset. */
  shift = 0;
  /** Cycle speed in palette lengths per second. */
  cycleSpeed = 0;
  bgRgb: [number, number, number];
  bgEdgeRgb: [number, number, number];

  constructor(theme: Theme) {
    this.theme = theme;
    this.lut = buildLut(theme.stops);
    this.css = [];
    this.bgRgb = hexToRgb(theme.bg[0]);
    this.bgEdgeRgb = hexToRgb(theme.bg[1]);
    this.rebuild();
  }

  set(theme: Theme): void {
    this.theme = theme;
    this.lut = buildLut(theme.stops);
    this.bgRgb = hexToRgb(theme.bg[0]);
    this.bgEdgeRgb = hexToRgb(theme.bg[1]);
    this.rebuild();
  }

  private rebuild(): void {
    const css: string[] = new Array(256);
    for (let i = 0; i < 256; i++) {
      css[i] = `rgb(${this.lut[i * 3]},${this.lut[i * 3 + 1]},${this.lut[i * 3 + 2]})`;
    }
    this.css = css;
    this.version++;
  }

  update(dt: number): void {
    if (this.cycleSpeed > 0) {
      this.shift += dt * this.cycleSpeed;
      if (this.shift > 1000) this.shift -= 1000;
    }
  }

  /** LUT index for a palette position 0..1 (with cycling applied). */
  index(t: number): number {
    const x = this.cycleSpeed > 0 ? pingPong(t + this.shift) : t <= 0 ? 0 : t >= 1 ? 1 : t;
    return (x * 255 + 0.5) | 0;
  }

  /** CSS colour for a palette position 0..1. */
  color(t: number): string {
    return this.css[this.index(t)];
  }

  /** CSS colour with alpha (allocates; use sparingly, e.g. for gradients). */
  rgba(t: number, a: number): string {
    const i = this.index(t) * 3;
    return `rgba(${this.lut[i]},${this.lut[i + 1]},${this.lut[i + 2]},${a})`;
  }

  rgb(t: number): [number, number, number] {
    const i = this.index(t) * 3;
    return [this.lut[i], this.lut[i + 1], this.lut[i + 2]];
  }

  /** CSS gradient (for UI swatches). */
  static swatch(theme: Theme): string {
    return `linear-gradient(90deg, ${theme.stops.join(', ')})`;
  }
}
