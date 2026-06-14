// Door + lift + teleporter state machines (doom-design.md §7; grid-door technique
// engine.md §6.4). Animates door open amounts 0->1, checks key locks, runs lift
// floor tiers between discrete heights, and relocates entities on teleport. All
// timing is in DOOM tics; the per-frame entrypoints convert the seconds `dt`
// (the game's FIXED_STEP) via SECONDS_PER_TIC. Mutates the LevelRuntime state.
import type { Entity, Player, KeyColor, TeleporterSpec, TriggerSpec, EventBus, GameEventMap } from '../core';
import { SECONDS_PER_TIC, CELL_SIZE, degToRad } from '../core';
import type { LevelRuntime, DoorRuntime, LiftRuntime } from './level-runtime';
import { cellOf } from './collision';

/** Optional predicate: is a body standing in cell (cx,cy)? Used so a door won't
 *  close on an entity (decision 7 — doors are non-crushing). */
export type CellOccupancy = (cx: number, cy: number) => boolean;

/** Optional sink for positioned sound effects (additive — omit it and the state
 *  machines run identically; the tests call these without it). */
type SfxSink = EventBus<GameEventMap> | undefined;

const SFX_DOOR_OPEN = 'DSDOROPN';
const SFX_DOOR_CLOSE = 'DSDORCLS';
const SFX_LIFT_START = 'DSPSTART';
const SFX_LIFT_STOP = 'DSPSTOP';
const SFX_SWITCH = 'DSSWTCHN';
const SFX_TELEPORT = 'DSTELEPT';

function sfxAtCell(events: SfxSink, sound: string, cx: number, cy: number): void {
  events?.emit('sfx', { sound, x: (cx + 0.5) * CELL_SIZE, y: (cy + 0.5) * CELL_SIZE });
}

/** Advance every active door and lift by the elapsed `dt` (seconds). */
export function updateDoors(
  level: LevelRuntime,
  dt: number,
  isOccupied?: CellOccupancy,
  events?: SfxSink,
): void {
  const tics = dt / SECONDS_PER_TIC;
  for (const door of level.doors) advanceDoor(door, tics, isOccupied, events);
  for (const lift of level.lifts) advanceLift(lift, tics, events);
}

const EPS = 1e-9;

// Each phase consumes only the tics it needs and hands the remainder to the next
// phase, so a single large dt resolves through several phases at once (frame-rate
// independent — no time is lost at a transition).
function advanceDoor(d: DoorRuntime, tics: number, isOccupied?: CellOccupancy, events?: SfxSink): void {
  let left = tics;
  while (left > 0) {
    switch (d.phase) {
      case 'closed':
        return;
      case 'opening': {
        const need = (1 - d.open) / d.spec.speed;
        const used = Math.min(left, need);
        d.open += d.spec.speed * used;
        left -= used;
        if (d.open >= 1 - EPS) {
          d.open = 1;
          d.phase = 'open';
          d.waitTimer = d.spec.waitTics;
        } else return;
        break;
      }
      case 'open': {
        if (d.spec.waitTics < 0) return; // stays open (manual / hold-open door)
        const used = Math.min(left, Math.max(0, d.waitTimer));
        d.waitTimer -= used;
        left -= used;
        if (d.waitTimer <= 0) {
          d.phase = 'closing';
          sfxAtCell(events, SFX_DOOR_CLOSE, d.spec.x, d.spec.y); // auto-close after wait
        } else return;
        break;
      }
      case 'closing': {
        if (isOccupied?.(d.spec.x, d.spec.y)) {
          d.phase = 'opening'; // something's underneath — reopen instead of crushing
          sfxAtCell(events, SFX_DOOR_OPEN, d.spec.x, d.spec.y);
          break;
        }
        const need = d.open / d.spec.speed;
        const used = Math.min(left, need);
        d.open -= d.spec.speed * used;
        left -= used;
        if (d.open <= EPS) {
          d.open = 0;
          d.phase = 'closed';
        } else return;
        break;
      }
    }
  }
}

function advanceLift(l: LiftRuntime, tics: number, events?: SfxSink): void {
  const cell = l.spec.cells[0];
  let left = tics;
  while (left > 0) {
    switch (l.phase) {
      case 'top':
        return;
      case 'lowering': {
        const need = (l.height - l.spec.lowHeight) / l.spec.speed;
        const used = Math.min(left, need);
        l.height -= l.spec.speed * used;
        left -= used;
        if (l.height <= l.spec.lowHeight + EPS) {
          l.height = l.spec.lowHeight;
          l.phase = 'bottom';
          l.waitTimer = l.spec.waitTics;
          if (cell) sfxAtCell(events, SFX_LIFT_STOP, cell.x, cell.y);
        } else return;
        break;
      }
      case 'bottom': {
        if (l.spec.waitTics < 0) return; // stays down until retriggered
        const used = Math.min(left, Math.max(0, l.waitTimer));
        l.waitTimer -= used;
        left -= used;
        if (l.waitTimer <= 0) l.phase = 'raising';
        else return;
        break;
      }
      case 'raising': {
        const need = (l.spec.highHeight - l.height) / l.spec.speed;
        const used = Math.min(left, need);
        l.height += l.spec.speed * used;
        left -= used;
        if (l.height >= l.spec.highHeight - EPS) {
          l.height = l.spec.highHeight;
          l.phase = 'top';
          if (cell) sfxAtCell(events, SFX_LIFT_STOP, cell.x, cell.y);
        } else return;
        break;
      }
    }
  }
}

