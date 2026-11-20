import type { Visualizer } from '../types';
import { ledMeter, mirrorBars, spectrumBars } from './bars';
import { haloRings, polarBloom, radialBars } from './circular';
import { fractalTree, juliaSet, kaleido } from './fractal';
import { galaxy, sunflower, vortex } from './spiral';
import { lissajous, oscilloscope, ringWave, terrain } from './waveform';

/** All visualizers, in picker order (grouped by category). */
export function createModes(): Visualizer[] {
  return [
    spectrumBars(),
    mirrorBars(),
    ledMeter(),
    radialBars(),
    haloRings(),
    polarBloom(),
    galaxy(),
    sunflower(),
    vortex(),
    fractalTree(),
    juliaSet(),
    kaleido(),
    oscilloscope(),
    ringWave(),
    lissajous(),
    terrain(),
  ];
}
