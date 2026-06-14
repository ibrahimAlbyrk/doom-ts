// Monster AI driver — the generic state machine (idle→chase→melee/missile→pain→
// death→dead), parameterized per monster from ENEMIES, plus the infighting hookup
// (doom-design.md §3). Free functions over the World keep logic separate from data.
//
// Combat owns pain/death: applyDamage sets state to 'pain'/'death'/'gib' and emits
// on the CombatBus. This machine YIELDS to those states (plays them out) and reacts
// to the bus for infighting, rather than rolling pain/death itself.
import type { IWorld, Monster, Rng, Faction, MonsterType } from '../core';
import { REACTION_TICS, STOP_SPEED } from '../core';
import { stepMovement } from '../world';
import { CombatBus, isAliveMonster } from '../combat';
import { lookForTarget, noiseAlert } from './sight';
import { chaseThink } from './chase';
import { attackThink } from './attack';
import { wake } from './targeting';
import { DEATH_SETTLE_TICS, PAIN_TICS, sameSpecies } from './tuning';

/** Advance every monster one fixed step (`tics` DOOM tics, may be fractional). */
export function updateMonsters(world: IWorld, rng: Rng, combat: CombatBus, tics = 1): void {
  for (const m of world.monsters) updateMonster(world, m, rng, combat, tics);
}

function updateMonster(world: IWorld, m: Monster, rng: Rng, combat: CombatBus, tics: number): void {
  if (!m.active) return;

  switch (m.state) {
    case 'dead':
      return;

    case 'death':
    case 'gib':
      m.stateTimer += tics;
      integrateMomentum(world, m, tics); // let the corpse slide to rest
      if (m.stateTimer >= DEATH_SETTLE_TICS) m.state = 'dead';
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
        m.reactionTime = REACTION_TICS;
      }
      return;

    case 'chase':
      integrateMomentum(world, m, tics);
      chaseThink(world, m, rng, tics);
      return;

    case 'melee':
    case 'missile':
      attackThink(world, m, rng, combat, tics);
      return;
  }
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
): void {
  if (!isAliveMonster(victim) || attackerId === victim.id) return;
  if (attackerFaction === 'player') {
    wake(victim, attackerId);
    return;
  }
  if (attackerFaction === 'monster' && attackerType && !sameSpecies(victim.type, attackerType)) {
    wake(victim, attackerId);
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
    onDamagedBy(victim, e.sourceId, e.sourceFaction, attacker ? attacker.type : null);
  });

  return {
    update: (tics = 1) => updateMonsters(world, rng, combat, tics),
    noise: (x, y, makerId = world.player.id) => noiseAlert(world, x, y, makerId),
    dispose: unsubscribe,
  };
}
