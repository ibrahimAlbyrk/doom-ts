// Sprite + weapon view-model passes — engine.md §4, §10. STUB: billboard transform,
// far-to-near sort, per-column z-buffer clip + transparency, weapon overlay.
import type { Camera, RenderConfig, SpriteInstance, SpriteFrame } from '../core';

/** Draw all world sprites, z-tested against the wall zBuffer (engine.md §4). */
export function drawSprites(
  _back: Uint32Array,
  _zBuffer: Float64Array,
  _camera: Camera,
  _sprites: SpriteInstance[],
  _config: RenderConfig,
): void {
  throw new Error('NotImplemented: drawSprites (engine.md §4)');
}

/** Composite the first-person weapon frame last, in screen space (engine.md §10). */
export function drawWeapon(
  _back: Uint32Array,
  _frame: SpriteFrame,
  _config: RenderConfig,
  _light: number,
  _bobX: number,
  _bobY: number,
): void {
  throw new Error('NotImplemented: drawWeapon (engine.md §10)');
}
