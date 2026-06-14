// The Renderer SERVICE interface — CLIENT-ONLY (binds a DOM canvas). Moved out of
// `src/core` so the shared sim compiles/runs under Node without `lib.dom` (the
// multiplayer DOM-split; see docs/multiplayer-plan.md §0.1). The DOM-free render
// DATA shapes it consumes (RenderScene/RenderConfig/Texture/SpriteFrame/…) stay in
// `src/core/render.ts`; only this canvas-bound contract is browser-side.
import type { RenderConfig, RenderScene, IAssetStore } from '../core';

export interface Renderer {
  /** Bind to the display canvas and size the internal backbuffer. */
  init(canvas: HTMLCanvasElement, config: RenderConfig): void;
  /** Re-create the internal backbuffer after a resolution change. */
  resize(config: RenderConfig): void;
  /** Build the shade colormaps from the asset palette (engine.md §5.1). */
  setPalette(palette: Uint32Array): void;
  /** Bind the decoded-asset store so wall/flat/sky texture keys resolve to Textures. */
  setAssets(store: IAssetStore): void;
  /** Internal render resolution; UI draws its HUD layer at this size (HUD-blit hook). */
  getViewport(): { width: number; height: number };
  /** Composite a UI-owned layer (drawn at internal resolution) onto the display canvas. */
  blitHudLayer(layer: CanvasImageSource): void;
  /** Draw one world frame; `alpha` is the fixed-step interpolation factor. */
  render(scene: RenderScene, alpha: number): void;
}
