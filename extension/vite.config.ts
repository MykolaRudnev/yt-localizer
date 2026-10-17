import { defineConfig, type UserConfig } from 'vite';
import { resolve } from 'node:path';
import { viteStaticCopy } from 'vite-plugin-static-copy';

const root = resolve(__dirname);
const outDir = resolve(root, 'dist');
const alias = { '@shared': resolve(root, '../shared/src') };
const target = process.env.VT_TARGET ?? 'background';

function config(): UserConfig {
  if (target === 'content') {
    return {
      root,
      publicDir: false,
      resolve: { alias },
      build: {
        outDir,
        emptyOutDir: false,
        sourcemap: true,
        cssCodeSplit: false,
        rollupOptions: {
          input: resolve(root, 'src/content.ts'),
          output: {
            format: 'iife',
            name: 'VeilTranslateContent',
            entryFileNames: 'content.js',
            assetFileNames: 'content[extname]',
          },
        },
      },
    };
  }

  if (target === 'options') {
    return {
      root,
      base: './',
      publicDir: false,
      resolve: { alias },
      build: {
        outDir,
        emptyOutDir: false,
        sourcemap: true,
        rollupOptions: {
          input: resolve(root, 'options.html'),
          output: {
            entryFileNames: 'options.js',
            chunkFileNames: 'chunks/[name]-[hash].js',
            assetFileNames: '[name][extname]',
          },
        },
      },
    };
  }

  return {
    root,
    publicDir: false,
    resolve: { alias },
    plugins: [
      viteStaticCopy({
        targets: [
          { src: 'manifest.json', dest: '.' },
          { src: 'icons/*', dest: 'icons' },
          { src: '../languages.json', dest: '.' },
        ],
      }),
    ],
    build: {
      outDir,
      emptyOutDir: true,
      sourcemap: true,
      rollupOptions: {
        input: resolve(root, 'src/background.ts'),
        output: {
          format: 'es',
          entryFileNames: 'background.js',
          chunkFileNames: 'chunks/[name]-[hash].js',
        },
      },
    },
  };
}

export default defineConfig(config());
