// Deathmatch spawn-point derivation (multiplayer-plan §4, D5). DOOM ships dedicated DM
// starts in its maps; ours don't, so we DERIVE a spread set of arena spawns from any of
// the six levels — turning each into a deathmatch arena with no new map data. The level
// solver's key-aware flood fill (src/levels/solver) already yields every walkable, non-solid
// cell reachable from the start; farthest-point sampling over that set picks a handful of
// mutually-distant spawns so marines start (and respawn) spread across the map. Pure over
// MapData — no engine state, no rendering — so the headless server derives them too.
import type { MapData } from '../core';
import { degToRad } from '../core';
import { analyze } from './solver';
import type { SpawnPose } from './level-loader';

/** How many candidate spawns to derive — DOOM maps carry ~4-10 DM starts; 16 is plenty for
 *  an 8-player room while still leaving the picker room to choose one far from everyone. */
const MAX_SPAWNS = 16;

/** Cell-center world position (map units) for a flood-fill cell index. */
function cellCenter(data: MapData, index: number): { x: number; y: number; cx: number; cy: number } {
  const cx = index % data.width;
  const cy = (index - cx) / data.width;
  return { x: (cx + 0.5) * data.cellSize, y: (cy + 0.5) * data.cellSize, cx, cy };
}

/**
 * Derive up to {@link MAX_SPAWNS} deathmatch spawn poses for `data`, well spread over its
 * reachable open cells. Farthest-point sampling: seed with the walkable cell farthest from
 * the player start, then repeatedly add the candidate that maximises its distance to every
 * spawn already chosen. Each pose faces the map centre so a fresh marine looks inward. Falls
 * back to the single player start if the solver finds nothing reachable (degenerate map).
 */
export function deathmatchSpawns(data: MapData): SpawnPose[] {
  const reachable = [...analyze(data).reachable];
  const startX = data.playerStart.x;
  const startY = data.playerStart.y;
  if (reachable.length === 0) {
    return [{ x: startX, y: startY, angle: degToRad(data.playerStart.angle) }];
  }

  const cells = reachable.map((i) => cellCenter(data, i));
  const midX = (data.width * data.cellSize) / 2;
  const midY = (data.height * data.cellSize) / 2;

  // Seed: the reachable cell farthest from the player start (so DM never opens on the SP start).
  let seedIdx = 0;
  let seedDist = -1;
  for (let i = 0; i < cells.length; i++) {
    const d = Math.hypot(cells[i]!.x - startX, cells[i]!.y - startY);
    if (d > seedDist) {
      seedDist = d;
      seedIdx = i;
    }
  }

  const chosen = [cells[seedIdx]!];
  // Greedy farthest-point: each round add the candidate whose nearest chosen spawn is farthest.
  while (chosen.length < MAX_SPAWNS && chosen.length < cells.length) {
    let bestIdx = -1;
    let bestMinDist = -1;
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i]!;
      let nearest = Infinity;
      for (const s of chosen) {
        const d = (s.x - c.x) ** 2 + (s.y - c.y) ** 2;
        if (d < nearest) nearest = d;
      }
      if (nearest > bestMinDist) {
        bestMinDist = nearest;
        bestIdx = i;
      }
    }
    if (bestIdx < 0 || bestMinDist <= 0) break; // no candidate adds any new separation
    chosen.push(cells[bestIdx]!);
  }

  return chosen.map((c) => ({ x: c.x, y: c.y, angle: Math.atan2(midY - c.y, midX - c.x) }));
}

/**
 * Pick the deathmatch spawn that maximises the minimum distance to `avoid` (the other live
 * marines' positions) — DOOM's "spawn away from enemies" so a respawn isn't instant death.
 * With nobody to avoid (the first placement of a round) it spreads by `fallbackIndex` so a
 * batch of initial spawns lands on distinct points. Returns a pose from `spawns` (never null
 * for a non-empty list).
 */
export function pickDeathmatchSpawn(
  spawns: SpawnPose[],
  avoid: { x: number; y: number }[],
  fallbackIndex: number,
): SpawnPose {
  if (spawns.length === 0) throw new Error('pickDeathmatchSpawn: no spawns derived');
  if (avoid.length === 0) return spawns[fallbackIndex % spawns.length]!;

  let best = spawns[0]!;
  let bestMinDist = -1;
  for (const s of spawns) {
    let nearest = Infinity;
    for (const a of avoid) {
      const d = (a.x - s.x) ** 2 + (a.y - s.y) ** 2;
      if (d < nearest) nearest = d;
    }
    if (nearest > bestMinDist) {
      bestMinDist = nearest;
      best = s;
    }
  }
  return best;
}
