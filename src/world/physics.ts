// Movement integration — DOOM's momentum model (doom-design.md §1). Per tic:
// thrust is added along the move direction, per-axis momentum is clamped to
// MAXMOVE, the body slide-moves by its momentum, momentum decays by FRICTION,
// and momentum below STOPSPEED snaps to rest. Friction *is* the accel/decel
// curve — there is no separate acceleration term. Time is in DOOM tics (35/s);
// callers running the 60Hz fixed step pass tics = FIXED_STEP / SECONDS_PER_TIC.
import type { Entity, ILevelRuntime } from '../core';
import { FRICTION, MAX_MOVE, STOP_SPEED, clamp } from '../core';
import { slideMove } from './collision';

/** An entity that carries momentum. Player and Monster satisfy this structurally. */
export interface MovingBody extends Entity {
  velX: number;
  velY: number;
}

/** Add a thrust impulse of `magnitude` mu/tic along `angle`, scaled by `tics`. */
export function applyThrust(body: MovingBody, angle: number, magnitude: number, tics = 1): void {
  body.velX += Math.cos(angle) * magnitude * tics;
  body.velY += Math.sin(angle) * magnitude * tics;
}

/**
 * Advance one movement step over `tics` tics. Clamps momentum to MAXMOVE,
 * slide-moves by momentum, then decays by FRICTION^tics and snaps sub-STOPSPEED
 * momentum to 0. An axis blocked by a wall has its momentum zeroed so the body
 * settles against the wall and keeps the parallel component (clean sliding).
 */
export function stepMovement(body: MovingBody, level: ILevelRuntime, tics = 1): void {
  body.velX = clamp(body.velX, -MAX_MOVE, MAX_MOVE);
  body.velY = clamp(body.velY, -MAX_MOVE, MAX_MOVE);

  const moved = slideMove(body, body.velX * tics, body.velY * tics, level);
  if (!moved.movedX) body.velX = 0;
  if (!moved.movedY) body.velY = 0;

  const decay = Math.pow(FRICTION, tics);
  body.velX *= decay;
  body.velY *= decay;
  if (Math.abs(body.velX) < STOP_SPEED) body.velX = 0;
  if (Math.abs(body.velY) < STOP_SPEED) body.velY = 0;
}
