// Weapon system — STUB. Owns the player's current/pending weapon, fire cooldown,
// ammo spend, and dispatch into src/combat by WeaponDef.attack (doom-design.md §2).
// View-model raise/lower/fire animation state lives here; rendering is src/render.
import type { IWorld, WeaponId, Rng } from '../core';

/** Try to fire the current weapon this tick (respects cooldown + ammo). */
export function fireWeapon(_world: IWorld, _rng: Rng): boolean {
  throw new Error('NotImplemented: fireWeapon (doom-design §2)');
}

/** Begin switching to `weapon` (lower current, raise new). */
export function selectWeapon(_world: IWorld, _weapon: WeaponId): void {
  throw new Error('NotImplemented: selectWeapon');
}

/** Advance weapon cooldown / switch animation one tick. */
export function updateWeapon(_world: IWorld, _dt: number): void {
  throw new Error('NotImplemented: updateWeapon');
}
