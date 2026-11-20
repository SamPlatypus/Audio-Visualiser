/**
 * Spectrum analysis that turns raw FFT data into smooth, perceptually
 * balanced values the visualizers can use directly.
 *
 * Everything in here is plain math on typed arrays (no Web Audio), so it can
 * be unit tested and is frame-rate independent: every smoother takes `dt`.
 */

export const BAND_COUNT = 96;
export const F_MIN = 32;
export const F_MAX = 16000;

export interface BandLayout {
  count: number;
  /** Lower / upper edge of each band, as fractional FFT bin indices. */
  lo: Float32Array;
  hi: Float32Array;
  /** Centre frequency of each band in Hz. */
  freq: Float32Array;
}

/** Log-spaced bands between fMin and fMax, expressed in FFT bins. */
export function makeBandLayout(
  count: number,
  fMin: number,
  fMax: number,
  sampleRate: number,
  fftSize: number,
): BandLayout {
  const binHz = sampleRate / fftSize;
  const nyquist = sampleRate / 2;
  const top = Math.min(fMax, nyquist * 0.98);
  const ratio = top / fMin;
  const lo = new Float32Array(count);
  const hi = new Float32Array(count);
  const freq = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const f0 = fMin * Math.pow(ratio, i / count);
    const f1 = fMin * Math.pow(ratio, (i + 1) / count);
    lo[i] = f0 / binHz;
    hi[i] = f1 / binHz;
    freq[i] = Math.sqrt(f0 * f1);
  }
  return { count, lo, hi, freq };
}

const dbToPow = (db: number) => Math.pow(10, db / 10);
const powToDb = (p: number) => (p > 1e-20 ? 10 * Math.log10(p) : -200);

/**
 * Collapse an FFT magnitude spectrum (in dB, as returned by
 * AnalyserNode.getFloatFrequencyData) into band levels in dB.
 * Bands narrower than one bin are interpolated so low frequencies stay smooth.
 */
export function bandsFromSpectrum(spectrumDb: Float32Array, layout: BandLayout, out: Float32Array): void {
  const n = spectrumDb.length;
  for (let b = 0; b < layout.count; b++) {
    const lo = layout.lo[b];
    const hi = layout.hi[b];
    const first = Math.ceil(lo);
    const last = Math.min(n - 1, Math.floor(hi));
    if (last >= first) {
      let sum = 0;
      let peak = 0;
      for (let k = first; k <= last; k++) {
        const p = dbToPow(spectrumDb[k]);
        sum += p;
        if (p > peak) peak = p;
      }
      // Blend mean and peak power: mean keeps wide bands calm, peak keeps
      // tonal content (a single loud partial) visible.
      const mean = sum / (last - first + 1);
      out[b] = powToDb(mean * 0.5 + peak * 0.5);
    } else {
      const c = Math.min(n - 1.001, Math.max(0, (lo + hi) / 2));
      const k = Math.floor(c);
      const t = c - k;
      const p = dbToPow(spectrumDb[k]) * (1 - t) + dbToPow(spectrumDb[k + 1]) * t;
      out[b] = powToDb(p);
    }
  }
}

/** Exponential smoothing coefficient for a time constant, independent of frame rate. */
export function smoothK(dt: number, tau: number): number {
  if (tau <= 0) return 1;
  return 1 - Math.exp(-dt / tau);
}

export interface SpectrumSettings {
  /** Linear input gain applied before mapping, 0.25 – 4. */
  sensitivity: number;
  /** Track the loudness of the input and keep it filling the display. */
  autoLevel: boolean;
  /** 0 = snappy, 1 = very smooth. */
  smoothing: number;
}

export interface Features {
  bass: number;
  mid: number;
  treble: number;
  energy: number;
}

/**
 * Converts band dB levels into normalised 0..1 values with:
 *  - a +3 dB/octave tilt so treble is as visible as bass,
 *  - automatic level tracking (optional) plus user sensitivity,
 *  - attack/release smoothing and falling peak markers.
 */
export class SpectrumProcessor {
  readonly count: number;
  /** Instant normalised level per band (unsmoothed). */
  readonly raw: Float32Array;
  /** Smoothed level per band — what visualizers should draw. */
  readonly values: Float32Array;
  /** Falling peak markers. */
  readonly peaks: Float32Array;
  readonly features: Features = { bass: 0, mid: 0, treble: 0, energy: 0 };

  settings: SpectrumSettings = { sensitivity: 1, autoLevel: true, smoothing: 0.5 };

  /** Dynamic range shown on screen, in dB. */
  range = 58;
  /** Fixed ceiling used when auto level is off. */
  fixedCeilingDb = -24;
  /** Auto-level reference (tracks recent loud band level). */
  reference = -40;
  /** Seconds of fast auto-level adaptation left (after a new source starts). */
  private settleTime = 2;

  private tilt: Float32Array;
  private peakVel: Float32Array;
  private peakHold: Float32Array;
  private bassEnd = 0;
  private midEnd = 0;
  private layout: BandLayout | null = null;

  constructor(count = BAND_COUNT) {
    this.count = count;
    this.raw = new Float32Array(count);
    this.values = new Float32Array(count);
    this.peaks = new Float32Array(count);
    this.tilt = new Float32Array(count);
    this.peakVel = new Float32Array(count);
    this.peakHold = new Float32Array(count);
  }

  setLayout(layout: BandLayout): void {
    this.layout = layout;
    this.bassEnd = 0;
    this.midEnd = 0;
    for (let i = 0; i < this.count; i++) {
      const f = layout.freq[i];
      this.tilt[i] = 3 * Math.log2(f / 1000);
      if (f < 250) this.bassEnd = i + 1;
      if (f < 2500) this.midEnd = i + 1;
    }
  }

