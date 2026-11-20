import type { ThemeRuntime } from './themes';
import type { AudioFrame, RenderOptions, View, Visualizer, VisualizerGL } from './types';

export type QualityPref = 'auto' | 'high' | 'balanced' | 'saver';

const MIN_SCALE = 0.5;

/**
 * Owns the canvases and draws the active visualizer each frame.
 *
 *  - 2D modes draw on a transparent canvas over a CSS background, so motion
 *    trails are a cheap `destination-out` fade.
 *  - Shader modes draw on a separate WebGL canvas at reduced resolution.
 *  - Mode switches cross-fade using a snapshot of the last frame.
 *  - An adaptive controller lowers the render scale when frames are dropped
 *    and raises it again when there is headroom.
 */
export class Renderer {
  readonly c2d: HTMLCanvasElement;
  readonly cgl: HTMLCanvasElement;
  readonly cfade: HTMLCanvasElement;
  readonly glAvailable: boolean;

  mode: Visualizer;
  options: RenderOptions = { trails: 0.5, glow: true, beatReact: 0.7 };
  quality: QualityPref = 'auto';

  private g: CanvasRenderingContext2D;
  private gl: WebGLRenderingContext | null = null;
  private glLost = false;
  private glReady = new Set<VisualizerGL>();
  private pending: Visualizer | null = null;

  private cssW = 1;
  private cssH = 1;
  private scale = 1;
  private lastRender = 0;
  private view2d: View = { w: 1, h: 1, px: 1, u: 1, cx: 0, cy: 0, quality: 1 };
  private viewGL: View = { w: 1, h: 1, px: 1, u: 1, cx: 0, cy: 0, quality: 1 };

  // Frame pacing statistics.
  private intervals = new Float32Array(90);
  private intervalCount = 0;
  private baseline = 1000 / 60;
  private slowWindows = 0;
  private fastWindows = 0;
  fps = 0;

