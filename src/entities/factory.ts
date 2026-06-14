// Entity factory. createPlayer is implemented (the canonical DOOM start loadout,
// doom-design.md §1/§4: Fist + Pistol, 50 bullets). Monster/pickup/projectile
// spawners are STUBs the AI/items/weapons workers fill in.
import type { Player, Monster, Pickup, Projectile, IWorld } from '../core';
import { PLAYER_RADIUS, HEALTH_START } from '../core';
import { AMMO } from '../data';

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

/** Spawn a monster from a DoomEd thing id at a world position. STUB. */
export function spawnMonster(_world: IWorld, _thingId: number, _x: number, _y: number, _angle: number): Monster {
  throw new Error('NotImplemented: spawnMonster (reads ENEMIES by thing id)');
}

/** Spawn a pickup from a DoomEd thing id. STUB. */
export function spawnPickup(_world: IWorld, _thingId: number, _x: number, _y: number): Pickup {
  throw new Error('NotImplemented: spawnPickup (reads ITEMS_BY_ID)');
}

/** Spawn a projectile from an owner toward an angle. STUB. */
export function spawnProjectile(
  _world: IWorld,
  _ownerId: number,
  _x: number,
  _y: number,
  _angle: number,
  _sprite: string,
): Projectile {
  throw new Error('NotImplemented: spawnProjectile');
}
