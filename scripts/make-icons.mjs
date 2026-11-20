// Renders public/icons/icon.svg to the PNG sizes the manifest and iOS need.
// Usage: node scripts/make-icons.mjs   (uses the Playwright Chromium on this machine)
import { readFileSync } from 'node:fs';
import { chromium } from './playwright.mjs';

const svg = readFileSync(new URL('../public/icons/icon.svg', import.meta.url), 'utf8');
const out = (name) => new URL(`../public/icons/${name}`, import.meta.url).pathname;

const targets = [
  { name: 'icon-192.png', size: 192, pad: 0, round: true },
  { name: 'icon-512.png', size: 512, pad: 0, round: true },
  // Maskable: full-bleed background, artwork inside the 80% safe zone.
  { name: 'maskable-512.png', size: 512, pad: 0.12, round: false },
  // iOS applies its own corner mask, so supply a square full-bleed icon.
  { name: 'apple-touch-icon.png', size: 180, pad: 0.06, round: false },
];

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });
for (const t of targets) {
  const inner = Math.round(t.size * (1 - t.pad * 2));
  // Padded variants get a full-bleed background and the artwork without its tile.
  const art = t.round ? svg : svg.replace(/<rect [^>]*\/>/, '');
  const bg = t.round ? 'transparent' : 'radial-gradient(75% 75% at 50% 45%, #1a1036, #05030c)';
  await page.setViewportSize({ width: t.size, height: t.size });
  await page.setContent(`<!doctype html><html><body style="margin:0;background:${bg};
    width:${t.size}px;height:${t.size}px;display:grid;place-items:center;overflow:hidden">
    <div style="width:${t.pad ? inner : t.size}px;height:${t.pad ? inner : t.size}px">${art.replace('<svg ', '<svg width="100%" height="100%" ')}</div>
    </body></html>`);
  await page.screenshot({ path: out(t.name), omitBackground: t.round });
  console.log('wrote', t.name);
}
await browser.close();
