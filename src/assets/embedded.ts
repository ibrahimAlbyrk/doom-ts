// Embedded-asset bridge for the self-contained itch.io build (`npm run build:itch`).
//
// The default (same-origin / VPS) build fetches manifest.json + assets at runtime.
// That breaks when the game is embedded in a `sandbox="allow-scripts"` iframe (document
// origin "null") on a host that serves it under a Content-Security-Policy: the static
// host sends no CORS headers AND a CSP such as `connect-src *` does not cover the `data:`
// scheme — so neither cross-origin http fetch nor `fetch('data:…')` is allowed.
// build:itch instead inlines everything via the embed-assets Vite plugin (filling
// `virtual:doom-embedded-assets`): the manifest + palette as plain JS objects, and each
// image/sound/music asset as a `data:` URL the loader decodes in-memory with atob — no
// fetch at all (see ./data-url.ts). In the default build that module is `null`, so this
// whole graph tree-shakes away and the same-origin build stays lean.
import EMBEDDED from 'virtual:doom-embedded-assets';
import type { AssetManifest } from './manifest';

/** One per-level music track: a `data:audio/wav` URL plus its natural loop length. */
export interface EmbeddedMusicTrack {
  path: string;
  durationSec: number;
  url: string;
}

export interface EmbeddedAssets {
  manifest: AssetManifest;
  /** PLAYPAL[0] as 256 [r,g,b] triples — same shape as palette.json. */
  palette: Array<[number, number, number]>;
  /** manifest-relative path → `data:image/png;base64,…` URL. */
  images: Record<string, string>;
  /** manifest-relative path → `data:audio/wav;base64,…` URL. */
  sounds: Record<string, string>;
  /** Per-level music (mirrors the extractor's music index), inlined as `data:` URLs so
   *  the itch build loops music with zero fetches — full parity with the server build. */
  music: { rate: number; tracks: Record<string, EmbeddedMusicTrack> };
}

export const EMBEDDED_ASSETS = EMBEDDED as EmbeddedAssets | null;
