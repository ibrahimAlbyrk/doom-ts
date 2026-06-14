// Grid collision + movement — STUB. Axis-aligned AABB body vs solid cells, with
// wall-sliding and the 24mu auto step-up (doom-design.md §1). Operates in map units.
import type { Entity } from '../core';
import type { LevelRuntime } from './level-runtime';

/** Move an entity by (dx,dy) map units, sliding along solid cells. Returns moved flag. */
export function moveEntity(_entity: Entity, _dx: number, _dy: number, _level: LevelRuntime): boolean {
  throw new Error('NotImplemented: moveEntity (doom-design §1 collision)');
}

/** Test whether a radius-`r` body centred at (x,y) map units fits (no solid overlap). */
export function positionFits(_x: number, _y: number, _r: number, _level: LevelRuntime): boolean {
  throw new Error('NotImplemented: positionFits');
}
