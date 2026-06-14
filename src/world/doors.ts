// Door + lift + teleporter state machines (doom-design.md §7; grid-door technique
// engine.md §6.4). Animates door open amounts 0->1, checks key locks, runs lift
// floor tiers between discrete heights, and relocates entities on teleport. All
// timing is in DOOM tics; the per-frame entrypoints convert the seconds `dt`
// (the game's FIXED_STEP) via SECONDS_PER_TIC. Mutates the LevelRuntime state.
import type { Entity, Player, KeyColor, TeleporterSpec } from '../core';
import { SECONDS_PER_TIC, degToRad } from '../core';
import type { LevelRuntime, DoorRuntime, LiftRuntime } from './level-runtime';
import { cellOf } from './collision';

/** Optional predicate: is a body standing in cell (cx,cy)? Used so a door won't
 *  close on an entity (decision 7 — doors are non-crushing). */
export type CellOccupancy = (cx: number, cy: number) => boolean;

/** Advance every active door and lift by the elapsed `dt` (seconds). */
export function updateDoors(level: LevelRuntime, dt: number, isOccupied?: CellOccupancy): void {
  const tics = dt / SECONDS_PER_TIC;
  for (const door of level.doors) advanceDoor(door, tics, isOccupied);
  for (const lift of level.lifts) advanceLift(lift, tics);
}

const EPS = 1e-9;

// Each phase consumes only the tics it needs and hands the remainder to the next
// phase, so a single large dt resolves through several phases at once (frame-rate
// independent — no time is lost at a transition).
function advanceDoor(d: DoorRuntime, tics: number, isOccupied?: CellOccupancy): void {
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
        if (d.waitTimer <= 0) d.phase = 'closing';
        else return;
        break;
      }
      case 'closing': {
        if (isOccupied?.(d.spec.x, d.spec.y)) {
          d.phase = 'opening'; // something's underneath — reopen instead of crushing
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

function advanceLift(l: LiftRuntime, tics: number): void {
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
        } else return;
        break;
      }
    }
  }
}

/** Player pressed Use on (cx,cy). Opens an unlocked/keyed door, or toggles an
 *  already-open one shut (DR-door behaviour). Returns whether a door responded. */
export function tryUseDoor(level: LevelRuntime, cx: number, cy: number, player: Player): boolean {
  const d = level.doorAt(cx, cy);
  if (!d) return false;
  if (d.spec.kind === 'locked' && d.spec.key && !playerHasKey(player, d.spec.key)) return false;
  if (d.phase === 'closed' || d.phase === 'closing') {
    d.phase = 'opening';
    return true;
  }
  if (d.phase === 'open' || d.phase === 'opening') {
    d.phase = 'closing';
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
 * pendingExit). Once-triggers fire a single time. Teleporting moves the entity
 * off its trigger cell, so repeatable teleports don't re-fire while standing.
 */
export function checkWalkoverTriggers(level: LevelRuntime, entity: Entity): void {
  const cx = cellOf(entity.x);
  const cy = cellOf(entity.y);
  const data = level.data;

  data.lifts.forEach((spec, i) => {
    const t = spec.trigger;
    if (t.kind !== 'walkover' || t.x !== cx || t.y !== cy) return;
    if (t.once && level.hasFired('lift', i)) return;
    const rt = level.lifts[i];
    if (rt && triggerLift(rt) && t.once) level.markFired('lift', i);
  });

  data.exits.forEach((spec, i) => {
    const t = spec.trigger;
    if (t.kind !== 'walkover' || t.x !== cx || t.y !== cy) return;
    if (t.once && level.hasFired('exit', i)) return;
    level.pendingExit = spec.kind;
    if (t.once) level.markFired('exit', i);
  });

  data.teleporters.forEach((spec, i) => {
    const t = spec.trigger;
    if (t.kind !== 'walkover' || t.x !== cx || t.y !== cy) return;
    if (t.once && level.hasFired('tp', i)) return;
    teleportEntity(entity, spec);
    if (t.once) level.markFired('tp', i);
  });
}

function playerHasKey(player: Player, color: KeyColor): boolean {
  const k = player.inventory.keys[color];
  return !!k && (k.card || k.skull);
}
