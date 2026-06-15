// Vite plugin: provides `virtual:doom-embedded-assets`.
//
// When enabled (build:itch), it reads the extracted manifest plus every PNG/WAV/
// palette it references from public/ and inlines them as `data:` URLs, so the runtime
// performs ZERO asset fetches and the game loads from an opaque-origin sandbox (where
// http fetch() is CORS-blocked but `data:` URLs are exempt). When disabled it resolves
// to `null`, leaving the default same-origin build untouched (the data tree-shakes away).
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Plugin } from 'vite';
import type { AssetManifest } from '../../src/assets/manifest';

const VIRTUAL_ID = 'virtual:doom-embedded-assets';
const RESOLVED_ID = '\0' + VIRTUAL_ID;

function dataUrl(absPath: string, mime: string): string {
  return `data:${mime};base64,${readFileSync(absPath).toString('base64')}`;
}

export function embedAssets(enabled: boolean): Plugin {
  return {
    name: 'doom-embed-assets',
    resolveId(id) {
      return id === VIRTUAL_ID ? RESOLVED_ID : null;
    },
    load(id) {
      if (id !== RESOLVED_ID) return null;
      if (!enabled) return 'export default null';

      const assetsDir = resolve(process.cwd(), 'public/assets');
      const manifestPath = resolve(process.cwd(), 'public/manifest.json');
      if (!existsSync(manifestPath)) {
        throw new Error(`embedAssets: ${manifestPath} missing — run \`npm run extract-assets\` first`);
      }
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as AssetManifest;
      const palette = JSON.parse(readFileSync(resolve(assetsDir, 'palette.json'), 'utf8'));

      const images: Record<string, string> = {};
      const sounds: Record<string, string> = {};
      const addImage = (path: string): void => {
        if (images[path]) return;
        const abs = resolve(assetsDir, path);
        if (!existsSync(abs)) throw new Error(`embedAssets: image ${path} missing under public/assets`);
        images[path] = dataUrl(abs, 'image/png');
      };

      for (const e of Object.values(manifest.textures)) addImage(e.path);
      for (const e of Object.values(manifest.flats)) addImage(e.path);
      for (const e of Object.values(manifest.ui)) addImage(e.path);
      for (const f of Object.values(manifest.fonts)) for (const g of Object.values(f.glyphs)) addImage(g.path);
      for (const set of Object.values(manifest.sprites)) for (const fr of Object.values(set.frames)) addImage(fr.path);
      for (const s of Object.values(manifest.sounds)) {
        const abs = resolve(assetsDir, s.path);
        if (!existsSync(abs)) throw new Error(`embedAssets: sound ${s.path} missing under public/assets`);
        sounds[s.path] = dataUrl(abs, 'audio/wav');
      }

      // Per-level music lives outside the manifest: the extractor writes WAV tracks plus an
      // index that AudioManager loads on demand. Inline the index + every track as data: URLs
      // (alongside the SFX) so the self-contained build loops music with zero fetches — full
      // audio parity with the same-origin build. Bundle size is unconstrained for build:itch.
      const musicIndexPath = resolve(assetsDir, 'audio/music/index.json');
      if (!existsSync(musicIndexPath)) {
        throw new Error(`embedAssets: ${musicIndexPath} missing — run \`npm run extract-assets\` first`);
      }
      const musicRaw = JSON.parse(readFileSync(musicIndexPath, 'utf8')) as {
        rate: number;
        tracks: Record<string, { path: string; durationSec: number }>;
      };
      const tracks: Record<string, { path: string; durationSec: number; url: string }> = {};
      for (const [id, t] of Object.entries(musicRaw.tracks)) {
        const abs = resolve(assetsDir, t.path);
        if (!existsSync(abs)) throw new Error(`embedAssets: music ${t.path} missing under public/assets`);
        tracks[id] = { path: t.path, durationSec: t.durationSec, url: dataUrl(abs, 'audio/wav') };
      }
      const music = { rate: musicRaw.rate, tracks };

      return `export default ${JSON.stringify({ manifest, palette, images, sounds, music })}`;
    },
  };
}
