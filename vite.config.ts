/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

/** Recursively list files under a directory as POSIX-style relative paths. */
function listFiles(dir: string, root = dir): string[] {
  let out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out = out.concat(listFiles(full, root));
    else out.push(relative(root, full).split(sep).join('/'));
  }
  return out;
}

/**
 * Emits `sw.js`: a precaching service worker that makes the whole app
 * available offline. The cache name is derived from the build output so a
 * new build always installs a fresh cache and old ones are cleaned up.
 */
function offlineServiceWorker(): Plugin {
  return {
    name: 'offline-service-worker',
    apply: 'build',
    enforce: 'post',
    generateBundle(_options, bundle) {
      const assets = new Set<string>(['./', 'index.html']);
      const hash = createHash('sha256');
      for (const [fileName, item] of Object.entries(bundle)) {
        if (fileName.endsWith('.map')) continue;
        assets.add(fileName);
        hash.update(fileName);
        hash.update(item.type === 'chunk' ? item.code : item.source);
      }
      for (const file of listFiles('public')) {
        assets.add(file);
        hash.update(file);
        hash.update(readFileSync(join('public', file)));
      }
      const template = readFileSync('sw/sw-template.js', 'utf8');
      const source = template
        .replace('__VERSION__', hash.digest('hex').slice(0, 12))
        .replace('__ASSETS__', JSON.stringify([...assets].sort(), null, 2));
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    },
  };
}

export default defineConfig({
  // Relative base so the build works from any sub-path, from file-based
  // hosting, and inside a Capacitor native shell.
  base: './',
  plugins: [offlineServiceWorker()],
  build: {
    target: 'es2020',
    assetsInlineLimit: 0,
    sourcemap: false,
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
