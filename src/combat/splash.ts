// Radius (splash) damage — DOOM P_RadiusAttack. Damage falls off linearly with
// distance (`radius − dist`, max `radius` at point-blank) and is gated by 2D
// line-of-sight: an intervening wall fully blocks it (doom-design.md §2, §9.6).
// Hits every live entity in range except the source — including allies, which is
// what drives splash-triggered infighting (§3).
import type { IWorld, Entity, Faction, Rng } from '../core';
import { CombatBus } from './events';
import { segmentBlocked } from './raycast';
import { isAliveMonster, isAlivePlayer } from './targets';
import { applyDamage } from './resolve';

export function radiusDamage(
  world: IWorld,
  x: number,
  y: number,
  radius: number,
  sourceId: number,
  sourceFaction: Faction,
  rng: Rng,
  events?: CombatBus,
): void {
  const level = world.level;
  const origin = { x, y };

  const victims: Entity[] = [];
  if (isAlivePlayer(world.player) && world.player.id !== sourceId) victims.push(world.player);
  for (const m of world.monsters) if (isAliveMonster(m) && m.id !== sourceId) victims.push(m);

  for (const e of victims) {
    const dist = Math.max(0, Math.hypot(e.x - x, e.y - y) - e.radius);
    if (dist >= radius) continue;
    if (level && segmentBlocked(level, x, y, e.x, e.y)) continue; // wall blocks the blast
    const dmg = Math.floor(radius - dist);
    if (dmg <= 0) continue;
    applyDamage(world, e, dmg, sourceId, sourceFaction, rng, events, origin);
  }
}
