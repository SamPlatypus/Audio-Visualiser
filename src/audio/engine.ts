import type { AudioFrame } from '../render/types';
import {
  BAND_COUNT,
  F_MAX,
  F_MIN,
  SpectrumProcessor,
  WaveformProcessor,
  bandsFromSpectrum,
  makeBandLayout,
  smoothK,
  softClip,
} from './analysis';
import { BeatDetector } from './beat';
import { DemoSynth } from './demo';

export type SourceKind = 'none' | 'mic' | 'file' | 'demo';

export const WAVE_SIZE = 2048;
const FFT_SIZE = 4096;

export class AudioError extends Error {
  constructor(
    readonly code: 'insecure' | 'unsupported' | 'denied' | 'no-device' | 'busy' | 'decode' | 'unknown',
    message: string,
  ) {
    super(message);
  }
}

type WebkitWindow = Window & { webkitAudioContext?: typeof AudioContext };

/**
 * Owns the AudioContext, the three kinds of sources (microphone, local file,
 * built-in demo) and the analysis chain. Emits `change` whenever the source
 * or play state changes.
 */
export class AudioEngine extends EventTarget {
  ctx: AudioContext | null = null;
  source: SourceKind = 'none';
  readonly media: HTMLAudioElement;
  readonly spectrum = new SpectrumProcessor(BAND_COUNT);
  readonly beat = new BeatDetector();

  private analyser: AnalyserNode | null = null;
  private analyserL: AnalyserNode | null = null;
  private analyserR: AnalyserNode | null = null;
  private input: GainNode | null = null;
  private output: GainNode | null = null;
  private mediaNode: MediaElementAudioSourceNode | null = null;
  private micStream: MediaStream | null = null;
  private micNode: MediaStreamAudioSourceNode | null = null;
  private demo: DemoSynth | null = null;
  private objectUrl: string | null = null;

  private readonly waveProc = new WaveformProcessor();
  private fftDb = new Float32Array(FFT_SIZE / 2);
  private bandDb = new Float32Array(BAND_COUNT);
  private timeBuf = new Float32Array(FFT_SIZE);
  private timeL = new Float32Array(WAVE_SIZE);
  private timeR = new Float32Array(WAVE_SIZE);
  private idleMix = 1;

  readonly frame: AudioFrame;

  constructor() {
    super();
    this.media = new Audio();
    this.media.preload = 'auto';
    this.media.setAttribute('playsinline', '');
    for (const ev of ['play', 'pause', 'ended', 'loadedmetadata', 'emptied']) {
      this.media.addEventListener(ev, () => this.emit());
    }
    // Decode errors can surface after playback starts (truncated / corrupt files).
    this.media.addEventListener('error', () => {
      if (this.source === 'file' && this.media.getAttribute('src')) {
        this.dispatchEvent(new Event('mediaerror'));
      }
    });
    this.frame = {
      time: 0,
      dt: 0,
      bands: this.spectrum.values,
      peaks: this.spectrum.peaks,
      wave: new Float32Array(WAVE_SIZE),
      waveL: new Float32Array(WAVE_SIZE),
      waveR: new Float32Array(WAVE_SIZE),
      stereo: false,
      bass: 0,
      mid: 0,
      treble: 0,
      energy: 0,
      beat: 0,
      beatCount: 0,
      bpm: 0,
      level: 0,
      active: false,
    };
  }

  private emit(): void {
    this.dispatchEvent(new Event('change'));
  }

  /** Create (or wake) the audio graph. Must first be called from a user gesture. */
  private ensureContext(): AudioContext {
    if (!this.ctx) {
      const Ctor = window.AudioContext || (window as WebkitWindow).webkitAudioContext;
      if (!Ctor) throw new AudioError('unsupported', 'This browser does not support Web Audio.');
      const ctx = new Ctor({ latencyHint: 'interactive' });
      const analyser = ctx.createAnalyser();
      analyser.fftSize = FFT_SIZE;
      analyser.smoothingTimeConstant = 0;
      analyser.minDecibels = -120;
      analyser.maxDecibels = 0;

      const input = ctx.createGain();
      input.connect(analyser);
      const splitter = ctx.createChannelSplitter(2);
      input.connect(splitter);
      const aL = ctx.createAnalyser();
      const aR = ctx.createAnalyser();
      aL.fftSize = aR.fftSize = WAVE_SIZE;
      splitter.connect(aL, 0);
      splitter.connect(aR, 1);

      const output = ctx.createGain();
      output.connect(ctx.destination);

      this.ctx = ctx;
      this.analyser = analyser;
      this.analyserL = aL;
      this.analyserR = aR;
      this.input = input;
      this.output = output;
      this.fftDb = new Float32Array(analyser.frequencyBinCount);
      this.spectrum.setLayout(makeBandLayout(BAND_COUNT, F_MIN, F_MAX, ctx.sampleRate, FFT_SIZE));
      ctx.addEventListener('statechange', () => this.emit());
    }
    if (this.ctx.state !== 'running') void this.ctx.resume().catch(() => undefined);
    return this.ctx;
  }

