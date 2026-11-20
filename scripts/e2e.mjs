// End-to-end smoke test in headless Chromium emulating a phone.
//
//   npm run build && npm run e2e            (screenshots land in test-output/)
//
// Covers: welcome screen, demo source, every visualizer, colour themes,
// gestures, auto-hide, file playback (play / pause / seek), microphone input
// (fed from a generated WAV), settings persistence and offline reload.
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium, devices } from './playwright.mjs';
import { makeTestTrack } from './make-test-track.mjs';

const OUT = resolve('test-output');
const PORT = 4173;
const URL_ = `http://localhost:${PORT}/`;
const shots = process.argv.includes('--no-shots') ? false : true;
mkdirSync(OUT, { recursive: true });
const track = makeTestTrack(resolve(OUT, 'test-track.wav'), 14);

let failures = 0;
const check = (cond, msg) => {
  console.log(`${cond ? '  ✓' : '  ✗'} ${msg}`);
  if (!cond) failures++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort'], {
  stdio: 'pipe',
});
const stopServer = () => server.exitCode === null && server.kill();
process.on('exit', stopServer);
await new Promise((res, rej) => {
  const t = setTimeout(() => rej(new Error('preview server did not start')), 20000);
  server.stdout.on('data', (d) => {
    if (String(d).includes(String(PORT))) {
      clearTimeout(t);
      res();
    }
  });
});

const browser = await chromium.launch({
  args: [
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    `--use-file-for-fake-audio-capture=${track}`,
    '--autoplay-policy=no-user-gesture-required',
    '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist',
  ],
});

