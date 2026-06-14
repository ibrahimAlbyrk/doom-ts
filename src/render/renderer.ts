// Canvas2DRenderer — implements the Renderer contract (src/core/render.ts).
// init/resize/setPalette are wired (boot-safe: allocate backbuffer, build colormaps).
// render() is a STUB until the raycaster passes (raycaster.ts/sprites.ts) land.
// Pipeline + upscale strategy: engine.md §6, §9.
import type { Renderer, RenderConfig, RenderScene } from '../core';
import { COLORMAP_LEVELS } from '../core';
import { buildColormaps } from './colormap';

export class Canvas2DRenderer implements Renderer {
  private displayCtx: CanvasRenderingContext2D | null = null;
  private config: RenderConfig | null = null;
  private buffer: ImageData | null = null;
  private back: Uint32Array | null = null;
  private zBuffer: Float64Array | null = null;
  private colormaps: Uint32Array[] = [];

  init(canvas: HTMLCanvasElement, config: RenderConfig): void {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas2DRenderer: 2D context unavailable');
    ctx.imageSmoothingEnabled = false; // nearest-neighbor upscale (engine.md §6.2)
    this.displayCtx = ctx;
    this.allocate(config);
  }

  resize(config: RenderConfig): void {
    this.allocate(config);
  }

  setPalette(palette: Uint32Array): void {
    const levels = this.config?.colormapLevels ?? COLORMAP_LEVELS;
    this.colormaps = buildColormaps(palette, levels);
  }

  render(_scene: RenderScene, _alpha: number): void {
    // STUB — full per-frame order (engine.md §9):
    //   floor/ceiling cast → wall cast (+zBuffer) → sprites (z-tested) → weapon → blit.
    // Intentionally a no-op so the app boots cleanly before the raycaster exists.
    // The real pipeline writes `this.back`, samples `this.colormaps`, then blits
    // `this.buffer` through `this.displayCtx`.
    if (!this.back || !this.zBuffer || !this.displayCtx) return;
    if (this.colormaps.length === 0) return; // palette not loaded yet
  }

  private allocate(config: RenderConfig): void {
    this.config = config;
    const w = config.internalWidth;
    const h = config.internalHeight;
    this.buffer = new ImageData(w, h);
    this.back = new Uint32Array(this.buffer.data.buffer);
    this.zBuffer = new Float64Array(w);
  }
}
