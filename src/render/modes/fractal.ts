import { ShaderPass } from '../gl';
import type { Visualizer2D, VisualizerGL } from '../types';
import { GlowSprites, SegmentBatch, TAU, sampleAt } from '../util';

/**
 * A radially symmetric fractal tree. Each branching level listens to a
 * different part of the spectrum: trunks to the bass, twigs to the treble.
 * Branch angles open with the mids and branches stretch with the bass.
 */
export function fractalTree(): Visualizer2D {
  const MAX_DEPTH = 9;
  const TRUNKS = 5;
  const cap = TRUNKS * (1 << MAX_DEPTH);
  // Two node buffers (current level / next level).
  let ax = new Float32Array(cap);
  let ay = new Float32Array(cap);
  let aa = new Float32Array(cap);
  let bx = new Float32Array(cap);
  let by = new Float32Array(cap);
  let ba = new Float32Array(cap);
  const levels: SegmentBatch[] = [];
  for (let d = 0; d < MAX_DEPTH; d++) levels.push(new SegmentBatch(TRUNKS << d));
  let sprites: GlowSprites | null = null;
  let rot = 0;
  return {
    id: 'tree',
    name: 'Fractal Tree',
    category: 'Fractal',
    kind: '2d',
    blurb: 'Recursive branches: trunks follow the bass, twigs the treble',
    trailAffinity: 0.55,
    render(g, f, v, th, o) {
      sprites ??= new GlowSprites(16, 48);
      sprites.ensure(th);
      const depth = v.quality > 0.8 ? 9 : v.quality > 0.5 ? 8 : 7;
      rot += f.dt * (0.04 + f.energy * 0.22);
      const spreadL = 0.3 + f.mid * 0.75 + 0.05 * Math.sin(f.time * 0.5);
      const spreadR = 0.3 + f.mid * 0.75 + 0.05 * Math.cos(f.time * 0.43);
      const ratio = Math.min(0.8, 0.68 + f.bass * 0.1);
      let len = v.u * 0.115 * (1 + f.beat * 0.12 * o.beatReact + f.bass * 0.15);

      let n = TRUNKS;
      for (let i = 0; i < TRUNKS; i++) {
        ax[i] = v.cx;
        ay[i] = v.cy;
        aa[i] = rot + (i / TRUNKS) * TAU - Math.PI / 2;
      }
      for (let d = 0; d < depth; d++) {
        const batch = levels[d];
        batch.reset();
        const t = d / (depth - 1);
        const val = sampleAt(f.bands, t * 0.9);
        const sway = Math.sin(f.time * 1.3 + d * 0.8) * 0.08 * (f.treble + 0.2);
        const l = len * (0.75 + val * 0.6);
        const last = d === depth - 1;
        let m = 0;
        for (let i = 0; i < n; i++) {
          const x0 = ax[i];
          const y0 = ay[i];
          const a = aa[i] + sway;
          const x1 = x0 + Math.cos(a) * l;
          const y1 = y0 + Math.sin(a) * l;
          batch.push(x0, y0, x1, y1, 0);
          if (!last) {
            bx[m] = x1;
            by[m] = y1;
            ba[m++] = a - spreadL;
            bx[m] = x1;
            by[m] = y1;
            ba[m++] = a + spreadR;
          } else {
            bx[i] = x1;
            by[i] = y1;
          }
        }
        if (!last) {
          [ax, bx] = [bx, ax];
          [ay, by] = [by, ay];
          [aa, ba] = [ba, aa];
          n = m;
          len *= ratio;
        }
      }

      g.globalCompositeOperation = 'lighter';
      g.lineCap = 'round';
      for (let d = 0; d < depth; d++) {
        const t = d / (depth - 1);
        const val = sampleAt(f.bands, t * 0.9);
        const lw = Math.max(0.7 * v.px, (depth - d) * 0.5 * v.px * (1 + val * 1.6));
        g.strokeStyle = th.color(t);
        if (o.glow && d < depth - 3) {
          g.globalAlpha = 0.12;
          g.lineWidth = lw * 3.5;
          levels[d].strokeAll(g);
        }
        g.globalAlpha = 0.35 + val * 0.65;
        g.lineWidth = lw;
        levels[d].strokeAll(g);
      }

      // Blossoms at the branch tips, sized by the treble.
      const tips = n;
      const step = Math.max(1, Math.ceil(tips / 360));
      const bloom = (2 + f.treble * 16 + f.beat * 6 * o.beatReact) * v.px;
      g.globalAlpha = 0.3 + f.treble * 0.7;
      const bucket = sprites.bucketFor(1);
      for (let i = 0; i < tips; i += step) sprites.draw(g, bucket, bx[i], by[i], bloom);
      g.globalAlpha = 1;
      g.lineCap = 'butt';
      g.globalCompositeOperation = 'source-over';
    },
  };
}

