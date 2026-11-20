import type { Visualizer2D } from '../types';
import { SegmentBatch, TAU, closedCurve, sampleAt, sampleRange } from '../util';

const BUCKETS = 16;

/** Bars radiating from a pulsing core, mirrored left/right. */
export function radialBars(): Visualizer2D {
  let vals = new Float32Array(64);
  const outer = new SegmentBatch(256);
  const inner = new SegmentBatch(256);
  let rot = 0;
  return {
    id: 'radial',
    name: 'Radial',
    category: 'Circular',
    kind: '2d',
    blurb: 'Bars radiating from a core that pulses with the bass',
    trailAffinity: 0.45,
    render(g, f, v, th, o) {
      const r0 = v.u * 0.2 * (1 + f.beat * 0.1 * o.beatReact + f.bass * 0.06);
      const half = Math.max(36, Math.min(96, Math.round((Math.PI * r0) / (7 * v.px))));
      if (vals.length !== half) vals = new Float32Array(half);
      sampleRange(f.bands, vals, 0, 0.94);
      rot += f.dt * (0.06 + f.energy * 0.5);

      const n = half * 2;
      const maxL = v.u * 0.27;
      outer.reset();
      inner.reset();
      for (let i = 0; i < n; i++) {
        const k = i < half ? i : n - 1 - i;
        const val = vals[k];
        const a = rot + ((i + 0.5) / n) * TAU - Math.PI / 2;
        const c = Math.cos(a);
        const s = Math.sin(a);
        const len = Math.max(2 * v.px, val * maxL);
        const b = Math.round((k / (half - 1)) * (BUCKETS - 1));
        outer.push(v.cx + c * r0, v.cy + s * r0, v.cx + c * (r0 + len), v.cy + s * (r0 + len), b);
        const il = len * 0.22;
        inner.push(v.cx + c * (r0 - 4 * v.px), v.cy + s * (r0 - 4 * v.px), v.cx + c * (r0 - 4 * v.px - il), v.cy + s * (r0 - 4 * v.px - il), b);
      }

      // Core glow.
      const core = g.createRadialGradient(v.cx, v.cy, 0, v.cx, v.cy, r0 * 1.05);
      core.addColorStop(0, th.rgba(0, 0.1 + f.bass * 0.45));
      core.addColorStop(0.7, th.rgba(0.3, 0.06 + f.bass * 0.12));
      core.addColorStop(1, th.rgba(0.5, 0));
      g.fillStyle = core;
      g.beginPath();
      g.arc(v.cx, v.cy, r0 * 1.05, 0, TAU);
      g.fill();

      const lw = Math.max(1.5 * v.px, ((TAU * r0) / n) * 0.55);
      g.lineCap = 'round';
      g.globalCompositeOperation = 'lighter';
      if (o.glow) {
        g.globalAlpha = 0.2;
        g.lineWidth = lw * 2.6;
        outer.stroke(g, th, BUCKETS);
      }
      g.globalAlpha = 1;
      g.lineWidth = lw;
      outer.stroke(g, th, BUCKETS);
      g.globalAlpha = 0.45;
      g.lineWidth = lw * 0.7;
      inner.stroke(g, th, BUCKETS);

      // Thin ring.
      g.globalAlpha = 0.5;
      g.strokeStyle = th.color(0.15);
      g.lineWidth = Math.max(1, v.px);
      g.beginPath();
      g.arc(v.cx, v.cy, r0 - 2 * v.px, 0, TAU);
      g.stroke();
      g.globalAlpha = 1;
      g.globalCompositeOperation = 'source-over';
      g.lineCap = 'butt';
    },
  };
}

