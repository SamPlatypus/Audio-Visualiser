// Renders Auralis launcher icons and splash screens into the Capacitor Android project.
// Usage: node scripts/make-android-assets.mjs   (after `npx cap add android`)
import { existsSync, readFileSync } from 'node:fs';
import { chromium } from './playwright.mjs';

const RES = new URL('../android/app/src/main/res/', import.meta.url).pathname;
if (!existsSync(RES)) {
  console.error('android/ project not found — run `npx cap add android` first.');
  process.exit(1);
}
const svg = readFileSync(new URL('../public/icons/icon.svg', import.meta.url), 'utf8');
const art = svg.replace(/<rect [^>]*\/>/, ''); // artwork without its background tile
const BG = 'radial-gradient(75% 75% at 50% 45%, #1a1036, #05030c)';
const sized = (s) => s.replace('<svg ', '<svg width="100%" height="100%" ');

const densities = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
const jobs = [];
for (const [d, k] of Object.entries(densities)) {
  const icon = Math.round(48 * k);
  const fg = Math.round(108 * k);
  jobs.push({ path: `mipmap-${d}/ic_launcher.png`, w: icon, h: icon, html: `<div style="width:100%;height:100%">${sized(svg)}</div>`, transparent: true });
  jobs.push({
    path: `mipmap-${d}/ic_launcher_round.png`, w: icon, h: icon, transparent: true,
    html: `<div style="width:100%;height:100%;border-radius:50%;overflow:hidden;background:${BG};display:grid;place-items:center"><div style="width:78%;height:78%">${sized(art)}</div></div>`,
  });
  // Adaptive foreground: the visible safe zone is the central 66 of 108 dp.
  jobs.push({
    path: `mipmap-${d}/ic_launcher_foreground.png`, w: fg, h: fg, transparent: true,
    html: `<div style="width:100%;height:100%;display:grid;place-items:center"><div style="width:58%;height:58%">${sized(art)}</div></div>`,
  });
}
const splashes = [
  ['drawable/splash.png', 480, 320],
  ['drawable-land-mdpi/splash.png', 480, 320], ['drawable-land-hdpi/splash.png', 800, 480],
  ['drawable-land-xhdpi/splash.png', 1280, 720], ['drawable-land-xxhdpi/splash.png', 1600, 960],
  ['drawable-land-xxxhdpi/splash.png', 1920, 1280],
  ['drawable-port-mdpi/splash.png', 320, 480], ['drawable-port-hdpi/splash.png', 480, 800],
  ['drawable-port-xhdpi/splash.png', 720, 1280], ['drawable-port-xxhdpi/splash.png', 960, 1600],
  ['drawable-port-xxxhdpi/splash.png', 1280, 1920],
];
for (const [path, w, h] of splashes) {
  const s = Math.round(Math.min(w, h) * 0.3);
  jobs.push({
    path, w, h, transparent: false,
    html: `<div style="width:100%;height:100%;background:#05030c;display:grid;place-items:center"><div style="width:${s}px;height:${s}px">${sized(art)}</div></div>`,
  });
}

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });
for (const j of jobs) {
  await page.setViewportSize({ width: j.w, height: j.h });
  await page.setContent(`<!doctype html><body style="margin:0;width:${j.w}px;height:${j.h}px;overflow:hidden;background:transparent">${j.html}</body>`);
  await page.screenshot({ path: RES + j.path, omitBackground: j.transparent });
}
await browser.close();
console.log(`wrote ${jobs.length} Android images`);
