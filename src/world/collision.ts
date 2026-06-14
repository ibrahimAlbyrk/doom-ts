// Circle-vs-grid collision with wall sliding (doom-design.md §1). The body is a
// circle of `entity.radius` mu; solid grid cells are axis-aligned 64mu boxes.
// A move tries the full step, then slides per-axis along whatever blocked it.
// Reads the level only through ILevelRuntime, so both the player and monster AI
// can drive it (parameterized by each entity's own radius). Operates in map units.
import type { Entity, ILevelRuntime } from '../core';
import { CELL_SIZE, MAX_STEP_UP, clamp } from '../core';

const EPS = 1e-4;

export interface MoveResult {
  movedX: boolean; // achieved the full requested dx (not blocked)
  movedY: boolean;
}

export function cellOf(coord: number): number {
  return Math.floor(coord / CELL_SIZE);
}

/** Does a cell block a body? Solid walls/closed doors always; a floor tier more
 *  than MAX_STEP_UP above `fromFloorZ` (e.g. a raised lift) blocks entry too. */
function cellBlocks(cx: number, cy: number, level: ILevelRuntime, fromFloorZ?: number): boolean {
  if (level.isSolid(cx, cy)) return true;
  if (fromFloorZ !== undefined && level.floorHeightAt(cx, cy) - fromFloorZ > MAX_STEP_UP) return true;
  return false;
}

/** The floor a body actually stands on: the HIGHEST floor among the cells its
 *  circle overlaps — DOOM stands you on the tallest floor your bounding box
 *  touches. Used as the reference height for the auto step-up test. Taking the
 *  max (not just the centre cell) lets a body straddling a tier seam — e.g. the
 *  instant after dropping off the +64 blue ledge, when its radius still overlaps
 *  the high cell behind it — keep moving off the seam instead of wedging against
 *  that high cell as if it were a wall. Solid cells aren't floors, so skip them. */
function standingFloorZ(x: number, y: number, r: number, level: ILevelRuntime): number {
  const minCx = cellOf(x - r);
  const maxCx = cellOf(x + r);
  const minCy = cellOf(y - r);
  const maxCy = cellOf(y + r);
  const r2 = r * r;
  let z = level.floorHeightAt(cellOf(x), cellOf(y)); // the centre cell always counts
  for (let cy = minCy; cy <= maxCy; cy++) {
    for (let cx = minCx; cx <= maxCx; cx++) {
      if (level.isSolid(cx, cy)) continue;
      const boxMinX = cx * CELL_SIZE;
      const boxMinY = cy * CELL_SIZE;
      const nearestX = clamp(x, boxMinX, boxMinX + CELL_SIZE);
      const nearestY = clamp(y, boxMinY, boxMinY + CELL_SIZE);
      const dx = x - nearestX;
      const dy = y - nearestY;
      if (dx * dx + dy * dy < r2 - EPS) {
        const fz = level.floorHeightAt(cx, cy);
        if (fz > z) z = fz;
      }
    }
  }
  return z;
}

/** True if a radius-`r` circle centred at (x,y) overlaps no blocking cell. When
 *  `fromFloorZ` is given, cells higher than the auto step-up also count blocking. */
export function positionFits(
  x: number,
  y: number,
  r: number,
  level: ILevelRuntime,
  fromFloorZ?: number,
): boolean {
  const minCx = cellOf(x - r);
  const maxCx = cellOf(x + r);
  const minCy = cellOf(y - r);
  const maxCy = cellOf(y + r);
  const r2 = r * r;
  for (let cy = minCy; cy <= maxCy; cy++) {
    for (let cx = minCx; cx <= maxCx; cx++) {
      if (!cellBlocks(cx, cy, level, fromFloorZ)) continue;
      const boxMinX = cx * CELL_SIZE;
      const boxMinY = cy * CELL_SIZE;
      const nearestX = clamp(x, boxMinX, boxMinX + CELL_SIZE);
      const nearestY = clamp(y, boxMinY, boxMinY + CELL_SIZE);
      const dx = x - nearestX;
      const dy = y - nearestY;
      if (dx * dx + dy * dy < r2 - EPS) return false; // circle overlaps the cell box
    }
  }
  return true;
}

/**
 * Slide-move `entity` by (dx,dy) map units. Tries the combined step first; if a
 * wall blocks it, retries each axis independently so the body slides along the
 * wall. Long moves are sub-stepped to avoid tunnelling a cell. Mutates x/y and
 * reports which axes completed (a blocked axis lets callers stop momentum there).
 */
export function slideMove(entity: Entity, dx: number, dy: number, level: ILevelRuntime): MoveResult {
  const r = entity.radius;
  const fromFloorZ = standingFloorZ(entity.x, entity.y, r, level);
  const startX = entity.x;
  const startY = entity.y;

  // Sub-step so a single substep never exceeds the body radius (or a quarter
  // cell): this both prevents tunnelling and lets the body creep flush to a wall.
  const maxStep = Math.max(1, Math.min(r, CELL_SIZE / 4));
  const span = Math.max(Math.abs(dx), Math.abs(dy));
  const steps = span > maxStep ? Math.ceil(span / maxStep) : 1;
  const sx = dx / steps;
  const sy = dy / steps;

  for (let i = 0; i < steps; i++) {
    if (positionFits(entity.x + sx, entity.y + sy, r, level, fromFloorZ)) {
      entity.x += sx;
      entity.y += sy;
      continue;
    }
    let stepped = false;
    if (sx !== 0 && positionFits(entity.x + sx, entity.y, r, level, fromFloorZ)) {
      entity.x += sx;
      stepped = true;
    }
    if (sy !== 0 && positionFits(entity.x, entity.y + sy, r, level, fromFloorZ)) {
      entity.y += sy;
      stepped = true;
    }
    if (!stepped) break; // wedged in a corner — nothing more to give
  }

  return {
    movedX: Math.abs(entity.x - (startX + dx)) <= EPS,
    movedY: Math.abs(entity.y - (startY + dy)) <= EPS,
  };
}

/** Move an entity by (dx,dy) map units, sliding along solid cells. Returns whether
 *  it moved at all. Thin wrapper over slideMove for callers that ignore per-axis. */
export function moveEntity(entity: Entity, dx: number, dy: number, level: ILevelRuntime): boolean {
  const startX = entity.x;
  const startY = entity.y;
  slideMove(entity, dx, dy, level);
  return entity.x !== startX || entity.y !== startY;
}
