// Entity factory — builds the struct-of-entities records from the frozen src/core
// shapes, parameterized by the const tables in src/data. `create*` are pure
// builders; `spawn*` allocate an id, register into the World, and (monsters) emit
// the frozen monster:spawned event. All stats come from src/data — nothing here
// invents combat numbers (doom-design.md §1–§5).
import type {
  Player,
  Monster,
  Pickup,
  Projectile,
  IWorld,
  MonsterType,
  Faction,
  DamageRoll,
  EnemyDef,
  EventBus,
  GameEventMap,
} from '../core';
import { PLAYER_RADIUS, HEALTH_START, REACTION_TICS } from '../core';
import { AMMO, ENEMIES, ITEMS_BY_ID } from '../data';

// Collision radii for entity classes with no radius field in the frozen data
// tables (monsters carry EnemyDef.radiusMu; items/projectiles do not). Small DOOM
// mobj radii: troop/fireball ≈ 6, items ≈ 20.
const PROJECTILE_RADIUS = 6; // mu
const PICKUP_RADIUS = 20; // mu

/** Spawn parameters for a projectile (read off a WeaponDef / MonsterAttackDef). */
export interface ProjectileSpec {
  damage: DamageRoll;
  speed: number; // mu/tic
  sprite: string;
  splashRadius: number; // 0 if none
}

export function createPlayer(id: number, x: number, y: number, angle: number): Player {
  return {
    id,
    x,
    y,
    angle,
    radius: PLAYER_RADIUS,
    active: true,
    velX: 0,
    velY: 0,
    health: HEALTH_START,
    armor: { points: 0, factor: 0 },
    inventory: {
      weapons: {
        fist: true,
        chainsaw: false,
        pistol: true,
        shotgun: false,
        superShotgun: false,
        chaingun: false,
        rocketLauncher: false,
        plasmaRifle: false,
        bfg9000: false,
      },
      ammo: { bullets: 50, shells: 0, rockets: 0, cells: 0 },
      ammoMax: {
        bullets: AMMO.bullets.normalMax,
        shells: AMMO.shells.normalMax,
        rockets: AMMO.rockets.normalMax,
        cells: AMMO.cells.normalMax,
      },
      keys: {
        blue: { card: false, skull: false },
        yellow: { card: false, skull: false },
        red: { card: false, skull: false },
      },
      backpack: false,
    },
    currentWeapon: 'pistol',
    pendingWeapon: null,
    weaponCooldown: 0,
    bob: 0,
    powerups: {},
  };
}

// ── Monsters ─────────────────────────────────────────────────────────────────

/** Map a DoomEd thing id to its EnemyDef (the interchange anchor, doom-design §8). */
export function enemyDefForThingId(thingId: number): EnemyDef | null {
  return Object.values(ENEMIES).find((d) => d.thingId === thingId) ?? null;
}

/** Build a monster of `type` from ENEMIES. `angle` is radians (entity convention). */
export function createMonster(id: number, type: MonsterType, x: number, y: number, angle: number): Monster {
  const def = ENEMIES[type];
  return {
    id,
    x,
    y,
    angle,
    radius: def.radiusMu,
    active: true,
    type,
    health: def.health,
    state: 'idle',
    stateTimer: 0,
    reactionTime: REACTION_TICS,
    target: null,
    velX: 0,
    velY: 0,
    flinchImmune: false,
  };
}

/** Spawn a monster from a DoomEd thing id, register it, and emit monster:spawned.
 *  Returns null for an unknown id. `angle` is radians. */
export function spawnMonster(
  world: IWorld,
  thingId: number,
  x: number,
  y: number,
  angle: number,
  events?: EventBus<GameEventMap>,
): Monster | null {
  const def = enemyDefForThingId(thingId);
  if (!def) return null;
  const monster = createMonster(world.allocId(), def.type, x, y, angle);
  world.monsters.push(monster);
  events?.emit('monster:spawned', { id: monster.id, type: monster.type });
  return monster;
}

// ── Projectiles ──────────────────────────────────────────────────────────────

/** Build a projectile travelling along `angle` at `spec.speed`. */
export function createProjectile(
  id: number,
  ownerId: number,
  ownerFaction: Faction,
  x: number,
  y: number,
  angle: number,
  spec: ProjectileSpec,
): Projectile {
  return {
    id,
    x,
    y,
    angle,
    radius: PROJECTILE_RADIUS,
    active: true,
    velX: Math.cos(angle) * spec.speed,
    velY: Math.sin(angle) * spec.speed,
    damage: spec.damage,
    speed: spec.speed,
    ownerId,
    ownerFaction,
    splashRadius: spec.splashRadius,
    sprite: spec.sprite,
  };
}

/** Spawn a projectile from an owner toward `angle` and register it in the World. */
export function spawnProjectile(
  world: IWorld,
  ownerId: number,
  ownerFaction: Faction,
  x: number,
  y: number,
  angle: number,
  spec: ProjectileSpec,
): Projectile {
  const projectile = createProjectile(world.allocId(), ownerId, ownerFaction, x, y, angle, spec);
  world.projectiles.push(projectile);
  return projectile;
}

// ── Pickups ────────────────────────────────────────────────────────────────--

/** Build a pickup from a DoomEd thing id (ITEMS_BY_ID). Returns null if unknown. */
export function createPickup(id: number, thingId: number, x: number, y: number): Pickup | null {
  const def = ITEMS_BY_ID.get(thingId);
  if (!def) return null;
  return {
    id,
    x,
    y,
    angle: 0,
    radius: PICKUP_RADIUS,
    active: true,
    thingId,
    kind: def.kind,
    respawns: false,
  };
}

/** Spawn a pickup from a DoomEd thing id and register it. Null if unknown id. */
export function spawnPickup(world: IWorld, thingId: number, x: number, y: number): Pickup | null {
  const pickup = createPickup(world.allocId(), thingId, x, y);
  if (!pickup) return null;
  world.pickups.push(pickup);
  return pickup;
}
