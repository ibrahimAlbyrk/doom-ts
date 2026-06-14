// Door + lift + teleporter triggers — STUB. Animates door open amounts (0→1),
// checks key locks, runs lift floor tiers, and teleports on walkover
// (doom-design.md §7; grid-door technique engine.md §6.4).
import type { Player } from '../core';
import type { LevelRuntime } from './level-runtime';

/** Advance every active door/lift this tick. */
export function updateDoors(_level: LevelRuntime, _dt: number): void {
  throw new Error('NotImplemented: updateDoors (engine.md §6.4)');
}

/** Player pressed Use on (cx,cy): open the door if unlocked or the key is held. */
export function tryUseDoor(_level: LevelRuntime, _cx: number, _cy: number, _player: Player): boolean {
  throw new Error('NotImplemented: tryUseDoor');
}

/** Resolve walkover triggers (teleporters, walk-exit lines) at the player's cell. */
export function checkWalkoverTriggers(_level: LevelRuntime, _player: Player): void {
  throw new Error('NotImplemented: checkWalkoverTriggers');
}
