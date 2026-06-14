// 2D grid ray utilities for combat: how far a ray travels before a solid cell
// (wall / closed door), whether two points have clear line-of-sight, and where a
// ray first crosses an entity body. All combat is on the flat plane, so these
// replace DOOM's BSP P_CheckSight / P_AimLineAttack with a uniform-grid march
// (doom-design.md §9 — "first thing along the 2D ray"). Map units throughout.
import type { ILevelRuntime } from '../core';
import { CELL_SIZE } from '../core';

const EPS = 1e-6;

export function cellOf(coord: number): number {
  return Math.floor(coord / CELL_SIZE);
}

/**
 * Distance along the unit ray (ox,oy)+t·(dx,dy) to where it first enters a solid
 * grid cell, or Infinity if none within `maxDist`. Amanatides–Woo DDA; the origin
 * cell is never counted as a blocker (the shooter may stand against a wall).
 */
export function wallDistance(
  level: ILevelRuntime,
  ox: number,
  oy: number,
  dx: number,
  dy: number,
  maxDist: number,
): number {
  let cx = cellOf(ox);
  let cy = cellOf(oy);
  const stepX = dx > 0 ? 1 : -1;
  const stepY = dy > 0 ? 1 : -1;

  const nextBoundX = (dx > 0 ? cx + 1 : cx) * CELL_SIZE;
  const nextBoundY = (dy > 0 ? cy + 1 : cy) * CELL_SIZE;
  let tMaxX = Math.abs(dx) > EPS ? (nextBoundX - ox) / dx : Infinity;
  let tMaxY = Math.abs(dy) > EPS ? (nextBoundY - oy) / dy : Infinity;
  const tDeltaX = Math.abs(dx) > EPS ? CELL_SIZE / Math.abs(dx) : Infinity;
  const tDeltaY = Math.abs(dy) > EPS ? CELL_SIZE / Math.abs(dy) : Infinity;

  // Bound the iteration count so a degenerate ray can never loop forever.
  const maxCells = 2 * Math.ceil(maxDist / CELL_SIZE) + 2;
  for (let i = 0; i < maxCells; i++) {
    let t: number;
    if (tMaxX < tMaxY) {
      cx += stepX;
      t = tMaxX;
      tMaxX += tDeltaX;
    } else {
      cy += stepY;
      t = tMaxY;
      tMaxY += tDeltaY;
    }
    if (t > maxDist) return Infinity;
    if (level.isSolid(cx, cy)) return t;
  }
  return Infinity;
}

/** True if a solid cell lies on the segment a→b (line-of-sight is blocked). */
export function segmentBlocked(level: ILevelRuntime, ax: number, ay: number, bx: number, by: number): boolean {
  const dx = bx - ax;
  const dy = by - ay;
  const len = Math.hypot(dx, dy);
  if (len < EPS) return false;
  const hit = wallDistance(level, ax, ay, dx / len, dy / len, len);
  return hit < len - EPS;
}

/**
 * Distance along the unit ray to where it first crosses a circle of radius `r`
 * centred at (cx,cy), or -1 if it misses / the hit is beyond `maxDist`. Returns 0
 * when the origin is already inside the body.
 */
export function rayCircleHit(
  ox: number,
  oy: number,
  dx: number,
  dy: number,
  cx: number,
  cy: number,
  r: number,
  maxDist: number,
): number {
  const ex = cx - ox;
  const ey = cy - oy;
  const centerDistSq = ex * ex + ey * ey;
  if (centerDistSq <= r * r) return 0; // origin inside the body
  const proj = ex * dx + ey * dy; // closest approach parameter
  if (proj <= 0) return -1; // body is behind the ray
  const perpSq = centerDistSq - proj * proj;
  if (perpSq > r * r) return -1; // ray passes wide of the body
  const t = proj - Math.sqrt(r * r - perpSq);
  return t >= 0 && t <= maxDist ? t : -1;
}
