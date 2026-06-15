// Boot-time asset loader (web-arch.md §7). Fetches manifest.json, decodes PNG →
// packed-ABGR Texture buffers, registers sprite frames + UI/font/flat images, and
// loads SFX through the Audio service — reporting progress for the LOADING state.
//
// Path model: the manifest lives at `./manifest.json`; its asset `path`s are
// relative to the assets base (`./assets/`). Paths are RELATIVE so the build runs
// from any subdirectory. The PLAYPAL[0] palette is emitted by the extractor as
// `<assetsBase>palette.json` (256 [r,g,b] triples) and loaded into the store as
// packed 0xAABBGGRR for the renderer's colormap.
//
// Self-contained itch build: when `EMBEDDED_ASSETS` is present (build:itch), the
// manifest + palette come from the embedded payload and every asset URL is a `data:`
// URL instead of an http path. Those data: URLs are decoded in-memory (atob → bytes;
// see ./data-url.ts) rather than fetched, because an embedding host's CSP `connect-src`
// does NOT cover the `data:` scheme (`connect-src *` still blocks `fetch('data:…')`).
// Net: the itch build performs ZERO fetches; the default build fetches real URLs as before.
import type { Audio, Texture, MapData } from '../core';
import type { AssetStore } from './asset-store';
import type { AssetManifest } from './manifest';
import { EMBEDDED_ASSETS } from './embedded';
import { isDataUrl, parseDataUrl } from './data-url';

export interface LoadProgress {
  loaded: number;
  total: number;
}

export type ProgressCallback = (p: LoadProgress) => void;

const DEFAULT_MANIFEST_URL = './manifest.json';
const DEFAULT_ASSETS_BASE = './assets/';
const DECODE_CONCURRENCY = 8;

export class AssetLoader {
  constructor(
    private readonly store: AssetStore,
    private readonly audio: Audio,
    private readonly manifestUrl: string = DEFAULT_MANIFEST_URL,
    private readonly assetsBase: string = DEFAULT_ASSETS_BASE,
  ) {}

  /** Fetch + decode everything in the manifest, reporting progress per asset. */
  async loadAll(onProgress: ProgressCallback): Promise<void> {
    const manifest = await this.loadManifest();
    this.store.setManifest(manifest);

    const tasks: Array<() => Promise<void>> = [];

    // Palette first — the renderer needs it to build shade colormaps.
    tasks.push(() => this.loadPalette());

    for (const [id, e] of Object.entries(manifest.textures)) {
      tasks.push(() => this.loadTexture(id, this.imageUrl(e.path)));
    }
    for (const [id, e] of Object.entries(manifest.flats)) {
      tasks.push(() => this.loadTexture(id, this.imageUrl(e.path)));
    }
    for (const [id, e] of Object.entries(manifest.ui)) {
      tasks.push(() => this.loadTexture(id, this.imageUrl(e.path)));
    }
    for (const [fontKey, font] of Object.entries(manifest.fonts)) {
      for (const [code, glyph] of Object.entries(font.glyphs)) {
        tasks.push(() => this.loadTexture(`${fontKey}#${code}`, this.imageUrl(glyph.path)));
      }
    }

    // Sprite frames may share a PNG (mirror-packed lumps) — decode each file once,
    // then register every frame that references it.
    for (const task of this.spriteTasks(manifest)) tasks.push(task);

    for (const [id, sound] of Object.entries(manifest.sounds)) {
      tasks.push(() => this.audio.load(id, this.soundUrl(sound.path)));
    }

    let loaded = 0;
    const total = tasks.length;
    onProgress({ loaded, total });
    await this.runPool(tasks, DECODE_CONCURRENCY, () => {
      loaded += 1;
      onProgress({ loaded, total });
    });
  }

