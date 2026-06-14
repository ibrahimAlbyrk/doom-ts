// src/ai barrel — monster AI state machine.
// Integration: build one MonsterAI per level, tick it inside the fixed step.
//   const ai = createMonsterAI(world, rng, combatBus);  // at level start
//   ai.update(tics);                                     // every fixed tic
//   ai.noise(player.x, player.y);                        // when the player fires
//   ai.dispose();                                        // at level teardown
export { createMonsterAI, updateMonsters, onDamagedBy, type MonsterAI } from './monster-ai';
export { lookForTarget, noiseAlert } from './sight';
