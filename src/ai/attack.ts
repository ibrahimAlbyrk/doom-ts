// Attack states — A_FaceTarget then the actor's A_*Attack, dispatched by data type
// (doom-design.md §3). Standing attacks fire once on entry, hold for the actor's
// refire cadence, then return to chase. The Lost Soul "charge" is a moving attack:
// it flies along a locked heading until it bites the target, hits a wall, or times
// out. All damage/projectiles route through src/combat with the correct data.
import type { Entity, IWorld, Monster, Rng } from '../core';
import { HITSCAN_RANGE, rollDamage } from '../core';
import { ENEMIES } from '../data';
import { applyDamage, fireProjectile, hitscan } from '../combat';
import type { ProjectileSpec } from '../entities';
import { moveEntity } from '../world';
import { angleTo, inMeleeRange, targetEntity } from './targeting';
import { CHARGE_MAX_TICS, MONSTER_SPREAD_SHIFT, attackTics, memoOf, projectileSpeed } from './tuning';
import { CombatBus } from '../combat';

/** Run one attack-state tic for `m` (melee or missile, including Lost Soul charge). */
export function attackThink(world: IWorld, m: Monster, rng: Rng, combat: CombatBus, tics: number): void {
  if (ENEMIES[m.type].attack.kind === 'charge') {
    chargeThink(world, m, rng, combat, tics);
    return;
  }

  const target = targetEntity(world, m);
  if (!target) {
    m.state = 'chase';
    m.stateTimer = 0;
    return;
  }

  if (m.stateTimer === 0) {
    m.angle = angleTo(m, target);
    const attackSound = ENEMIES[m.type].sounds.attack;
    if (attackSound) combat.emitGame('sfx', { sound: attackSound, x: m.x, y: m.y });
    performAttack(world, m, target, rng, combat);
  }

  m.stateTimer += tics;
  if (m.stateTimer >= attackTics(m.type, world.skill)) {
    m.state = 'chase';
    m.stateTimer = 0;
  }
}

function performAttack(world: IWorld, m: Monster, target: Entity, rng: Rng, combat: CombatBus): void {
  const a = ENEMIES[m.type].attack;

  if (m.state === 'melee') {
    if (a.melee && inMeleeRange(m, target)) {
      applyDamage(world, target, rollDamage(rng, a.melee.n, a.melee.m), m.id, 'monster', rng, combat);
    }
    return;
  }

  // Missile state.
  if (a.kind === 'hitscan' && a.hitscan) {
    hitscan(
      world,
      m.x,
      m.y,
      m.angle,
      HITSCAN_RANGE,
      a.hitscan.roll,
      MONSTER_SPREAD_SHIFT,
      a.hitscan.pellets,
      false,
      m.id,
      'monster',
      rng,
      combat,
    );
  } else if (a.kind === 'projectile' && a.projectile) {
    const spec: ProjectileSpec = {
      damage: a.projectile.roll,
      speed: projectileSpeed(a.projectile.speed, world.skill),
      sprite: a.projectile.sprite,
      splashRadius: a.projectile.splashRadius ?? 0,
    };
    fireProjectile(world, m, 'monster', m.angle, spec);
  }
}

function chargeThink(world: IWorld, m: Monster, rng: Rng, combat: CombatBus, tics: number): void {
  const def = ENEMIES[m.type];
  const target = targetEntity(world, m);
  const level = world.level;
  m.stateTimer += tics;

  const dir = memoOf(m).chargeDir;
  const speed = def.chargeSpeed * tics;
  const moved = level ? moveEntity(m, Math.cos(dir) * speed, Math.sin(dir) * speed, level) : false;

  if (target && def.attack.melee && inMeleeRange(m, target)) {
    applyDamage(world, target, rollDamage(rng, def.attack.melee.n, def.attack.melee.m), m.id, 'monster', rng, combat);
    endCharge(m);
    return;
  }
  if (!target || !moved || m.stateTimer >= CHARGE_MAX_TICS) endCharge(m);
}

function endCharge(m: Monster): void {
  m.flinchImmune = false;
  m.state = 'chase';
  m.stateTimer = 0;
  m.velX = 0;
  m.velY = 0;
}
