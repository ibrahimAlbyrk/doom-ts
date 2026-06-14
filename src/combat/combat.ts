// Combat barrel — all resolution is on the 2D plane (no player pitch; autoaim
// degenerates to "first thing along the 2D ray", doom-design.md §9). The pieces:
//   events.ts      — CombatBus + CombatEventMap (the combat event surface)
//   targets.ts     — faction/alive predicates over the World
//   raycast.ts     — grid DDA: wall distance, line-of-sight, ray↔body hits
//   resolve.ts     — applyDamage: armor split, knockback, pain, death
//   hitscan.ts     — autoaim + multi-pellet spread hitscan
//   splash.ts      — radiusDamage (P_RadiusAttack, LOS-gated)
//   projectiles.ts — fireProjectile + per-tic movement/impact
export * from './events';
export * from './targets';
export * from './raycast';
export * from './resolve';
export * from './hitscan';
export * from './splash';
export * from './projectiles';
