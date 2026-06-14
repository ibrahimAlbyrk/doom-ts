// A_Chase — the pursue/decide step. Each tic the monster faces its target, then
// either commits to an attack (melee/missile/charge when in range, LOS-clear, and
// past its reaction delay) or takes one 8-way step toward the target, re-picking
// the direction periodically or when blocked (doom-design.md §3 P_NewChaseDir).
import type { Entity, IWorld, Monster, Rng } from '../core';
import { TAU, normalizeAngle } from '../core';
import { ENEMIES } from '../data';
import { moveEntity, positionFits } from '../world';
import { angleTo, dist2d, hasLOS, inMeleeRange, targetEntity } from './targeting';
import { MISSILE_RANGE, MOVE_RESELECT_MAX, MOVE_RESELECT_MIN, hasMelee, hasRanged, memoOf } from './tuning';

const DIR_COUNT = 8;
const DIR_STEP = TAU / DIR_COUNT;

/** Run one chase tic. May transition the monster into a melee/missile state. */
export function chaseThink(world: IWorld, m: Monster, rng: Rng, tics: number): void {
  const target = targetEntity(world, m);
  if (!target) {
    m.state = 'idle';
    m.target = null;
    return;
  }

  m.angle = angleTo(m, target);
  if (m.reactionTime > 0) m.reactionTime -= tics;

  const def = ENEMIES[m.type];
  const los = hasLOS(world, m, target);
  const dist = dist2d(m, target);

  if (m.reactionTime <= 0 && los) {
    if (def.attack.kind === 'charge') {
      if (dist <= MISSILE_RANGE) {
        enterCharge(m, target);
        return;
      }
    } else {
      if (hasMelee(def) && inMeleeRange(m, target)) {
        m.state = 'melee';
        m.stateTimer = 0;
        return;
      }
      if (hasRanged(def) && dist <= MISSILE_RANGE) {
        m.state = 'missile';
        m.stateTimer = 0;
        return;
      }
    }
  }

  stepToward(world, m, rng, target, tics);
}

/** Begin a Lost Soul charge: lock the heading and ignore pain mid-flight. */
export function enterCharge(m: Monster, target: Entity): void {
  m.state = 'missile';
  m.stateTimer = 0;
  m.flinchImmune = true;
  m.velX = 0;
  m.velY = 0;
  memoOf(m).chargeDir = angleTo(m, target);
}

function stepToward(world: IWorld, m: Monster, rng: Rng, target: Entity, tics: number): void {
  const level = world.level;
  if (!level) return;

  const memo = memoOf(m);
  memo.moveCount -= tics;
  if (memo.moveCount <= 0) {
    memo.moveDir = newChaseDir(world, m, target, tics);
    memo.moveCount = rng.range(MOVE_RESELECT_MIN, MOVE_RESELECT_MAX);
  }

  const speed = ENEMIES[m.type].speed * tics;
  const moved = moveEntity(m, Math.cos(memo.moveDir) * speed, Math.sin(memo.moveDir) * speed, level);
  if (!moved) memo.moveCount = 0; // blocked — re-pick next tic
}

/** Snap the heading-to-target to one of 8 compass dirs, falling back to nearby
 *  dirs when the preferred one is blocked. */
function newChaseDir(world: IWorld, m: Monster, target: Entity, tics: number): number {
  const want = angleTo(m, target);
  const base = Math.round(normalizeAngle(want) / DIR_STEP);
  const offsets = [0, 1, -1, 2, -2, 3, -3, 4];
  const step = ENEMIES[m.type].speed * tics;
  for (const off of offsets) {
    const dir = (base + off) * DIR_STEP;
    if (probeFits(world, m, dir, step)) return dir;
  }
  return base * DIR_STEP;
}

function probeFits(world: IWorld, m: Monster, dir: number, step: number): boolean {
  const level = world.level;
  if (!level) return true;
  return positionFits(m.x + Math.cos(dir) * step, m.y + Math.sin(dir) * step, m.radius, level);
}