/** Player pressed Use on (cx,cy). Opens an unlocked/keyed door, or toggles an
 *  already-open one shut (DR-door behaviour). Returns whether a door responded. */
export function tryUseDoor(
  level: LevelRuntime,
  cx: number,
  cy: number,
  player: Player,
  events?: SfxSink,
): boolean {
  const d = level.doorAt(cx, cy);
  if (!d) return false;
  if (d.spec.kind === 'locked' && d.spec.key && !playerHasKey(player, d.spec.key)) return false;
  if (d.phase === 'closed' || d.phase === 'closing') {
    d.phase = 'opening';
    sfxAtCell(events, SFX_DOOR_OPEN, cx, cy);
    return true;
  }
  if (d.phase === 'open' || d.phase === 'opening') {
    d.phase = 'closing';
    sfxAtCell(events, SFX_DOOR_CLOSE, cx, cy);
    return true;
  }
  return false;
}

/** Start a lift's down-wait-up cycle. Only fires from the raised rest position. */
export function triggerLift(lift: LiftRuntime): boolean {
  if (lift.phase === 'top') {
    lift.phase = 'lowering';
    return true;
  }
  return false;
}

/** Relocate an entity to a teleport destination, facing the destination angle. */
export function teleportEntity(entity: Entity, tp: TeleporterSpec): void {
  entity.x = tp.destX;
  entity.y = tp.destY;
  entity.angle = degToRad(tp.destAngle);
}

/**
 * Resolve walkover triggers under `entity` this frame: teleporters (relocate +
 * face), walkover-triggered lifts (start the cycle), and walkover exits (flag
 * pendingExit). Once-triggers fire a single time.
 *
 * Matching is by the body's footprint (its radius bounding box crosses the
 * trigger cell, DOOM's bbox line-crossing), so boarding a lift is forgiving and
 * doesn't demand the body centre land on one exact cell. Firing is edge-detected
 * (entry only): a body parked on a repeatable trigger fires once per crossing,
 * never every tic — otherwise a lift retriggers each frame it returns to `top`
 * and cycles forever instead of completing its travel.
 */
export function checkWalkoverTriggers(level: LevelRuntime, entity: Entity, events?: SfxSink): void {
  const data = level.data;
  const r = entity.radius;
  const minCx = cellOf(entity.x - r);
  const maxCx = cellOf(entity.x + r);
  const minCy = cellOf(entity.y - r);
  const maxCy = cellOf(entity.y + r);
  const crosses = (tx: number, ty: number): boolean =>
    tx >= minCx && tx <= maxCx && ty >= minCy && ty <= maxCy;
  // A trigger may cover its whole approach edge (trigger.cells); a single (x,y)
  // is the common case. The footprint trips it if it overlaps ANY listed cell —
  // so a wide lift boards from its full front, not just one corner.
  const crossesTrigger = (t: TriggerSpec): boolean =>
    t.cells ? t.cells.some((c) => crosses(c.x, c.y)) : crosses(t.x, t.y);

  // Collect every walkover trigger the footprint overlaps, then act only on the
  // ones just entered this tic (level.walkoverEntries edge-detects per entity).
  const keys: string[] = [];
  data.lifts.forEach((spec, i) => {
    if (spec.trigger.kind === 'walkover' && crossesTrigger(spec.trigger)) keys.push(`lift:${i}`);
  });
  data.exits.forEach((spec, i) => {
    if (spec.trigger.kind === 'walkover' && crossesTrigger(spec.trigger)) keys.push(`exit:${i}`);
  });
  data.teleporters.forEach((spec, i) => {
    if (spec.trigger.kind === 'walkover' && crossesTrigger(spec.trigger)) keys.push(`tp:${i}`);
  });
  const entered = level.walkoverEntries(entity.id, keys);
  if (entered.size === 0) return;

  data.lifts.forEach((spec, i) => {
    if (!entered.has(`lift:${i}`) || (spec.trigger.once && level.hasFired('lift', i))) return;
    const rt = level.lifts[i];
    if (rt && triggerLift(rt)) {
      sfxAtCell(events, SFX_LIFT_START, spec.trigger.x, spec.trigger.y);
      if (spec.trigger.once) level.markFired('lift', i);
    }
  });

  data.exits.forEach((spec, i) => {
    if (!entered.has(`exit:${i}`) || (spec.trigger.once && level.hasFired('exit', i))) return;
    level.pendingExit = spec.kind;
    sfxAtCell(events, SFX_SWITCH, spec.trigger.x, spec.trigger.y);
    if (spec.trigger.once) level.markFired('exit', i);
  });

  data.teleporters.forEach((spec, i) => {
    if (!entered.has(`tp:${i}`) || (spec.trigger.once && level.hasFired('tp', i))) return;
    teleportEntity(entity, spec);
    sfxAtCell(events, SFX_TELEPORT, cellOf(entity.x), cellOf(entity.y));
    if (spec.trigger.once) level.markFired('tp', i);
  });
}

function playerHasKey(player: Player, color: KeyColor): boolean {
  const k = player.inventory.keys[color];
  return !!k && (k.card || k.skull);
}
