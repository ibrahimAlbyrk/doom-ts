// Inventory + powerup-timer mutations for the pickup system (doom-design.md §5).
// Health/armor adds honour DOOM's caps; powerup timers count down each tic and
// emit their expiry. Ammo/weapon/backpack grants route through WeaponSystem
// (src/weapons) — see pickups.ts — so auto-switch + max-doubling live in one place.
import type { Player, PowerupKind, EventBus, GameEventMap } from '../core';
import { ARMOR_BLUE_CAP, ARMOR_GREEN_FACTOR } from '../core';
import { POWERUPS } from '../data';

/** Berserk heals to (but never above) the soft cap — DOOM P_GiveBody(100). */
const BERSERK_HEAL_CAP = 100;

/** Add health, clamped to `cap`. Returns true if any was applied. */
export function addHealth(player: Player, amount: number, cap: number): boolean {
  if (player.health >= cap) return false;
  player.health = Math.min(cap, player.health + amount);
  return true;
}

/** Armor "+N bonus" (helmet): additive up to 200, defaulting to green absorption
 *  when the player has no armor. Always succeeds (caps silently, DOOM SPR_BON2). */
export function addArmorBonus(player: Player, amount: number): void {
  const armor = player.armor;
  armor.points = Math.min(ARMOR_BLUE_CAP, armor.points + amount);
  if (armor.factor === 0) armor.factor = ARMOR_GREEN_FACTOR;
}

/** Green/blue armor "set to tier": only upgrades when it would raise points, so a
 *  lesser suit over a greater one is ignored (DOOM P_GiveArmor). */
export function giveArmor(player: Player, points: number, factor: number): boolean {
  const armor = player.armor;
  if (armor.points >= points) return false;
  armor.points = points;
  armor.factor = factor;
  return true;
}

/** Start (or refresh) a powerup; durations come from POWERUPS (-1 = rest of level).
 *  Berserk also heals to the soft cap and enables the fist berserk-damage flag the
 *  weapon system reads (player.powerups.berserk). */
export function startPowerup(player: Player, kind: PowerupKind, events?: EventBus<GameEventMap>): void {
  player.powerups[kind] = POWERUPS[kind].durationTics;
  if (kind === 'berserk') addHealth(player, BERSERK_HEAL_CAP, BERSERK_HEAL_CAP);
  events?.emit('powerup:started', { kind });
}

/** Count active powerup timers down by `tics`; expire (and emit) those that hit 0.
 *  Level-permanent powerups (duration -1: berserk, computer map) never expire. */
export function updatePowerups(player: Player, tics = 1, events?: EventBus<GameEventMap>): void {
  for (const kind of Object.keys(player.powerups) as PowerupKind[]) {
    const remaining = player.powerups[kind];
    if (remaining === undefined || remaining < 0) continue;
    const next = remaining - tics;
    if (next <= 0) {
      delete player.powerups[kind];
      events?.emit('powerup:expired', { kind });
    } else {
      player.powerups[kind] = next;
    }
  }
}