  /** Re-start the context after the OS suspended it (e.g. phone call, tab switch). */
  async wake(): Promise<void> {
    if (this.ctx && this.ctx.state !== 'running') {
      try {
        await this.ctx.resume();
      } catch {
        /* will retry on next gesture */
      }
    }
  }

  get contextSuspended(): boolean {
    return !!this.ctx && this.ctx.state !== 'running' && this.source !== 'none';
  }

  // ---------------------------------------------------------------- sources

  async useMicrophone(): Promise<void> {
    const ctx = this.ensureContext();
    if (!navigator.mediaDevices?.getUserMedia) {
      throw window.isSecureContext
        ? new AudioError('unsupported', 'Microphone input is not available in this browser.')
        : new AudioError('insecure', 'Microphone access needs the app to be opened over HTTPS or installed.');
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
        video: false,
      });
    } catch (err) {
      const name = (err as DOMException)?.name;
      if (name === 'NotAllowedError' || name === 'SecurityError')
        throw new AudioError('denied', 'Microphone permission was denied. Allow it in your browser or app settings.');
      if (name === 'NotFoundError' || name === 'OverconstrainedError')
        throw new AudioError('no-device', 'No microphone was found on this device.');
      if (name === 'NotReadableError' || name === 'AbortError')
        throw new AudioError('busy', 'The microphone is being used by another app.');
      throw new AudioError('unknown', 'Could not start the microphone.');
    }
    this.stopCurrent();
    await this.wake();
    this.micStream = stream;
    this.micNode = ctx.createMediaStreamSource(stream);
    this.micNode.connect(this.input!);
    const track = stream.getAudioTracks()[0];
    track?.addEventListener('ended', () => {
      if (this.micStream === stream) {
        this.stopCurrent();
        this.setSource('none');
      }
    });
    this.resetAnalysis();
    this.setSource('mic');
  }

  /** Load a local file into the player and start it. */
  async playFile(file: File): Promise<void> {
    const ctx = this.ensureContext();
    this.stopCurrent();
    if (!this.mediaNode) {
      this.mediaNode = ctx.createMediaElementSource(this.media);
      this.mediaNode.connect(this.input!);
      this.mediaNode.connect(this.output!);
    }
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
    this.objectUrl = URL.createObjectURL(file);
    this.media.src = this.objectUrl;
    this.resetAnalysis();
    this.setSource('file');
    try {
      await this.media.play();
    } catch (err) {
      const name = (err as DOMException)?.name;
      if (name === 'NotAllowedError') return; // autoplay blocked: user can press play
      throw new AudioError('decode', `“${file.name}” could not be played. The format may not be supported.`);
    }
  }

  useDemo(): void {
    const ctx = this.ensureContext();
    this.stopCurrent();
    if (!this.demo) {
      this.demo = new DemoSynth(ctx);
      this.demo.output.connect(this.input!);
      this.demo.output.connect(this.output!);
    }
    this.demo.start();
    this.resetAnalysis();
    this.setSource('demo');
  }

  /** Stop the current source and return to the idle animation. */
  stop(): void {
    this.stopCurrent();
    this.setSource('none');
  }

  private stopCurrent(): void {
    if (!this.media.paused) this.media.pause();
    this.demo?.stop();
    if (this.micStream) {
      for (const t of this.micStream.getTracks()) t.stop();
      this.micStream = null;
    }
    if (this.micNode) {
      this.micNode.disconnect();
      this.micNode = null;
    }
  }

  private setSource(kind: SourceKind): void {
    this.source = kind;
    this.emit();
  }

  private resetAnalysis(): void {
    this.beat.reset();
    this.spectrum.settle();
  }

  // ------------------------------------------------------------- transport

  get playing(): boolean {
    switch (this.source) {
      case 'file':
        return !this.media.paused && !this.media.ended;
      case 'demo':
        return !!this.demo?.playing;
      case 'mic':
        return true;
      default:
        return false;
    }
  }

  get canPause(): boolean {
    return this.source === 'file' || this.source === 'demo';
  }

  async play(): Promise<void> {
    this.ensureContext();
    await this.wake();
    if (this.source === 'file') {
      if (this.media.ended) this.media.currentTime = 0;
      try {
        await this.media.play();
      } catch {
        /* surfaced through the play state */
      }
    } else if (this.source === 'demo') {
      this.demo?.start();
      this.emit();
    }
  }

  pause(): void {
    if (this.source === 'file') this.media.pause();
    else if (this.source === 'demo') {
      this.demo?.stop();
      this.emit();
    }
  }

  togglePlay(): void {
    if (this.playing) this.pause();
    else void this.play();
  }

  seek(seconds: number): void {
    if (this.source !== 'file' || !isFinite(this.media.duration)) return;
    this.media.currentTime = Math.max(0, Math.min(this.media.duration - 0.05, seconds));
  }

  get currentTime(): number {
    return this.source === 'file' ? this.media.currentTime : 0;
  }

  get duration(): number {
    return this.source === 'file' && isFinite(this.media.duration) ? this.media.duration : 0;
  }

  // -------------------------------------------------------------- analysis

  /** Produce the analysis frame for this animation frame. */
  analyse(time: number, dt: number, needStereo: boolean): AudioFrame {
    const f = this.frame;
    f.time = time;
    f.dt = dt;
    const live = this.source !== 'none' && this.playing && !!this.analyser;

    // Blend towards a gentle idle animation whenever nothing is playing so the
    // screen never looks frozen.
    this.idleMix += ((live ? 0 : 1) - this.idleMix) * smoothK(dt, live ? 0.15 : 0.8);
    f.active = live;

    if (this.analyser && this.source !== 'none') {
      this.analyser.getFloatFrequencyData(this.fftDb);
      bandsFromSpectrum(this.fftDb, this.spectrum.bandLayout!, this.bandDb);
      this.spectrum.process(this.bandDb, dt);

      this.analyser.getFloatTimeDomainData(this.timeBuf);
      const recent = this.timeBuf.subarray(FFT_SIZE - WAVE_SIZE);
      const rms = this.waveProc.process(recent, f.wave, dt, this.spectrum.settings);
      f.level += (Math.min(1, rms * 3.2) - f.level) * smoothK(dt, 0.08);

      f.stereo = false;
      if (needStereo && this.analyserL && this.analyserR) {
        this.analyserL.getFloatTimeDomainData(this.timeL);
        this.analyserR.getFloatTimeDomainData(this.timeR);
        let diff = 0;
        let rEnergy = 0;
        for (let i = 0; i < WAVE_SIZE; i += 8) {
          diff += Math.abs(this.timeL[i] - this.timeR[i]);
          rEnergy += Math.abs(this.timeR[i]);
        }
        f.stereo = diff > 1e-3 && rEnergy > 1e-3;
        if (f.stereo) {
          const gain = this.waveProc.lastGain;
          for (let i = 0; i < WAVE_SIZE; i++) {
            f.waveL[i] = softClip(this.timeL[i] * gain);
            f.waveR[i] = softClip(this.timeR[i] * gain);
          }
        }
      }
      if (!f.stereo && needStereo) {
        f.waveL.set(f.wave);
        f.waveR.set(f.wave);
      }

      this.beat.update(this.spectrum.rawBass(), dt, time);
    } else {
      this.spectrum.process(SILENCE, dt);
      f.wave.fill(0);
      f.level += (0 - f.level) * smoothK(dt, 0.1);
      this.beat.update(0, dt, time);
    }

    const s = this.spectrum.features;
    f.bass = s.bass;
    f.mid = s.mid;
    f.treble = s.treble;
    f.energy = s.energy;
    f.beat = this.beat.pulse;
    f.beatCount = this.beat.count;
    f.bpm = live ? this.beat.bpm : 0;

    if (this.idleMix > 0.002) this.mixIdle(time, this.idleMix);
    return f;
  }

  /** Overlay a slow, breathing synthetic signal (used while idle or paused). */
  private mixIdle(t: number, mix: number): void {
    const f = this.frame;
    const b = f.bands;
    const n = b.length;
    for (let i = 0; i < n; i++) {
      const x = i / n;
      const idle =
        0.16 +
        0.12 * Math.sin(t * 0.8 + x * 9.0) * Math.sin(t * 0.31 - x * 4.0) +
        0.07 * Math.sin(t * 1.9 + x * 23.0) -
        x * 0.08;
      b[i] += (Math.max(0, idle) - b[i]) * mix;
      f.peaks[i] = Math.max(b[i], f.peaks[i] * (1 - mix * 0.02));
    }
    const w = f.wave;
    for (let i = 0; i < w.length; i++) {
      const p = (i / w.length) * Math.PI * 2;
      const idle = 0.18 * Math.sin(p * 3 + t * 1.3) * Math.sin(p * 0.5 + t * 0.4) + 0.05 * Math.sin(p * 11 - t * 2);
      w[i] += (idle - w[i]) * mix;
    }
    if (f.waveL !== w) {
      f.waveL.set(w);
      f.waveR.set(w);
    }
    const breathe = 0.5 + 0.5 * Math.sin(t * 0.9);
    f.bass += (0.18 + 0.12 * breathe - f.bass) * mix;
    f.mid += (0.14 + 0.08 * Math.sin(t * 0.6) - f.mid) * mix;
    f.treble += (0.08 - f.treble) * mix;
    f.energy += (0.15 + 0.05 * breathe - f.energy) * mix;
  }
}

const SILENCE = new Float32Array(BAND_COUNT).fill(-200);
