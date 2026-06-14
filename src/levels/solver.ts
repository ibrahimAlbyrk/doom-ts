// Structural solvability analysis for an authored MapData. A key-aware flood fill
// answers the questions the acceptance check cares about: are the keys reachable,
// is every locked door openable (its key collectable before it's needed), and is
// an exit reachable? Doors are passable unless locked-without-key; collecting a key
// re-opens the fill (fixpoint); lifts bridge floor tiers; teleporters jump to their
// destination cell. Pure over MapData — no engine state, no rendering.
import type { MapData, KeyColor, ExitSpec, DoorSpec } from '../core';
import { MAX_STEP_UP } from '../core';
import { ITEMS_BY_ID } from '../data';

export interface Reachability {
  reachable: Set<number>; // cell indices reachable once all collectable keys are held
  keys: Set<KeyColor>; // keys the player can collect along the way
  keyCellReachable: Map<KeyColor, boolean>; // each placed key: is its cell reachable?
  lockedDoorsSolvable: boolean; // every locked door's key is collectable
  exitReachable: boolean; // at least one exit is reachable (stand-on or stand-adjacent)
}

export function analyze(data: MapData): Reachability {
  const { width, height, cellSize } = data;
  const idx = (x: number, y: number): number => y * width + x;
  const cellOf = (mu: number): number => Math.floor(mu / cellSize);
  const inBounds = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < width && y < height;

  const doorByCell = new Map<number, DoorSpec>();
  for (const d of data.doors) doorByCell.set(idx(d.x, d.y), d);

  const liftCells = new Set<number>();
  for (const l of data.lifts) for (const c of l.cells) liftCells.add(idx(c.x, c.y));

  const teleDest = new Map<number, number>();
  for (const t of data.teleporters) {
    teleDest.set(idx(t.trigger.x, t.trigger.y), idx(cellOf(t.destX), cellOf(t.destY)));
  }

  const keyCellByColor = new Map<KeyColor, number>();
  for (const t of data.things) {
    const def = ITEMS_BY_ID.get(t.id);
    if (def?.kind === 'key' && def.keyColor) keyCellByColor.set(def.keyColor, idx(cellOf(t.x), cellOf(t.y)));
  }

  const startIdx = idx(cellOf(data.playerStart.x), cellOf(data.playerStart.y));
  const hardWall = (i: number): boolean => (data.walls[i] ?? 0) !== 0 && !doorByCell.has(i);
  const floorH = (i: number): number => data.floorHeights[i] ?? 0;

  const flood = (collected: Set<KeyColor>): Set<number> => {
    const seen = new Set<number>([startIdx]);
    const queue = [startIdx];
    const startDest = teleDest.get(startIdx);
    if (startDest !== undefined) {
      seen.add(startDest);
      queue.push(startDest);
    }
    while (queue.length) {
      const cur = queue.pop()!;
      const cx = cur % width;
      const cy = (cur - cx) / width;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (!inBounds(nx, ny)) continue;
        const ni = idx(nx, ny);
        if (seen.has(ni) || hardWall(ni)) continue;
        const door = doorByCell.get(ni);
        if (door && door.kind === 'locked' && door.key && !collected.has(door.key)) continue;
        const flexible = liftCells.has(cur) || liftCells.has(ni);
        if (!flexible && floorH(ni) - floorH(cur) > MAX_STEP_UP) continue; // can drop, can step ≤24
        seen.add(ni);
        queue.push(ni);
        const dest = teleDest.get(ni);
        if (dest !== undefined && !seen.has(dest)) {
          seen.add(dest);
          queue.push(dest);
        }
      }
    }
    return seen;
  };

  const collected = new Set<KeyColor>();
  let reachable = flood(collected);
  for (;;) {
    let added = false;
    for (const [color, cell] of keyCellByColor) {
      if (reachable.has(cell) && !collected.has(color)) {
        collected.add(color);
        added = true;
      }
    }
    if (!added) break;
    reachable = flood(collected);
  }

  const keyCellReachable = new Map<KeyColor, boolean>();
  for (const [color, cell] of keyCellByColor) keyCellReachable.set(color, reachable.has(cell));

  const lockedDoorsSolvable = data.doors.every(
    (d) => d.kind !== 'locked' || !d.key || collected.has(d.key),
  );

  const exitCellReachable = (e: ExitSpec): boolean => {
    const t = e.trigger;
    if (t.kind === 'walkover') return reachable.has(idx(t.x, t.y));
    // switch/use: the trigger cell is a wall; the player stands on an adjacent floor cell.
    return ([[1, 0], [-1, 0], [0, 1], [0, -1]] as const).some(([dx, dy]) => {
      const nx = t.x + dx;
      const ny = t.y + dy;
      return inBounds(nx, ny) && reachable.has(idx(nx, ny));
    });
  };
  const exitReachable = data.exits.some(exitCellReachable);

  return { reachable, keys: collected, keyCellReachable, lockedDoorsSolvable, exitReachable };
}
