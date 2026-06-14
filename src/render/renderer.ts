// Canvas2DRenderer — implements the Renderer contract (src/core/render.ts).
// Per-frame order (engine.md §9): floor/ceiling cast → wall cast (+zBuffer) → sprites
// (z-tested) → weapon overlay → putImageData. The internal backbuffer is sized to the
// configured internal resolution and blitted 1:1; the display canvas attribute size is
// set to that resolution and the browser upscales nearest-neighbor via CSS
// `image-rendering: pixelated` (engine.md §6.2, "skip the second canvas").
import type {
  Renderer,
  RenderConfig,
  RenderScene,
  Texture,
  IAssetStore,
} from '../core';
import { COLORMAP_LEVELS, CELL_SIZE, VIEW_HEIGHT, TAU } from '../core';
import { buildColormaps } from './colormap';
import { buildBrightness } from './lighting';
import { makeCheckerTexture, makeSkyFallback } from './textures';
import type { Frame } from './frame';
import { castWalls, castFloorCeiling } from './raycaster';
import { drawSprites, drawWeapon, cameraCellLight } from './sprites';

export class Canvas2DRenderer implements Renderer {
  private canvas: HTMLCanvasElement | null = null;
  private displayCtx: CanvasRenderingContext2D | null = null;
  private config: RenderConfig | null = null;
  private buffer: ImageData | null = null;
  private back: Uint32Array | null = null;
  private zBuffer: Float64Array | null = null;
  private colormaps: Uint32Array[] = []; // paletted-path LUTs (kept per contract)
  private brightness: Float64Array = buildBrightness(COLORMAP_LEVELS);

  // Texture resolution (the frozen Renderer has no asset binding — see report).
  private assets: IAssetStore | null = null;
  private readonly texCache = new Map<string, Texture>();
  private skyFallback: Texture = makeSkyFallback();

  // Reused scratch (no per-frame allocation, engine.md §6.3).
  private skyColumn = new Int32Array(0);
  private readonly spriteOrder: number[] = [];

