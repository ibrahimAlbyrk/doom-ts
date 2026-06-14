// Level loader — turns a frozen MapData (src/core) into a live LevelRuntime and
// populates the World with the player + skill-filtered things. The grid/door/lift
// state lives on the LevelRuntime (src/world); this module only drives the
// one-time spawn pass: position the player, then walk MapData.things spawning
// monsters/items through the entity factories (src/entities), converting thing
// angles from DEGREES (level data) to RADIANS (entity convention).
import type { IWorld, MapData, SkillId, EventBus, GameEventMap } from '../core';
import { degToRad } from '../core';
import { LevelRuntime } from '../world';
import { enemyDefForThingId, spawnMonster, spawnPickup } from '../entities';
import { ITEMS_BY_ID, SKILLS } from '../data';

const SKILL_BIT: Record<'easy' | 'normal' | 'hard', number> = { easy: 1, normal: 2, hard: 4 };

/** Does a thing's MTF skill bitmask include the chosen skill? A thing with no bit
 *  for any single-player skill (e.g. skill 0 / multiplayer-only) never spawns. */
export function thingSpawnsAtSkill(mtf: number, skill: SkillId): boolean {
  return (mtf & SKILL_BIT[SKILLS[skill].monsterFlag]) !== 0;
}

/**
 * Build the runtime for `data` and populate `world`: reset entities, install the
 * level, place the player at the start (angle deg→rad), and spawn every thing
 * whose skill flag matches `skill`. Monsters route through spawnMonster (emitting
 * monster:spawned via `events`), pickups through spawnPickup; start/teleport-dest
 * and unknown decoration ids spawn no entity. Keys reset each level so key-locked
 * doors gate progression. Returns the LevelRuntime (also set as world.level).
 */
export function loadLevel(
  world: IWorld,
  data: MapData,
  skill: SkillId,
  events?: EventBus<GameEventMap>,
): LevelRuntime {
  world.reset();
  const level = new LevelRuntime(data);
  world.level = level;
  world.skill = skill; // combat reads this to scale player damage (ITYTD takes half)

  const p = world.player;
  p.x = data.playerStart.x;
  p.y = data.playerStart.y;
  p.angle = degToRad(data.playerStart.angle);
  p.velX = 0;
  p.velY = 0;
  p.active = true;
  p.inventory.keys.blue = { card: false, skull: false };
  p.inventory.keys.yellow = { card: false, skull: false };
  p.inventory.keys.red = { card: false, skull: false };

  for (const t of data.things) {
    if (!thingSpawnsAtSkill(t.skill, skill)) continue;
    const angle = degToRad(t.angle);
    if (enemyDefForThingId(t.id)) {
      spawnMonster(world, t.id, t.x, t.y, angle, events);
    } else if (ITEMS_BY_ID.has(t.id)) {
      spawnPickup(world, t.id, t.x, t.y);
    }
    // ids 1 (player start) / 14 (teleport dest) / unknown decorations spawn nothing
  }

  return level;
}

/**
 * Structural validation of a parsed map: grid-layer lengths, texture-id ranges, a
 * non-solid player start, locked doors that name a key, and at least one exit.
 * Returns a list of human-readable errors; an empty list means the map is valid.
 */
export function validateMap(data: MapData): string[] {
  const errors: string[] = [];
  const n = data.width * data.height;
  const layers: Array<[string, number[]]> = [
    ['walls', data.walls],
    ['floors', data.floors],
    ['ceilings', data.ceilings],
    ['floorHeights', data.floorHeights],
    ['ceilHeights', data.ceilHeights],
    ['light', data.light],
  ];
  for (const [name, layer] of layers) {
    if (layer.length !== n) errors.push(`layer ${name} length ${layer.length} ≠ width*height ${n}`);
  }

  const inBounds = (cx: number, cy: number): boolean =>
    cx >= 0 && cy >= 0 && cx < data.width && cy < data.height;
  const cellOf = (mu: number): number => Math.floor(mu / data.cellSize);

  data.walls.forEach((id, i) => {
    if (id < 0 || id > data.wallTextures.length) errors.push(`wall id ${id} at cell ${i} out of range`);
  });
  data.floors.forEach((id, i) => {
    if (id < 0 || id >= data.flatTextures.length) errors.push(`floor id ${id} at cell ${i} out of range`);
  });
  data.ceilings.forEach((id, i) => {
    if (id !== -1 && (id < 0 || id >= data.flatTextures.length))
      errors.push(`ceiling id ${id} at cell ${i} out of range`);
  });

  const sx = cellOf(data.playerStart.x);
  const sy = cellOf(data.playerStart.y);
  if (!inBounds(sx, sy)) errors.push(`player start (${sx},${sy}) out of bounds`);
  else if ((data.walls[sy * data.width + sx] ?? 0) !== 0)
    errors.push(`player start sits in a solid cell (${sx},${sy})`);

  data.doors.forEach((d, i) => {
    if (!inBounds(d.x, d.y)) errors.push(`door ${i} cell (${d.x},${d.y}) out of bounds`);
    if (d.kind === 'locked' && !d.key) errors.push(`locked door ${i} names no key`);
  });

  data.things.forEach((t, i) => {
    const cx = cellOf(t.x);
    const cy = cellOf(t.y);
    if (!inBounds(cx, cy)) errors.push(`thing ${i} (id ${t.id}) at (${cx},${cy}) out of bounds`);
  });

  if (data.exits.length === 0) errors.push('map has no exit');

  return errors;
}
