import type { ThemeRuntime } from './themes';

export type Category = 'Bars' | 'Circular' | 'Spiral' | 'Fractal' | 'Waveform';
export const CATEGORIES: Category[] = ['Bars', 'Circular', 'Spiral', 'Fractal', 'Waveform'];

/** Everything a visualizer needs to know about the sound for one frame. */
export interface AudioFrame {
  /** Seconds since the app started (monotonic). */
  time: number;
  /** Seconds since the previous frame (clamped to avoid jumps). */
  dt: number;
  /** Smoothed, normalised (0..1) log-spaced spectrum, bass first. */
  bands: Float32Array;
  /** Falling peak markers for `bands`. */
  peaks: Float32Array;
  /** Mono waveform, display-normalised to roughly -1..1. */
  wave: Float32Array;
  /** Left / right waveforms (equal to `wave` for mono sources). */
  waveL: Float32Array;
  waveR: Float32Array;
  /** True when left and right actually differ. */
  stereo: boolean;
  bass: number;
  mid: number;
  treble: number;
  energy: number;
  /** Beat pulse: 1 at a detected beat, decaying towards 0. */
  beat: number;
  beatCount: number;
  bpm: number;
  /** Input loudness 0..1 (for meters). */
  level: number;
  /** A real source is producing sound (false = idle animation). */
  active: boolean;
}

/** Drawing surface information, in device pixels. */
export interface View {
  w: number;
  h: number;
  /** Device pixels per CSS pixel actually used for this canvas. */
  px: number;
  /** min(w, h): a resolution-independent unit. */
  u: number;
  cx: number;
  cy: number;
  /** 0..1 detail level from the adaptive quality controller. */
  quality: number;
}

export interface RenderOptions {
  /** 0..1 motion-trail amount. */
  trails: number;
  /** Additive glow passes. */
  glow: boolean;
  /** 0..1 how strongly visuals punch on beats. */
  beatReact: number;
}

interface VisualizerBase {
  readonly id: string;
  readonly name: string;
  readonly category: Category;
  /** One-line description for the mode picker. */
  readonly blurb: string;
  /** How much this mode benefits from motion trails (0..1). */
  readonly trailAffinity: number;
  /** Reads the stereo waveforms (lets the engine skip work otherwise). */
  readonly needsStereo?: boolean;
}

export interface Visualizer2D extends VisualizerBase {
  readonly kind: '2d';
  render(g: CanvasRenderingContext2D, f: AudioFrame, v: View, theme: ThemeRuntime, o: RenderOptions): void;
  /** Called when the mode becomes active (clear history etc.). */
  reset?(): void;
}

export interface VisualizerGL extends VisualizerBase {
  readonly kind: 'gl';
  /** Render resolution relative to the 2D canvas (fractal shaders are expensive). */
  readonly resolution: number;
  init(gl: WebGLRenderingContext): void;
  render(gl: WebGLRenderingContext, f: AudioFrame, v: View, theme: ThemeRuntime, o: RenderOptions): void;
  dispose(gl: WebGLRenderingContext): void;
}

export type Visualizer = Visualizer2D | VisualizerGL;
