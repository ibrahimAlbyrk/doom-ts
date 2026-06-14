// Projectile spawning + per-tic movement and impact. Projectiles fly straight at
// `speed` mu/tic, sub-stepped so they can't tunnel through a thin wall, and detonate
// on the first wall or non-owner body they touch — applying direct damage to a hit
// entity and splash (with LOS) if they carry a splashRadius (doom-design.md §2).
import type { IWorld, Entity, Projectile, Faction, Rng } from '../core';
import { CELL_SIZE, rollDamage } from '../core';
import { spawnProjectile, type ProjectileSpec } from '../entities';
import { CombatBus } from './events';
import { cellOf } from './raycast';
import { isAliveMonster, isAlivePlayer } from './targets';
import { applyDamage } from './resolve';
import { radiusDamage } from './splash';

// Gap added to the owner's radius when spawning, so a projectile clears its
// shooter's body instead of detonating on it the first tic.
const PROJECTILE_SPAWN_GAP = 8; // mu

/** Spawn a projectile just in front of `owner`, travelling along `angle`. */
export function fireProjectile(
  world: IWorld,
  owner: Entity,
  ownerFaction: Faction,
  angle: number,
  spec: ProjectileSpec,
): Projectile {
  const offset = owner.radius + PROJECTILE_SPAWN_GAP;
  const x = owner.x + Math.cos(angle) * offset;
  const y = owner.y + Math.sin(angle) * offset;
  return spawnProjectile(world, owner.id, ownerFaction, x, y, angle, spec);
}

/** Advance every projectile over `tics` tics, resolving impacts. */
export function updateProjectiles(world: IWorld, rng: Rng, events?: CombatBus, tics = 1): void {
  const dirX = (p: Projectile) => Math.cos(p.angle);
  const dirY = (p: Projectile) => Math.sin(p.angle);

  for (const p of [...world.projectiles]) {
    if (!p.active) continue;
    let remaining = p.speed * tics;
    const maxStep = Math.max(1, Math.min(p.radius, CELL_SIZE / 4));
    const dx = dirX(p);
    const dy = dirY(p);

    let impacted = false;
    while (remaining > 0 && !impacted) {
      const step = Math.min(maxStep, remaining);
      p.x += dx * step;
      p.y += dy * step;
      remaining -= step;

      const target = projectileHitTarget(world, p);
      if (target) {
        resolveImpact(world, p, target, rng, events);
        impacted = true;
      } else if (world.level && world.level.isSolid(cellOf(p.x), cellOf(p.y))) {
        resolveImpact(world, p, null, rng, events);
        impacted = true;
      }
    }
  }
}

/** Nearest live entity (other than the owner) whose body the projectile overlaps. */
function projectileHitTarget(world: IWorld, p: Projectile): Entity | null {
  let best: Entity | null = null;
  let bestDistSq = Infinity;
  const consider = (e: Entity): void => {
    if (e.id === p.ownerId) return;
    const reach = p.radius + e.radius;
    const distSq = (e.x - p.x) ** 2 + (e.y - p.y) ** 2;
    if (distSq <= reach * reach && distSq < bestDistSq) {
      bestDistSq = distSq;
      best = e;
    }
  };
  for (const player of world.players.values()) if (isAlivePlayer(player)) consider(player);
  for (const m of world.monsters) if (isAliveMonster(m)) consider(m);
  return best;
}

function resolveImpact(
  world: IWorld,
  p: Projectile,
  target: Entity | null,
  rng: Rng,
  events?: CombatBus,
): void {
  if (target) {
    const direct = rollDamage(rng, p.damage.n, p.damage.m);
    applyDamage(world, target, direct, p.ownerId, p.ownerFaction, rng, events, { x: p.x, y: p.y });
  }
  if (p.splashRadius > 0) {
    radiusDamage(world, p.x, p.y, p.splashRadius, p.ownerId, p.ownerFaction, rng, events);
  }
  events?.emit('projectile:impact', {
    projectileId: p.id,
    x: p.x,
    y: p.y,
    targetId: target ? target.id : null,
    splashRadius: p.splashRadius,
  });
  world.removeProjectile(p.id);
}
