import { describe, expect, it } from 'vitest';
import { THEMES, buildLut, hexToRgb, pingPong } from '../src/render/themes';
import { DEFAULTS, sanitize } from '../src/state/settings';
import { formatTime, sensToSlider, sliderToSens } from '../src/ui/controls';

const modes = ['spectrum', 'radial', 'julia'];
const themes = THEMES.map((t) => t.id);

describe('settings sanitize', () => {
  it('returns defaults for garbage', () => {
    expect(sanitize(null, modes, themes)).toEqual({ ...DEFAULTS });
    expect(sanitize('nope', modes, themes)).toEqual({ ...DEFAULTS });
  });

  it('clamps numbers and rejects unknown ids', () => {
    const s = sanitize(
      { sensitivity: 99, smoothing: -1, mode: 'missing', theme: 'sunset', quality: 'ultra', trails: '0.5', autoCycle: '30' },
      modes,
      themes,
    );
    expect(s.sensitivity).toBe(4);
    expect(s.smoothing).toBe(0);
    expect(s.mode).toBe('radial');
    expect(s.theme).toBe('sunset');
    expect(s.quality).toBe('auto');
    expect(s.trails).toBe(DEFAULTS.trails);
    expect(s.autoCycle).toBe('30');
  });

  it('falls back to the first mode if the default mode is unavailable', () => {
    expect(sanitize({}, ['scope', 'tree'], themes).mode).toBe('scope');
  });
});

describe('themes', () => {
  it('have unique ids and valid colours', () => {
    expect(new Set(themes).size).toBe(themes.length);
    for (const t of THEMES) {
      expect(t.stops.length).toBeGreaterThanOrEqual(2);
      for (const c of [...t.stops, ...t.bg]) expect(c).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it('LUT interpolates between the end stops', () => {
    const lut = buildLut(['#000000', '#ffffff']);
    expect([lut[0], lut[1], lut[2]]).toEqual([0, 0, 0]);
    expect([lut[765], lut[766], lut[767]]).toEqual([255, 255, 255]);
    expect(lut[128 * 3]).toBeGreaterThan(120);
    expect(lut[128 * 3]).toBeLessThan(136);
  });

  it('hexToRgb parses short and long forms', () => {
    expect(hexToRgb('#fff')).toEqual([255, 255, 255]);
    expect(hexToRgb('#102030')).toEqual([16, 32, 48]);
  });

  it('ping-pong is continuous and stays in range', () => {
    for (let x = -3; x <= 3; x += 0.01) {
      const v = pingPong(x);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
      expect(Math.abs(pingPong(x + 0.01) - v)).toBeLessThan(0.011);
    }
  });
});

describe('control helpers', () => {
  it('sensitivity slider is log scaled with 1× in the middle', () => {
    expect(sliderToSens(500)).toBe(1);
    expect(sliderToSens(0)).toBe(0.25);
    expect(sliderToSens(1000)).toBe(4);
    expect(sensToSlider(1)).toBe(500);
    for (const s of [0.3, 0.5, 2, 3.5]) expect(sliderToSens(sensToSlider(s))).toBeCloseTo(s, 1);
  });

  it('formats times', () => {
    expect(formatTime(0)).toBe('0:00');
    expect(formatTime(65.7)).toBe('1:05');
    expect(formatTime(NaN)).toBe('0:00');
  });
});
