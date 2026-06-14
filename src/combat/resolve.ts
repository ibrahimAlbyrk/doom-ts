// Damage resolution — the single choke point all attacks route through. Handles
// the armor split (green 1/3, blue 1/2), knockback thrust, monster pain-chance,
// and death, and broadcasts the combat + frozen events (doom-design.md §3, §5).
import type { IWorld, Entity, Monster, Player, Faction, Rng } from '../core';
import { PLAYER_MASS, KNOCKBACK_SCALE } from '../core';
import { ENEMIES, SKILLS } from '../data';
import { CombatBus } from './events';
import { isPlayer, entityPos } from './targets';

/** Where the hit came from, for knockback direction (defaults to the source's
 *  current position — splash passes the explosion centre instead). */
export interface DamageOrigin {
  x: number;
  y: number;
}

/**
 * Apply `amount` damage to `target` from a source. Routes through armor (player),
 * applies knockback, rolls pain (monsters), and resolves death. `origin` overrides
 * the knockback source position (used by splash). Safe to call on dead/inactive
 * targets (no-op).
 */
export function applyDamage(
  world: IWorld,
  target: Entity,
  amount: number,
  sourceId: number,
  sourceFaction: Faction,
  rng: Rng,
  events?: CombatBus,
  origin?: DamageOrigin,
): void {
  if (amount <= 0 || !target.active) return;
  if (isPlayer(world, target)) {
    applyPlayerDamage(world, world.player, amount, sourceId, sourceFaction, events, origin);
  } else {
    applyMonsterDamage(world, target as Monster, amount, sourceId, sourceFaction, rng, events, origin);
  }
}

function applyPlayerDamage(
  world: IWorld,
  player: Player,
  amount: number,
  sourceId: number,
  sourceFaction: Faction,
  events: CombatBus | undefined,
  origin: DamageOrigin | undefined,
): void {
  if (player.health <= 0) return;
  // Invulnerability blocks all damage (doom-design §5).
  const invuln = player.powerups.invulnerability;
  if (invuln !== undefined && invuln !== 0) return;

  // Skill scaling: ITYTD (skill 1) halves the damage the player takes; every other
  // skill is 1.0. Mirrors DOOM P_DamageMobj's `if (gameskill == sk_baby) damage >>= 1`.
  const factor = SKILLS[world.skill].damageTaken;
  if (factor !== 1) amount = Math.floor(amount * factor);
  if (amount <= 0) return;

  let toHealth = amount;
  const armor = player.armor;
  if (armor.points > 0 && armor.factor > 0) {
    let saved = Math.floor(amount * armor.factor);
    if (saved > armor.points) saved = armor.points;
    armor.points -= saved;
    if (armor.points === 0) armor.factor = 0;
    toHealth -= saved;
  }

  player.health -= toHealth;
  applyKnockback(world, player, PLAYER_MASS, amount, sourceId, origin);

  events?.emit('entity:damaged', {
    targetId: player.id,
    targetFaction: 'player',
    monsterType: null,
    amount: toHealth,
    sourceId,
    sourceFaction,
    remainingHealth: player.health,
  });
  events?.emitGame('player:damaged', { amount: toHealth, sourceFaction, remainingHealth: player.health });
  events?.emitGame('player:healthChanged', { health: player.health });

  if (player.health <= 0) {
    events?.emit('entity:death', {
      id: player.id,
      faction: 'player',
      monsterType: null,
      sourceId,
      sourceFaction,
      gibbed: false,
    });
    events?.emitGame('player:died', {});
  }
}

function applyMonsterDamage(
  world: IWorld,
  monster: Monster,
  amount: number,
  sourceId: number,
  sourceFaction: Faction,
  rng: Rng,
  events: CombatBus | undefined,
  origin: DamageOrigin | undefined,
): void {
  if (monster.health <= 0) return;
  const def = ENEMIES[monster.type];

  monster.health -= amount;
  applyKnockback(world, monster, def.mass, amount, sourceId, origin);

  events?.emit('entity:damaged', {
    targetId: monster.id,
    targetFaction: 'monster',
    monsterType: monster.type,
    amount,
    sourceId,
    sourceFaction,
    remainingHealth: monster.health,
  });

  if (monster.health <= 0) {
    const gibbed = monster.health < -def.health;
    monster.state = gibbed ? 'gib' : 'death';
    monster.stateTimer = 0;
    monster.target = null;
    events?.emit('entity:death', {
      id: monster.id,
      faction: 'monster',
      monsterType: monster.type,
      sourceId,
      sourceFaction,
      gibbed,
    });
    events?.emitGame('monster:died', { id: monster.id, type: monster.type });
    return;
  }

  // Pain: flinch if the pain-chance roll passes (lost soul mid-charge is immune).
  if (!monster.flinchImmune && rng.chance256(def.painChance)) {
    monster.state = 'pain';
    monster.stateTimer = 0;
    events?.emit('entity:pain', {
      id: monster.id,
      faction: 'monster',
      monsterType: monster.type,
      sourceId,
    });
  }
}

/** Thrust the body away from the hit: |v| ≈ damage * 12.5 / mass mu/tic (§3). */
function applyKnockback(
  world: IWorld,
  body: Player | Monster,
  mass: number,
  amount: number,
  sourceId: number,
  origin: DamageOrigin | undefined,
): void {
  if (mass <= 0) return;
  const from = origin ?? entityPos(world, sourceId);
  if (!from) return;
  const dx = body.x - from.x;
  const dy = body.y - from.y;
  const dist = Math.hypot(dx, dy);
  if (dist < 1e-4) return;
  const mag = (amount * KNOCKBACK_SCALE) / mass;
  body.velX += (dx / dist) * mag;
  body.velY += (dy / dist) * mag;
}
