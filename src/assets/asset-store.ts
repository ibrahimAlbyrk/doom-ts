// Decoded-asset registry — implements the IAssetStore contract from src/core.
// STUB: holds decoded textures/sprites/maps + the palette; lookups are wired but
// empty until the asset-loader (and the WAD extractor) populate them.
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
}
