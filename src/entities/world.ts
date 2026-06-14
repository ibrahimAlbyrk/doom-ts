// World — the entity registry (struct-of-entities, web-arch.md §4 option A).
// Plain typed arrays with O(1) swap-pop removal. Implements the IWorld contract.
// Players live in an id-keyed map (multiplayer-plan B1): offline single-player is a
// map of size 1 (the local player, id 0); the headless sim supports N players.
import type { IWorld, Player, Monster, Projectile, Pickup, ILevelRuntime, SkillId } from '../core';
import { createPlayer } from './factory';

export class World implements IWorld {
  players = new Map<number, Player>();
  localPlayerId: number;
  monsters: Monster[] = [];
  projectiles: Projectile[] = [];
  pickups: Pickup[] = [];
  level: ILevelRuntime | null = null;
  skill: SkillId = 3; // HMP baseline; loadLevel overwrites with the chosen skill per session

  private nextId = 0;

  constructor() {
    // Host-authoritative allocation (B3): the session owner allocates the local
    // player first, so it deterministically gets id 0 (LocalSession's single player).
    this.localPlayerId = this.addPlayer(0, 0, 0).id;
  }

  /** The local client's own player (its point of view). */
  get player(): Player {
    return this.players.get(this.localPlayerId)!;
  }

  allocId(): number {
    return this.nextId++;
  }

  /** Allocate an id, build a player, and register it. The authority calls this per
   *  joined player (B3); the local player is created in the constructor (id 0). */
  addPlayer(x: number, y: number, angle: number): Player {
    const player = createPlayer(this.allocId(), x, y, angle);
    this.players.set(player.id, player);
    return player;
  }

  removeMonster(id: number): void {
    swapPopById(this.monsters, id);
  }

  removeProjectile(id: number): void {
    swapPopById(this.projectiles, id);
  }

  removePickup(id: number): void {
    swapPopById(this.pickups, id);
  }

  /** Clear all entities for a fresh level (player loadout is re-created by levels).
   *  Players persist across levels — they carry their inventory; loadLevel repositions. */
  reset(): void {
    this.monsters.length = 0;
    this.projectiles.length = 0;
    this.pickups.length = 0;
    this.level = null;
  }
}

function swapPopById<T extends { id: number }>(arr: T[], id: number): void {
  const i = arr.findIndex((e) => e.id === id);
  if (i === -1) return;
  const last = arr[arr.length - 1]!;
  arr[i] = last;
  arr.pop();
}
