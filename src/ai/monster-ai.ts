// Monster AI — STUB. The generic state machine (idle→chase→melee/missile→pain→death)
// parameterized per monster from ENEMIES, plus sight/sound wakeups and infighting
// (doom-design.md §3). Free functions over the World (logic separate from data).
import type { IWorld, Monster, Rng } from '../core';

/** Advance every monster one fixed tick. */
export function updateMonsters(_world: IWorld, _dt: number, _rng: Rng): void {
  throw new Error('NotImplemented: updateMonsters (doom-design §3 AI)');
}

/** A_Look: acquire the player if within the 180° front cone + LOS, or on noise. */
export function lookForTarget(_world: IWorld, _m: Monster): boolean {
  throw new Error('NotImplemented: lookForTarget');
}

/** Re-target on friendly fire from another species (doom-design §3 infighting). */
export function onDamagedBy(_m: Monster, _attackerId: number, _attackerIsMonster: boolean): void {
  throw new Error('NotImplemented: onDamagedBy (infighting)');
}