try {
  const context = await browser.newContext({ ...devices['Pixel 7'], permissions: ['microphone'] });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`));

  const app = (fn, arg) => page.evaluate(fn, arg);
  const shot = async (name) => shots && page.screenshot({ path: `${OUT}/${name}.png` });

  console.log('Welcome');
  await page.goto(URL_);
  await page.waitForSelector('#welcome:not([hidden])');
  await sleep(800);
  await shot('00-welcome');
  check(await page.isVisible('text=Microphone'), 'welcome shows the microphone option');
  check(await page.isVisible('text=Audio files'), 'welcome shows the files option');

  console.log('Demo source');
  await page.click('.big-btn[data-action="demo"]');
  await sleep(2500);
  const demo = await app(() => ({
    source: window.auralis.engine.source,
    playing: window.auralis.engine.playing,
    energy: window.auralis.engine.frame.energy,
    active: window.auralis.engine.frame.active,
  }));
  check(demo.source === 'demo' && demo.playing, 'demo beat is playing');
  check(demo.active && demo.energy > 0.05, `demo produces analysed energy (${demo.energy.toFixed(2)})`);
  check(await page.isHidden('#welcome'), 'welcome screen dismissed');

  console.log('Visualizers');
  const modes = await app(() => window.auralis.modes.map((m) => ({ id: m.id, name: m.name, kind: m.kind })));
  check(modes.length >= 16, `${modes.length} visualizers available (WebGL modes included)`);
  // Keep the controls out of the screenshots.
  await app(() => window.auralis.controls.hideNow());
  for (const [i, m] of modes.entries()) {
    await app((id) => window.auralis.selectMode(id, false), m.id);
    await sleep(m.kind === 'gl' ? 1800 : 1300);
    await app(() => window.auralis.controls.hideNow());
    // Sample inside requestAnimationFrame, right after the app has drawn, so the
    // WebGL drawing buffer is still readable.
    const nonEmpty = await page.evaluate((kind) => new Promise((done) => requestAnimationFrame(() => {
      const c = document.getElementById(kind === 'gl' ? 'cgl' : 'c2d');
      const probe = document.createElement('canvas');
      probe.width = 64;
      probe.height = 64;
      const g = probe.getContext('2d');
      g.drawImage(c, 0, 0, 64, 64);
      const d = g.getImageData(0, 0, 64, 64).data;
      let lit = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 20 && d[i] + d[i + 1] + d[i + 2] > 90) lit++;
      done(lit);
    })), m.kind);
    check(nonEmpty > 12, `${m.name} draws something (${nonEmpty} lit probe pixels)`);
    await shot(`${String(i + 1).padStart(2, '0')}-${m.id}`);
  }

  console.log('Themes');
  for (const id of ['sunset', 'aurora', 'inferno']) {
    await app((t) => window.auralis.selectTheme(t, false), id);
    await app(() => window.auralis.selectMode('radial', false));
    await sleep(900);
  }
  await shot('20-theme-inferno');
  const bg = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim());
  check(bg.toLowerCase() === '#ff6a1a', `theme accent applied to UI (${bg})`);

  console.log('Gestures');
  const swipe = (dx, dy) =>
    page.evaluate(
      ([dx, dy]) => {
        const el = document.getElementById('stage');
        const base = { pointerId: 7, pointerType: 'touch', isPrimary: true, bubbles: true };
        el.dispatchEvent(new PointerEvent('pointerdown', { ...base, clientX: 200, clientY: 400 }));
        el.dispatchEvent(new PointerEvent('pointermove', { ...base, clientX: 200 + dx / 2, clientY: 400 + dy / 2 }));
        el.dispatchEvent(new PointerEvent('pointerup', { ...base, clientX: 200 + dx, clientY: 400 + dy }));
      },
      [dx, dy],
    );
  const modeBefore = await app(() => window.auralis.settings.value.mode);
  await swipe(-160, 10);
  const modeAfter = await app(() => window.auralis.settings.value.mode);
  check(modeBefore !== modeAfter, `swipe left changes visualizer (${modeBefore} → ${modeAfter})`);
  await swipe(160, -5);
  check((await app(() => window.auralis.settings.value.mode)) === modeBefore, 'swipe right goes back');
  const themeBefore = await app(() => window.auralis.settings.value.theme);
  await swipe(5, -170);
  check((await app(() => window.auralis.settings.value.theme)) !== themeBefore, 'swipe up changes theme');
  await sleep(1300);

  console.log('Auto-hide controls');
  await page.tap('#stage', { position: { x: 200, y: 450 } });
  await sleep(400);
  check(!(await page.evaluate(() => document.body.classList.contains('ui-hidden'))), 'tap reveals controls');
  await shot('21-controls');
  await page.waitForFunction(() => document.body.classList.contains('ui-hidden'), null, { timeout: 6000 });
  check(true, 'controls fade out on their own while music plays');

  console.log('Sheets');
  await page.tap('#stage', { position: { x: 200, y: 450 } });
  await sleep(300);
  await page.click('#btn-modes');
  await sleep(500);
  await shot('22-modes-sheet');
  check(await page.isVisible('#sheet-modes.open'), 'visualizer sheet opens');
  await page.click('.mode-btn:has-text("Galaxy")');
  await sleep(300);
  check((await app(() => window.auralis.settings.value.mode)) === 'galaxy', 'picking a mode from the sheet');
  await page.click('#scrim', { position: { x: 200, y: 60 } });
  await sleep(500);
  await page.click('#btn-themes');
  await sleep(500);
  await shot('23-themes-sheet');
  await page.click('.theme-btn:has-text("Ocean")');
  check((await app(() => window.auralis.settings.value.theme)) === 'ocean', 'picking a theme from the sheet');
  await page.click('#sheet-themes [data-close]');
  await sleep(500);
  await page.click('#btn-sens');
  await sleep(400);
  await shot('24-sensitivity');
  const sens = page.locator('#sens');
  await sens.evaluate((el) => {
    el.value = '750';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const s = await app(() => window.auralis.settings.value.sensitivity);
  check(s > 1.9 && s < 2.1, `sensitivity slider maps to ${s}×`);
  check(
    Math.abs((await app(() => window.auralis.engine.spectrum.settings.sensitivity)) - s) < 1e-6,
    'sensitivity reaches the analyser',
  );
  await page.click('#btn-sens');
  await page.click('#btn-settings');
  await sleep(500);
  await shot('25-settings');
  await page.click('#sheet-settings [data-close]');
  await sleep(400);

  console.log('File playback');
  await page.setInputFiles('#file-input', track);
  await sleep(2000);
  const f1 = await app(() => ({
    source: window.auralis.engine.source,
    playing: window.auralis.engine.playing,
    t: window.auralis.engine.currentTime,
    energy: window.auralis.engine.frame.energy,
    stereo: (window.auralis.selectMode('lissajous', false), true),
  }));
  check(f1.source === 'file' && f1.playing && f1.t > 0.5, `file is playing (t=${f1.t.toFixed(2)}s)`);
  check(f1.energy > 0.05, `file audio is analysed (energy ${f1.energy.toFixed(2)})`);
  await sleep(800);
  check(await app(() => window.auralis.engine.frame.stereo), 'stereo file detected for the vectorscope');
  await page.tap('#stage', { position: { x: 200, y: 450 } });
  await sleep(300);
  check((await page.textContent('#track-title')) === 'test-track', 'track title shown');
  await shot('26-file-playing');
  await page.click('#btn-play');
  await sleep(300);
  check(!(await app(() => window.auralis.engine.playing)), 'pause button pauses');
  const tPaused = await app(() => window.auralis.engine.currentTime);
  await sleep(700);
  check(Math.abs((await app(() => window.auralis.engine.currentTime)) - tPaused) < 0.05, 'time stands still while paused');
  await app(() => window.auralis.engine.seek(9));
  await page.click('#btn-play');
  await sleep(400);
  const t2 = await app(() => window.auralis.engine.currentTime);
  check((await app(() => window.auralis.engine.playing)) && t2 >= 9, `play resumes after seeking (t=${t2.toFixed(2)}s)`);
  check(!(await page.evaluate(() => document.getElementById('btn-play').hidden)), 'play/pause visible for files');

  console.log('Unplayable file');
  await page.click('#btn-play'); // pause so the new file starts immediately
  await sleep(200);
  await page.setInputFiles('#file-input', { name: 'broken.mp3', mimeType: 'audio/mpeg', buffer: Buffer.from('not really audio') });
  await page.waitForSelector('.toast.msg.error.show', { timeout: 5000 }).catch(() => null);
  const toast = (await page.textContent('#toast')) ?? '';
  check(/broken\.mp3/.test(toast) && /play/i.test(toast), `friendly error for a corrupt file: ${JSON.stringify(toast)}`);
  check((await app(() => window.auralis.playlist.length)) === 2, 'playlist holds both files');

  console.log('Microphone');
  await page.click('#btn-source');
  await sleep(400);
  await page.click('.source-btn[data-action="mic"]');
  await sleep(2500);
  const mic = await app(() => ({
    source: window.auralis.engine.source,
    level: window.auralis.engine.frame.level,
    energy: window.auralis.engine.frame.energy,
    filePaused: window.auralis.engine.media.paused,
  }));
  check(mic.source === 'mic', 'microphone source active');
  check(mic.energy > 0.05, `microphone input is analysed (energy ${mic.energy.toFixed(2)})`);
  check(mic.filePaused, 'file playback paused when switching to the mic');
  check(await page.evaluate(() => document.getElementById('btn-play').hidden), 'no play button for live mic');
  await app(() => window.auralis.selectMode('spectrum', false));
  await sleep(1200);
  await app(() => window.auralis.controls.hideNow());
  await sleep(300);
  await shot('27-mic-spectrum');

  console.log('Stats & quality');
  await app(() => window.auralis.settings.update({ showStats: true }));
  await sleep(1800);
  const stats = await page.textContent('#stats');
  check(/fps/.test(stats ?? ''), `stats overlay: ${JSON.stringify(stats)}`);

  console.log('Persistence & offline');
  await sleep(500);
  await page.waitForFunction(() => navigator.serviceWorker?.controller || navigator.serviceWorker?.ready, null, { timeout: 8000 });
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await page.waitForSelector('#welcome:not([hidden])');
  const persisted = await app(() => window.auralis.settings.value);
  check(persisted.theme === 'ocean' && persisted.mode === 'spectrum', 'settings persist across reloads');
  check(!!(await page.evaluate(() => navigator.serviceWorker.controller)), 'service worker controls the page');
  await context.setOffline(true);
  await page.reload();
  await page.waitForSelector('#welcome:not([hidden])', { timeout: 8000 });
  check(await page.isVisible('text=Demo beat'), 'app loads while offline');
  await page.click('.big-btn[data-action="demo"]');
  await sleep(1500);
  check((await app(() => window.auralis.engine.frame.energy)) > 0.05, 'demo plays offline');
  await context.setOffline(false);

  console.log('Landscape');
  await page.setViewportSize({ width: 915, height: 412 });
  await app(() => window.auralis.selectMode('julia', false));
  await sleep(1800);
  await app(() => window.auralis.controls.hideNow());
  await shot('28-landscape-julia');
  await app(() => window.auralis.engine.stop());
  await sleep(600);
  await shot('29-landscape-welcome');

  const relevant = errors.filter((e) => !/favicon/.test(e));
  check(relevant.length === 0, `no page errors${relevant.length ? `: ${relevant.join(' | ')}` : ''}`);
} finally {
  await browser.close();
  stopServer();
}

console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