  /** Fetch and parse the manifest JSON (or read it from the embedded payload). */
  async loadManifest(url: string = this.manifestUrl): Promise<AssetManifest> {
    if (EMBEDDED_ASSETS) return EMBEDDED_ASSETS.manifest;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`AssetLoader: manifest fetch ${url} → ${res.status}`);
    return (await res.json()) as AssetManifest;
  }

  // ── URL resolution: embedded `data:` URL (build:itch) or http path (default) ──
  private imageUrl(path: string): string {
    return EMBEDDED_ASSETS ? EMBEDDED_ASSETS.images[path]! : this.assetsBase + path;
  }

  private soundUrl(path: string): string {
    return EMBEDDED_ASSETS ? EMBEDDED_ASSETS.sounds[path]! : this.assetsBase + path;
  }

  /** Decode a PNG into a packed-Uint32 Texture and register it under `id`. */
  async loadTexture(id: string, url: string): Promise<void> {
    this.store.addTexture(id, await this.decodeImage(url));
  }

  /** Load and register a level JSON. */
  async loadMap(id: string, url: string): Promise<void> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`AssetLoader: map fetch ${url} → ${res.status}`);
    this.store.addMap(id, (await res.json()) as MapData);
  }

  // ── internals ──────────────────────────────────────────────────────────────
  private spriteTasks(manifest: AssetManifest): Array<() => Promise<void>> {
    interface FrameRef {
      key: string;
      originX: number;
      originY: number;
      mirror: boolean;
    }
    const byPath = new Map<string, FrameRef[]>();
    for (const [prefix, set] of Object.entries(manifest.sprites)) {
      for (const [frameKey, f] of Object.entries(set.frames)) {
        const refs = byPath.get(f.path) ?? [];
        refs.push({ key: `${prefix}${frameKey}`, originX: f.origin[0], originY: f.origin[1], mirror: f.mirror });
        byPath.set(f.path, refs);
      }
    }
    return [...byPath.entries()].map(([path, refs]) => async () => {
      const texture = await this.decodeImage(this.imageUrl(path));
      for (const r of refs) {
        this.store.addSprite(r.key, { texture, originX: r.originX, originY: r.originY, mirror: r.mirror });
      }
    });
  }

  private async loadPalette(): Promise<void> {
    let triples: Array<[number, number, number]>;
    if (EMBEDDED_ASSETS) {
      triples = EMBEDDED_ASSETS.palette;
    } else {
      const url = this.assetsBase + 'palette.json';
      const res = await fetch(url);
      if (!res.ok) throw new Error(`AssetLoader: palette fetch ${url} → ${res.status}`);
      triples = (await res.json()) as Array<[number, number, number]>;
    }
    const pal = new Uint32Array(triples.length);
    for (let i = 0; i < triples.length; i++) {
      const t = triples[i]!;
      pal[i] = ((0xff << 24) | (t[2] << 16) | (t[1] << 8) | t[0]) >>> 0; // 0xAABBGGRR
    }
    this.store.setPalette(pal);
  }

  /** Image bytes as a Blob: an inlined `data:` URL is decoded via atob (no fetch, so the
   *  host CSP's connect-src never applies); a real path is fetched (default build). Either
   *  way createImageBitmap + the canvas pixel readback below run identically. */
  private async imageBlob(url: string): Promise<Blob> {
    if (isDataUrl(url)) {
      const { mime, bytes } = parseDataUrl(url);
      return new Blob([bytes], { type: mime });
    }
    const res = await fetch(url);
    if (!res.ok) throw new Error(`AssetLoader: image fetch ${url} → ${res.status}`);
    return res.blob();
  }

  private async decodeImage(url: string): Promise<Texture> {
    const bitmap = await createImageBitmap(await this.imageBlob(url), {
      premultiplyAlpha: 'none',
      colorSpaceConversion: 'none',
    });
    const { width, height } = bitmap;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const cx = canvas.getContext('2d');
    if (!cx) throw new Error('AssetLoader: 2D context unavailable for image decode');
    cx.drawImage(bitmap, 0, 0);
    bitmap.close();
    const { data } = cx.getImageData(0, 0, width, height);
    const pixels = new Uint32Array(data.buffer.slice(0)); // RGBA bytes → 0xAABBGGRR
    return { width, height, pixels };
  }

  private async runPool(
    tasks: Array<() => Promise<void>>,
    concurrency: number,
    onDone: () => void,
  ): Promise<void> {
    let next = 0;
    const worker = async (): Promise<void> => {
      while (next < tasks.length) {
        const i = next++;
        await tasks[i]!();
        onDone();
      }
    };
    const workers = Array.from({ length: Math.min(concurrency, tasks.length) }, worker);
    await Promise.all(workers);
  }
}
