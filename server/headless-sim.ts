// Headless authoritative-sim smoke runner — the P0 proof that the shared simulation
// runs under Node with NO renderer/audio/input/DOM, which is exactly what the future
// multiplayer server needs (docs/multiplayer-plan.md P0 / §0.1). It boots a GameSession
// with a DOM-free SimContext + null services, drives a scripted command stream through
// one level, and prints a deterministic end-state checksum: the SAME seed + SAME
// commands always yield the SAME checksum. This is a placeholder for the real
// authoritative server (the Colyseus Room wrapping this same GameSession lands in P2).
//
// Run: `npm run sim:headless`  (executed via tsx — no build step, no DOM).
import { World } from '../src/entities';
import { EventBus, Rng, DEFAULT_SEED } from '../src/core';
import type { GameEventMap, SimContext } from '../src/core';
import { GameSession, type TicCommand } from '../src/game/session';

function makeCommand(seq: number, over: Partial<TicCommand> = {}): TicCommand {
  return {
    forward: 0,
    strafe: 0,
    turn: 0,
    lookTurn: 0,
    run: false,
    fire: false,
    use: false,
    weaponSlot: 0,
    weaponCycle: 0,
    pause: false,
    seq,
    ...over,
  };
}

function runHeadlessLevel(tics: number): Record<string, unknown> {
  const events = new EventBus<GameEventMap>();
  const world = new World();
  const rng = new Rng(DEFAULT_SEED);
  const ctx: SimContext = { world, events, rng, skill: 3, episodeLevel: 0 };

  // presentation:false → the headless/server build: gameplay events only, no cosmetic
  // SFX. The exact same GameSession class the browser's LocalSession runs.
  const sim = new GameSession(ctx, { presentation: false });

  let monsterDeaths = 0;
  events.on('monster:died', () => {
    monsterDeaths++;
  });

  sim.startNewGame(3);

  let ran = 0;
  let outcome: string = 'continue';
  for (let i = 0; i < tics; i++) {
    // Walk forward, alternate running, and hold fire — exercises movement, collision,
    // weapons, AI, projectiles and item pickups together, all deterministically.
    const result = sim.tic(makeCommand(i, { forward: 1, fire: true, run: i % 2 === 0 }));
    ran++;
    if (result !== 'continue') {
      outcome = result;
      break;
    }
  }

  const p = world.player;
  const r2 = (n: number): number => Math.round(n * 100) / 100;
  return {
    ticsRun: ran,
    outcome,
    player: { x: r2(p.x), y: r2(p.y), angle: r2(p.angle), health: p.health },
    monstersInRegistry: world.monsters.length,
    monsterDeaths,
    projectilesLive: world.projectiles.length,
    pickupsLive: world.pickups.length,
    stats: sim.stats(),
    processedSeq: sim.processedSeq,
  };
}

const TICS = 350; // ~10 s of sim at 35 Hz
// Run twice to demonstrate determinism (identical checksums for the same seed+commands).
const a = JSON.stringify(runHeadlessLevel(TICS));
const b = JSON.stringify(runHeadlessLevel(TICS));

console.log('HEADLESS SIM OK — ran a full level under Node, no DOM/canvas/audio touched.');
console.log('End-state checksum:');
console.log(JSON.stringify(JSON.parse(a), null, 2));
console.log(`Deterministic across runs (same seed → same checksum): ${a === b ? 'YES' : 'NO'}`);
if (a !== b) {
  console.error('NON-DETERMINISTIC: checksums differ between identical runs.');
  throw new Error('headless sim determinism check failed');
}