  constructor(stage: HTMLElement, mode: Visualizer) {
    this.c2d = stage.querySelector<HTMLCanvasElement>('#c2d')!;
    this.cgl = stage.querySelector<HTMLCanvasElement>('#cgl')!;
    this.cfade = stage.querySelector<HTMLCanvasElement>('#cfade')!;
    this.g = this.c2d.getContext('2d', { alpha: true, desynchronized: true })!;
    this.mode = mode;

    let gl: WebGLRenderingContext | null = null;
    try {
      gl = this.cgl.getContext('webgl', {
        alpha: false,
        antialias: false,
        depth: false,
        stencil: false,
        premultipliedAlpha: false,
        preserveDrawingBuffer: false,
        powerPreference: 'high-performance',
      });
    } catch {
      gl = null;
    }
    this.gl = gl;
    this.glAvailable = !!gl;
    this.cgl.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.glLost = true;
      this.glReady.clear();
    });
    this.cgl.addEventListener('webglcontextrestored', () => {
      this.glLost = false;
    });

    new ResizeObserver(() => this.measure()).observe(stage);
    window.addEventListener('resize', () => this.measure());
    this.measure();
    this.applyVisibility();
  }

  // ------------------------------------------------------------------ sizing

  private maxDpr(): number {
    switch (this.quality) {
      case 'high':
        return 3;
      case 'balanced':
        return 2;
      case 'saver':
        return 1.25;
      default:
        return 2;
    }
  }

  private measure(): void {
    const stage = this.c2d.parentElement!;
    const r = stage.getBoundingClientRect();
    this.cssW = Math.max(1, r.width);
    this.cssH = Math.max(1, r.height);
    this.applySize();
  }

  private applySize(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, this.maxDpr());
    const s = this.quality === 'auto' ? this.scale : 1;
    const px = dpr * s;
    const w = Math.round(this.cssW * px);
    const h = Math.round(this.cssH * px);
    if (this.c2d.width !== w || this.c2d.height !== h) {
      this.c2d.width = w;
      this.c2d.height = h;
    }
    const quality = this.detail();
    this.view2d = { w, h, px, u: Math.min(w, h), cx: w / 2, cy: h / 2, quality };

    const glRes = this.mode.kind === 'gl' ? this.mode.resolution : 0.7;
    const gpx = Math.max(0.5, Math.min(dpr, 2) * s * glRes);
    const gw = Math.max(1, Math.round(this.cssW * gpx));
    const gh = Math.max(1, Math.round(this.cssH * gpx));
    if (this.cgl.width !== gw || this.cgl.height !== gh) {
      this.cgl.width = gw;
      this.cgl.height = gh;
    }
    this.viewGL = { w: gw, h: gh, px: gpx, u: Math.min(gw, gh), cx: gw / 2, cy: gh / 2, quality };
  }

  /** 0..1 detail level handed to visualizers (particle counts, iterations). */
  private detail(): number {
    switch (this.quality) {
      case 'high':
        return 1;
      case 'balanced':
        return 0.7;
      case 'saver':
        return 0.35;
      default:
        return Math.max(0.3, Math.min(1, (this.scale - MIN_SCALE) / (1 - MIN_SCALE)));
    }
  }

  setQuality(q: QualityPref): void {
    this.quality = q;
    this.scale = 1;
    this.slowWindows = this.fastWindows = 0;
    this.applySize();
  }

  /** Frame cap: battery saver renders at ~30 fps. */
  shouldRender(now: number): boolean {
    if (this.quality !== 'saver') return true;
    return now - this.lastRender >= 1000 / 30 - 4;
  }

  // ------------------------------------------------------------------- modes

  /** Switch visualizer; the old frame fades out over the new one. */
  setMode(next: Visualizer, crossfade = true): void {
    if (next === this.mode && !this.pending) return;
    if (next.kind === 'gl' && !this.glAvailable) return;
    if (crossfade) this.pending = next;
    else this.activate(next);
  }

  private activate(next: Visualizer): void {
    this.mode = next;
    if (next.kind === '2d') {
      this.g.clearRect(0, 0, this.c2d.width, this.c2d.height);
      next.reset?.();
    }
    this.applySize();
    this.applyVisibility();
  }

  private applyVisibility(): void {
    const gl = this.mode.kind === 'gl';
    this.cgl.style.visibility = gl ? 'visible' : 'hidden';
    this.c2d.style.visibility = gl ? 'hidden' : 'visible';
  }

  private snapshot(): void {
    const src = this.mode.kind === 'gl' ? this.cgl : this.c2d;
    const f = this.cfade;
    f.width = this.c2d.width;
    f.height = this.c2d.height;
    const fg = f.getContext('2d')!;
    fg.clearRect(0, 0, f.width, f.height);
    try {
      fg.drawImage(src, 0, 0, f.width, f.height);
    } catch {
      return;
    }
    f.style.transition = 'none';
    f.style.opacity = '1';
    void f.offsetWidth; // restart the transition
    f.style.transition = 'opacity 650ms ease';
    f.style.opacity = '0';
  }

  // ------------------------------------------------------------------ render

  render(frame: AudioFrame, theme: ThemeRuntime, now: number): void {
    const interval = this.lastRender ? now - this.lastRender : 16.7;
    this.lastRender = now;
    this.track(interval);

    const mode = this.mode;
    if (mode.kind === '2d') {
      this.paint2d(frame, theme);
    } else {
      this.paintGL(mode, frame, theme);
    }

    // Swap modes right after drawing, so the snapshot holds a complete frame
    // (WebGL buffers are only readable within the same task).
    if (this.pending) {
      const next = this.pending;
      this.pending = null;
      this.snapshot();
      this.activate(next);
    }
  }

  private paint2d(frame: AudioFrame, theme: ThemeRuntime): void {
    const g = this.g;
    const v = this.view2d;
    const mode = this.mode as Extract<Visualizer, { kind: '2d' }>;
    const trail = Math.min(0.94, this.options.trails * mode.trailAffinity);
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = 1;
    if (trail < 0.02) {
      g.clearRect(0, 0, v.w, v.h);
    } else {
      // Frame-rate independent fade: keep `trail` of the image per 1/60 s.
      const keep = Math.pow(trail, frame.dt * 60);
      g.globalCompositeOperation = 'destination-out';
      g.fillStyle = `rgba(0,0,0,${(1 - keep).toFixed(4)})`;
      g.fillRect(0, 0, v.w, v.h);
      g.globalCompositeOperation = 'source-over';
    }
    mode.render(g, frame, v, theme, this.options);
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
  }

  private paintGL(mode: VisualizerGL, frame: AudioFrame, theme: ThemeRuntime): void {
    const gl = this.gl;
    if (!gl || this.glLost || gl.isContextLost()) return;
    if (!this.glReady.has(mode)) {
      try {
        mode.init(gl);
        this.glReady.add(mode);
      } catch (err) {
        console.error(err);
        return;
      }
    }
    mode.render(gl, frame, this.viewGL, theme, this.options);
  }

  // ---------------------------------------------------- adaptive quality

  private track(ms: number): void {
    if (ms <= 0 || ms > 250) return; // tab was hidden or paused
    this.intervals[this.intervalCount++] = ms;
    if (this.intervalCount < this.intervals.length) return;
    this.intervalCount = 0;

    const sorted = Array.from(this.intervals).sort((a, b) => a - b);
    const p10 = sorted[Math.floor(sorted.length * 0.1)];
    const median = sorted[sorted.length >> 1];
    this.fps = Math.round(1000 / median);
    // Display refresh estimate: fastest typical frame interval seen recently.
    this.baseline = Math.min(this.baseline * 1.02, Math.max(4, p10));

    if (this.quality !== 'auto') return;
    if (median > this.baseline * 1.3) {
      this.fastWindows = 0;
      if (++this.slowWindows >= 2 && this.scale > MIN_SCALE) {
        this.scale = Math.max(MIN_SCALE, this.scale * 0.85);
        this.slowWindows = 0;
        this.applySize();
      }
    } else if (median < this.baseline * 1.08) {
      this.slowWindows = 0;
      if (++this.fastWindows >= 5 && this.scale < 1) {
        this.scale = Math.min(1, this.scale / 0.9);
        this.fastWindows = 0;
        this.applySize();
      }
    }
  }

  /** Current render scale (1 = full resolution), for the stats overlay. */
  get renderScale(): number {
    return this.quality === 'auto' ? this.scale : 1;
  }
}
