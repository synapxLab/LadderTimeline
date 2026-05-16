import { defineConfig } from 'vite';
import { resolve } from 'path';

/**
 * Config Vite pour le build NPM (lib mode).
 * Usage : npm run build:lib
 *
 * Produit dans dist/ :
 *   chrono-map.es.js   — ESM  (import ... from '@synapxlab/chronomap')
 *   chrono-map.umd.cjs — UMD  (require / <script>)
 *   style.css          — CSS compilé à importer séparément
 *   *.d.ts             — Types TypeScript (générés par tsc)
 */
export default defineConfig({
  css: {
    preprocessorOptions: {
      scss: { api: 'modern' },
    },
  },
  build: {
    lib: {
      entry:   resolve(__dirname, 'src/index.ts'),
      name:    'ChronoMap',
      formats: ['es', 'umd'],
      fileName: (format) => format === 'umd'
        ? 'chrono-map.umd.cjs'
        : `chrono-map.${format}.js`,
    },
    target:       'es2020',
    outDir:       'dist',
    sourcemap:    true,
    cssCodeSplit: false,
    emptyOutDir:  true,
  },
});