/** Concentric rings, each deformed by its own slice of the spectrum. */
export function haloRings(): Visualizer2D {
  const PTS = 96;
  const RINGS = 4;
  const xs = new Float32Array(PTS);
  const ys = new Float32Array(PTS);
  const rot = new Float32Array(RINGS);
  return {
    id: 'halo',
    name: 'Halo',
    category: 'Circular',
    kind: '2d',
    blurb: 'Concentric rings rippling with bass, mids and treble',
    trailAffinity: 0.7,
    render(g, f, v, th, o) {
      g.globalCompositeOperation = 'lighter';
      g.lineJoin = 'round';
      const pump = 1 + f.beat * 0.07 * o.beatReact;
      for (let k = RINGS - 1; k >= 0; k--) {
        const from = (k / RINGS) * 0.85;
        const to = from + 0.85 / RINGS + 0.12;
        rot[k] += f.dt * (k % 2 ? -1 : 1) * (0.05 + 0.08 * k + f.mid * 0.4);
        const baseR = v.u * (0.11 + 0.085 * k) * pump;
        const amp = v.u * (0.06 + 0.02 * k);
        let mean = 0;
        for (let j = 0; j < PTS; j++) {
          const m = j < PTS / 2 ? j / (PTS / 2) : (PTS - j) / (PTS / 2);
          const val = sampleAt(f.bands, from + (to - from) * m);
          mean += val;
          const a = (j / PTS) * TAU + rot[k];
          const r = baseR + val * amp;
          xs[j] = v.cx + Math.cos(a) * r;
          ys[j] = v.cy + Math.sin(a) * r;
        }
        mean /= PTS;
        const t = k / (RINGS - 1);
        g.beginPath();
        closedCurve(g, xs, ys, PTS);
        if (k === 0) {
          g.globalAlpha = 0.08 + f.bass * 0.22;
          g.fillStyle = th.color(t);
          g.fill();
        }
        g.strokeStyle = th.color(t);
        const lw = (1.4 + mean * 4) * v.px;
        if (o.glow) {
          g.globalAlpha = 0.14;
          g.lineWidth = lw * 5;
          g.stroke();
        }
        g.globalAlpha = 0.95;
        g.lineWidth = lw;
        g.stroke();
      }
      g.globalAlpha = 1;
      g.globalCompositeOperation = 'source-over';
    },
  };
}

/** A many-petalled flower whose petals are the spectrum, layered and counter-rotating. */
export function polarBloom(): Visualizer2D {
  const PTS = 216;
  const xs = new Float32Array(PTS);
  const ys = new Float32Array(PTS);
  const layers = [
    { scale: 1.0, spin: 1, t: 0.85, alpha: 0.22 },
    { scale: 0.72, spin: -1.4, t: 0.5, alpha: 0.28 },
    { scale: 0.46, spin: 2, t: 0.12, alpha: 0.36 },
  ];
  let rot = 0;
  return {
    id: 'bloom',
    name: 'Bloom',
    category: 'Circular',
    kind: '2d',
    blurb: 'Layered kaleidoscopic petals shaped by the spectrum',
    trailAffinity: 0.6,
    render(g, f, v, th, o) {
      rot += f.dt * (0.04 + f.energy * 0.35);
      const petals = 6;
      const base = v.u * 0.16 * (1 + f.beat * 0.12 * o.beatReact);
      const amp = v.u * 0.34;
      g.globalCompositeOperation = 'lighter';
      g.lineJoin = 'round';
      for (let l = 0; l < layers.length; l++) {
        const L = layers[l];
        const offset = l * 0.18;
        for (let j = 0; j < PTS; j++) {
          const a = (j / PTS) * TAU;
          const local = ((a * petals) / TAU) % 1;
          const m = 1 - Math.abs(local * 2 - 1); // 0 at petal edge, 1 at petal centre
          const val = sampleAt(f.bands, Math.min(1, (1 - m) * 0.75 + offset));
          const r = (base + val * amp * (0.55 + 0.45 * m)) * L.scale;
          const aa = a + rot * L.spin;
          xs[j] = v.cx + Math.cos(aa) * r;
          ys[j] = v.cy + Math.sin(aa) * r;
        }
        g.beginPath();
        closedCurve(g, xs, ys, PTS);
        const grad = g.createRadialGradient(v.cx, v.cy, 0, v.cx, v.cy, (base + amp) * L.scale);
        grad.addColorStop(0, th.rgba(L.t, L.alpha * 1.6));
        grad.addColorStop(1, th.rgba(Math.min(1, L.t + 0.25), L.alpha * 0.4));
        g.fillStyle = grad;
        g.globalAlpha = 1;
        g.fill();
        g.strokeStyle = th.color(L.t);
        g.lineWidth = (1.2 + f.energy * 2.5) * v.px;
        if (o.glow) {
          g.globalAlpha = 0.18;
          g.lineWidth *= 4;
          g.stroke();
          g.lineWidth /= 4;
        }
        g.globalAlpha = 0.9;
        g.stroke();
      }
      g.globalAlpha = 1;
      g.globalCompositeOperation = 'source-over';
    },
  };
}
