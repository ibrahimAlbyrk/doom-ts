// AI tuning — the per-monster cadence/timing numbers the DOOM state machine bakes
// into each actor's state-table tic counts. EnemyDef (src/data, frozen) carries
// stats + attack damage but NOT attack-state durations, so the canonical tic
// counts live here (doom-design.md §3 "attack cooldown baked into state durations").
import type { EnemyDef, Monster, MonsterType, SkillId } from '../core';
import { SKILLS } from '../data';

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

/** Refire cadence shortening under fast-monsters (~45% quicker re-attacks), floored
 *  so the attack stays readable (expert: never below 0.5×). */
const FAST_ATTACK_CADENCE = 0.55;

export function attackTics(type: MonsterType, skill: SkillId): number {
  const base = ATTACK_TICS[type];
  return fastMonsters(skill) ? base * FAST_ATTACK_CADENCE : base;
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
/**
 * Sound-flood reach in grid cells, per skill (1..5). A shot wakes the room you're
 * standing in plus the edge of one adjacent room through a doorway — NOT the whole
 * level. The radius cap is the grid approximation of DOOM's unbounded-until-
 * soundblock propagation (doom-design §9.7); walls + CLOSED doors still block the
 * flood (the designer's "fight one room at a time" tool). Monotonic by skill:
 * easier = smaller reach, Nightmare largest. Expert-tuned.
 */
const SOUND_TRAVEL_BY_SKILL: Record<SkillId, number> = { 1: 6, 2: 7, 3: 9, 4: 11, 5: 13 };

export function soundTravelCells(skill: SkillId): number {
  return SOUND_TRAVEL_BY_SKILL[skill];
}

/**
 * Sight→first-attack delay (tics) per skill. Baseline 8; easier skills give the
 * player more grace before the first shot, Nightmare reacts fast (floor 4 — never
 * an instant turret). Expert-tuned, monotonic.
 */
const REACTION_BY_SKILL: Record<SkillId, number> = { 1: 12, 2: 10, 3: 8, 4: 7, 5: 4 };

export function reactionTics(skill: SkillId): number {
  return REACTION_BY_SKILL[skill];
}

// ── Nightmare fast-monsters + respawn (gated on the skill flags; doom-design §7) ──

/** True on skills whose fastMonsters flag is set (Nightmare). */
export function fastMonsters(skill: SkillId): boolean {
  return SKILLS[skill].fastMonsters;
}

/** True on skills whose respawn flag is set (Nightmare). */
export function respawns(skill: SkillId): boolean {
  return SKILLS[skill].respawn;
}

/** Projectile speed under fast-monsters: ~2×, capped at 20 mu/tic so bruiser shots
 *  stay dodgeable on the grid (imp/caco 10→20, baron/knight 15→20; doom-design §7). */
const FAST_PROJECTILE_CAP = 20;

export function projectileSpeed(base: number, skill: SkillId): number {
  return fastMonsters(skill) ? Math.min(base * 2, FAST_PROJECTILE_CAP) : base;
}

/** Move-speed multiplier under fast-monsters. Only the melee closers (demon/spectre)
 *  speed up; a global 2× chase is chaotic on a grid (expert guidance). */
export function moveSpeedMul(type: MonsterType, skill: SkillId): number {
  if (!fastMonsters(skill)) return 1;
  return type === 'demon' || type === 'spectre' ? 2 : 1;
}

/** Nightmare respawn delay in tics, counted from when the corpse settles (death
 *  animation complete). ~12 s at 35 tics/s = 420 (doom-design §7 telefrag-respawn). */
export const RESPAWN_TICS = 420;
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
