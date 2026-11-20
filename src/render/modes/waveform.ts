import { findTrigger } from '../../audio/analysis';
import type { Visualizer2D } from '../types';
import { SegmentBatch, TAU, closedCurve, sampleAt } from '../util';

/** Triggered oscilloscope trace with phosphor glow. */
export function oscilloscope(): Visualizer2D {
  const SPAN = 1024;
  return {
    id: 'scope',
    name: 'Oscilloscope',
    category: 'Waveform',
    kind: '2d',
    blurb: 'A steady, triggered waveform trace with phosphor afterglow',
    trailAffinity: 0.85,
    render(g, f, v, th, o) {
      const w = f.wave;
      const start = Math.min(w.length - SPAN, findTrigger(w, w.length - SPAN));
      const margin = v.w * 0.04;
      const width = v.w - margin * 2;
      const amp = v.h * (v.h > v.w ? 0.22 : 0.34);
      const pts = Math.max(200, Math.min(SPAN, Math.round(width / (1.5 * v.px))));

      // Faint graticule.
      g.strokeStyle = 'rgba(255,255,255,0.045)';
      g.lineWidth = Math.max(1, v.px);
      g.beginPath();
      for (let i = 1; i < 10; i++) {
        const x = margin + (width * i) / 10;
        g.moveTo(x, v.cy - amp * 1.2);
        g.lineTo(x, v.cy + amp * 1.2);
      }
      for (let i = -2; i <= 2; i++) {
        const y = v.cy + (amp * 1.2 * i) / 2;
        g.moveTo(margin, y);
        g.lineTo(margin + width, y);
      }
      g.stroke();

      const grad = g.createLinearGradient(margin, 0, margin + width, 0);
      for (let i = 0; i <= 4; i++) grad.addColorStop(i / 4, th.color(i / 4));

      g.beginPath();
      for (let i = 0; i < pts; i++) {
        const idx = start + (i / (pts - 1)) * (SPAN - 1);
        const k = idx | 0;
        const s = w[k] + (w[Math.min(w.length - 1, k + 1)] - w[k]) * (idx - k);
        const x = margin + (i / (pts - 1)) * width;
        const y = v.cy - s * amp;
        if (i === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.strokeStyle = grad;
      g.lineJoin = 'round';
      g.globalCompositeOperation = 'lighter';
      const lw = (1.6 + f.energy * 2.6 + f.beat * 1.5 * o.beatReact) * v.px;
      if (o.glow) {
        g.globalAlpha = 0.14;
        g.lineWidth = lw * 6;
        g.stroke();
        g.globalAlpha = 0.3;
        g.lineWidth = lw * 2.5;
        g.stroke();
      }
      g.globalAlpha = 1;
      g.lineWidth = lw;
      g.stroke();
      g.globalCompositeOperation = 'source-over';
    },
  };
}

/** The waveform wrapped into seamless concentric loops. */
export function ringWave(): Visualizer2D {
  const N = 300;
  const BLEND = 40;
  const xs = new Float32Array(N);
  const ys = new Float32Array(N);
  const rings = [
    { r: 0.2, amp: 0.09, spin: 0.25, t: 0.0, offset: 0 },
    { r: 0.29, amp: 0.11, spin: -0.18, t: 0.5, offset: 320 },
    { r: 0.38, amp: 0.12, spin: 0.12, t: 1.0, offset: 640 },
  ];
  const rot = [0, 0, 0];
  return {
    id: 'ringwave',
    name: 'Ring Wave',
    category: 'Waveform',
    kind: '2d',
    blurb: 'The waveform bent into glowing loops around a bass core',
    trailAffinity: 0.75,
    render(g, f, v, th, o) {
      const w = f.wave;
      const trig = findTrigger(w, 512);
      const pump = 1 + f.beat * 0.08 * o.beatReact;

      const core = g.createRadialGradient(v.cx, v.cy, 0, v.cx, v.cy, v.u * 0.2);
      core.addColorStop(0, th.rgba(0, 0.08 + f.bass * 0.35));
      core.addColorStop(1, th.rgba(0.3, 0));
      g.fillStyle = core;
      g.fillRect(v.cx - v.u * 0.2, v.cy - v.u * 0.2, v.u * 0.4, v.u * 0.4);

      g.globalCompositeOperation = 'lighter';
      g.lineJoin = 'round';
      for (let k = 0; k < rings.length; k++) {
        const R = rings[k];
        rot[k] += f.dt * R.spin * (1 + f.energy * 2);
        const base = BLEND + Math.min(w.length - N - BLEND - 1, trig + R.offset);
        const radius = v.u * R.r * pump;
        const amp = v.u * R.amp;
        for (let j = 0; j < N; j++) {
          let s = w[base + j];
          if (j >= N - BLEND) {
            // Cross-fade into the samples just before the start so the loop closes smoothly.
            const t = (j - (N - BLEND)) / BLEND;
            s = s * (1 - t) + w[base - BLEND + (j - (N - BLEND))] * t;
          }
          const a = (j / N) * TAU + rot[k];
          const r = radius + s * amp;
          xs[j] = v.cx + Math.cos(a) * r;
          ys[j] = v.cy + Math.sin(a) * r;
        }
        g.beginPath();
        closedCurve(g, xs, ys, N);
        g.strokeStyle = th.color(R.t);
        const lw = (1.4 + f.energy * 2.4) * v.px;
        if (o.glow) {
          g.globalAlpha = 0.16;
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

/** X/Y vectorscope: stereo as mid/side, mono as a phase portrait. */
export function lissajous(): Visualizer2D {
  const BUCKETS = 10;
  const batch = new SegmentBatch(2048);
  let rot = 0;
  return {
    id: 'lissajous',
    name: 'Lissajous',
    category: 'Waveform',
    kind: '2d',
    blurb: 'A vectorscope drawing stereo (or phase) as luminous figures',
    trailAffinity: 1,
    needsStereo: true,
    render(g, f, v, th, o) {
      const L = f.waveL;
      const R = f.waveR;
      const n = L.length;
      const scale = v.u * 0.4 * (1 + f.beat * 0.06 * o.beatReact);
      rot += f.dt * (0.05 + f.energy * 0.2);
      const cr = Math.cos(rot);
      const sr = Math.sin(rot);
      const delay = 28;
      const step = v.quality > 0.6 ? 1 : 2;
      batch.reset();
      let px = 0;
      let py = 0;
      const count = n - delay;
      for (let i = 0; i < count; i += step) {
        let x: number;
        let y: number;
        if (f.stereo) {
          x = (L[i] - R[i]) * 0.7071;
          y = (L[i] + R[i]) * 0.7071;
        } else {
          x = L[i];
          y = L[i + delay];
        }
        const X = v.cx + (x * cr - y * sr) * scale;
        const Y = v.cy - (x * sr + y * cr) * scale;
        if (i > 0) batch.push(px, py, X, Y, Math.min(BUCKETS - 1, ((i / count) * BUCKETS) | 0));
        px = X;
        py = Y;
      }
      g.globalCompositeOperation = 'lighter';
      g.lineCap = 'round';
      const lw = Math.max(1, (1.1 + f.energy * 1.5) * v.px);
      if (o.glow) {
        g.globalAlpha = 0.08;
        g.lineWidth = lw * 5;
        batch.stroke(g, th, BUCKETS);
      }
      g.globalAlpha = 0.75;
      g.lineWidth = lw;
      batch.stroke(g, th, BUCKETS);
      g.globalAlpha = 1;
      g.lineCap = 'butt';
      g.globalCompositeOperation = 'source-over';
    },
  };
}

/** Receding ridgelines of recent sound, drawn with true occlusion. */
export function terrain(): Visualizer2D {
  const COLS = 72;
  const MAX_ROWS = 40;
  const history: Float32Array[] = [];
  for (let i = 0; i < MAX_ROWS; i++) history.push(new Float32Array(COLS));
  let head = 0;
  let acc = 0;
  const RATE = 1 / 24; // seconds per row
  const xs = new Float32Array(COLS);
  const ys = new Float32Array(COLS);
  return {
    id: 'terrain',
    name: 'Terrain',
    category: 'Waveform',
    kind: '2d',
    blurb: 'Ridgelines of recent sound scrolling into the distance',
    trailAffinity: 0,
    reset() {
      for (const row of history) row.fill(0);
    },
    render(g, f, v, th) {
      const rows = Math.round(26 + 14 * v.quality);
      acc += f.dt;
      while (acc >= RATE) {
        acc -= RATE;
        head = (head + 1) % MAX_ROWS;
        const row = history[head];
        for (let j = 0; j < COLS; j++) {
          const x = (j / (COLS - 1)) * 2 - 1; // -1..1
          const pos = Math.pow(Math.abs(x), 0.85);
          const env = Math.pow(Math.cos(x * Math.PI * 0.5), 1.5);
          row[j] = sampleAt(f.bands, pos * 0.9) * env;
        }
      }
      const phase = acc / RATE;

      const top = v.h * 0.2;
      const bottom = v.h * 0.88;
      const amp = v.h * 0.2;
      g.lineJoin = 'round';
      // Draw from far (oldest) to near (newest).
      for (let r = rows - 1; r >= 0; r--) {
        const row = history[(head - r + MAX_ROWS * 2) % MAX_ROWS];
        const depth = (r + phase) / rows; // 0 near .. 1 far
        const persp = 1 / (1 + depth * 1.6);
        const y0 = top + (bottom - top) * Math.pow(1 - depth, 1.4);
        const halfW = v.w * 0.46 * (0.55 + 0.45 * persp);
        for (let j = 0; j < COLS; j++) {
          xs[j] = v.cx - halfW + (j / (COLS - 1)) * halfW * 2;
          ys[j] = y0 - row[j] * amp * persp;
        }
        g.beginPath();
        g.moveTo(xs[0], ys[0]);
        for (let j = 1; j < COLS; j++) g.lineTo(xs[j], ys[j]);
        // Occlude anything behind this ridge.
        g.lineTo(xs[COLS - 1], v.h);
        g.lineTo(xs[0], v.h);
        g.closePath();
        g.globalCompositeOperation = 'destination-out';
        g.fillStyle = '#000';
        g.fill();
        g.globalCompositeOperation = 'source-over';

        g.beginPath();
        g.moveTo(xs[0], ys[0]);
        for (let j = 1; j < COLS; j++) g.lineTo(xs[j], ys[j]);
        const fade = Math.min(1, (1 - depth) * 1.6);
        g.globalAlpha = fade;
        g.strokeStyle = th.color(1 - depth);
        g.lineWidth = Math.max(1, (1 + persp * 1.4) * v.px);
        g.stroke();
      }
      g.globalAlpha = 1;
    },
  };
}
