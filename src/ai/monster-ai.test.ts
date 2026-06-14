// Runtime harness for src/ai. Like world.test.ts / combat.test.ts it is run
// directly (`npx tsx src/ai/monster-ai.test.ts`) and throws on the first failed
// assertion (non-zero exit); `tsc` typechecks it. Proves the acceptance cases:
// wake-on-LOS, wake-on-sound, chase closes distance, melee hits a player-faction
// target, a ranged monster spawns a projectile (and a hitscan monster deals
// damage), pain interrupts an action, the death→dead transition, that death is
// PERMANENT (a corpse never wakes/re-targets/flips to a live state under sight,
// continued fire, pain, or infighting), and infighting.
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

// States a corpse must NEVER re-enter. The renderer reads `m.state` to pick the
// sprite (idle/chase ⇒ a standing/walking frame), so "stays in a dead state" IS
// the sim-side guarantee behind "never stands back up".
const LIVE_STATES = ['idle', 'chase', 'melee', 'missile', 'pain'];
function isLiveState(s: string): boolean {
  return LIVE_STATES.includes(s);
}

// ── 10. death is permanent: a corpse never re-enters a live state ───────────────
// Regression for "killed monsters sometimes get back up". Kills a monster, then
// runs the sim for a long time with the player point-blank, in the corpse's front
// cone, with clear LOS — the exact setup that wakes a LIVE monster — and proves the
// body never wakes, re-targets, or flips to a standing/active state.
function testDeathIsPermanent(): void {
  console.log('death is permanent');
  const { world, combat, rng } = setup();
  const ai = createMonsterAI(world, rng, combat); // wire the infighting bus too

  const m = chasing(spawnMon(world, 'zombieman', 300, 200, FACING_PLAYER), world.player.id);
  applyDamage(world, m, 25, world.player.id, 'player', rng, combat); // 20hp → −5: lethal, not gib
  ok(m.state === 'death', 'lethal hit set state to death');
  for (let i = 0; i < DEATH_SETTLE_TICS + 1; i++) updateMonsters(world, rng, combat, 1);
  ok(m.state === 'dead', 'death animation settled into an inert corpse');

  // Player point-blank, directly in front of the corpse (it faces −x), clear LOS.
  world.player.x = m.x - 40;
  world.player.y = m.y;
  let everLive = false;
  let everWoke = false;
  for (let i = 0; i < 600; i++) {
    updateMonsters(world, rng, combat, 1);
    if (isLiveState(m.state)) everLive = true;
    if (m.target !== null) everWoke = true;
  }
  ok(!everLive, 'corpse never re-enters a live state across 600 ticks with the player in sight');
  ok(!everWoke, 'corpse never re-acquires a target (never wakes) despite LOS + front cone');
  ok(m.state === 'dead', `corpse held the dead state (now ${m.state})`);
  ok(m.health <= 0, `corpse health stayed non-positive (${m.health})`);

  // Direct sight query on the corpse must also refuse — no sight response when dead.
  ok(!lookForTarget(world, m), 'lookForTarget refuses a dead monster even in front cone + LOS');
  ok(m.target === null, 'lookForTarget left the corpse without a target');

  ai.dispose();
}

// ── 11. a corpse ignores further damage, pain, and infighting ──────────────────
// Pours continuous fire from BOTH the player and a cross-species monster (the
// infighting trigger) onto a gibbed body across and well past the settle window.
// Proves no pain flinch, no re-target, no resurrection — gib stays gibbed.
function testCorpseIgnoresDamageAndInfighting(): void {
  console.log('corpse ignores further damage / pain / infighting');
  const { world, combat, rng } = setup();
  const ai = createMonsterAI(world, rng, combat);

  let painAfterDeath = 0;
  let deathEvents = 0;
  combat.on('entity:death', () => deathEvents++);

  // lostSoul has painChance 256 (always flinches while alive): the worst pain case.
  const m = chasing(spawnMon(world, 'lostSoul', 400, 200, FACING_PLAYER), world.player.id);
  applyDamage(world, m, 9999, world.player.id, 'player', rng, combat); // massive overkill ⇒ gib
  ok(m.state === 'gib', 'massive overkill set state to gib');
  ok(deathEvents === 1, 'death fired exactly once');

  // Only count pain that arrives AFTER the body is already dead.
  combat.on('entity:pain', (e) => {
    if (e.id === m.id && !isLiveState(m.state)) painAfterDeath++;
  });

  const attacker = spawnMon(world, 'imp', 420, 200, 0); // cross-species: would normally infight
  let everLive = false;
  let everWoke = false;
  for (let i = 0; i < 200; i++) {
    applyDamage(world, m, 50, world.player.id, 'player', rng, combat);
    applyDamage(world, m, 50, attacker.id, 'monster', rng, combat); // infighting source
    updateMonsters(world, rng, combat, 1);
    if (isLiveState(m.state)) everLive = true;
    if (m.target !== null) everWoke = true;
  }
  ok(!everLive, 'gibbed body never flips back to a live state under continuous fire');
  ok(!everWoke, 'gibbed body never re-targets despite cross-species (infighting) hits');
  ok(painAfterDeath === 0, 'no pain flinch is ever rolled on the corpse');
  ok(deathEvents === 1, 'death never fires a second time (no re-kill/re-spawn loop)');
  ok(m.health <= 0, `corpse health stayed non-positive (${m.health})`);
  ok(m.state === 'dead', `gib settled to an inert corpse and held it (now ${m.state})`);

  ai.dispose();
}

// ── 12. infighting target switch ───────────────────────────────────────────────
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
  testDeathIsPermanent();
  testCorpseIgnoresDamageAndInfighting();
  testInfighting();
  console.log(`\nAll ${passed} AI assertions passed.`);
}

main();
