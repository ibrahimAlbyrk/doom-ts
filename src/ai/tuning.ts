// AI tuning — the per-monster cadence/timing numbers the DOOM state machine bakes
// into each actor's state-table tic counts. EnemyDef (src/data, frozen) carries
// stats + attack damage but NOT attack-state durations, so the canonical tic
// counts live here (doom-design.md §3 "attack cooldown baked into state durations").
import type { EnemyDef, Monster, MonsterType } from '../core';

/** Tics a monster sits in its attack state (fires once, then back to chase).
 *  This IS the refire cadence — derived from each actor's S_*_ATK frame tics. */
const ATTACK_TICS: Record<MonsterType, number> = {
  zombieman: 26,
  shotgunGuy: 30,
  imp: 20,
  demon: 16,
  spectre: 16,
  lostSoul: 12, // charge recovery before it can lunge again
  cacodemon: 18,
  baron: 24,
  hellKnight: 24,
  cyberdemon: 24,
  spiderMastermind: 8, // rapid chaingun
};

export function attackTics(type: MonsterType): number {
  return ATTACK_TICS[type];
}

/** Brief flinch length (doom-design §3 "interrupts current action ~6 tics"). */
export const PAIN_TICS = 6;
/** Tics the death animation plays before the body becomes an inert corpse. */
export const DEATH_SETTLE_TICS = 20;
/** Re-pick the 8-way chase direction every N tics (DOOM movecount, randomized). */
export const MOVE_RESELECT_MIN = 8;
export const MOVE_RESELECT_MAX = 16;
/** Max tics a Lost Soul stays in its charge before giving up. */
export const CHARGE_MAX_TICS = 20;
/** Sound-flood reach in grid cells (~2048 mu at 64 mu/cell ≈ MISSILERANGE). */
export const SOUND_TRAVEL_CELLS = 32;
/** Distance (mu) a monster will open fire from — DOOM MISSILERANGE. */
export const MISSILE_RANGE = 2048;
/** Horizontal spread for monster hitscan: `(P_Random-P_Random) << 20` (A_PosAttack). */
export const MONSTER_SPREAD_SHIFT = 20;

/** Has a melee swing available (demon/spectre, plus the imp/caco/baron scratch). */
export function hasMelee(def: EnemyDef): boolean {
  return def.attack.melee !== undefined;
}

/** Fires a standing ranged attack (hitscan trooper or projectile caster). */
export function hasRanged(def: EnemyDef): boolean {
  return def.attack.kind === 'hitscan' || def.attack.kind === 'projectile';
}

// Infighting species grouping. DOOM suppresses retaliation between the same
// species; Demon and Spectre are the same actor family, so they're grouped here
// (doom-design §3 "not its own species, with a few exceptions").
const SPECIES_GROUP: Partial<Record<MonsterType, string>> = {
  demon: 'pinky',
  spectre: 'pinky',
};

function speciesOf(type: MonsterType): string {
  return SPECIES_GROUP[type] ?? type;
}

export function sameSpecies(a: MonsterType, b: MonsterType): boolean {
  return speciesOf(a) === speciesOf(b);
}

// Per-monster scratch the state machine needs but the frozen Monster struct does
// not carry: the current 8-way move direction + its countdown, and a Lost Soul's
// locked charge heading. Keyed by the Monster object (no id collisions across worlds).
export interface ChaseMemo {
  moveDir: number; // radians
  moveCount: number; // tics until the direction is re-picked
  chargeDir: number; // radians (Lost Soul skullfly heading)
}

const memos = new WeakMap<Monster, ChaseMemo>();

export function memoOf(m: Monster): ChaseMemo {
  let memo = memos.get(m);
  if (!memo) {
    memo = { moveDir: 0, moveCount: 0, chargeDir: 0 };
    memos.set(m, memo);
  }
  return memo;
}
