// Runtime harness for src/ai. Like world.test.ts / combat.test.ts it is run
// directly (`npx tsx src/ai/monster-ai.test.ts`) and throws on the first failed
// assertion (non-zero exit); `tsc` typechecks it. Proves the acceptance cases:
// wake-on-LOS, wake-on-sound, chase closes distance, melee hits a player-faction
// target, a ranged monster spawns a projectile (and a hitscan monster deals
// damage), pain interrupts an action, the death→dead transition, and infighting.
import type { MapData, Monster, MonsterType } from '../core';
import { CELL_SIZE, EventBus, Rng, type GameEventMap } from '../core';
import { World, createMonster } from '../entities';
import { LevelRuntime } from '../world';
import { CombatBus, applyDamage } from '../combat';
import { DEATH_SETTLE_TICS, PAIN_TICS } from './tuning';
import { createMonsterAI, updateMonsters, lookForTarget, noiseAlert } from './index';

// ── assert plumbing ───────────────────────────────────────────────────────────
let passed = 0;
function ok(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
  passed++;
  console.log(`  ok  ${msg}`);
}

// ── fixtures ────────────────────────────────────────────────────────────────--
function makeMap(width: number, height: number, walls?: number[]): MapData {
  const n = width * height;
  const fill = (v: number): number[] => new Array(n).fill(v);
  return {
    id: 'AITEST',
    name: 'AITest',
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

interface Setup {
  world: World;
  combat: CombatBus;
  rng: Rng;
}

function setup(playerX = 200, playerY = 200): Setup {
  const world = new World();
  world.level = new LevelRuntime(makeMap(16, 16));
  world.player.x = playerX;
  world.player.y = playerY;
  const combat = new CombatBus(new EventBus<GameEventMap>());
  return { world, combat, rng: new Rng(0xa1b2c3) };
}

/** Spawn a monster into the world and return it. `angle` is radians. */
function spawnMon(world: World, type: MonsterType, x: number, y: number, angle: number): Monster {
  const m = createMonster(world.allocId(), type, x, y, angle);
  world.monsters.push(m);
  return m;
}

/** Put a monster straight into an awake, ready-to-act chase on the player. */
function chasing(m: Monster, playerId: number): Monster {
  m.state = 'chase';
  m.target = playerId;
  m.reactionTime = 0;
  return m;
}

const FACING_PLAYER = Math.PI; // monster placed east of the player faces west (−x)
const FACING_AWAY = 0;

// ── 1. wake on line-of-sight ───────────────────────────────────────────────────
function testWakeOnSight(): void {
  console.log('wake on sight');
  const { world, combat, rng } = setup();
  const m = spawnMon(world, 'imp', 400, 200, FACING_PLAYER);
  ok(lookForTarget(world, m), 'lookForTarget sees player in front cone + LOS');

  const m2 = spawnMon(world, 'imp', 400, 400, FACING_AWAY);
  ok(!lookForTarget(world, m2), 'lookForTarget fails when player is behind (outside cone)');

  updateMonsters(world, rng, combat, 1);
  ok(m.state === 'chase' && m.target === world.player.id, 'sighting monster transitions idle→chase');
  ok(m2.state === 'idle', 'facing-away monster stays idle (no sight)');
}

// ── 2. wake on sound ────────────────────────────────────────────────────────--
function testWakeOnSound(): void {
  console.log('wake on sound');
  const { world } = setup();
  const m = spawnMon(world, 'zombieman', 400, 200, FACING_AWAY); // can't see the player
  ok(!lookForTarget(world, m), 'monster facing away cannot see the player');

  const woke = noiseAlert(world, world.player.x, world.player.y, world.player.id);
  ok(woke === 1, `noiseAlert woke ${woke} idle monster`);
  ok(m.state === 'chase' && m.target === world.player.id, 'sound wakes the monster toward the noise maker');
}

// ── 3. chase closes distance ───────────────────────────────────────────────────
function testChaseClosesDistance(): void {
  console.log('chase closes distance');
  const { world, combat, rng } = setup();
  const m = chasing(spawnMon(world, 'demon', 600, 200, FACING_PLAYER), world.player.id);
  const before = Math.hypot(m.x - world.player.x, m.y - world.player.y);
  for (let i = 0; i < 20; i++) updateMonsters(world, rng, combat, 1);
  const after = Math.hypot(m.x - world.player.x, m.y - world.player.y);
  ok(after < before - 100, `chase reduced distance ${before.toFixed(0)}→${after.toFixed(0)} mu`);
}

// ── 4. melee monster damages a player-faction target ───────────────────────────
function testMeleeDamagesPlayer(): void {
  console.log('melee damages player');
  const { world, combat, rng } = setup();
  chasing(spawnMon(world, 'demon', 270, 200, FACING_PLAYER), world.player.id); // dist 70 ≤ reach 80
  const hp0 = world.player.health;
  for (let i = 0; i < 15; i++) updateMonsters(world, rng, combat, 1);
  ok(world.player.health < hp0, `demon melee hurt the player ${hp0}→${world.player.health}`);
}

// ── 5. ranged monster spawns a projectile ─────────────────────────────────────--
function testRangedSpawnsProjectile(): void {
  console.log('ranged spawns projectile');
  const { world, combat, rng } = setup();
  chasing(spawnMon(world, 'imp', 600, 200, FACING_PLAYER), world.player.id); // out of melee, in missile range
  for (let i = 0; i < 10; i++) updateMonsters(world, rng, combat, 1);
  ok(world.projectiles.length >= 1, `imp fired ${world.projectiles.length} projectile(s)`);
}

// ── 6. hitscan monster deals damage ────────────────────────────────────────────
function testHitscanDamagesPlayer(): void {
  console.log('hitscan damages player');
  const { world, combat, rng } = setup();
  chasing(spawnMon(world, 'zombieman', 230, 200, FACING_PLAYER), world.player.id); // dist 30: spread can't miss
  const hp0 = world.player.health;
  for (let i = 0; i < 40; i++) updateMonsters(world, rng, combat, 1);
  ok(world.player.health < hp0, `zombieman hitscan hurt the player ${hp0}→${world.player.health}`);
}

// ── 7. pain interrupts the current action ─────────────────────────────────────--
function testPainInterrupts(): void {
  console.log('pain interrupts');
  const { world, combat, rng } = setup();
  const m = chasing(spawnMon(world, 'lostSoul', 400, 200, FACING_PLAYER), world.player.id);
  applyDamage(world, m, 5, world.player.id, 'player', rng, combat); // painChance 256 → always flinch
  ok(m.state === 'pain', 'taking damage interrupted chase into pain');
  for (let i = 0; i < PAIN_TICS + 2; i++) updateMonsters(world, rng, combat, 1);
  ok(m.state !== 'pain', `pain flinch ends and the monster resumes acting (now ${m.state})`);
}

// ── 8. death → dead transition ────────────────────────────────────────────────--
function testDeathTransition(): void {
  console.log('death transition');
  const { world, combat, rng } = setup();
  const m = chasing(spawnMon(world, 'zombieman', 300, 200, FACING_PLAYER), world.player.id);
  applyDamage(world, m, 25, world.player.id, 'player', rng, combat); // 20hp → −5: lethal, not gib
  ok(m.state === 'death', 'lethal hit set state to death');
  for (let i = 0; i < DEATH_SETTLE_TICS + 1; i++) updateMonsters(world, rng, combat, 1);
  ok(m.state === 'dead', 'death animation settles into an inert corpse (dead)');
}

// ── 9. infighting target switch ────────────────────────────────────────────────
function testInfighting(): void {
  console.log('infighting');
  const { world, combat, rng } = setup();
  const ai = createMonsterAI(world, rng, combat);

  const attacker = spawnMon(world, 'zombieman', 200, 200, 0);
  const victim = spawnMon(world, 'imp', 300, 200, 0);
  ok(victim.target === null, 'victim starts with no target');
  applyDamage(world, victim, 5, attacker.id, 'monster', rng, combat);
  ok(victim.target === attacker.id, 'cross-species monster hit retargets the victim onto the attacker');

  const dA = spawnMon(world, 'demon', 500, 200, 0);
  const dB = spawnMon(world, 'demon', 600, 200, 0);
  applyDamage(world, dB, 5, dA.id, 'monster', rng, combat);
  ok(dB.target === null, 'same-species friendly fire does NOT trigger infighting');

  ai.dispose();
}

// ── run ─────────────────────────────────────────────────────────────────────--
function main(): void {
  testWakeOnSight();
  testWakeOnSound();
  testChaseClosesDistance();
  testMeleeDamagesPlayer();
  testRangedSpawnsProjectile();
  testHitscanDamagesPlayer();
  testPainInterrupts();
  testDeathTransition();
  testInfighting();
  console.log(`\nAll ${passed} AI assertions passed.`);
}

main();
