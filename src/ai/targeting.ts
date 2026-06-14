// Targeting geometry shared by sight/chase/attack: facing, distance, the 2D
// line-of-sight test, current-target resolution, melee reach, and the wake helper.
// LOS reuses combat's grid raycaster (segmentBlocked) — the engine's single
// "first thing along the 2D ray" primitive (doom-design.md §9).
import type { Entity, IWorld, Monster } from '../core';
import { MELEE_RANGE, REACTION_TICS, angleDiff } from '../core';
import { isAliveMonster, isAlivePlayer, segmentBlocked } from '../combat';

interface Point {
  x: number;
  y: number;
}

export function angleTo(from: Point, to: Point): number {
  return Math.atan2(to.y - from.y, to.x - from.x);
}

export function dist2d(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/** Clear line-of-sight between two points (no level ⇒ open space ⇒ always true). */
export function hasLOS(world: IWorld, a: Point, b: Point): boolean {
  const level = world.level;
  if (!level) return true;
  return !segmentBlocked(level, a.x, a.y, b.x, b.y);
}

/** Target inside the monster's front cone (default DOOM 180°). */
export function inFrontCone(m: Monster, target: Point, halfAngle = Math.PI / 2): boolean {
  return Math.abs(angleDiff(m.angle, angleTo(m, target))) <= halfAngle;
}

/** P_CheckMeleeRange: centre distance within MELEERANGE + the target's radius. */
export function inMeleeRange(m: Monster, target: Entity): boolean {
  return dist2d(m, target) <= MELEE_RANGE + target.radius;
}

/** Resolve a monster's current target id to a live entity, or null if gone. */
export function targetEntity(world: IWorld, m: Monster): Entity | null {
  if (m.target === null) return null;
  const player = world.players.get(m.target);
  if (player) return isAlivePlayer(player) ? player : null;
  const mon = world.monsters.find((x) => x.id === m.target);
  return mon && isAliveMonster(mon) ? mon : null;
}

/** Acquire `targetId`; a sleeping monster wakes into chase with a reaction delay
 *  (skill-scaled by the caller; falls back to the baseline when unspecified). */
export function wake(m: Monster, targetId: number, reaction: number = REACTION_TICS): void {
  m.target = targetId;
  if (m.state === 'idle') {
    m.state = 'chase';
    m.stateTimer = 0;
    m.reactionTime = reaction;
  }
}
