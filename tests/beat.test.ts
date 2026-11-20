import { describe, expect, it } from 'vitest';
import { BeatDetector, estimateTempo } from '../src/audio/beat';

/** Simulate a kick drum envelope at `bpm` for `seconds`, sampled at `fps`. */
function simulate(bpm: number, seconds: number, fps = 60, noise = 0.03) {
  const d = new BeatDetector();
  const period = 60 / bpm;
  let hits = 0;
  let seed = 1;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) - 0.5;
  for (let i = 0; i < seconds * fps; i++) {
    const t = i / fps;
    const phase = (t % period) / period;
    const kick = Math.exp(-phase * 9) * 0.7;
    const level = 0.18 + kick + rand() * noise;
    if (d.update(level, 1 / fps, t)) hits++;
  }
  return { d, hits };
}

describe('BeatDetector', () => {
  it('finds one beat per kick at 120 BPM', () => {
    const { hits } = simulate(120, 10);
    expect(hits).toBeGreaterThanOrEqual(18);
    expect(hits).toBeLessThanOrEqual(21);
  });

  it('behaves the same at 30 and 120 fps', () => {
    const a = simulate(100, 12, 30).hits;
    const b = simulate(100, 12, 120).hits;
    expect(Math.abs(a - b)).toBeLessThanOrEqual(2);
  });

  it('estimates tempo', () => {
    const { d } = simulate(128, 12);
    expect(Math.abs(d.bpm - 128)).toBeLessThanOrEqual(3);
  });

  it('stays quiet on steady sound', () => {
    const d = new BeatDetector();
    let hits = 0;
    for (let i = 0; i < 600; i++) if (d.update(0.4, 1 / 60, i / 60)) hits++;
    expect(hits).toBeLessThanOrEqual(1);
  });

  it('pulse decays after a beat', () => {
    const d = new BeatDetector();
    for (let i = 0; i < 120; i++) d.update(0.1, 1 / 60, i / 60);
    d.update(0.9, 1 / 60, 2.0);
    expect(d.pulse).toBe(1);
    for (let i = 1; i <= 30; i++) d.update(0.1, 1 / 60, 2 + i / 60);
    expect(d.pulse).toBeLessThan(0.1);
  });
});

describe('estimateTempo', () => {
  it('folds half/double time into range', () => {
    const onsets = Array.from({ length: 12 }, (_, i) => i * (60 / 60)); // 60 BPM -> 120
    expect(estimateTempo(onsets)).toBe(120);
  });
  it('returns 0 for irregular onsets', () => {
    expect(estimateTempo([0, 0.37, 1.13, 1.61, 2.71, 3.02, 4.93, 5.51])).toBe(0);
  });
});
