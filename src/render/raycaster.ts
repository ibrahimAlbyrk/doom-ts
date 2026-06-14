// Wall + flat casting — engine.md §1–3. STUB: the DDA grid raycaster, perpendicular
// distance, perspective-correct wall texture mapping, and per-row floor/ceiling cast.
import type { Camera, ILevelRuntime, RenderConfig } from '../core';

/** Cast one column per screen x: DDA → perpWallDist → textured wall slice; fills zBuffer. */
export function castWalls(
  _back: Uint32Array,
  _zBuffer: Float64Array,
  _camera: Camera,
  _level: ILevelRuntime,
  _config: RenderConfig,
): void {
  throw new Error('NotImplemented: castWalls (engine.md §1–2)');
}

/** Per-row floor + ceiling flats below/above the horizon (engine.md §3). */
export function castFloorCeiling(
  _back: Uint32Array,
  _camera: Camera,
  _level: ILevelRuntime,
  _config: RenderConfig,
): void {
  throw new Error('NotImplemented: castFloorCeiling (engine.md §3)');
}
