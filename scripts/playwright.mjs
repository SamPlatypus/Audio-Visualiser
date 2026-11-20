// Resolve Playwright from the project if installed, else from the global npm prefix
// (the dev/CI image ships a global Playwright + Chromium; it is not a project dependency).
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
let pw;
try {
  pw = require('playwright');
} catch {
  const globalRoot = execSync('npm root -g').toString().trim();
  pw = require(join(globalRoot, 'playwright'));
}
export const { chromium, devices } = pw;