  init(canvas: HTMLCanvasElement, config: RenderConfig): void {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas2DRenderer: 2D context unavailable');
    this.canvas = canvas;
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

  /**
   * Pre-darkened palette LUT for light band `level` (engine.md §5.1). Our hot loop
   * shades truecolor RGBA in RGB space (§5.2, ARCHITECTURE §4 bakes RGBA assets), so
   * these are built by setPalette but only needed by a future paletted-texture path.
   */
  getColormap(level: number): Uint32Array | undefined {
    return this.colormaps[level];
  }

  /**
   * Bind the decoded-asset store so wall/flat/sky texture KEYS resolve to Textures.
   * NOT on the frozen Renderer interface — the contract has no asset binding (reported
   * as an interface gap). Optional: with no store bound, every key falls back to a
   * procedural checkerboard so the engine stays verifiable before assets land.
   */
  setAssets(assets: IAssetStore): void {
    this.assets = assets;
    this.texCache.clear(); // drop any fallbacks now backed by real textures
  }

  /** Internal render resolution; UI draws its HUD layer at this size (HUD-blit hook). */
  getViewport(): { width: number; height: number } {
    return {
      width: this.config?.internalWidth ?? 0,
      height: this.config?.internalHeight ?? 0,
    };
  }

  /**
   * HUD-blit hook: composite a UI-owned layer (drawn at internal resolution) onto the
   * display canvas after the world, so it shares the same nearest-neighbor upscale.
   * Content is the UI worker's responsibility (engine.md §9 step 8).
   */
  blitHudLayer(layer: CanvasImageSource): void {
    this.displayCtx?.drawImage(layer, 0, 0);
  }

  render(scene: RenderScene, _alpha: number): void {
    const back = this.back;
    const zBuffer = this.zBuffer;
    const config = this.config;
    const ctx = this.displayCtx;
    const buffer = this.buffer;
    if (!back || !zBuffer || !config || !ctx || !buffer) return;

    const W = config.internalWidth;
    const H = config.internalHeight;
    const { camera: cam, level } = scene;

    // Height model in cell units (engine.md §7): eye above the player's floor tier.
    const pcx = Math.floor(cam.posX);
    const pcy = Math.floor(cam.posY);
    const pf = level.floorHeightAt(pcx, pcy) / CELL_SIZE;
    const pc = level.ceilHeightAt(pcx, pcy) / CELL_SIZE;
    const eyeAboveFloor = VIEW_HEIGHT / CELL_SIZE;
    const eyeZ = pf + eyeAboveFloor;
    const posZFloor = eyeAboveFloor * H;
    const ceilAboveEye = Math.max(pc - eyeZ, 0.001);
    const posZCeil = ceilAboveEye * H;

    const skyTex = this.resolveSky(level.data.sky);
    this.buildSkyColumns(cam, W, skyTex.width);

    const frame: Frame = {
      back,
      zBuffer,
      W,
      H,
      cam,
      level,
      resolve: (key) => this.resolveTexture(key),
      brightness: this.brightness,
      levels: config.colormapLevels,
      extralight: scene.extralight,
      eyeZ,
      posZFloor,
      posZCeil,
      skyTex,
      skyColumn: this.skyColumn,
    };

    // engine.md §9: flats → walls (+zBuffer) → sprites (z-tested) → weapon → blit.
    castFloorCeiling(frame);
    castWalls(frame);
    drawSprites(frame, scene.sprites, this.spriteOrder);
    if (scene.viewWeapon) {
      drawWeapon(
        back,
        W,
        H,
        scene.viewWeapon,
        this.brightness,
        config.colormapLevels,
        cameraCellLight(level, cam.posX, cam.posY),
        scene.extralight,
        0,
        0, // RenderScene carries no weapon bob offset — see reported interface gap
      );
    }

    ctx.putImageData(buffer, 0, 0);
  }

  private buildSkyColumns(cam: RenderScene['camera'], W: number, skyW: number): void {
    if (this.skyColumn.length !== W) this.skyColumn = new Int32Array(W);
    const col = this.skyColumn;
    for (let x = 0; x < W; x++) {
      const cameraX = (2 * x) / W - 1;
      const rayDirX = cam.dirX + cam.planeX * cameraX;
      const rayDirY = cam.dirY + cam.planeY * cameraX;
      let angle = Math.atan2(rayDirY, rayDirX) / TAU; // -0.5 .. 0.5 turns
      angle -= Math.floor(angle); // 0 .. 1
      let sx = (angle * skyW) | 0;
      sx %= skyW;
      if (sx < 0) sx += skyW;
      col[x] = sx;
    }
  }

  private resolveTexture(key: string): Texture {
    let tex = this.texCache.get(key);
    if (tex) return tex;
    tex = (key ? this.assets?.getTexture(key) : undefined) ?? makeCheckerTexture(key || 'NULL');
    this.texCache.set(key, tex);
    return tex;
  }

  private resolveSky(key: string): Texture {
    return (key ? this.assets?.getTexture(key) : undefined) ?? this.skyFallback;
  }

  private allocate(config: RenderConfig): void {
    this.config = config;
    const w = config.internalWidth;
    const h = config.internalHeight;
    this.buffer = new ImageData(w, h);
    this.back = new Uint32Array(this.buffer.data.buffer);
    this.zBuffer = new Float64Array(w);
    this.skyColumn = new Int32Array(w);
    this.brightness = buildBrightness(config.colormapLevels);
    if (this.canvas && this.displayCtx) {
      // Backbuffer is blitted 1:1; canvas attr = internal res, CSS upscales (engine.md §6.2).
      this.canvas.width = w;
      this.canvas.height = h;
      this.displayCtx.imageSmoothingEnabled = false;
    }
  }
}
