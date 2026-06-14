// Monster AI driver — the generic state machine (idle→chase→melee/missile→pain→
// death→dead), parameterized per monster from ENEMIES, plus the infighting hookup
// (doom-design.md §3). Free functions over the World keep logic separate from data.
//
// Combat owns pain/death: applyDamage sets state to 'pain'/'death'/'gib' and emits
// on the CombatBus. This machine YIELDS to those states (plays them out) and reacts
// to the bus for infighting, rather than rolling pain/death itself.
import type { IWorld, Monster, Rng, Faction, MonsterType } from '../core';
import { STOP_SPEED } from '../core';
import { ENEMIES } from '../data';
import { stepMovement } from '../world';
import { CombatBus, isAliveMonster } from '../combat';
import { lookForTarget, noiseAlert } from './sight';
import { chaseThink } from './chase';
import { attackThink } from './attack';
import { wake } from './targeting';
import { DEATH_SETTLE_TICS, PAIN_TICS, RESPAWN_TICS, reactionTics, respawns, sameSpecies } from './tuning';

/** Advance every monster one fixed step (`tics` DOOM tics, may be fractional). */
export function updateMonsters(world: IWorld, rng: Rng, combat: CombatBus, tics = 1): void {
  for (const m of world.monsters) updateMonster(world, m, rng, combat, tics);
}

function updateMonster(world: IWorld, m: Monster, rng: Rng, combat: CombatBus, tics: number): void {
  if (!m.active) return;

  switch (m.state) {
    case 'dead':
      maybeRespawn(world, m, tics);
      return;

    case 'death':
    case 'gib':
      m.stateTimer += tics;
      integrateMomentum(world, m, tics); // let the corpse slide to rest
      if (m.stateTimer >= DEATH_SETTLE_TICS) {
        m.state = 'dead';
        m.stateTimer = 0; // restart the clock for the respawn delay
      }
      return;

    case 'pain':
      m.stateTimer += tics;
      integrateMomentum(world, m, tics); // knockback flinch
      if (m.stateTimer >= PAIN_TICS) {
        m.state = 'chase';
        m.stateTimer = 0;
      }
      return;

    case 'idle':
      if (lookForTarget(world, m)) {
        m.state = 'chase';
        m.stateTimer = 0;
        m.reactionTime = reactionTics(world.skill);
        emitSightSound(m, rng, combat); // monster just woke and saw the player
      }
      return;

    case 'chase':
      integrateMomentum(world, m, tics);
      chaseThink(world, m, rng, tics);
      if (rng.chance256(3)) emitActiveSound(m, combat); // occasional idle grunt (A_Chase)
      return;

    case 'melee':
    case 'missile':
      attackThink(world, m, rng, combat, tics);
      return;
  }
}

/** Play a random sight bark for `m` via the combat bus (forwarded to audio as 'sfx').
 *  No-op when the type has no sight sound or when no game bus is attached (tests). */
function emitSightSound(m: Monster, rng: Rng, combat: CombatBus): void {
  const sights = ENEMIES[m.type].sounds.sight;
  if (!sights || sights.length === 0) return;
  combat.emitGame('sfx', { sound: sights[rng.int(sights.length)]!, x: m.x, y: m.y });
}

/** Play the active/idle grunt for `m` while it hunts. No-op if the type has none. */
function emitActiveSound(m: Monster, combat: CombatBus): void {
  const active = ENEMIES[m.type].sounds.active;
  if (active) combat.emitGame('sfx', { sound: active, x: m.x, y: m.y });
}

/**
 * Nightmare respawn (doom-design §7): once a corpse has lain `RESPAWN_TICS` tics it
 * stands back up in place as a fresh idle monster (full health, no target), so the
 * map never empties. No-op on every skill whose respawn flag is unset — which is
 * what keeps death PERMANENT on skills 1–4.
 */
function maybeRespawn(world: IWorld, m: Monster, tics: number): void {
  if (!respawns(world.skill)) return;
  m.stateTimer += tics;
  if (m.stateTimer < RESPAWN_TICS) return;
  m.health = ENEMIES[m.type].health;
  m.state = 'idle';
  m.stateTimer = 0;
  m.reactionTime = 0; // set when it re-acquires a target
  m.target = null;
  m.velX = 0;
  m.velY = 0;
  m.flinchImmune = false;
}

/** Carry leftover momentum (e.g. combat knockback) and let friction settle it. */
function integrateMomentum(world: IWorld, m: Monster, tics: number): void {
  if (!world.level) return;
  if (Math.abs(m.velX) < STOP_SPEED && Math.abs(m.velY) < STOP_SPEED) return;
  stepMovement(m, world.level, tics);
}

/**
 * Infighting / retaliation. When `victim` is hurt: a player hit makes it chase the
 * player; a hit from a *different-species* monster makes it turn on that attacker
 * (doom-design.md §3). Same-species friendly fire is ignored.
 */
export function onDamagedBy(
  victim: Monster,
  attackerId: number,
  attackerFaction: Faction,
  attackerType: MonsterType | null,
  reaction?: number,
): void {
  if (!isAliveMonster(victim) || attackerId === victim.id) return;
  if (attackerFaction === 'player') {
    wake(victim, attackerId, reaction);
    return;
  }
  if (attackerFaction === 'monster' && attackerType && !sameSpecies(victim.type, attackerType)) {
    wake(victim, attackerId, reaction);
  }
}

/** Bundles the per-tick update with the combat-bus subscription that drives
 *  infighting. Integration constructs one per level and calls `update` each tic. */
export interface MonsterAI {
  /** Advance all monsters by `tics` DOOM tics (default 1). */
  update(tics?: number): void;
  /** Wake idle monsters that can hear a noise at (x,y) — call when the player fires. */
  noise(x: number, y: number, makerId?: number): number;
  /** Unsubscribe from the combat bus (call at level teardown). */
  dispose(): void;
}

export function createMonsterAI(world: IWorld, rng: Rng, combat: CombatBus): MonsterAI {
  const unsubscribe = combat.on('entity:damaged', (e) => {
    if (e.targetFaction !== 'monster') return;
    const victim = world.monsters.find((m) => m.id === e.targetId);
    if (!victim) return;
    const attacker = world.monsters.find((m) => m.id === e.sourceId);
    onDamagedBy(victim, e.sourceId, e.sourceFaction, attacker ? attacker.type : null, reactionTics(world.skill));
  });

  return {
    update: (tics = 1) => updateMonsters(world, rng, combat, tics),
    noise: (x, y, makerId = world.player.id) => noiseAlert(world, x, y, makerId),
    dispose: unsubscribe,
  };
}
