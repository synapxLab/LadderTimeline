import { defineConfig } from 'vite';
import { resolve } from 'path';

/**
 * Config Vite pour le build NPM (lib mode).
 * Usage : npm run build:lib
 *
 * Produit dans dist/ :
 *   ladder-timeline.es.js   — ESM  (import ... from '@synapxlab/ladder-timeline')
 *   ladder-timeline.umd.cjs — UMD  (require / <script>)
 *   style.css               — CSS compilé à importer séparément
 *   *.d.ts                  — Types TypeScript (générés par tsc)
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
      name:    'LadderTimeline',
      formats: ['es', 'umd'],
      fileName: (format) => format === 'umd'
        ? 'ladder-timeline.umd.cjs'
        : `ladder-timeline.${format}.js`,
    },
    target:       'es2020',
    outDir:       'dist',
    sourcemap:    true,
    cssCodeSplit: false,
    emptyOutDir:  true,
  },
});
