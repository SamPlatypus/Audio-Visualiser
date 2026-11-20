import { describe, expect, it } from 'vitest';
import {
  BAND_COUNT,
  SpectrumProcessor,
  WaveformProcessor,
  bandsFromSpectrum,
  findTrigger,
  makeBandLayout,
  smoothK,
} from '../src/audio/analysis';

const SR = 48000;
const FFT = 4096;

/** A dB spectrum with a single loud partial at `hz` over a quiet floor. */
function toneSpectrum(hz: number, peakDb = -20, floorDb = -110): Float32Array {
  const s = new Float32Array(FFT / 2).fill(floorDb);
  const bin = Math.round(hz / (SR / FFT));
  s[bin] = peakDb;
  s[bin - 1] = peakDb - 8;
  s[bin + 1] = peakDb - 8;
  return s;
}

function processor(layoutCount = BAND_COUNT) {
  const p = new SpectrumProcessor(layoutCount);
  const layout = makeBandLayout(layoutCount, 32, 16000, SR, FFT);
  p.setLayout(layout);
  return { p, layout };
}

function run(p: SpectrumProcessor, layout: ReturnType<typeof makeBandLayout>, spec: Float32Array, seconds: number, fps = 60) {
  const bands = new Float32Array(layout.count);
  bandsFromSpectrum(spec, layout, bands);
  const frames = Math.round(seconds * fps);
  for (let i = 0; i < frames; i++) p.process(bands, 1 / fps);
}

describe('band layout', () => {
  it('is log spaced, contiguous and increasing', () => {
    const l = makeBandLayout(96, 32, 16000, SR, FFT);
    for (let i = 1; i < l.count; i++) {
      expect(l.lo[i]).toBeCloseTo(l.hi[i - 1], 4);
      expect(l.freq[i]).toBeGreaterThan(l.freq[i - 1]);
    }
    // Constant ratio between neighbouring band centres.
    const r1 = l.freq[1] / l.freq[0];
    const r2 = l.freq[80] / l.freq[79];
    expect(r1).toBeCloseTo(r2, 5);
    expect(l.freq[0]).toBeGreaterThan(32);
    expect(l.freq[l.count - 1]).toBeLessThan(16000);
  });

  it('clamps the top band below Nyquist for low sample rates', () => {
    const l = makeBandLayout(64, 32, 16000, 22050, 2048);
    expect(l.hi[l.count - 1]).toBeLessThan(1024);
  });
});

describe('bandsFromSpectrum', () => {
  it('puts a tone into the band that contains it', () => {
    const l = makeBandLayout(BAND_COUNT, 32, 16000, SR, FFT);
    const out = new Float32Array(BAND_COUNT);
    for (const hz of [60, 440, 3000, 9000]) {
      bandsFromSpectrum(toneSpectrum(hz), l, out);
      let best = 0;
      for (let i = 1; i < out.length; i++) if (out[i] > out[best]) best = i;
      const lo = (l.lo[best] * SR) / FFT;
      const hi = (l.hi[best] * SR) / FFT;
      // Allow one band of slack for bin quantisation.
      const ratio = hi / lo;
      expect(hz).toBeGreaterThan(lo / ratio);
      expect(hz).toBeLessThan(hi * ratio);
    }
  });

  it('handles -Infinity (digital silence) without NaN', () => {
    const l = makeBandLayout(BAND_COUNT, 32, 16000, SR, FFT);
    const out = new Float32Array(BAND_COUNT);
    bandsFromSpectrum(new Float32Array(FFT / 2).fill(-Infinity), l, out);
    for (const v of out) expect(Number.isFinite(v)).toBe(true);
  });
});

describe('SpectrumProcessor', () => {
  it('keeps values within 0..1 and lights up the right region', () => {
    const { p, layout } = processor();
    run(p, layout, toneSpectrum(100, -15), 1);
    for (const v of p.values) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
    expect(p.features.bass).toBeGreaterThan(p.features.treble);
  });

  it('higher sensitivity gives bigger values', () => {
    const quiet = processor();
    quiet.p.settings = { sensitivity: 0.5, autoLevel: false, smoothing: 0.5 };
    run(quiet.p, quiet.layout, toneSpectrum(1000, -45), 1);
    const loud = processor();
    loud.p.settings = { sensitivity: 3, autoLevel: false, smoothing: 0.5 };
    run(loud.p, loud.layout, toneSpectrum(1000, -45), 1);
    expect(loud.p.features.energy).toBeGreaterThan(quiet.p.features.energy);
  });

  it('auto level brings quiet and loud input to a similar size', () => {
    const levels = [-60, -25].map((db) => {
      const { p, layout } = processor();
      p.settings = { sensitivity: 1, autoLevel: true, smoothing: 0.5 };
      run(p, layout, toneSpectrum(500, db, db - 50), 3);
      return Math.max(...p.values);
    });
    expect(levels[0]).toBeGreaterThan(0.5);
    expect(Math.abs(levels[0] - levels[1])).toBeLessThan(0.15);
  });

  it('auto level does not amplify near-silence into full-scale bars', () => {
    const { p, layout } = processor();
    p.settings = { sensitivity: 1, autoLevel: true, smoothing: 0.5 };
    run(p, layout, new Float32Array(FFT / 2).fill(-118), 4);
    expect(Math.max(...p.values)).toBeLessThan(0.2);
  });

  it('smoothing is frame-rate independent', () => {
    const a = processor();
    const b = processor();
    run(a.p, a.layout, toneSpectrum(800, -20), 0.5, 30);
    run(b.p, b.layout, toneSpectrum(800, -20), 0.5, 120);
    expect(Math.abs(a.p.features.energy - b.p.features.energy)).toBeLessThan(0.02);
  });

  it('peaks hold above the falling values and then fall', () => {
    const { p, layout } = processor();
    run(p, layout, toneSpectrum(200, -10), 0.5);
    const idx = p.values.indexOf(Math.max(...p.values));
    run(p, layout, new Float32Array(FFT / 2).fill(-120), 0.2);
    expect(p.peaks[idx]).toBeGreaterThan(p.values[idx]);
    const held = p.peaks[idx];
    run(p, layout, new Float32Array(FFT / 2).fill(-120), 1.5);
    expect(p.peaks[idx]).toBeLessThan(held);
  });
});

describe('smoothK', () => {
  it('composes across frames like a single long step', () => {
    let x = 0;
    for (let i = 0; i < 4; i++) x += (1 - x) * smoothK(0.01, 0.1);
    let y = 0;
    y += (1 - y) * smoothK(0.04, 0.1);
    expect(x).toBeCloseTo(y, 6);
  });
});

describe('waveform', () => {
  it('auto level boosts quiet input and clamps output', () => {
    const w = new WaveformProcessor();
    const input = new Float32Array(1024).map((_, i) => 0.02 * Math.sin(i / 10));
    const out = new Float32Array(1024);
    for (let i = 0; i < 240; i++) w.process(input, out, 1 / 60, { sensitivity: 1, autoLevel: true, smoothing: 0.5 });
    expect(Math.max(...out)).toBeGreaterThan(0.3);
    expect(Math.max(...out)).toBeLessThanOrEqual(1.25);
  });

  it('finds the first rising zero crossing', () => {
    const wave = new Float32Array(200).map((_, i) => Math.sin((i + 30) / 10));
    const t = findTrigger(wave, 200);
    expect(wave[t - 1]).toBeLessThan(0);
    expect(wave[t]).toBeGreaterThanOrEqual(0);
  });
});