const JULIA_FS = `
uniform vec2 uC;
uniform float uZoom;
uniform float uRot;
uniform float uGlow;
uniform float uBeat;
uniform int uIter;
void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * uRes) / min(uRes.x, uRes.y);
  float cs = cos(uRot), sn = sin(uRot);
  vec2 z = mat2(cs, -sn, sn, cs) * uv * uZoom;
  float n = 0.0;
  float trap = 1e9;
  float d2 = 0.0;
  for (int i = 0; i < 200; i++) {
    if (i >= uIter) break;
    z = vec2(z.x * z.x - z.y * z.y, 2.0 * z.x * z.y) + uC;
    d2 = dot(z, z);
    trap = min(trap, d2);
    if (d2 > 256.0) break;
    n += 1.0;
  }
  float r = length(uv);
  vec3 bg = uBg * (1.0 - 0.55 * r);
  vec3 col;
  if (n >= float(uIter)) {
    // Inside the set: deep colour banded by the orbit trap.
    float t = sqrt(trap);
    col = pal(0.1 + t * 0.6) * (0.18 + 0.5 * smoothstep(0.9, 0.0, t)) * (0.7 + 0.6 * uBeat);
  } else {
    // Outside: smooth escape count, glowing towards the boundary.
    float mu = n + 1.0 - log2(max(1e-6, log2(d2) * 0.5));
    float glow = pow(clamp(mu / 26.0, 0.0, 1.0), 1.5);
    col = pal(mu * 0.03 + uTime * 0.02) * glow * 1.25;
    col += vec3(1.0) * pow(glow, 8.0) * 0.35 * (0.6 + uBeat);
  }
  gl_FragColor = vec4(bg + col * uGlow, 1.0);
}
`;

/** GPU Julia set whose parameter orbits the Mandelbrot boundary, steered by the music. */
export function juliaSet(): VisualizerGL {
  let pass: ShaderPass | null = null;
  let phase = 0;
  let rot = 0;
  return {
    id: 'julia',
    name: 'Julia',
    category: 'Fractal',
    kind: 'gl',
    resolution: 0.7,
    blurb: 'A living Julia set; its shape is steered by bass and mids',
    trailAffinity: 0,
    init(gl) {
      pass = new ShaderPass(gl, JULIA_FS);
    },
    render(gl, f, v, th, o) {
      if (!pass) return;
      phase += f.dt * (0.05 + f.energy * 0.16);
      rot += f.dt * (0.03 + f.mid * 0.12);
      // c rides the main cardioid of the Mandelbrot set, where Julia sets are
      // connected and most intricate. Bass and beats push it just outside, so
      // the fractal splinters and re-forms with the music.
      const ca = Math.cos(phase);
      const sa = Math.sin(phase);
      const cx = 0.5 * ca - 0.25 * (ca * ca - sa * sa);
      const cy = 0.5 * sa - 0.25 * (2 * sa * ca);
      const k = 0.985 + f.bass * 0.035 + f.beat * 0.025 * o.beatReact;
      const p = pass.begin(gl, v.w, v.h, f.time, th);
      p.f2('uC', cx * k, cy * k);
      p.f1('uZoom', 3.1 - f.bass * 0.45 - f.beat * 0.15 * o.beatReact);
      p.f1('uRot', rot);
      p.f1('uGlow', 0.85 + f.energy * 0.6);
      p.f1('uBeat', f.beat * o.beatReact);
      p.i1('uIter', Math.round(64 + 96 * v.quality));
      pass.draw();
    },
    dispose() {
      pass?.dispose();
      pass = null;
    },
  };
}