  get bandLayout(): BandLayout | null {
    return this.layout;
  }

  /** dB value that maps to the top of the display. */
  get ceilingDb(): number {
    return this.settings.autoLevel ? this.reference + 3 : this.fixedCeilingDb;
  }

  /** Feed one frame of band levels (dB) and advance the smoothers by dt seconds. */
  process(bandDb: Float32Array, dt: number): void {
    const n = this.count;
    const { sensitivity, autoLevel, smoothing } = this.settings;

    // Track the loudest tilted band for auto level.
    let frameMax = -200;
    for (let i = 0; i < n; i++) {
      const v = bandDb[i] + this.tilt[i];
      if (v > frameMax) frameMax = v;
    }
    if (autoLevel) {
      if (frameMax > this.reference) this.reference += (frameMax - this.reference) * smoothK(dt, 0.08);
      // Fall 5 dB/s normally (no pumping), much faster while settling on a new source.
      else this.reference -= (this.settleTime > 0 ? 30 : 5) * dt;
      if (this.settleTime > 0) this.settleTime -= dt;
      // Never chase the noise floor: silence should look like silence. -62 dB
      // still lets distant music picked up by a phone mic fill the screen.
      this.reference = Math.min(0, Math.max(-62, this.reference));
    }

    const gainDb = 20 * Math.log10(Math.max(0.05, sensitivity));
    const ceiling = this.ceilingDb;
    const floor = ceiling - this.range;
    const invRange = 1 / this.range;

    const attack = smoothK(dt, 0.025);
    const release = smoothK(dt, 0.06 + smoothing * 0.42);
    const gravity = 1.6; // peak fall acceleration, display heights per s^2

    for (let i = 0; i < n; i++) {
      let v = (bandDb[i] + this.tilt[i] + gainDb - floor) * invRange;
      v = v <= 0 ? 0 : v >= 1 ? 1 : v;
      v = Math.pow(v, 1.35); // expand contrast so quiet detail sits low
      this.raw[i] = v;

      const cur = this.values[i];
      const next = cur + (v - cur) * (v > cur ? attack : release);
      this.values[i] = next;

      // Peaks: hold briefly, then fall with gravity.
      if (next >= this.peaks[i]) {
        this.peaks[i] = next;
        this.peakVel[i] = 0;
        this.peakHold[i] = 0.35;
      } else if (this.peakHold[i] > 0) {
        this.peakHold[i] -= dt;
      } else {
        this.peakVel[i] += gravity * dt;
        this.peaks[i] = Math.max(next, this.peaks[i] - this.peakVel[i] * dt);
      }
    }

    // Feature bands.
    const f = this.features;
    const bass = average(this.values, 0, this.bassEnd);
    const mid = average(this.values, this.bassEnd, this.midEnd);
    const treble = average(this.values, this.midEnd, n);
    const energy = average(this.values, 0, n);
    const kf = smoothK(dt, 0.05);
    f.bass += (bass - f.bass) * kf;
    f.mid += (mid - f.mid) * kf;
    f.treble += (treble - f.treble) * kf;
    f.energy += (energy - f.energy) * kf;
  }

  /** Adapt the auto level quickly for the next couple of seconds (new source). */
  settle(): void {
    this.settleTime = 2;
  }

  /** Mean of the raw (instant) bass bands — used for beat detection. */
  rawBass(): number {
    return average(this.raw, 0, Math.max(1, this.bassEnd));
  }

  reset(): void {
    this.raw.fill(0);
    this.values.fill(0);
    this.peaks.fill(0);
    this.peakVel.fill(0);
    this.peakHold.fill(0);
    this.features.bass = this.features.mid = this.features.treble = this.features.energy = 0;
  }
}

function average(a: Float32Array, from: number, to: number): number {
  if (to <= from) return 0;
  let s = 0;
  for (let i = from; i < to; i++) s += a[i];
  return s / (to - from);
}

/**
 * Normalises a time-domain waveform for display. With auto level on, the
 * gain follows the signal's RMS (not its peak, which a single kick drum
 * would dominate) and a soft tanh saturation keeps transients on screen
 * without hard clipping. Sensitivity scales the result.
 */
export class WaveformProcessor {
  /** Smoothed RMS of recent input. */
  rms = 0.1;
  /** Gain applied on the most recent call (reused for the stereo channels). */
  lastGain = 1;

  process(input: Float32Array, out: Float32Array, dt: number, settings: SpectrumSettings): number {
    let sum = 0;
    for (let i = 0; i < input.length; i++) sum += input[i] * input[i];
    const rms = Math.sqrt(sum / Math.max(1, input.length));
    // Fast to rise, slow to fall, so loud passages don't pump.
    this.rms += (rms - this.rms) * smoothK(dt, rms > this.rms ? 0.08 : 0.8);

    const auto = settings.autoLevel ? 0.38 / Math.max(0.012, this.rms) : 1.6;
    const gain = Math.min(40, auto * settings.sensitivity);
    this.lastGain = gain;
    for (let i = 0; i < input.length; i++) out[i] = softClip(input[i] * gain);
    return rms;
  }
}

/** Smooth saturation into roughly ±1.1. */
export function softClip(v: number): number {
  return 1.1 * Math.tanh(v);
}

/** Index of the first rising zero crossing, for a stable oscilloscope trace. */
export function findTrigger(wave: Float32Array, searchLength: number): number {
  const end = Math.min(wave.length - 1, searchLength);
  for (let i = 1; i < end; i++) {
    if (wave[i - 1] < 0 && wave[i] >= 0) return i;
  }
  return 0;
}
