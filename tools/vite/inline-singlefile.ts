// Vite plugin: inline every emitted JS/CSS chunk into index.html and drop the chunk
// files, yielding a single self-contained index.html that fetches nothing. Required
// for an opaque-origin sandbox, where even a `<script type="module" src>` and its
// imports are CORS-fetched (and blocked). Pair with
// build.rollupOptions.output.inlineDynamicImports so there is exactly one JS chunk —
// the inline module then has no imports left to fetch.
import type { Plugin } from 'vite';

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function inlineSingleFile(): Plugin {
  return {
    name: 'doom-inline-singlefile',
    enforce: 'post',
    generateBundle(_options, bundle) {
      const htmlAsset = Object.values(bundle).find(
        (b) => b.type === 'asset' && b.fileName.endsWith('.html'),
      );
      if (!htmlAsset || htmlAsset.type !== 'asset') return;
      let html = htmlAsset.source.toString();

      for (const file of Object.values(bundle)) {
        if (file.type === 'chunk' && file.fileName.endsWith('.js')) {
          const tag = new RegExp(`<script[^>]*\\bsrc="[^"]*${escapeRe(file.fileName)}"[^>]*></script>`);
          html = html.replace(tag, `<script type="module">${file.code}</script>`);
          delete bundle[file.fileName];
        } else if (file.type === 'asset' && file.fileName.endsWith('.css')) {
          const tag = new RegExp(`<link[^>]*href="[^"]*${escapeRe(file.fileName)}"[^>]*>`);
          html = html.replace(tag, `<style>${file.source.toString()}</style>`);
          delete bundle[file.fileName];
        }
      }
      // Drop modulepreload hints — their targets are now inlined and removed.
      html = html.replace(/<link[^>]*rel="modulepreload"[^>]*>/g, '');
      htmlAsset.source = html;
    },
  };
}
