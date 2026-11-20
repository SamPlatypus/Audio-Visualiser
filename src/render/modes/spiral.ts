import type { Visualizer2D } from '../types';
import { GlowSprites, SegmentBatch, TAU, sampleAt } from '../util';

const MAX_STARS = 1800;

/** A rotating spiral galaxy: stars along the arms light up by frequency (bass at the core). */
export function galaxy(): Visualizer2D {
  const s = new Float32Array(MAX_STARS);
  const arm = new Uint8Array(MAX_STARS);
  const jitterA = new Float32Array(MAX_STARS);
  const jitterR = new Float32Array(MAX_STARS);
  const size = new Float32Array(MAX_STARS);
  const ARMS = 4;
  for (let i = 0; i < MAX_STARS; i++) {
    s[i] = Math.pow(Math.random(), 0.8);
    arm[i] = i % ARMS;
    // Gaussian-ish scatter around the arm.
    jitterA[i] = (Math.random() + Math.random() + Math.random() - 1.5) * 0.55;
    jitterR[i] = Math.random() - 0.5;
    size[i] = 0.6 + Math.random() * 0.8;
  }
  let sprites: GlowSprites | null = null;
  let rot = 0;
  return {
    id: 'galaxy',
    name: 'Galaxy',
    category: 'Spiral',
    kind: '2d',
    blurb: 'Star-filled spiral arms that spin faster as the music builds',
    trailAffinity: 0.75,
    render(g, f, v, th, o) {
      sprites ??= new GlowSprites(16, 48);
      sprites.ensure(th);
      rot += f.dt * (0.1 + f.energy * 0.9 + f.beat * 0.4 * o.beatReact);
      const n = Math.round(600 + 1200 * v.quality);
      const R = v.u * 0.5 * (1 + f.beat * 0.08 * o.beatReact);
      const twist = 3.4;
      g.globalCompositeOperation = 'lighter';

      // Core.
      const coreSize = v.u * (0.18 + f.bass * 0.22);
      g.globalAlpha = 0.35 + f.bass * 0.5;
      sprites.draw(g, 0, v.cx, v.cy, coreSize);

      for (let i = 0; i < n; i++) {
        const si = s[i];
        const val = sampleAt(f.bands, si * 0.96);
        const spread = jitterA[i] * (0.4 * (1 - si) + 0.12);
        const a = (arm[i] * TAU) / ARMS + si * twist + rot * (1.3 - si * 0.7) + spread;
        const r = R * si + jitterR[i] * v.u * 0.025 + val * v.u * 0.035;
        const x = v.cx + Math.cos(a) * r;
        const y = v.cy + Math.sin(a) * r;
        const sz = (3 + val * 13) * size[i] * v.px;
        g.globalAlpha = 0.18 + val * 0.82;
        sprites.draw(g, sprites.bucketFor(si), x, y, sz);
      }
      g.globalAlpha = 1;
      g.globalCompositeOperation = 'source-over';
    },
  };
}

/** Golden-angle phyllotaxis: a sunflower of dots whose spiral pattern drifts with the music. */
export function sunflower(): Visualizer2D {
  const GOLDEN = Math.PI * (3 - Math.sqrt(5));
  let sprites: GlowSprites | null = null;
  let rot = 0;
  let drift = 0;
  return {
    id: 'sunflower',
    name: 'Sunflower',
    category: 'Spiral',
    kind: '2d',
    blurb: 'Golden-angle seeds whose spiral pattern morphs with the mids',
    trailAffinity: 0.5,
    render(g, f, v, th, o) {
      sprites ??= new GlowSprites(16, 48);
      sprites.ensure(th);
      rot += f.dt * (0.05 + f.energy * 0.3);
      drift += f.dt * (0.015 + f.mid * 0.06);
      const angle = GOLDEN + 0.0045 * Math.sin(drift);
      const n = Math.round(420 + 600 * v.quality);
      const c = (v.u * 0.47) / Math.sqrt(n);
      const pump = 1 + f.beat * 0.06 * o.beatReact;
      g.globalCompositeOperation = 'lighter';
      for (let k = 1; k <= n; k++) {
        const pos = k / n;
        const val = sampleAt(f.bands, pos * 0.95);
        const r = c * Math.sqrt(k) * pump;
        const a = k * angle + rot;
        const x = v.cx + Math.cos(a) * r;
        const y = v.cy + Math.sin(a) * r;
        const sz = c * (1.1 + val * 3.4);
        g.globalAlpha = 0.25 + val * 0.75;
        sprites.draw(g, sprites.bucketFor(pos), x, y, sz);
      }
      g.globalAlpha = 1;
      g.globalCompositeOperation = 'source-over';
    },
  };
}

/** The spectrum unrolled along a twin Archimedean spiral (bass inside, treble outside). */
export function vortex(): Visualizer2D {
  const PTS = 260;
  const ARMS = 2;
  const BUCKETS = 16;
  const line = new SegmentBatch(PTS * ARMS);
  const spokes = new SegmentBatch(PTS * ARMS);
  let rot = 0;
  return {
    id: 'vortex',
    name: 'Vortex',
    category: 'Spiral',
    kind: '2d',
    blurb: 'The spectrum wound into a spinning twin spiral',
    trailAffinity: 0.8,
    render(g, f, v, th, o) {
      rot += f.dt * (0.18 + f.energy * 1.4 + f.beat * 0.6 * o.beatReact);
      const turns = 3.1;
      const r0 = v.u * 0.035;
      const R = v.u * 0.47;
      const gap = (R - r0) / turns;
      line.reset();
      spokes.reset();
      for (let a = 0; a < ARMS; a++) {
        let px = 0;
        let py = 0;
        for (let j = 0; j < PTS; j++) {
          const sPos = j / (PTS - 1);
          const theta = sPos * turns * TAU + rot + (a * TAU) / ARMS;
          const val = sampleAt(f.bands, sPos * 0.97);
          const base = r0 + sPos * (R - r0);
          const r = base + val * gap * 0.9;
          const c = Math.cos(theta);
          const sn = Math.sin(theta);
          const x = v.cx + c * r;
          const y = v.cy + sn * r;
          const b = Math.round(sPos * (BUCKETS - 1));
          if (j > 0) line.push(px, py, x, y, b);
          if (j % 2 === 0) spokes.push(v.cx + c * base, v.cy + sn * base, x, y, b);
          px = x;
          py = y;
        }
      }
      g.globalCompositeOperation = 'lighter';
      g.lineCap = 'round';
      g.globalAlpha = 0.28;
      g.lineWidth = Math.max(1, 1.2 * v.px);
      spokes.stroke(g, th, BUCKETS);
      const lw = (1.6 + f.energy * 2.4) * v.px;
      if (o.glow) {
        g.globalAlpha = 0.16;
        g.lineWidth = lw * 4;
        line.stroke(g, th, BUCKETS);
      }
      g.globalAlpha = 1;
      g.lineWidth = lw;
      line.stroke(g, th, BUCKETS);
      g.globalAlpha = 1;
      g.lineCap = 'butt';
      g.globalCompositeOperation = 'source-over';
    },
  };
}
