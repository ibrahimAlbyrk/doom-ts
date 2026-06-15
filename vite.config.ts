import { defineConfig } from 'vite';
import { embedAssets } from './tools/vite/embed-assets';
import { inlineSingleFile } from './tools/vite/inline-singlefile';

// `npm run build:itch` sets VITE_INLINE_ASSETS=1 → a single self-contained index.html
// (assets inlined as data: URLs, JS/CSS inlined) that loads from an opaque-origin
// sandbox with zero CORS-requiring fetches. The default build is unchanged: relative
// asset paths fetched normally same-origin. See docs/research/web-arch.md §1.
const INLINE = process.env.VITE_INLINE_ASSETS === '1';

export default defineConfig({
  base: './', // relative asset paths so the build runs from any subdirectory
  // Default build copies public/ (assets + manifest) verbatim. The itch build embeds
  // them instead, so public/ is not copied — dist/ ends up as a single index.html.
  publicDir: INLINE ? false : 'public',
  plugins: INLINE ? [embedAssets(true), inlineSingleFile()] : [embedAssets(false)],
  build: {
    target: 'es2022',
    outDir: 'dist',
    assetsInlineLimit: 0, // never inline audio/images as base64
    // One JS chunk for the itch build so the single inline <script> has no imports left
    // to fetch (module-script imports are CORS-fetched and would be blocked in-sandbox).
    ...(INLINE ? { rollupOptions: { output: { inlineDynamicImports: true } } } : {}),
  },
  server: {
    headers: {
      // Cross-origin isolation — keeps the door open for SharedArrayBuffer / AudioWorklet.
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
});
