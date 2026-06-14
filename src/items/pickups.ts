// Pickup resolution (doom-design.md §5). Each tic the game loop calls updateItems:
// test the player against every active pickup, apply the touched item's effect, and
// remove it (our skills don't respawn items), then advance powerup timers. Ammo /
// weapon / backpack grants route through the injected WeaponSystem so auto-switch +
// backpack max-doubling stay in one place (DIP — items needn't know the class).
import type {
  IWorld,
  ItemDef,
  SkillId,
  WeaponId,
  AmmoType,
  Pickup,
  Player,
  EventBus,
  GameEventMap,
} from '../core';
import { HEALTH_SOFT_CAP, HEALTH_HARD_CAP, ARMOR_GREEN_FACTOR, ARMOR_BLUE_FACTOR } from '../core';
import { ITEMS_BY_ID, SKILLS } from '../data';
import { addHealth, addArmorBonus, giveArmor, startPowerup, updatePowerups } from './inventory';

/** The slice of WeaponSystem the pickup system drives; WeaponSystem satisfies it
 *  structurally, so items depends on this abstraction, not the concrete class. */
export interface ItemGiver {
  giveWeapon(weapon: WeaponId, autoSwitch?: boolean): boolean;
  giveAmmo(type: AmmoType, amount: number): number;
  giveBackpack(): boolean;
}

/** Everything the pickup system needs threaded in from the game loop each tic. */
export interface PickupContext {
  world: IWorld;
  weapons: ItemGiver;
  skill: SkillId;
  events?: EventBus<GameEventMap>;
}

/** Per-tic items update the game loop calls: collect overlapping pickups per player,
 *  then advance every player's powerup timers by the `tics` elapsed this step. */
export function updateItems(ctx: PickupContext, tics = 1): void {
  checkPickups(ctx);
  for (const player of ctx.world.players.values()) updatePowerups(player, tics, ctx.events);
}

/** Test every player against each active pickup; the touching player collects it,
 *  the effect applies to THAT player, and it is removed (pickups are per-player). */
export function checkPickups(ctx: PickupContext): void {
  const { world } = ctx;
  for (const player of world.players.values()) {
    if (!player.active) continue;
    // Back-to-front: removePickup swap-pops, so lower indices stay valid mid-loop.
    for (let i = world.pickups.length - 1; i >= 0; i--) {
      const pickup = world.pickups[i];
      if (!pickup || !pickup.active || !touches(player, pickup)) continue;
      const def = ITEMS_BY_ID.get(pickup.thingId);
      if (!def) continue;
      if (applyItem(ctx, def, player)) {
        ctx.events?.emit('pickup:collected', { thingId: pickup.thingId });
        world.removePickup(pickup.id);
      }
    }
  }
}

/** DOOM box-overlap: touch when |dx| and |dy| are both within the combined radii. */
function touches(player: Player, pickup: Pickup): boolean {
  const block = player.radius + pickup.radius;
  return Math.abs(player.x - pickup.x) < block && Math.abs(player.y - pickup.y) < block;
}

/** Apply one item's effect to `player`. Returns false when the item must stay in the
 *  world (full-health stimpack/medikit, armor that wouldn't upgrade, ammo already
 *  maxed). Direct effects (health/armor/keys/powerups) land on the touching player;
 *  ammo/weapon/backpack route through the injected WeaponSystem (P1: the local
 *  player's — per-player weapon systems land with the authoritative server, P2). */
export function applyItem(ctx: PickupContext, def: ItemDef, player: Player): boolean {
  switch (def.kind) {
    case 'health':
      return applyHealth(player, def);
    case 'armor':
      return applyArmor(player, def);
    case 'ammo':
      return applyAmmo(ctx, def);
    case 'weapon':
      return applyWeapon(ctx, def);
    case 'backpack':
      ctx.weapons.giveBackpack();
      return true;
    case 'key':
      return applyKey(ctx, def, player);
    case 'powerup':
      return applyPowerup(ctx, def, player);
  }
}

function applyHealth(player: Player, def: ItemDef): boolean {
  const cap = def.healthCap ?? HEALTH_HARD_CAP;
  const healed = addHealth(player, def.health ?? 0, cap);
  // Megasphere bundles blue armor (set unconditionally; consumption is driven by health).
  if (def.armorPoints !== undefined) giveArmor(player, def.armorPoints, def.armorFactor ?? ARMOR_BLUE_FACTOR);
  // Spheres/bonuses (hard cap) are always taken; stimpack/medikit (soft cap) only when they heal.
  return cap > HEALTH_SOFT_CAP || healed;
}

function applyArmor(player: Player, def: ItemDef): boolean {
  // Armor bonus (helmet) is the only additive armor; green/blue armor set a tier.
  if (def.id === 'armorBonus') {
    addArmorBonus(player, def.armorPoints ?? 1);
    return true;
  }
  return giveArmor(player, def.armorPoints ?? 0, def.armorFactor ?? ARMOR_GREEN_FACTOR);
}

function applyAmmo(ctx: PickupContext, def: ItemDef): boolean {
  if (def.ammoType === undefined || def.ammoAmount === undefined) return false;
  const amount = def.ammoAmount * SKILLS[ctx.skill].ammoMultiplier;
  return ctx.weapons.giveAmmo(def.ammoType, amount) > 0;
}

function applyWeapon(ctx: PickupContext, def: ItemDef): boolean {
  if (def.weapon === undefined) return false;
  ctx.weapons.giveWeapon(def.weapon); // grants first-pickup ammo, emits weapon:pickedUp, auto-switches
  return true;
}

function applyKey(ctx: PickupContext, def: ItemDef, player: Player): boolean {
  if (def.keyColor === undefined || def.keyForm === undefined) return false;
  player.inventory.keys[def.keyColor][def.keyForm] = true;
  ctx.events?.emit('key:collected', { color: def.keyColor });
  return true;
}

function applyPowerup(ctx: PickupContext, def: ItemDef, player: Player): boolean {
  if (def.powerup === undefined) return false;
  startPowerup(player, def.powerup, ctx.events);
  return true;
}
