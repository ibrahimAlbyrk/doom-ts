// Pickup resolution — STUB. Player-vs-pickup overlap test, then apply the ItemDef
// effect (health/armor/ammo/weapon/powerup/key/backpack) with caps + skill ammo
// multiplier (doom-design.md §4, §5).
import type { IWorld, ItemDef, SkillId } from '../core';

/** Test player overlap with each active pickup; collect + remove on touch. */
export function checkPickups(_world: IWorld, _skill: SkillId): void {
  throw new Error('NotImplemented: checkPickups');
}

/** Apply one item's effect to the player. Returns false if it cannot be picked up. */
export function applyItem(_world: IWorld, _def: ItemDef, _skill: SkillId): boolean {
  throw new Error('NotImplemented: applyItem (doom-design §5)');
}
