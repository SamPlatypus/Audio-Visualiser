import type { Visualizer2D } from '../types';
import { sampleRange } from '../util';

function topRoundedRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, w / 2, h);
  g.moveTo(x, y + h);
  g.lineTo(x, y + rr);
  g.quadraticCurveTo(x, y, x + rr, y);
  g.lineTo(x + w - rr, y);
  g.quadraticCurveTo(x + w, y, x + w, y + rr);
  g.lineTo(x + w, y + h);
  g.closePath();
}

function capsule(g: CanvasRenderingContext2D, x: number, y0: number, y1: number, w: number): void {
  const r = Math.min(w / 2, (y1 - y0) / 2);
  g.moveTo(x, y0 + r);
  g.quadraticCurveTo(x, y0, x + w / 2, y0);
  g.quadraticCurveTo(x + w, y0, x + w, y0 + r);
  g.lineTo(x + w, y1 - r);
  g.quadraticCurveTo(x + w, y1, x + w / 2, y1);
  g.quadraticCurveTo(x, y1, x, y1 - r);
  g.closePath();
}

/** Classic analyser: log-spaced bars, falling peak caps and a soft floor reflection. */
export function spectrumBars(): Visualizer2D {
  let vals = new Float32Array(64);
  let peaks = new Float32Array(64);
  return {
    id: 'spectrum',
    name: 'Spectrum',
    category: 'Bars',
    kind: '2d',
    blurb: 'Analyser bars with falling peaks and a mirrored floor',
    trailAffinity: 0.3,
    render(g, f, v, th, o) {
      const count = Math.max(24, Math.min(128, Math.round(v.w / (11 * v.px))));
      if (vals.length !== count) {
        vals = new Float32Array(count);
        peaks = new Float32Array(count);
      }
      sampleRange(f.bands, vals);
      sampleRange(f.peaks, peaks);

      const margin = v.w * 0.04;
      const pitch = (v.w - margin * 2) / count;
      const bw = Math.max(1, pitch * 0.7);
      const base = v.h * (v.h > v.w ? 0.7 : 0.74);
      const maxH = base * 0.82;
      const punch = 1 + f.beat * 0.07 * o.beatReact;
      const radius = Math.min(bw / 2, 4 * v.px);
      const minH = 2 * v.px;

      // Soft glow behind the bars.
      if (o.glow) {
        g.globalCompositeOperation = 'lighter';
        g.globalAlpha = 0.16;
        for (let i = 0; i < count; i++) {
          const hgt = Math.max(minH, vals[i] * maxH * punch);
          const x = margin + i * pitch + (pitch - bw) / 2;
          g.fillStyle = th.color(i / (count - 1));
          g.fillRect(x - bw * 0.5, base - hgt - bw * 0.4, bw * 2, hgt + bw * 0.4);
        }
        g.globalAlpha = 1;
        g.globalCompositeOperation = 'source-over';
      }

      // Bars + reflection.
      for (let i = 0; i < count; i++) {
        const hgt = Math.max(minH, vals[i] * maxH * punch);
        const x = margin + i * pitch + (pitch - bw) / 2;
        g.fillStyle = th.color(i / (count - 1));
        g.globalAlpha = 1;
        g.beginPath();
        topRoundedRect(g, x, base - hgt, bw, hgt, radius);
        g.fill();
        g.globalAlpha = 0.22;
        g.fillRect(x, base + 3 * v.px, bw, hgt * 0.38);
      }
      g.globalAlpha = 1;

      // Fade the reflection out towards the bottom.
      const fade = g.createLinearGradient(0, base, 0, base + maxH * 0.4);
      fade.addColorStop(0, 'rgba(0,0,0,0.25)');
      fade.addColorStop(1, 'rgba(0,0,0,1)');
      g.globalCompositeOperation = 'destination-out';
      g.fillStyle = fade;
      g.fillRect(0, base + 2 * v.px, v.w, v.h - base);
      g.globalCompositeOperation = 'source-over';

      // Peak caps.
      g.fillStyle = 'rgba(255,255,255,0.85)';
      g.beginPath();
      const capH = Math.max(1.5, 2.5 * v.px);
      for (let i = 0; i < count; i++) {
        const p = peaks[i] * maxH * punch;
        if (p < minH * 2) continue;
        const x = margin + i * pitch + (pitch - bw) / 2;
        g.rect(x, base - p - capH - 3 * v.px, bw, capH);
      }
      g.fill();
    },
  };
}

