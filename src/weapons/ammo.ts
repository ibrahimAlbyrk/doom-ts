// Ammo pool bookkeeping (doom-design.md §4). Pure mutations on the player
// inventory: consume per shot, grant pickups clamped to max, backpack doubling.
import type { WeaponId, AmmoType, PlayerInventory } from '../core';
import { WEAPONS, AMMO } from '../data';

const AMMO_TYPES = Object.keys(AMMO) as AmmoType[];

/** Spend one shot's worth of the weapon's ammo (no-op for fist/chainsaw). */
export function consumeAmmo(inv: PlayerInventory, weapon: WeaponId): void {
  const def = WEAPONS[weapon];
  if (def.ammo === null) return;
  inv.ammo[def.ammo] = Math.max(0, inv.ammo[def.ammo] - def.ammoPerShot);
}

/** Add `amount` of `type`, clamped to the active max. Returns the amount actually added. */
export function addAmmo(inv: PlayerInventory, type: AmmoType, amount: number): number {
  const before = inv.ammo[type];
  const after = Math.min(inv.ammoMax[type], before + amount);
  inv.ammo[type] = after;
  return after - before;
}

/** Backpack: first grab doubles every max; always grants one small pickup of each
 *  ammo type. Returns true if this was the first backpack (the max-raising one). */
export function giveBackpack(inv: PlayerInventory): boolean {
  const firstTime = !inv.backpack;
  if (firstTime) {
    inv.backpack = true;
    for (const t of AMMO_TYPES) inv.ammoMax[t] = AMMO[t].backpackMax;
  }
  for (const t of AMMO_TYPES) addAmmo(inv, t, AMMO[t].smallPickup);
  return firstTime;
}
