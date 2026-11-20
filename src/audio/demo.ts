/**
 * A small generative synth-pop loop built entirely from Web Audio nodes, so
 * the visualizer can be tried with sound without a microphone or any files.
 * Uses a look-ahead scheduler for sample-accurate timing.
 */

const BPM = 116;
const STEP = 60 / BPM / 4; // sixteenth note
const LOOKAHEAD = 0.14;

// Am – F – C – G, as MIDI notes (root, third, fifth, octave-ish colour).
const CHORDS = [
  [57, 60, 64, 69],
  [53, 57, 60, 65],
  [48, 55, 60, 64],
  [55, 59, 62, 67],
];
const BASS_PATTERN = [0, 0, 12, 0, 0, 12, 0, 7, 0, 0, 12, 0, 0, 7, 12, 10];
const ARP_ORDER = [0, 1, 2, 3, 2, 1, 2, 3, 0, 2, 1, 3, 2, 3, 1, 2];

const midiHz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

export class DemoSynth {
  readonly output: GainNode;
  private ctx: AudioContext;
  private master: DynamicsCompressorNode;
  private delay: DelayNode;
  private noise: AudioBuffer;
  private timer: number | null = null;
  private nextTime = 0;
  private step = 0;

  constructor(ctx: AudioContext) {
    this.ctx = ctx;
    this.output = ctx.createGain();
    this.output.gain.value = 0.85;
    this.master = ctx.createDynamicsCompressor();
    this.master.threshold.value = -14;
    this.master.ratio.value = 4;
    this.master.attack.value = 0.004;
    this.master.release.value = 0.2;
    this.master.connect(this.output);

    // Feedback delay for the arpeggio.
    this.delay = ctx.createDelay(1);
    this.delay.delayTime.value = STEP * 3;
    const fb = ctx.createGain();
    fb.gain.value = 0.32;
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 3200;
    this.delay.connect(tone).connect(fb).connect(this.delay);
    tone.connect(this.master);

    const len = Math.floor(ctx.sampleRate * 1);
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }

  get playing(): boolean {
    return this.timer !== null;
  }

  start(): void {
    if (this.timer !== null) return;
    this.nextTime = this.ctx.currentTime + 0.06;
    this.timer = window.setInterval(() => this.schedule(), 25);
    this.schedule();
  }

  stop(): void {
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
  }

  dispose(): void {
    this.stop();
    this.output.disconnect();
  }

  /** Song position in seconds within the 4-bar loop. */
  get position(): number {
    return (this.step % 64) * STEP;
  }

  private schedule(): void {
    const ctx = this.ctx;
    // If the tab was throttled, skip ahead instead of firing a burst of notes.
    if (this.nextTime < ctx.currentTime - 0.2) this.nextTime = ctx.currentTime + 0.05;
    while (this.nextTime < ctx.currentTime + LOOKAHEAD) {
      this.playStep(this.step, this.nextTime);
      this.nextTime += STEP;
      this.step = (this.step + 1) % 256;
    }
  }

  private playStep(step: number, t: number): void {
    const s16 = step % 16;
    const bar = Math.floor(step / 16) % 4;
    const section = Math.floor(step / 64) % 4; // 4 sections of 4 bars
    const chord = CHORDS[bar];

    if (s16 % 4 === 0) this.kick(t);
    if (s16 === 4 || s16 === 12) this.snare(t);
    if (section > 0 && s16 % 2 === 1) this.hat(t, s16 % 4 === 3 ? 0.12 : 0.05);
    if (section === 3 && s16 === 14) this.hat(t, 0.28);
    this.bass(t, chord[0] - 24 + BASS_PATTERN[s16]);
    if (s16 === 0) this.pad(t, chord, STEP * 16);
    if (section >= 1) this.pluck(t, chord[ARP_ORDER[s16]] + 12, section === 2 ? 0.07 : 0.05);
  }

  private env(param: AudioParam, t: number, peak: number, attack: number, decay: number): void {
    param.cancelScheduledValues(t);
    param.setValueAtTime(0.0001, t);
    param.exponentialRampToValueAtTime(peak, t + attack);
    param.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  }

  private kick(t: number): void {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.frequency.setValueAtTime(155, t);
    osc.frequency.exponentialRampToValueAtTime(42, t + 0.13);
    this.env(g.gain, t, 1.0, 0.003, 0.42);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + 0.5);
  }

  private snare(t: number): void {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1900;
    bp.Q.value = 0.8;
    const g = ctx.createGain();
    this.env(g.gain, t, 0.55, 0.002, 0.19);
    src.connect(bp).connect(g).connect(this.master);
    src.start(t, Math.random() * 0.5);
    src.stop(t + 0.25);

    const body = ctx.createOscillator();
    body.type = 'triangle';
    body.frequency.setValueAtTime(220, t);
    body.frequency.exponentialRampToValueAtTime(140, t + 0.08);
    const bg = ctx.createGain();
    this.env(bg.gain, t, 0.3, 0.002, 0.09);
    body.connect(bg).connect(this.master);
    body.start(t);
    body.stop(t + 0.12);
  }

  private hat(t: number, length: number): void {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 7600;
    const g = ctx.createGain();
    this.env(g.gain, t, 0.22, 0.001, length);
    src.connect(hp).connect(g).connect(this.master);
    src.start(t, Math.random() * 0.5);
    src.stop(t + length + 0.02);
  }

  private bass(t: number, note: number): void {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = midiHz(note);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = 6;
    lp.frequency.setValueAtTime(180, t);
    lp.frequency.exponentialRampToValueAtTime(900, t + 0.02);
    lp.frequency.exponentialRampToValueAtTime(160, t + STEP * 1.6);
    const g = ctx.createGain();
    this.env(g.gain, t, 0.32, 0.005, STEP * 1.8);
    osc.connect(lp).connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + STEP * 2);
  }

  private pad(t: number, chord: number[], length: number): void {
    const ctx = this.ctx;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(700, t);
    lp.frequency.linearRampToValueAtTime(2200, t + length * 0.5);
    lp.frequency.linearRampToValueAtTime(900, t + length);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.06, t + 0.35);
    g.gain.setValueAtTime(0.06, t + length - 0.25);
    g.gain.exponentialRampToValueAtTime(0.0001, t + length + 0.1);
    lp.connect(g).connect(this.master);
    for (const note of chord.slice(0, 3)) {
      for (const detune of [-9, 8]) {
        const osc = ctx.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.value = midiHz(note);
        osc.detune.value = detune;
        osc.connect(lp);
        osc.start(t);
        osc.stop(t + length + 0.15);
      }
    }
  }

  private pluck(t: number, note: number, level: number): void {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.value = midiHz(note);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(5200, t);
    lp.frequency.exponentialRampToValueAtTime(700, t + 0.16);
    const g = ctx.createGain();
    this.env(g.gain, t, level, 0.002, 0.2);
    osc.connect(lp).connect(g);
    g.connect(this.master);
    g.connect(this.delay);
    osc.start(t);
    osc.stop(t + 0.25);
  }
}