const KALEIDO_FS = `
uniform float uSeg;
uniform float uRot;
uniform float uZoom;
uniform vec2 uK;
uniform float uTwist;
uniform float uGlow;
uniform float uBass;
uniform float uBeat;
uniform int uIter;
void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * uRes) / min(uRes.x, uRes.y);
  float r = length(uv);
  // Kaleidoscope: fold the plane into mirrored wedges.
  float a = atan(uv.y, uv.x) + uRot;
  float seg = 6.2831853 / uSeg;
  a = mod(a, seg);
  a = abs(a - seg * 0.5);
  vec2 p = vec2(cos(a), sin(a)) * r * uZoom;
  // Kaleidoscopic IFS: fold, rotate, scale. Each level adds glowing
  // filaments; deeper (finer) levels are dimmer so the structure reads clearly.
  float cs = cos(uTwist), sn = sin(uTwist);
  mat2 m = mat2(cs, -sn, sn, cs);
  float px = uZoom / min(uRes.x, uRes.y);
  float scale = 1.0;
  float weight = 1.0;
  vec3 col = vec3(0.0);
  for (int i = 0; i < 12; i++) {
    if (i >= uIter) break;
    p = abs(p) - uK;
    p = m * p;
    p *= 1.5;
    scale *= 1.5;
    float dl = abs(p.y) / scale;
    float dr = abs(length(p) - 0.8) / scale;
    float lines = exp(-dl / (px * 1.4 + 0.0008));
    float rings = exp(-dr / (px * 2.0 + 0.001));
    col += pal(float(i) * 0.13 + r * 0.45 - uTime * 0.025) * (lines + rings * 0.45) * weight;
    weight *= 0.66;
  }
  col += pal(0.0) * exp(-r * 5.0) * (0.12 + uBass * 0.45);
  col *= uGlow * (0.8 + 0.4 * uBeat) * smoothstep(1.4, 0.2, r);
  gl_FragColor = vec4(uBg * (1.0 - 0.6 * r) + col, 1.0);
}
`;

/** Kaleidoscopic Kali-set fractal folding in on itself to the beat. */
export function kaleido(): VisualizerGL {
  let pass: ShaderPass | null = null;
  let rot = 0;
  let drift = 0;
  return {
    id: 'kaleido',
    name: 'Kaleido',
    category: 'Fractal',
    kind: 'gl',
    resolution: 0.75,
    blurb: 'A folding kaleidoscope fractal that breathes with the beat',
    trailAffinity: 0,
    init(gl) {
      pass = new ShaderPass(gl, KALEIDO_FS);
    },
    render(gl, f, v, th, o) {
      if (!pass) return;
      rot += f.dt * (0.04 + f.energy * 0.3);
      drift += f.dt * (0.05 + f.mid * 0.15);
      const p = pass.begin(gl, v.w, v.h, f.time, th);
      p.f1('uSeg', 6);
      p.f1('uRot', rot);
      p.f1('uZoom', 2.4 - f.bass * 0.5 - f.beat * 0.2 * o.beatReact);
      p.f2('uK', 0.62 + 0.12 * Math.sin(drift) + f.mid * 0.12, 0.42 + 0.1 * Math.cos(drift * 0.73) + f.treble * 0.1);
      p.f1('uTwist', 0.35 + 0.25 * Math.sin(drift * 0.41) + f.bass * 0.2);
      p.f1('uGlow', 0.8 + f.energy * 0.8);
      p.f1('uBass', f.bass);
      p.f1('uBeat', f.beat * o.beatReact);
      p.i1('uIter', Math.round(6 + 3 * v.quality));
      pass.draw();
    },
    dispose() {
      pass?.dispose();
      pass = null;
    },
  };
}
