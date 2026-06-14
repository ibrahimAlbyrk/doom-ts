// Weapon ordering + selection priority (doom-design.md §2). Pure helpers over the
// player inventory — no side effects, no combat. The WeaponSystem drives them.
import type { WeaponId, PlayerInventory } from '../core';
import { WEAPONS } from '../data';

/** Selection cycle (slot ascending; within a shared slot, base before upgrade). */
export const WEAPON_CYCLE: readonly WeaponId[] = [
  'fist',
  'chainsaw',
  'pistol',
  'shotgun',
  'superShotgun',
  'chaingun',
  'rocketLauncher',
  'plasmaRifle',
  'bfg9000',
];

/** DOOM P_CheckAmmo fallback order (best → worst) when the current weapon dries up. */
export const DRY_SWITCH_PRIORITY: readonly WeaponId[] = [
  'plasmaRifle',
  'superShotgun',
  'chaingun',
  'shotgun',
  'pistol',
  'chainsaw',
  'rocketLauncher',
  'bfg9000',
  'fist',
];

export function ownsWeapon(inv: PlayerInventory, weapon: WeaponId): boolean {
  return inv.weapons[weapon] === true;
}

/** Enough ammo in the pool for one shot (always true for the ammo-less melee weapons). */
export function hasAmmoFor(inv: PlayerInventory, weapon: WeaponId): boolean {
  const def = WEAPONS[weapon];
  if (def.ammo === null) return true;
  return inv.ammo[def.ammo] >= def.ammoPerShot;
}

/** Weapons sharing `slot`, base-first (e.g. slot 1 → [fist, chainsaw]). */
export function weaponsInSlot(slot: number): WeaponId[] {
  return WEAPON_CYCLE.filter((w) => WEAPONS[w].slot === slot);
}

/** Best owned, ammo-ready weapon to fall back to when the current one runs dry. */
export function bestDryWeapon(inv: PlayerInventory): WeaponId {
  for (const w of DRY_SWITCH_PRIORITY) {
    if (ownsWeapon(inv, w) && hasAmmoFor(inv, w)) return w;
  }
  return 'fist';
}
