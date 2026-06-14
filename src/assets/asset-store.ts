// Decoded-asset registry — implements the IAssetStore contract from src/core.
// The AssetLoader populates it from the manifest at boot. getTexture(id) is the
// single image accessor exposed by IAssetStore, so EVERY decoded image is keyed
// here under a string id:
//   • wall textures / flats / UI graphics → their manifest key (e.g. "STARTAN3",
//     "FLOOR4_8", "STBAR", "STTNUM0").
//   • font glyphs → `${fontKey}#${asciiCode}` (e.g. "hud#65" for 'A').
// Sprites use getSprite(prefix, frame, rotation), keyed `${prefix}${frame}${rotation}`
// (e.g. "TROOA1").
import type { IAssetStore, Texture, SpriteFrame, MapData } from '../core';
import type { AssetManifest } from './manifest';

export class AssetStore implements IAssetStore {
  readonly textures = new Map<string, Texture>();
  /** Keyed by `${prefix}${frame}${rotation}`, e.g. "TROOA1". */
  readonly sprites = new Map<string, SpriteFrame>();
  readonly maps = new Map<string, MapData>();
  manifest: AssetManifest | null = null;
  private palette: Uint32Array | null = null;

  getTexture(id: string): Texture | undefined {
    return this.textures.get(id);
  }

  getSprite(prefix: string, frame: string, rotation: number): SpriteFrame | undefined {
    return this.sprites.get(`${prefix}${frame}${rotation}`);
  }

  getMap(id: string): MapData | undefined {
    return this.maps.get(id);
  }

  getPalette(): Uint32Array | null {
    return this.palette;
  }

  setPalette(palette: Uint32Array): void {
    this.palette = palette;
  }

  has(id: string): boolean {
    return this.textures.has(id) || this.sprites.has(id) || this.maps.has(id);
  }

  // ── Registration (used by AssetLoader) ────────────────────────────────────
  setManifest(manifest: AssetManifest): void {
    this.manifest = manifest;
  }

  addTexture(id: string, texture: Texture): void {
    this.textures.set(id, texture);
  }

  /** Register a sprite frame under its store key (prefix + frame + rotation). */
  addSprite(key: string, frame: SpriteFrame): void {
    this.sprites.set(key, frame);
  }

  addMap(id: string, map: MapData): void {
    this.maps.set(id, map);
  }
}
