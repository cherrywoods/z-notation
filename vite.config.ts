import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';

declare const process: { env: Record<string, string | undefined> };

// base './' keeps all asset URLs relative, so the build works under any
// GitHub Pages sub-path (https://<user>.github.io/<repo>/) without configuration.
export default defineConfig({
  base: './',
  // Separate dependency caches per dev server (several servers may run in parallel).
  cacheDir: process.env.VITE_CACHE_DIR ?? 'node_modules/.vite',
  plugins: [svelte()],
  test: {
    include: ['src/**/*.test.ts'],
  },
});
