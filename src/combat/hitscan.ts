// Hitscan attacks — instant rays with optional multi-pellet horizontal spread and
// DOOM-style autoaim. On a flat grid autoaim degenerates to "snap the base aim to
// the nearest valid target in a cone, then the bullet hits the first body the ray
// crosses before any wall" (doom-design.md §2, §9). Spread uses the BAM idiom
// `(P_Random()−P_Random()) << shift`.
import type { IWorld, Entity, DamageRoll, Faction, Rng } from '../core';
import { rollDamage, degToRad, angleDiff, TAU } from '../core';
import { CombatBus } from './events';
import { wallDistance, rayCircleHit, segmentBlocked } from './raycast';
import { collectAttackTargets } from './targets';
import { applyDamage } from './resolve';

// Autoaim lock cone (half-angle). DOOM autoaim is vertical; flattened to 2D it
// becomes a modest horizontal lock so aiming near a target connects (§9.3).
const AUTOAIM_HALF_ANGLE = degToRad(15);

/** BAM horizontal jitter for one pellet: `(P_Random()−P_Random()) << shift`. */
export function spreadAngle(rng: Rng, shift: number): number {
  const bam = (rng.p() - rng.p()) * (1 << shift); // ±255 << shift, in BAM
  return (bam / 4294967296) * TAU; // BAM (0x1_0000_0000 = 2π) → radians
}

/**
 * Nearest valid target within `range` and the autoaim cone of `angle`, with clear
 * line-of-sight. Returns null if nothing locks on (the shot then keeps `angle`).
 */
export function autoaimTarget(
  world: IWorld,
  x: number,
  y: number,
  angle: number,
  range: number,
  sourceFaction: Faction,
  sourceId?: number,
): Entity | null {
  const level = world.level;
  let best: Entity | null = null;
  let bestDist = Infinity;
  for (const e of collectAttackTargets(world, sourceFaction, sourceId)) {
    const ex = e.x - x;
    const ey = e.y - y;
    const dist = Math.hypot(ex, ey);
    if (dist > range || dist < 1e-4) continue;
    if (Math.abs(angleDiff(angle, Math.atan2(ey, ex))) > AUTOAIM_HALF_ANGLE) continue;
    if (level && segmentBlocked(level, x, y, e.x, e.y)) continue;
    if (dist < bestDist) {
      bestDist = dist;
      best = e;
    }
  }
  return best;
}

/**
 * Fire `pellets` hitscan rays from (x,y). The base aim auto-locks to the nearest
 * target (autoaimTarget); each non-accurate pellet adds spread; every pellet that
 * crosses a target body (before any wall) rolls `damage` and applies it.
 */
export function hitscan(
  world: IWorld,
  x: number,
  y: number,
  angle: number,
  range: number,
  damage: DamageRoll,
  spreadShift: number,
  pellets: number,
  firstShotAccurate: boolean,
  sourceId: number,
  sourceFaction: Faction,
  rng: Rng,
  events?: CombatBus,
): void {
  const aim = autoaimTarget(world, x, y, angle, range, sourceFaction, sourceId);
  const baseAngle = aim ? Math.atan2(aim.y - y, aim.x - x) : angle;
  const origin = { x, y };

  for (let i = 0; i < pellets; i++) {
    const accurate = i === 0 && firstShotAccurate;
    const a = !accurate && spreadShift > 0 ? baseAngle + spreadAngle(rng, spreadShift) : baseAngle;
    const hit = rayFirstTarget(world, x, y, a, range, sourceFaction, sourceId);
    if (hit) {
      applyDamage(world, hit, rollDamage(rng, damage.n, damage.m), sourceId, sourceFaction, rng, events, origin);
    }
  }
}

/** First valid target a ray crosses before any wall, or null. */
function rayFirstTarget(
  world: IWorld,
  x: number,
  y: number,
  angle: number,
  range: number,
  sourceFaction: Faction,
  sourceId?: number,
): Entity | null {
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  const wallD = world.level ? wallDistance(world.level, x, y, dx, dy, range) : Infinity;
  const maxD = Math.min(range, wallD);
  let best: Entity | null = null;
  let bestT = Infinity;
  for (const e of collectAttackTargets(world, sourceFaction, sourceId)) {
    const t = rayCircleHit(x, y, dx, dy, e.x, e.y, e.radius, maxD);
    if (t >= 0 && t < bestT) {
      bestT = t;
      best = e;
    }
  }
  return best;
}
