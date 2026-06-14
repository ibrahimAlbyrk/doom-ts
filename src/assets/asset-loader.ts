// Boot-time asset loader — fetches manifest.json, decodes PNG → Texture pixel
// buffers, registers sprite frames, loads maps + audio, reports progress.
// STUB: signatures only (web-arch.md §7). LoadingState drives `loadAll`.
import type { Audio } from '../core';
import type { AssetStore } from './asset-store';
import type { AssetManifest } from './manifest';

export interface LoadProgress {
  loaded: number;
  total: number;
}

export type ProgressCallback = (p: LoadProgress) => void;

export class AssetLoader {
  constructor(
    private readonly store: AssetStore,
    private readonly audio: Audio,
  ) {}

  /** Fetch + decode everything in the manifest, reporting progress per asset. */
  async loadAll(_onProgress: ProgressCallback): Promise<void> {
    // Real impl: fetch manifest → decode PNGs into `this.store`, audio via `this.audio`.
    if (!this.store || !this.audio) throw new Error('AssetLoader: services missing');
    throw new Error('NotImplemented: AssetLoader.loadAll');
  }

  /** Fetch and parse the manifest JSON. */
  async loadManifest(_url = '/manifest.json'): Promise<AssetManifest> {
    throw new Error('NotImplemented: AssetLoader.loadManifest');
  }

  /** Decode a PNG into a packed-Uint32 Texture and register it. */
  async loadTexture(_id: string, _url: string): Promise<void> {
    throw new Error('NotImplemented: AssetLoader.loadTexture');
  }

  /** Load and register a level JSON. */
  async loadMap(_id: string, _url: string): Promise<void> {
    throw new Error('NotImplemented: AssetLoader.loadMap');
  }
}
