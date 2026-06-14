// Runtime harness for the multi-player state refactor (multiplayer-plan P1). Run
// directly (`npx tsx src/game/multiplayer.test.ts`); throws on the first failed
// assertion (non-zero exit); `tsc` typechecks it. Proves the P1 acceptance: the sim
// tracks N players in world.players (host-authoritative ids, local player = 0), AI
// targets EITHER player (nearest visible), combat treats any player as source AND
// target, pickups are per-player, two command streams drive two players who move and
// collide independently, and the headless GameSession runs with two players tracked.
import type { MapData } from '../core';
import {
  CELL_SIZE,
  EventBus,
  Rng,
  DEFAULT_SEED,
  type GameEventMap,
  type SimContext,
} from '../core';
import { World, spawnMonster, spawnPickup, createMonster } from '../entities';
import { LevelRuntime, applyThrust, stepMovement, positionFits, cellOf } from '../world';
import { CombatBus, applyDamage, hitscan } from '../combat';
import { lookForTarget } from '../ai';
import { updateItems } from '../items';
import { WeaponSystem } from '../weapons';
import { WEAPONS } from '../data';
import { GameSession, type TicCommand } from './session';

// ── assert plumbing ───────────────────────────────────────────────────────────
let passed = 0;
function ok(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
  passed++;
  console.log(`  ok  ${msg}`);
}

// ── fixtures ──────────────────────────────────────────────────────────────────
function makeMap(width: number, height: number, walls?: number[]): MapData {
  const n = width * height;
  const fill = (v: number): number[] => new Array(n).fill(v);
  return {
    id: 'MPTEST',
    name: 'MultiplayerTest',
    width,
    height,
    cellSize: CELL_SIZE,
    walls: walls ?? fill(0),
    floors: fill(0),
    ceilings: fill(0),
    floorHeights: fill(0),
    ceilHeights: fill(128),
    light: fill(160),
    wallTextures: ['WALL'],
    flatTextures: ['FLAT'],
    sky: 'SKY',
    doors: [],
    lifts: [],
    teleporters: [],
    exits: [],
    secretSectors: [],
    things: [],
    playerStart: { x: CELL_SIZE * 1.5, y: CELL_SIZE * 1.5, angle: 0 },
    par: 30,
  };
}

function buses(): { game: EventBus<GameEventMap>; combat: CombatBus } {
  const game = new EventBus<GameEventMap>();
  return { game, combat: new CombatBus(game) };
}

function spawnMon(world: World, type: Parameters<typeof createMonster>[1], x: number, y: number, angle: number) {
  const m = createMonster(world.allocId(), type, x, y, angle);
  world.monsters.push(m);
  return m;
}

const FACING_WEST = Math.PI; // a monster at the east faces −x toward players to its west

// ── 1. host-authoritative id allocation: local player 0, no id collisions ───────
function testPlayerRegistry(): void {
  console.log('player registry + host-authoritative ids');
  const world = new World();
  ok(world.players.size === 1 && world.localPlayerId === 0 && world.player.id === 0, 'fresh world: one local player at id 0');

  const p0 = world.player;
  const p1 = world.addPlayer(600, 200, 0);
  ok(world.players.size === 2 && p1.id === 1, 'addPlayer registers a second player at the next host-allocated id (1)');
  ok(world.players.get(0) === p0 && world.players.get(1) === p1, 'both players are tracked by stable id');
  ok(world.player === p0, 'the local-player accessor still resolves to id 0 (the client POV)');

  const m = spawnMonster(world, 3004, 0, 0, 0)!;
  ok(m.id === 2, 'monsters allocate ids AFTER the players — no player/entity id collision');
}

// ── 2. AI targets EITHER player — nearest visible in the front cone ─────────────
function testAiTargetsEitherPlayer(): void {
  console.log('AI targets either player (nearest visible)');
  const world = new World();
  world.level = new LevelRuntime(makeMap(16, 16));
  const p0 = world.player;
  p0.x = 200;
  p0.y = 200;
  const p1 = world.addPlayer(600, 200, 0);

  // A monster just east of p0: only p0 is in its (west-facing) front cone → locks p0.
  const mA = spawnMon(world, 'imp', 250, 200, FACING_WEST);
  ok(lookForTarget(world, mA) && mA.target === p0.id, 'monster A locks onto p0 (the only player in its cone)');

  // A monster east of BOTH players: both are in the cone; it must pick the NEAREST (p1).
  const mB = spawnMon(world, 'imp', 650, 200, FACING_WEST);
  ok(lookForTarget(world, mB) && mB.target === p1.id, 'monster B sees both players and locks the NEAREST (p1)');

  // Kill p1; the same monster must re-acquire the other live player (p0) on its next look.
  p1.health = 0;
  mB.target = null;
  ok(lookForTarget(world, mB) && mB.target === p0.id, 'with p1 dead, monster B re-targets the surviving player p0');
}

