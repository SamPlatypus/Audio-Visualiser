// Writes a short synthetic stereo music loop (kick, bass, hats, panned lead) as a WAV.
// Used by the end-to-end test both as an "uploaded file" and as fake microphone input.
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export function makeTestTrack(path, seconds = 12, sampleRate = 44100) {
  const n = Math.floor(seconds * sampleRate);
  const L = new Float32Array(n);
  const R = new Float32Array(n);
  const bpm = 120;
  const beat = 60 / bpm;
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  const notes = [110, 110, 130.81, 98];
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    const tb = t % beat;
    const bar = Math.floor(t / (beat * 4)) % 4;
    // Kick: pitch-dropping sine.
    const kf = 50 + 110 * Math.exp(-tb * 30);
    const kick = Math.sin(2 * Math.PI * kf * tb) * Math.exp(-tb * 7) * 0.8;
    // Bass on eighths.
    const t8 = t % (beat / 2);
    const bass = Math.sin(2 * Math.PI * notes[bar] * t) * Math.exp(-t8 * 5) * 0.3;
    // Hats on off-beats.
    const off = (t + beat / 2) % beat;
    const hat = rand() * Math.exp(-off * 60) * 0.18;
    // Lead arpeggio, panned left/right alternately.
    const t16 = t % (beat / 4);
    const step = Math.floor(t / (beat / 4)) % 8;
    const lf = notes[bar] * 4 * [1, 1.25, 1.5, 2, 1.5, 1.25, 1, 0.75][step];
    const lead = Math.sign(Math.sin(2 * Math.PI * lf * t)) * Math.exp(-t16 * 12) * 0.08;
    const pan = step % 2 ? 0.8 : 0.2;
    L[i] = kick + bass + hat + lead * (1 - pan);
    R[i] = kick + bass + hat * 0.7 + lead * pan;
  }
  const data = Buffer.alloc(44 + n * 4);
  data.write('RIFF', 0);
  data.writeUInt32LE(36 + n * 4, 4);
  data.write('WAVE', 8);
  data.write('fmt ', 12);
  data.writeUInt32LE(16, 16);
  data.writeUInt16LE(1, 20); // PCM
  data.writeUInt16LE(2, 22); // stereo
  data.writeUInt32LE(sampleRate, 24);
  data.writeUInt32LE(sampleRate * 4, 28);
  data.writeUInt16LE(4, 32);
  data.writeUInt16LE(16, 34);
  data.write('data', 36);
  data.writeUInt32LE(n * 4, 40);
  for (let i = 0; i < n; i++) {
    const clip = (v) => Math.max(-1, Math.min(1, v)) * 32767;
    data.writeInt16LE(clip(L[i]) | 0, 44 + i * 4);
    data.writeInt16LE(clip(R[i]) | 0, 46 + i * 4);
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, data);
  return path;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(makeTestTrack(process.argv[2] ?? 'test-output/test-track.wav'));
}
