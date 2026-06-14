// Combat resolution — STUB. All combat is on the 2D plane (DOOM-style autoaim
// degenerates to "first thing along the 2D ray"; no player pitch). Covers hitscan
// with spread, projectile spawning, radius/splash with 2D line-of-sight, the armor
// damage split, pain-chance/knockback, and infighting hooks (doom-design.md §2, §3).
import type { IWorld, Entity, Faction, DamageRoll, Rng } from '../core';

/** Apply `amount` damage to a target, routing through armor + pain-chance. */
export function applyDamage(
  _world: IWorld,
  _target: Entity,
  _amount: number,
  _sourceId: number,
  _sourceFaction: Faction,
  _rng: Rng,
): void {
  throw new Error('NotImplemented: applyDamage (doom-design §3, §5 armor split)');
}

/** Fire a hitscan ray from origin along angle: autoaim target, roll damage, apply. */
export function hitscan(
  _world: IWorld,
  _x: number,
  _y: number,
  _angle: number,
  _rangeMu: number,
  _damage: DamageRoll,
  _spreadShift: number,
  _sourceId: number,
  _sourceFaction: Faction,
  _rng: Rng,
): void {
  throw new Error('NotImplemented: hitscan (doom-design §2 spread/autoaim)');
}

/** Radius attack: damage = radius − distance, to anything in range with 2D LOS. */
export function radiusDamage(
  _world: IWorld,
  _x: number,
  _y: number,
  _radius: number,
  _sourceId: number,
  _sourceFaction: Faction,
  _rng: Rng,
): void {
  throw new Error('NotImplemented: radiusDamage (doom-design §2 P_RadiusAttack)');
}

/** Pick the first entity along a 2D ray (the grid-raycaster autoaim, doom-design §9). */
export function autoaimTarget(_world: IWorld, _x: number, _y: number, _angle: number, _rangeMu: number): Entity | null {
  throw new Error('NotImplemented: autoaimTarget');
}
