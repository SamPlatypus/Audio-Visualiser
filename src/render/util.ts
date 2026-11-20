import type { ThemeRuntime } from './themes';

export const TAU = Math.PI * 2;

/** Linear-interpolated read of an array at position x in 0..1. */
export function sampleAt(src: Float32Array, x: number): number {
  const n = src.length - 1;
  const p = (x <= 0 ? 0 : x >= 1 ? 1 : x) * n;
  const i = p | 0;
  const t = p - i;
  return i >= n ? src[n] : src[i] + (src[i + 1] - src[i]) * t;
}

/** Resample `src` into `out` (linear interpolation across the full range). */
export function resample(src: Float32Array, out: Float32Array): Float32Array {
  const m = out.length - 1;
  for (let i = 0; i <= m; i++) out[i] = sampleAt(src, m === 0 ? 0 : i / m);
  return out;
}

/**
 * Sample the spectrum over a sub-range [from, to] of the bands, with a
 * gentle neighbour blur so that very wide displays don't look stair-stepped.
 */
export function sampleRange(src: Float32Array, out: Float32Array, from = 0, to = 1): Float32Array {
  const m = out.length - 1;
  for (let i = 0; i <= m; i++) {
    const x = from + (to - from) * (m === 0 ? 0 : i / m);
    out[i] = sampleAt(src, x);
  }
  return out;
}

export const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/**
 * Batches line segments by colour bucket so a whole frame of differently
 * coloured lines costs only a handful of stroke() calls.
 */
export class SegmentBatch {
  private x0: Float32Array;
  private y0: Float32Array;
  private x1: Float32Array;
  private y1: Float32Array;
  private bucket: Uint8Array;
  n = 0;

  constructor(capacity: number) {
    this.x0 = new Float32Array(capacity);
    this.y0 = new Float32Array(capacity);
    this.x1 = new Float32Array(capacity);
    this.y1 = new Float32Array(capacity);
    this.bucket = new Uint8Array(capacity);
  }

  ensure(capacity: number): void {
    if (capacity <= this.x0.length) return;
    const c = Math.ceil(capacity * 1.5);
    this.x0 = new Float32Array(c);
    this.y0 = new Float32Array(c);
    this.x1 = new Float32Array(c);
    this.y1 = new Float32Array(c);
    this.bucket = new Uint8Array(c);
  }

  reset(): void {
    this.n = 0;
  }

  push(x0: number, y0: number, x1: number, y1: number, bucket: number): void {
    const i = this.n++;
    this.x0[i] = x0;
    this.y0[i] = y0;
    this.x1[i] = x1;
    this.y1[i] = y1;
    this.bucket[i] = bucket;
  }

  /** Stroke every segment as one path using the current stroke style. */
  strokeAll(g: CanvasRenderingContext2D): void {
    g.beginPath();
    for (let i = 0; i < this.n; i++) {
      g.moveTo(this.x0[i], this.y0[i]);
      g.lineTo(this.x1[i], this.y1[i]);
    }
    g.stroke();
  }

  /** Stroke all segments, one path per bucket, coloured from the theme. */
  stroke(g: CanvasRenderingContext2D, theme: ThemeRuntime, buckets: number, offset = 0, span = 1): void {
    for (let b = 0; b < buckets; b++) {
      let any = false;
      g.beginPath();
      for (let i = 0; i < this.n; i++) {
        if (this.bucket[i] !== b) continue;
        g.moveTo(this.x0[i], this.y0[i]);
        g.lineTo(this.x1[i], this.y1[i]);
        any = true;
      }
      if (!any) continue;
      g.strokeStyle = theme.color(offset + (span * b) / Math.max(1, buckets - 1));
      g.stroke();
    }
  }
}

/**
 * Pre-rendered soft glow dots, one per palette bucket. drawImage of a
 * cached sprite is far cheaper than arc() + gradient for thousands of
 * particles, and gives a nicer soft falloff.
 */
export class GlowSprites {
  readonly buckets: number;
  readonly size: number;
  readonly canvas: HTMLCanvasElement;
  private version = -1;
  private shift = -1;

  constructor(buckets = 16, size = 48) {
    this.buckets = buckets;
    this.size = size;
    this.canvas = document.createElement('canvas');
    this.canvas.width = size * buckets;
    this.canvas.height = size;
  }

  ensure(theme: ThemeRuntime): void {
    const stale =
      theme.version !== this.version || (theme.cycleSpeed > 0 && Math.abs(theme.shift - this.shift) > 0.008);
    if (!stale) return;
    this.version = theme.version;
    this.shift = theme.shift;
    const g = this.canvas.getContext('2d')!;
    const s = this.size;
    g.clearRect(0, 0, this.canvas.width, s);
    for (let b = 0; b < this.buckets; b++) {
      const [r, gr, bl] = theme.rgb(b / (this.buckets - 1));
      const cx = b * s + s / 2;
      const grad = g.createRadialGradient(cx, s / 2, 0, cx, s / 2, s / 2);
      const hot = (c: number) => Math.round(c + (255 - c) * 0.55);
      grad.addColorStop(0, `rgba(${hot(r)},${hot(gr)},${hot(bl)},1)`);
      grad.addColorStop(0.18, `rgba(${r},${gr},${bl},0.85)`);
      grad.addColorStop(0.45, `rgba(${r},${gr},${bl},0.25)`);
      grad.addColorStop(1, `rgba(${r},${gr},${bl},0)`);
      g.fillStyle = grad;
      g.fillRect(b * s, 0, s, s);
    }
  }

  draw(g: CanvasRenderingContext2D, bucket: number, x: number, y: number, size: number): void {
    const s = this.size;
    const b = bucket < 0 ? 0 : bucket >= this.buckets ? this.buckets - 1 : bucket | 0;
    g.drawImage(this.canvas, b * s, 0, s, s, x - size / 2, y - size / 2, size, size);
  }

  bucketFor(t: number): number {
    const b = (t * (this.buckets - 1) + 0.5) | 0;
    return b < 0 ? 0 : b >= this.buckets ? this.buckets - 1 : b;
  }
}

/** Trace a smooth closed curve through points using quadratic midpoints. */
export function closedCurve(g: CanvasRenderingContext2D, xs: Float32Array, ys: Float32Array, n: number): void {
  if (n < 3) return;
  let mx = (xs[n - 1] + xs[0]) / 2;
  let my = (ys[n - 1] + ys[0]) / 2;
  g.moveTo(mx, my);
  for (let i = 0; i < n; i++) {
    const j = i + 1 === n ? 0 : i + 1;
    mx = (xs[i] + xs[j]) / 2;
    my = (ys[i] + ys[j]) / 2;
    g.quadraticCurveTo(xs[i], ys[i], mx, my);
  }
  g.closePath();
}

/** Trace a smooth open curve through points. */
export function openCurve(g: CanvasRenderingContext2D, xs: Float32Array, ys: Float32Array, n: number): void {
  if (n < 2) return;
  g.moveTo(xs[0], ys[0]);
  for (let i = 1; i < n - 1; i++) {
    g.quadraticCurveTo(xs[i], ys[i], (xs[i] + xs[i + 1]) / 2, (ys[i] + ys[i + 1]) / 2);
  }
  g.lineTo(xs[n - 1], ys[n - 1]);
}
