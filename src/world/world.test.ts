// Lightweight runtime harness for src/world. Not a unit-test-framework file: it
// is run directly with `npx tsx src/world/world.test.ts` and throws on the first
// failed assertion (non-zero exit). Proves the acceptance cases: wall block +
// slide, door block/open/close, lift tier animation + step-up, teleporter
// relocation, and the friction/clamp/snap movement model. `tsc` typechecks it.
import type { MapData, Player, Entity } from '../core';
import { CELL_SIZE, FRICTION, MAX_MOVE, STOP_SPEED } from '../core';
import { LevelRuntime } from './level-runtime';
import { moveEntity, positionFits } from './collision';
import { applyThrust, stepMovement, type MovingBody } from './physics';
import { updateDoors, tryUseDoor, checkWalkoverTriggers } from './doors';

// ── tiny assert plumbing ─────────────────────────────────────────────────────
let passed = 0;
function ok(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
  passed++;
  console.log(`  ok  ${msg}`);
}
function near(a: number, b: number, eps = 1e-3): boolean {
  return Math.abs(a - b) <= eps;
}

// ── fixtures ─────────────────────────────────────────────────────────────────
function makeMap(width: number, height: number, walls?: number[]): MapData {
  const n = width * height;
  const fill = (v: number): number[] => new Array(n).fill(v);
  return {
    id: 'TEST',
    name: 'Test',
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

function body(x: number, y: number, radius = 16): MovingBody {
  return { id: 1, x, y, angle: 0, radius, active: true, velX: 0, velY: 0 };
}

function playerWithKeys(red: boolean): Player {
  return {
    inventory: {
      keys: {
        red: { card: red, skull: false },
        blue: { card: false, skull: false },
        yellow: { card: false, skull: false },
      },
    },
  } as unknown as Player;
}

// ── 1. wall block + slide ────────────────────────────────────────────────────
function testWallBlockAndSlide(): void {
  console.log('wall block + slide');
  // 4x4 with a solid vertical wall down column x=2.
  const walls = new Array(16).fill(0) as number[];
  for (let y = 0; y < 4; y++) walls[y * 4 + 2] = 1;
  const level = new LevelRuntime(makeMap(4, 4, walls));

  // head-on into the wall from cell (1,1): cannot pass, stops flush (x <= 112).
  const a = body(96, 96);
  moveEntity(a, 200, 0, level);
  ok(a.x > 96 && a.x <= CELL_SIZE * 2 - a.radius + 1e-3, `head-on stops flush at wall (x=${a.x.toFixed(2)}, <=112)`);
  ok(positionFits(a.x, a.y, a.radius, level), 'resting position does not overlap the wall');

  // diagonal into the wall: X (into wall) blocked, Y (along wall) slides full.
  const b = body(96, 96);
  moveEntity(b, 50, 50, level);
  ok(b.x < CELL_SIZE * 2 - b.radius + 1e-3, 'diagonal: blocked on the into-wall axis');
  ok(near(b.y, 146, 0.5), `diagonal: slides full along the wall (y=${b.y.toFixed(2)})`);
}

// ── 2. doors: block, open, pass, close, re-block ─────────────────────────────
function testDoors(): void {
  console.log('doors');
  // 5x3, corridor along row 1; door at cell (2,1). Rows 0/2 solid border.
  const w = 5;
  const h = 3;
  const walls = new Array(w * h).fill(1) as number[];
  for (let x = 0; x < w; x++) walls[1 * w + x] = 0; // open the corridor row
  walls[1 * w + 2] = 1; // door cell carries a wall id (closed face)
  const data = makeMap(w, h, walls);
  data.doors = [{ x: 2, y: 1, kind: 'normal', speed: 0.1, waitTics: 5, texture: 'DOOR' }];
  const level = new LevelRuntime(data);

  ok(level.isSolid(2, 1) && near(level.doorOpenAt(2, 1), 0), 'closed door is solid + occlusion 0');

  // closed door blocks an entity trying to walk east through it.
  const e1 = body(32, 96);
  moveEntity(e1, 200, 0, level);
  ok(e1.x < CELL_SIZE * 2 - e1.radius + 1e-3, `closed door blocks passage (x=${e1.x.toFixed(2)})`);

  // use the door, then tick until fully open.
  ok(tryUseDoor(level, 2, 1, playerWithKeys(false)), 'use opens an unlocked door');
  updateDoors(level, 0.4); // ~14 tics @ speed 0.1/tic -> fully open
  ok(near(level.doorOpenAt(2, 1), 1) && !level.isSolid(2, 1), 'door fully open + occlusion 1 + passable');

  // now the entity passes through to the far side of the door.
  const e2 = body(32, 96);
  moveEntity(e2, 200, 0, level);
  ok(e2.x > CELL_SIZE * 2, `open door lets the entity pass (x=${e2.x.toFixed(2)} > 128)`);

  // wait out the open timer, then close — door re-blocks.
  updateDoors(level, 0.6); // wait 5 tics then close ~10 tics
  ok(near(level.doorOpenAt(2, 1), 0) && level.isSolid(2, 1), 'door auto-closed + solid again');

  // locked door rejects without the key, opens with it.
  const ld = makeMap(3, 1, [1, 1, 1]);
  ld.doors = [{ x: 1, y: 0, kind: 'locked', key: 'red', speed: 0.1, waitTics: -1, texture: 'DOOR' }];
  const locked = new LevelRuntime(ld);
  ok(!tryUseDoor(locked, 1, 0, playerWithKeys(false)), 'locked door refuses without key');
  ok(tryUseDoor(locked, 1, 0, playerWithKeys(true)), 'locked door opens with the key');
}

// ── 3. lifts: tier animation + step-up gating ────────────────────────────────
function testLifts(): void {
  console.log('lifts');
  const data = makeMap(3, 3); // fully open floor
  data.lifts = [
    {
      cells: [{ x: 1, y: 1 }],
      lowHeight: 0,
      highHeight: 48,
      speed: 4,
      waitTics: 10,
      trigger: { kind: 'walkover', x: 1, y: 1, once: false },
    },
  ];
  const level = new LevelRuntime(data);

  ok(near(level.floorHeightAt(1, 1), 48), 'lift starts at the high tier (48)');
  // raised lift (48mu) is >24 step-up above a neighbour floor (0) -> blocks entry.
  ok(!positionFits(96, 96, 16, level, 0), 'raised lift blocks step-up onto it');

  // walking onto the trigger cell starts the lift; tick it down to the low tier.
  const rider = body(96, 96, 16);
  checkWalkoverTriggers(level, rider);
  updateDoors(level, 0.4); // ~14 tics @ 4mu/tic lowers 48 -> 0
  ok(near(level.floorHeightAt(1, 1), 0), `lift lowered to the low tier (h=${level.floorHeightAt(1, 1)})`);
  ok(positionFits(96, 96, 16, level, 0), 'lowered lift is now steppable');

  // it waits, then raises back to the high tier.
  updateDoors(level, 1.0); // wait 10 tics + raise 12 tics
  ok(near(level.floorHeightAt(1, 1), 48), 'lift returned to the high tier');
}

// ── 4. teleporter relocation + facing ────────────────────────────────────────
function testTeleporter(): void {
  console.log('teleporter');
  const data = makeMap(6, 6);
  data.teleporters = [
    { trigger: { kind: 'walkover', x: 1, y: 1, once: false }, destX: 300, destY: 280, destAngle: 90 },
  ];
  const level = new LevelRuntime(data);
  const e: Entity = body(96, 96);
  checkWalkoverTriggers(level, e);
  ok(near(e.x, 300) && near(e.y, 280), `teleported to destination (${e.x},${e.y})`);
  ok(near(e.angle, Math.PI / 2), 'faces the destination angle (90deg)');
}

// ── 5. movement physics: friction / clamp / snap / steady-state ───────────────
function testPhysics(): void {
  console.log('movement physics');
  const level = new LevelRuntime(makeMap(9, 9)); // wide open

  // friction decays momentum by exactly FRICTION per tic in open space.
  const f = body(288, 288);
  f.velX = 10;
  stepMovement(f, level, 1);
  ok(near(f.velX, 10 * FRICTION), `friction decay = FRICTION/tic (velX=${f.velX.toFixed(4)})`);

  // per-axis momentum is clamped to MAXMOVE before the move.
  const c = body(288, 288);
  c.velX = 100;
  const x0 = c.x;
  stepMovement(c, level, 1);
  ok(near(c.x - x0, MAX_MOVE), `momentum clamped to MAXMOVE for the move (dx=${(c.x - x0).toFixed(2)})`);
  ok(near(c.velX, MAX_MOVE * FRICTION), 'post-clamp momentum then decays by friction');

  // momentum below STOPSPEED snaps to rest.
  const s = body(288, 288);
  s.velX = STOP_SPEED * 0.8;
  stepMovement(s, level, 1);
  ok(s.velX === 0, 'sub-STOPSPEED momentum snaps to 0');

  // running into a wall zeroes the blocked axis (clean stop, no residual push).
  const wl = new LevelRuntime(makeMap(3, 3, [0, 0, 1, 0, 0, 1, 0, 0, 1]));
  const z = body(96, 96);
  z.velX = 20;
  stepMovement(z, wl, 1);
  ok(z.velX === 0, 'momentum into a wall is zeroed');

  // steady-state speed under constant thrust converges to T*friction/(1-friction)
  // (the faithful DOOM tic order: thrust -> move -> friction).
  const T = 0.78125; // DOOM walk thrust forwardmove[0]=25 -> 25*2048/65536 mu/tic
  const p = body(288, 288);
  for (let i = 0; i < 400; i++) {
    applyThrust(p, 0, T, 1);
    stepMovement(p, level, 1);
    if (p.x > 480) p.x = 288; // recycle space; physics unaffected
  }
  const expected = (T * FRICTION) / (1 - FRICTION);
  ok(near(p.velX, expected, 1e-3), `steady-state matches DOOM friction model (velX=${p.velX.toFixed(3)} ~= ${expected.toFixed(3)})`);
}

// ── run ──────────────────────────────────────────────────────────────────────
testWallBlockAndSlide();
testDoors();
testLifts();
testTeleporter();
testPhysics();
console.log(`\nAll ${passed} world assertions passed.`);
