// Asset manifest schema — matches docs/research/assets.md §5 exactly. The custom
// WAD extractor (tools/extract-wad) emits one manifest.json the runtime loads at boot.
// Coordinates are source pixels; `origin` = picture leftoffset/topoffset (draw hotspot).

export interface ManifestMeta {
  source: string; // e.g. "freedoom2.wad"
  freedoomVersion: string; // "0.13.0"
  license: string; // "BSD-3-Clause (modified BSD)"
  attribution: string; // path to bundled license text
  palette: string; // "PLAYPAL[0]"
}

/** Composited wall texture (assets.md §3.6). */
export interface TextureEntry {
  path: string;
  w: number;
  h: number;
}

/** 64×64 floor/ceiling flat (assets.md §3.7). */
export interface FlatEntry {
  path: string;
  w: number;
  h: number;
}

/** One sprite frame: image + draw hotspot, optionally a mirrored packed view. */
export interface SpriteFrameEntry {
  path: string;
  w: number;
  h: number;
  origin: [number, number]; // [leftoffset, topoffset]
  mirror: boolean;
}

/** A sprite set grouped by 4-char entity prefix (assets.md §3.8). */
export interface SpriteSet {
  entity: string;
  /** key = frameLetter + rotation, e.g. "A1", "A2", "A8". */
  frames: Record<string, SpriteFrameEntry>;
}

/** Status-bar / HUD graphic (assets.md §3.11). */
export interface UiEntry {
  path: string;
  w: number;
  h: number;
  origin: [number, number];
}

export interface GlyphEntry {
  path: string;
  w: number;
  h: number;
}

/** STCFN HUD font (assets.md §3.12). */
export interface FontEntry {
  lumpRange: string; // "STCFN033-STCFN095"
  space: number; // advance for the absent space glyph
  glyphs: Record<string, GlyphEntry>; // key = ASCII code as string
}

export interface SoundEntry {
  path: string;
  rate: number; // sample rate (usually 11025)
  channels: number;
  format: 'ogg' | 'wav';
}

export interface MusicEntry {
  path: string;
  format: 'ogg';
}

export interface AssetManifest {
  meta: ManifestMeta;
  textures: Record<string, TextureEntry>;
  flats: Record<string, FlatEntry>;
  sprites: Record<string, SpriteSet>;
  ui: Record<string, UiEntry>;
  fonts: Record<string, FontEntry>;
  sounds: Record<string, SoundEntry>;
  music: Record<string, MusicEntry>;
}
