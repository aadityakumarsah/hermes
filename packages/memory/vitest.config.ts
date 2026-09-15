import { access } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { defineConfig } from 'vitest/config';
import type { PluginOption } from 'vite';

/**
 * NodeNext emits `.js` specifiers that also point at `.ts` sources. Vite does
 * not rewrite those by default, so resolve them manually before falling back
 * to Vite's default resolver.
 */
const tsExtensionResolution: PluginOption = {
  name: 'ts-extension-resolution',
  async resolveId(source, importer) {
    if (!importer || !source.endsWith('.js')) {
      return undefined;
    }
    if (source.startsWith('.') || source.startsWith('/')) {
      const candidate = join(dirname(importer), source.replace(/\.js$/, '.ts'));
      try {
        await access(resolve(candidate));
        return candidate;
      } catch {
        return undefined;
      }
    }
    return undefined;
  },
};

export default defineConfig({
  base: resolve('.'),
  plugins: [tsExtensionResolution],
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    testTimeout: 20_000,
    hookTimeout: 30_000,
    pool: 'forks',
  },
});