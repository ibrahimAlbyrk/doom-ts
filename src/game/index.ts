// src/game barrel — the integration hub: loop, state machine, service wiring.
// The headless sim is `session.ts` (GameSession); the browser presenter is `client.ts`
// (GameClient); DOM-coupled contracts (GameContext/IGameState) are in `types.ts`.
export * from './types';
export * from './game';
export * from './states';
export * from './context';
export * from './session';
export * from './client';
export * from './scene';
