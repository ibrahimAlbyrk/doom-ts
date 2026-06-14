// World — the entity registry (struct-of-entities, web-arch.md §4 option A).
// Plain typed arrays with O(1) swap-pop removal. Implements the IWorld contract.
import type { IWorld, Player, Monster, Projectile, Pickup, ILevelRuntime, SkillId } from '../core';
import { createPlayer } from './factory';

export class World implements IWorld {
  player: Player;
  monsters: Monster[] = [];
  projectiles: Projectile[] = [];
  pickups: Pickup[] = [];
  level: ILevelRuntime | null = null;
  skill: SkillId = 3; // HMP baseline; loadLevel overwrites with the chosen skill per session

  private nextId = 1;

  constructor() {
    this.player = createPlayer(this.allocId(), 0, 0, 0);
  }

  allocId(): number {
    return this.nextId++;
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

  /** Clear all entities for a fresh level (player loadout is re-created by levels). */
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
