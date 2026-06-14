// Shared target predicates used by hitscan, splash, and projectile resolution.
// Faction is implied by which World collection an entity lives in: an entity in
// world.players is 'player', everything in world.monsters is 'monster' (the Entity
// struct carries no faction field — frozen contract).
import type { IWorld, Entity, Monster, Player, Faction, MonsterType } from '../core';

/** A monster is a live combatant until its health hits 0 / it enters a death state. */
export function isAliveMonster(m: Monster): boolean {
  return m.active && m.health > 0 && m.state !== 'death' && m.state !== 'gib' && m.state !== 'dead';
}

export function isAlivePlayer(p: Player): boolean {
  return p.active && p.health > 0;
}

/** Identity check against the players map: true iff `e` is one of the registered
 *  players (object identity, so it is safe even if ids ever overlap collections). */
export function isPlayer(world: IWorld, e: Entity): e is Player {
  return world.players.get(e.id) === e;
}

export function factionOf(world: IWorld, e: Entity): Faction {
  return isPlayer(world, e) ? 'player' : 'monster';
}

export function monsterTypeOf(world: IWorld, e: Entity): MonsterType | null {
  return isPlayer(world, e) ? null : (e as Monster).type;
}

/** Live entities a `sourceFaction` attack may hit — the opposing faction(s). A
 *  monster's attack may hit ANY live player (co-op friendly fire is gated elsewhere). */
export function collectAttackTargets(world: IWorld, sourceFaction: Faction): Entity[] {
  const out: Entity[] = [];
  if (sourceFaction !== 'player') {
    for (const p of world.players.values()) if (isAlivePlayer(p)) out.push(p);
  }
  if (sourceFaction !== 'monster') {
    for (const m of world.monsters) if (isAliveMonster(m)) out.push(m);
  }
  return out;
}

/** Current position of an entity id (player, monster, or projectile), or null. */
export function entityPos(world: IWorld, id: number): { x: number; y: number } | null {
  const player = world.players.get(id);
  if (player) return player;
  for (const m of world.monsters) if (m.id === id) return m;
  for (const p of world.projectiles) if (p.id === id) return p;
  return null;
}