// ── 3. combat: any player is a valid SOURCE and TARGET ──────────────────────────
function testCombatSourceAndTarget(): void {
  console.log('combat: any player as source + target');
  const world = new World();
  world.level = new LevelRuntime(makeMap(16, 16));
  const p0 = world.player;
  p0.x = 200;
  p0.y = 200;
  const p1 = world.addPlayer(600, 200, 0);
  const { combat } = buses();
  const rng = new Rng(0x2222);

  // As TARGET: a monster's hit routes to the actual target player (p1), not the local one.
  const p0Before = p0.health;
  const p1Before = p1.health;
  applyDamage(world, p1, 20, 999, 'monster', rng, combat, { x: p1.x - 10, y: p1.y });
  ok(p1.health < p1Before && p0.health === p0Before, 'damage to p1 lands on p1 only — the local player (p0) is untouched');

  // As SOURCE: the non-local player p1 shoots a monster (combat originates from any player).
  const z = spawnMon(world, 'zombieman', 700, 200, 0); // due east of p1, point-blank in range
  const zBefore = z.health;
  const w = WEAPONS.shotgun;
  hitscan(world, p1.x, p1.y, 0, w.rangeMu, w.damage, w.spreadShift, w.pellets, w.firstShotAccurate, p1.id, 'player', rng, combat);
  ok(z.health < zBefore, 'the non-local player p1 deals damage as a combat source (shotgun hurts the zombieman)');
}

// ── 4. pickups are per-player ───────────────────────────────────────────────────
function testPerPlayerPickups(): void {
  console.log('pickups are per-player');
  const world = new World();
  world.level = new LevelRuntime(makeMap(16, 16));
  const { game, combat } = buses();
  const p0 = world.player;
  p0.x = 200;
  p0.y = 200;
  p0.health = 50;
  const p1 = world.addPlayer(600, 200, 0);
  p1.health = 50;

  const giver = new WeaponSystem(world, new Rng(1), combat); // local player's giver (unused by health)
  spawnPickup(world, 2011, p1.x, p1.y); // a stimpack sitting on p1
  updateItems({ world, giverFor: () => giver, skill: 3, events: game }, 1);

  ok(p1.health === 60 && p0.health === 50, 'only the touching player (p1) is healed by the stimpack; p0 is unchanged');
  ok(world.pickups.length === 0, 'the collected pickup is removed from the world');
}

// ── 5. two command streams drive two players who move + collide independently ───
function testTwoCommandStreams(): void {
  console.log('two command streams drive two players (move + collide)');
  // A 6-wide arena with a solid wall column at x=4; p1 will walk into it and stop.
  const w = 6;
  const h = 4;
  const walls = new Array(w * h).fill(0) as number[];
  for (let y = 0; y < h; y++) walls[y * w + 4] = 1;
  const level = new LevelRuntime(makeMap(w, h, walls));
  const world = new World();
  world.level = level;

  const p0 = world.player;
  p0.x = CELL_SIZE * 1.5;
  p0.y = CELL_SIZE * 1.5; // top lane (cell row 1)
  const p1 = world.addPlayer(CELL_SIZE * 1.5, CELL_SIZE * 2.5, 0); // bottom lane (cell row 2)

  // Stream 0 pushes p0 south (into open floor); stream 1 pushes p1 east (into the wall).
  for (let i = 0; i < 80; i++) {
    applyThrust(p0, Math.PI / 2, 0.78125, 1); // south
    stepMovement(p0, level, 1);
    applyThrust(p1, 0, 0.78125, 1); // east, toward the wall at x=4
    stepMovement(p1, level, 1);
  }

  ok(cellOf(p0.y) > 1, `stream 0 walked p0 south to a new cell row (y-cell=${cellOf(p0.y)})`);
  ok(cellOf(p1.x) < 4, `stream 1 walked p1 east but the wall blocked it before x-cell 4 (x-cell=${cellOf(p1.x)})`);
  ok(positionFits(p0.x, p0.y, p0.radius, level) && positionFits(p1.x, p1.y, p1.radius, level), 'both players rest in wall-valid positions (independent collision)');
  ok(p0.x !== p1.x || p0.y !== p1.y, 'the two players moved to independent positions');
}

// ── 6. the headless GameSession runs with two players tracked ───────────────────
function testHeadlessSessionTwoPlayers(): void {
  console.log('headless GameSession with two players');
  const events = new EventBus<GameEventMap>();
  const world = new World();
  const rng = new Rng(DEFAULT_SEED);
  const ctx: SimContext = { world, events, rng, skill: 3, episodeLevel: 0 };
  const sim = new GameSession(ctx, { presentation: false });

  sim.startNewGame(3);
  // Add a second player next to the spawned local player, then run the local stream.
  const p1 = world.addPlayer(world.player.x + 64, world.player.y, 0);
  const startX = world.player.x;

  const cmd = (seq: number, over: Partial<TicCommand> = {}): TicCommand => ({
    forward: 0, strafe: 0, turn: 0, lookTurn: 0, run: false, fire: false,
    use: false, weaponSlot: 0, weaponCycle: 0, pause: false, seq, ...over,
  });
  let outcome = 'continue';
  for (let i = 0; i < 40; i++) {
    const r = sim.tic(cmd(i, { forward: 1 }));
    if (r !== 'continue') { outcome = r; break; }
  }

  ok(world.players.size === 2, 'GameSession runs a level with two players tracked');
  ok(outcome === 'continue' && world.player.x !== startX, 'the local command stream advances the local player (id 0)');
  ok(world.players.get(p1.id) === p1, 'the second player stays tracked across tics');
}

// ── run ─────────────────────────────────────────────────────────────────────────
testPlayerRegistry();
testAiTargetsEitherPlayer();
testCombatSourceAndTarget();
testPerPlayerPickups();
testTwoCommandStreams();
testHeadlessSessionTwoPlayers();
console.log(`\nAll ${passed} multiplayer (P1) assertions passed.`);
