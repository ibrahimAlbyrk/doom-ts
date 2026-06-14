// Inventory mutations + powerup timers — STUB. Ammo/health/armor adds with caps,
// weapon grants, backpack max-doubling, and per-tic powerup countdown
// (doom-design.md §1, §4, §5).
import type { Player, AmmoType, WeaponId, PowerupKind } from '../core';

/** Add ammo, clamped to the player's current max. Returns amount actually added. */
export function addAmmo(_player: Player, _type: AmmoType, _amount: number): number {
  throw new Error('NotImplemented: addAmmo');
}

/** Grant a weapon (and its first-pickup ammo). Returns true if it was new. */
export function giveWeapon(_player: Player, _weapon: WeaponId): boolean {
  throw new Error('NotImplemented: giveWeapon');
}

/** Add health, clamped to `cap`. Returns true if any was applied. */
export function addHealth(_player: Player, _amount: number, _cap: number): boolean {
  throw new Error('NotImplemented: addHealth');
}

/** Start a powerup for its duration (doom-design §5). */
export function startPowerup(_player: Player, _kind: PowerupKind): void {
  throw new Error('NotImplemented: startPowerup');
}

/** Count down active powerup timers one tick; emit expiry as they end. */
export function updatePowerups(_player: Player, _dt: number): void {
  throw new Error('NotImplemented: updatePowerups');
}
