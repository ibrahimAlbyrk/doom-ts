// FROZEN CONTRACT — the renderer interface and the data it consumes.
// The raycaster (src/render) implements `Renderer`; the asset store produces
// `Texture`/`SpriteFrame`; the game state builds a `RenderScene` each frame.
// Render math/derivation: docs/research/engine.md.
import type { ILevelRuntime } from './types';

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
}

export interface Renderer {
  /** Bind to the display canvas and size the internal backbuffer. */
  init(canvas: HTMLCanvasElement, config: RenderConfig): void;
  /** Re-create the internal backbuffer after a resolution change. */
  resize(config: RenderConfig): void;
  /** Build the shade colormaps from the asset palette (engine.md §5.1). */
  setPalette(palette: Uint32Array): void;
  /** Draw one world frame; `alpha` is the fixed-step interpolation factor. */
  render(scene: RenderScene, alpha: number): void;
}
