import { smoothK } from './analysis';

/**
 * Detects kick-drum style onsets from the instant bass level and estimates
 * tempo from the spacing between them. Uses time-based running statistics,
 * so it behaves the same at 30, 60 or 120 frames per second.
 */
export class BeatDetector {
  /** Visual pulse: jumps to 1 on a beat and decays smoothly. */
  pulse = 0;
  /** Number of beats detected so far. */
  count = 0;
  /** Estimated tempo, or 0 when not confident. */
  bpm = 0;

  private mean = 0;
  private variance = 0;
  private prev = 0;
  private lastBeat = -10;
  private onsets: number[] = [];

  /** Minimum gap between beats in seconds (caps detection at 200 BPM). */
  minInterval = 0.3;
  /** How far above the running mean (in standard deviations) a hit must be. */
  threshold = 1.35;

  /**
   * @param level instant bass level 0..1
   * @param dt seconds since previous call
   * @param now current time in seconds
   * @returns true when a beat starts on this frame
   */
  update(level: number, dt: number, now: number): boolean {
    const k = smoothK(dt, 0.9);
    const diff = level - this.mean;
    const std = Math.sqrt(Math.max(0, this.variance));
    const rising = level > this.prev;
    this.prev = level;

    const hit =
      rising &&
      level > 0.08 &&
      diff > Math.max(this.threshold * std, 0.045) &&
      now - this.lastBeat >= this.minInterval;

    // Update statistics after testing so the hit itself does not mask detection.
    this.mean += diff * k;
    this.variance += (diff * diff - this.variance) * k;

    this.pulse *= Math.exp(-dt / 0.16);
    if (hit) {
      this.lastBeat = now;
      this.pulse = 1;
      this.count++;
      this.onsets.push(now);
      if (this.onsets.length > 24) this.onsets.shift();
      this.bpm = estimateTempo(this.onsets);
    } else if (now - this.lastBeat > 4) {
      this.bpm = 0;
    }
    return hit;
  }

  reset(): void {
    this.pulse = 0;
    this.mean = 0;
    this.variance = 0;
    this.prev = 0;
    this.lastBeat = -10;
    this.onsets = [];
    this.bpm = 0;
  }
}

/**
 * Tempo from onset times: folds each inter-onset interval into the
 * 75–165 BPM range, then picks the most supported tempo. Returns 0 if the
 * evidence is weak.
 */
export function estimateTempo(onsets: number[]): number {
  if (onsets.length < 6) return 0;
  const candidates: number[] = [];
  for (let i = 1; i < onsets.length; i++) {
    let iv = onsets[i] - onsets[i - 1];
    if (iv <= 0.05) continue;
    let bpm = 60 / iv;
    while (bpm < 75) bpm *= 2;
    while (bpm > 165) bpm /= 2;
    candidates.push(bpm);
  }
  if (candidates.length < 5) return 0;
  let best = 0;
  let bestScore = 0;
  for (const c of candidates) {
    let score = 0;
    let sum = 0;
    for (const d of candidates) {
      if (Math.abs(d - c) < 3.5) {
        score++;
        sum += d;
      }
    }
    if (score > bestScore) {
      bestScore = score;
      best = sum / score;
    }
  }
  return bestScore / candidates.length >= 0.5 ? Math.round(best) : 0;
}
