// Waking: A_Look (sight) and sound propagation. A monster wakes either by seeing
// the player (180° front cone + LOS) or by hearing noise that floods to it through
// open cells (doom-design.md §3). Sound, unlike sight, spreads around corners — a
// grid flood from the noise origin, blocked by solid cells (walls / closed doors).
import type { IWorld, Monster, Player } from '../core';
import { cellOf } from '../world';
import { isAliveMonster, isAlivePlayer } from '../combat';
import { hasLOS, inFrontCone, wake } from './targeting';
import { reactionTics, soundTravelCells } from './tuning';

/** A_Look — true (and target set) if this monster can see a player right now. In
 *  co-op it considers every player and locks onto the NEAREST one in its front cone
 *  with clear line-of-sight. A dead/dying monster never sights: a corpse must never
 *  re-acquire a target or wake, no matter who calls this (the update loop already
 *  skips it; this guards every other caller too). */
export function lookForTarget(world: IWorld, m: Monster): boolean {
  if (!isAliveMonster(m)) return false;
  let nearest: Player | null = null;
  let nearestDistSq = Infinity;
  for (const player of world.players.values()) {
    if (!isAlivePlayer(player)) continue;
    if (!inFrontCone(m, player)) continue;
    if (!hasLOS(world, m, player)) continue;
    const distSq = (player.x - m.x) ** 2 + (player.y - m.y) ** 2;
    if (distSq < nearestDistSq) {
      nearestDistSq = distSq;
      nearest = player;
    }
  }
  if (!nearest) return false;
  m.target = nearest.id;
  return true;
}

/**
 * P_NoiseAlert — a sound made at (x,y) by `makerId` wakes every idle monster the
 * noise reaches. With a level, sound floods outward through non-solid cells up to
 * `maxCells`; without one (open test space) every idle monster hears it. Returns
 * how many woke.
 */
export function noiseAlert(world: IWorld, x: number, y: number, makerId: number, maxCells = soundTravelCells(world.skill)): number {
  const idle = world.monsters.filter((m) => m.state === 'idle' && isAliveMonster(m));
  if (idle.length === 0) return 0;

  const reached = floodCells(world, x, y, maxCells);
  const reaction = reactionTics(world.skill);
  let woke = 0;
  for (const m of idle) {
    if (reached === null || reached.has(cellKey(cellOf(m.x), cellOf(m.y)))) {
      wake(m, makerId, reaction);
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
