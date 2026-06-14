// src/weapons barrel — the player weapon system, view-model, and pure helpers.
//   weapon-system.ts — WeaponSystem class: state machine, firing, switching, BFG
//   weapon-order.ts  — selection cycle + auto-switch priority (pure)
//   ammo.ts          — ammo consume/grant/backpack (pure inventory mutations)
//   view-model.ts    — WeaponView shape feeding RenderScene (sprite id + bob)
export * from './weapon-system';
export * from './weapon-order';
export * from './ammo';
export * from './view-model';
