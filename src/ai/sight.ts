// Waking: A_Look (sight) and sound propagation. A monster wakes either by seeing
// the player (180° front cone + LOS) or by hearing noise that floods to it through
// open cells (doom-design.md §3). Sound, unlike sight, spreads around corners — a
// grid flood from the noise origin, blocked by solid cells (walls / closed doors).
import type { IWorld, Monster } from '../core';
import { cellOf } from '../world';
import { isAliveMonster, isAlivePlayer } from '../combat';
import { hasLOS, inFrontCone, wake } from './targeting';
import { SOUND_TRAVEL_CELLS } from './tuning';

/** A_Look — true (and target set) if this monster can see the player right now.
 *  A dead/dying monster never sights: a corpse must never re-acquire a target or
 *  wake, no matter who calls this (the update loop already skips it; this guards
 *  every other caller too). */
export function lookForTarget(world: IWorld, m: Monster): boolean {
  if (!isAliveMonster(m)) return false;
  const player = world.player;
  if (!isAlivePlayer(player)) return false;
  if (!inFrontCone(m, player)) return false;
  if (!hasLOS(world, m, player)) return false;
  m.target = player.id;
  return true;
}

/**
 * P_NoiseAlert — a sound made at (x,y) by `makerId` wakes every idle monster the
 * noise reaches. With a level, sound floods outward through non-solid cells up to
 * `maxCells`; without one (open test space) every idle monster hears it. Returns
 * how many woke.
 */
export function noiseAlert(world: IWorld, x: number, y: number, makerId: number, maxCells = SOUND_TRAVEL_CELLS): number {
  const idle = world.monsters.filter((m) => m.state === 'idle' && isAliveMonster(m));
  if (idle.length === 0) return 0;

  const reached = floodCells(world, x, y, maxCells);
  let woke = 0;
  for (const m of idle) {
    if (reached === null || reached.has(cellKey(cellOf(m.x), cellOf(m.y)))) {
      wake(m, makerId);
      woke++;
    }
  }
  return woke;
}

function cellKey(cx: number, cy: number): string {
  return `${cx},${cy}`;
}

/** Cells sound reaches from (x,y), or null when there's no level (open space). */
function floodCells(world: IWorld, x: number, y: number, maxCells: number): Set<string> | null {
  const level = world.level;
  if (!level) return null;

  const start: [number, number, number] = [cellOf(x), cellOf(y), 0];
  const visited = new Set<string>([cellKey(start[0], start[1])]);
  const queue: [number, number, number][] = [start];
  const steps: ReadonlyArray<[number, number]> = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];

  while (queue.length > 0) {
    const [cx, cy, depth] = queue.shift()!;
    if (depth >= maxCells) continue;
    for (const [dx, dy] of steps) {
      const nx = cx + dx;
      const ny = cy + dy;
      const key = cellKey(nx, ny);
      if (visited.has(key) || level.isSolid(nx, ny)) continue;
      visited.add(key);
      queue.push([nx, ny, depth + 1]);
    }
  }
  return visited;
}
