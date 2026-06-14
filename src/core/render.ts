// FROZEN CONTRACT — the renderer interface and the data it consumes.
// The raycaster (src/render) implements `Renderer`; the asset store produces
// `Texture`/`SpriteFrame`; the game state builds a `RenderScene` each frame.
// Render math/derivation: docs/research/engine.md.
import type { ILevelRuntime, IAssetStore } from './types';

/** Player camera in cell-space (engine.md §0). dir & plane stay perpendicular. */
export interface Camera {
  posX: number;
  posY: number;
  dirX: number;
  dirY: number;
  planeX: number;
  planeY: number;
}

/** Decoded image: packed little-endian ABGR (0xAABBGGRR) pixels (engine.md §6.1). */
export interface Texture {
  width: number;
  height: number;
  pixels: Uint32Array;
}

/** A single sprite frame: image + draw hotspot from the picture header (assets.md §5). */
export interface SpriteFrame {
  texture: Texture;
  originX: number; // leftoffset
  originY: number; // topoffset
  mirror: boolean; // horizontally flipped packed view
}

/** Render configuration (resolution + view tuning) — mutable via settings. */
export interface RenderConfig {
  internalWidth: number;
  internalHeight: number;
  fovRatio: number; // camera-plane length ratio (≈0.66)
  colormapLevels: number; // light bands
}

/**
 * Full-screen palette tint composited over the final frame (doom-design §5).
 * The game derives this each frame from damage events + active powerup timers; the
 * renderer just composites it. Omit (undefined) for no tint.
 */
export interface ScreenTint {
  /** Tint color channels, 0..255. Ignored by `mode: 'invert'`. */
  r: number;
  g: number;
  b: number;
  /** Effect strength 0..1 (0 = no visible tint). */
  a: number;
  /**
   * How the color combines with the frame (default 'blend'):
   *  - 'blend': alpha-blend the color over the frame — damage red, pickup gold,
   *    berserk red, radiation-suit green.
   *  - 'invert': invulnerability — invert the frame's RGB (DOOM "god" palette), then
   *    blend the color over at `a` (pass white for the classic bright wash).
   *  - 'bright': light-amp / infrared — lerp the frame toward the color by `a` to fake
   *    full-bright vision.
   */
  mode?: 'blend' | 'invert' | 'bright';
}

/** One billboarded world sprite to draw this frame (engine.md §4). */
export interface SpriteInstance {
  x: number; // cell-space world position
  y: number;
  frame: SpriteFrame;
  light: number; // 0..255 sector light at the sprite
  fullbright: boolean; // ignore distance lighting (projectiles, lamps)
  vMove: number; // vertical screen offset for floating things
}

/** Everything the renderer needs for one world frame. */
export interface RenderScene {
  camera: Camera;
  level: ILevelRuntime;
  sprites: SpriteInstance[];
  /** Screen-space weapon view-model frame, drawn last (engine.md §10). */
  viewWeapon: SpriteFrame | null;
  /** Whole-scene brightness bump after firing (engine.md §5 extralight). */
  extralight: number;
  /** Weapon-bob screen offset for the view-model; consumers default to 0. */
  bobX: number;
  bobY: number;
  /**
   * Muzzle-flash frame composited OVER the weapon view-model when firing
   * (doom-design §5). Optional/additive: existing scene builders may omit it. The game
   * resolves it like viewWeapon (assets.getSprite(view.flashSprite, view.flashFrame, 0)).
   */
  viewFlash?: SpriteFrame | null;
  /**
   * Full-screen palette tint composited over the final frame (doom-design §5).
   * Optional/additive: omit for no tint.
   */
  tint?: ScreenTint;
  /**
   * Bobbed eye height above the player's floor tier in MAP UNITS (DOOM P_CalcHeight:
   * VIEW_HEIGHT ± walk-bob). Drives the floor/ceiling/wall/sprite vertical projection so
   * the whole view bobs while walking. Optional/additive: renderer defaults to VIEW_HEIGHT.
   */
  viewZ?: number;
  /**
   * Height in pixels (internal resolution) of the 3D play view — the screen minus the
   * opaque status-bar strip. The weapon view-model anchors to the BOTTOM of this region
   * (just above the bar), not the screen bottom. Optional/additive: defaults to the full
   * internal height.
   */
  playViewHeight?: number;
}

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