/** Symmetric bars growing from a centre line, bass in the middle. */
export function mirrorBars(): Visualizer2D {
  let vals = new Float32Array(32);
  return {
    id: 'mirror',
    name: 'Mirror',
    category: 'Bars',
    kind: '2d',
    blurb: 'Symmetric bars bursting from a glowing centre line',
    trailAffinity: 0.55,
    render(g, f, v, th, o) {
      const half = Math.max(12, Math.min(72, Math.round(v.w / (2 * 10 * v.px))));
      if (vals.length !== half) vals = new Float32Array(half);
      sampleRange(f.bands, vals, 0, 0.92);

      const pitch = v.w / (half * 2);
      const bw = Math.max(1, pitch * 0.56);
      const maxH = v.h * 0.34 * (1 + f.beat * 0.08 * o.beatReact);
      const cy = v.cy;

      g.globalCompositeOperation = 'lighter';
      for (let pass = o.glow ? 0 : 1; pass < 2; pass++) {
        const glow = pass === 0;
        g.globalAlpha = glow ? 0.18 : 0.95;
        for (let i = 0; i < half; i++) {
          const val = vals[i];
          const hgt = Math.max(1.5 * v.px, val * maxH);
          const t = i / (half - 1);
          g.fillStyle = th.color(t);
          const extra = glow ? bw * 0.9 : 0;
          const w = bw + extra * 2;
          g.beginPath();
          const dx = (i + 0.5) * pitch;
          capsule(g, v.cx - dx - w / 2, cy - hgt - extra, cy + hgt + extra, w);
          capsule(g, v.cx + dx - w / 2, cy - hgt - extra, cy + hgt + extra, w);
          g.fill();
        }
      }

      // Centre beam.
      const beam = g.createLinearGradient(0, 0, v.w, 0);
      beam.addColorStop(0, 'rgba(255,255,255,0)');
      beam.addColorStop(0.5, th.rgba(0, 0.55 + f.bass * 0.45));
      beam.addColorStop(1, 'rgba(255,255,255,0)');
      g.globalAlpha = 1;
      g.fillStyle = beam;
      const bh = (1 + f.bass * 3) * v.px;
      g.fillRect(0, cy - bh / 2, v.w, bh);
      g.globalCompositeOperation = 'source-over';
    },
  };
}

/** Segmented LED-style equaliser with peak blocks. */
export function ledMeter(): Visualizer2D {
  let vals = new Float32Array(24);
  let peaks = new Float32Array(24);
  let lit = new Uint8Array(24);
  return {
    id: 'led',
    name: 'Equalizer',
    category: 'Bars',
    kind: '2d',
    blurb: 'Segmented LED columns, like a hi-fi graphic equalizer',
    trailAffinity: 0.2,
    render(g, f, v, th) {
      const cols = Math.max(10, Math.min(40, Math.round(v.w / (24 * v.px))));
      if (vals.length !== cols) {
        vals = new Float32Array(cols);
        peaks = new Float32Array(cols);
        lit = new Uint8Array(cols);
      }
      sampleRange(f.bands, vals);
      sampleRange(f.peaks, peaks);

      const top = v.h * 0.16;
      const bottom = v.h * 0.84;
      const rows = Math.max(12, Math.min(36, Math.round((bottom - top) / (11 * v.px))));
      const margin = v.w * 0.06;
      const colW = (v.w - margin * 2) / cols;
      const rowH = (bottom - top) / rows;
      const bw = colW * 0.78;
      const bh = rowH * 0.66;
      for (let c = 0; c < cols; c++) lit[c] = Math.round(vals[c] * rows);

      // Unlit cells.
      g.fillStyle = 'rgba(255,255,255,0.05)';
      g.beginPath();
      for (let c = 0; c < cols; c++) {
        const x = margin + c * colW + (colW - bw) / 2;
        for (let r = lit[c]; r < rows; r++) g.rect(x, bottom - (r + 1) * rowH, bw, bh);
      }
      g.fill();

      // Lit cells, one fill per row (colour follows the palette up the column).
      for (let r = 0; r < rows; r++) {
        let any = false;
        g.beginPath();
        for (let c = 0; c < cols; c++) {
          if (lit[c] <= r) continue;
          const x = margin + c * colW + (colW - bw) / 2;
          g.rect(x, bottom - (r + 1) * rowH, bw, bh);
          any = true;
        }
        if (!any) continue;
        g.fillStyle = th.color(r / (rows - 1));
        g.fill();
      }

      // Peak cells.
      g.fillStyle = 'rgba(255,255,255,0.9)';
      g.beginPath();
      for (let c = 0; c < cols; c++) {
        const r = Math.min(rows - 1, Math.round(peaks[c] * rows));
        if (r < 1 || r < lit[c]) continue;
        const x = margin + c * colW + (colW - bw) / 2;
        g.rect(x, bottom - (r + 1) * rowH + bh * 0.3, bw, bh * 0.4);
      }
      g.fill();
    },
  };
}
