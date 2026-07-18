import { resolve } from 'node:path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';

/**
 * Three build targets in one config:
 *
 *   main     → CommonJS, Node externals left alone
 *   preload  → CommonJS with a .cjs extension, which is what a sandboxed
 *              preload script must be
 *   renderer → two HTML entry points, bundled as ES modules
 *
 * The workspace packages are deliberately *not* externalised for the renderer:
 * they are TypeScript source, so Vite compiles and tree-shakes them into the
 * bundle rather than expecting a published build to exist.
 */
/**
 * All three targets compile the workspace packages from TypeScript source
 * rather than from `dist/`, so there is exactly one build step and no way for
 * a stale compiled copy to disagree with the source.
 */
const workspaceAliases = {
  '@blackholock/core': resolve(__dirname, '../core/src/index.ts'),
  '@blackholock/visuals': resolve(__dirname, '../visuals/src/index.ts'),
};

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: ['@blackholock/core', '@blackholock/visuals'] })],
    resolve: { alias: workspaceAliases },
    build: {
      outDir: 'out/main',
      lib: { entry: resolve(__dirname, 'src/main/index.ts'), formats: ['cjs'] },
      rollupOptions: { output: { entryFileNames: 'index.js' } },
    },
  },

  preload: {
    plugins: [externalizeDepsPlugin({ exclude: ['@blackholock/core'] })],
    resolve: { alias: workspaceAliases },
    build: {
      outDir: 'out/preload',
      lib: { entry: resolve(__dirname, 'src/preload/index.ts'), formats: ['cjs'] },
      rollupOptions: { output: { entryFileNames: 'index.cjs' } },
    },
  },

  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    resolve: { alias: workspaceAliases },
    build: {
      outDir: resolve(__dirname, 'out/renderer'),
      emptyOutDir: true,
      target: 'chrome128',
      rollupOptions: {
        input: {
          overlay: resolve(__dirname, 'src/renderer/overlay.html'),
          settings: resolve(__dirname, 'src/renderer/settings.html'),
          preview: resolve(__dirname, 'src/renderer/preview.html'),
        },
      },
    },
  },
});
