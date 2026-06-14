import { defineConfig } from 'vite';

// Surrounding-app config per docs/research/web-arch.md §1.
export default defineConfig({
  base: './', // relative asset paths so the build runs from any subdirectory
  publicDir: 'public', // public/ (assets + manifest) copied verbatim to dist/
  build: {
    target: 'es2022',
    outDir: 'dist',
    assetsInlineLimit: 0, // never inline audio/images as base64
  },
  server: {
    headers: {
      // Cross-origin isolation — keeps the door open for SharedArrayBuffer / AudioWorklet.
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
});
