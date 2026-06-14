// Runtime harness for src/entities factories + src/combat resolution. Like
// world.test.ts it is run directly (`npx tsx src/combat/combat.test.ts`) and throws
// on the first failed assertion (non-zero exit); `tsc` typechecks it. Proves the
// acceptance cases: roster spawn stats, pistol/shotgun hitscan kills a zombieman in
// the data-correct shot count, rocket splash damages a target with LOS but is
// blocked by an intervening wall, the armor split, pain-chance, knockback, death.
import type { MapData, Monster } from '../core';
import {
  Rng,
  EventBus,
  CELL_SIZE,
  ARMOR_GREEN_FACTOR,
  ARMOR_BLUE_FACTOR,
  KNOCKBACK_SCALE,
  type GameEventMap,
} from '../core';
import { WEAPONS, ENEMIES } from '../data';
import { World, createMonster, spawnMonster, createProjectile, createPickup, spawnPickup } from '../entities';
import { LevelRuntime } from '../world';
import { CombatBus, hitscan, radiusDamage, applyDamage, fireProjectile, updateProjectiles } from './index';

// ── assert plumbing ───────────────────────────────────────────────────────────
let passed = 0;
function ok(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
  passed++;
  console.log(`  ok  ${msg}`);
}
function near(a: number, b: number, eps = 1e-3): boolean {
  return Math.abs(a - b) <= eps;
}
function must<T>(v: T | null | undefined, msg: string): T {
  if (v === null || v === undefined) throw new Error(`FAIL: ${msg}`);
  return v;
}

// ── fixtures ───────────────────────────────────────────────────────────────────
function makeMap(width: number, height: number, walls?: number[]): MapData {
  const n = width * height;
  const fill = (v: number): number[] => new Array(n).fill(v);
  return {
    id: 'CTEST',
    name: 'CombatTest',
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

function freshWorld(level?: LevelRuntime): World {
  const world = new World();
  if (level) world.level = level;
  return world;
}

function buses(): { game: EventBus<GameEventMap>; combat: CombatBus } {
  const game = new EventBus<GameEventMap>();
  return { game, combat: new CombatBus(game) };
}

// ── 1. factory roster stats ──────────────────────────────────────────────────--
function testFactories(): void {
  console.log('factory stats');
  // Every roster monster spawns with its EnemyDef stats.
  for (const type of Object.keys(ENEMIES) as Array<keyof typeof ENEMIES>) {
    const def = ENEMIES[type];
    const m = createMonster(99, def.type, 0, 0, 0);
    ok(
      m.type === def.type && m.health === def.health && m.radius === def.radiusMu && m.state === 'idle',
      `createMonster ${def.type}: hp=${m.health} r=${m.radius} state=idle`,
    );
  }

  // spawnMonster resolves the DoomEd thing id, registers, and emits monster:spawned.
  const game = new EventBus<GameEventMap>();
  const world = freshWorld();
  let spawnedId = -1;
  game.on('monster:spawned', (p) => (spawnedId = p.id));
  const z = must(spawnMonster(world, 3004, 128, 64, 0, game), 'spawnMonster(3004) → zombieman');
  ok(z.type === 'zombieman' && world.monsters.length === 1, 'spawnMonster registers a zombieman');
  ok(spawnedId === z.id, 'spawnMonster emits monster:spawned with the new id');
  ok(spawnMonster(world, 999999, 0, 0, 0) === null, 'spawnMonster(unknown id) → null');

  // Projectile carries its velocity from angle*speed and its damage/splash spec.
  const proj = createProjectile(7, z.id, 'monster', 0, 0, 0, {
    damage: { n: 8, m: 3 },
    speed: 10,
    sprite: 'BAL1',
    splashRadius: 0,
  });
  ok(near(proj.velX, 10) && near(proj.velY, 0) && proj.sprite === 'BAL1', 'createProjectile sets velocity + sprite');

  // Pickup resolves an item by thing id.
  const stim = must(createPickup(5, 2011, 10, 20), 'createPickup(2011) → stimpack');
  ok(stim.kind === 'health' && stim.thingId === 2011, 'createPickup stimpack is a health pickup');
  const reg = must(spawnPickup(world, 2018, 0, 0), 'spawnPickup(2018) → green armor');
  ok(reg.kind === 'armor' && world.pickups.length === 1, 'spawnPickup registers a green-armor pickup');
  ok(spawnPickup(world, 123456, 0, 0) === null, 'spawnPickup(unknown id) → null');
}

// ── 2. pistol hitscan kills a zombieman in the data-correct shot count ─────────
function testPistolKillsZombieman(): void {
  console.log('pistol hitscan kills zombieman');
  const { game, combat } = buses();
  const world = freshWorld(); // no level → open arena, clear LOS
  world.player.x = 100;
  world.player.y = 100;
  world.player.angle = 0;
  const z = must(spawnMonster(world, 3004, 300, 100, 0), 'spawn zombieman');
  const startHp = z.health; // 20
  let died = 0;
  game.on('monster:died', () => died++);

  const rng = new Rng(0xc0ffee);
  const w = WEAPONS.pistol;
  let shots = 0;
  while (z.health > 0 && shots < 10) {
    const before = z.health;
    hitscan(world, world.player.x, world.player.y, 0, w.rangeMu, w.damage, w.spreadShift, w.pellets, w.firstShotAccurate, world.player.id, 'player', rng, combat);
    const dealt = before - z.health;
    ok(dealt === 5 || dealt === 10 || dealt === 15, `pistol shot dealt d3×5 damage (${dealt})`);
    shots++;
  }
  // 20 HP / (5..15 per shot) → between 2 and 4 pistol shots.
  ok(z.health <= 0 && shots >= 2 && shots <= 4, `zombieman dies in ${shots} pistol shots (2–4 expected)`);
  ok(z.state === 'death' && died === 1, 'death sets state=death and emits monster:died once');
  ok(startHp === 20, 'zombieman started at the data HP (20)');
}

// ── 3. one shotgun blast kills a zombieman ────────────────────────────────────
function testShotgunOneShotKill(): void {
  console.log('shotgun one-blast kill');
  const { combat } = buses();
  const world = freshWorld();
  world.player.x = 100;
  world.player.y = 100;
  const z = must(spawnMonster(world, 3004, 180, 100, 0), 'spawn zombieman'); // close → all pellets connect
  const rng = new Rng(0x1234);
  const w = WEAPONS.shotgun; // 7 pellets, d3×5 each → ≥35 min
  hitscan(world, world.player.x, world.player.y, 0, w.rangeMu, w.damage, w.spreadShift, w.pellets, w.firstShotAccurate, world.player.id, 'player', rng, combat);
  ok(z.health <= 0, `one shotgun blast (7×d3×5) kills the 20-HP zombieman (hp=${z.health})`);
}

// ── 4. rocket splash: LOS damages, intervening wall blocks ────────────────────
function testRocketSplashLos(): void {
  console.log('rocket splash + LOS block');
  const splash = WEAPONS.rocketLauncher.splashRadius; // 128
  const rng = new Rng(0xaa);

  // Geometry: explosion (180,160) cell(2,2); target (320,160) cell(5,2); centre
  // distance 140 → in splash range. A wall can sit at the intermediate cell (4,2).
  const explodeX = 180;
  const explodeY = 160;

  // (a) clear LOS → target takes splash.
  {
    const { combat } = buses();
    const world = freshWorld(new LevelRuntime(makeMap(8, 4)));
    const z = must(spawnMonster(world, 3004, 320, 160, 0), 'spawn target');
    radiusDamage(world, explodeX, explodeY, splash, 999, 'player', rng, combat);
    ok(z.health < 20 && z.health > 0, `splash with LOS damages the target (hp ${z.health} < 20)`);
  }

  // (b) wall at cell (4,2) strictly between → splash blocked, no damage.
  {
    const { combat } = buses();
    const walls = new Array(8 * 4).fill(0) as number[];
    walls[2 * 8 + 4] = 1; // solid cell (4,2)
    const world = freshWorld(new LevelRuntime(makeMap(8, 4, walls)));
    const z = must(spawnMonster(world, 3004, 320, 160, 0), 'spawn target');
    radiusDamage(world, explodeX, explodeY, splash, 999, 'player', rng, combat);
    ok(z.health === 20, `intervening wall blocks the splash (hp ${z.health} unchanged)`);
  }
}

// ── 5. end-to-end rocket flight: direct+splash hit, and wall stops the rocket ──
function testRocketFlight(): void {
  console.log('rocket flight (movement + impact)');
  const rl = WEAPONS.rocketLauncher;
  const spec = { damage: rl.damage, speed: rl.projectileSpeed, sprite: rl.projectileSprite, splashRadius: rl.splashRadius };

  // (a) rocket flies into a zombieman and detonates (direct + splash kills it).
  {
    const { combat } = buses();
    const world = freshWorld(new LevelRuntime(makeMap(16, 12)));
    world.player.x = 100;
    world.player.y = 300;
    const z = must(spawnMonster(world, 3004, 500, 300, 0), 'spawn target');
    let impacts = 0;
    combat.on('projectile:impact', () => impacts++);
    fireProjectile(world, world.player, 'player', 0, spec);
    for (let i = 0; i < 60 && world.projectiles.length > 0; i++) updateProjectiles(world, new Rng(i + 1), combat, 1);
    ok(z.health <= 0 && world.projectiles.length === 0 && impacts === 1, 'rocket reaches the target, detonates, and kills it');
  }

  // (b) a wall between shooter and a far target stops the rocket; target unharmed.
  {
    const { combat } = buses();
    const walls = new Array(16 * 12).fill(0) as number[];
    for (let y = 0; y < 12; y++) walls[y * 16 + 5] = 1; // solid column at cell x=5
    const world = freshWorld(new LevelRuntime(makeMap(16, 12, walls)));
    world.player.x = 100;
    world.player.y = 300;
    const z = must(spawnMonster(world, 3004, 800, 300, 0), 'spawn far target'); // beyond splash range
    let targetId: number | null = -1;
    combat.on('projectile:impact', (p) => (targetId = p.targetId));
    fireProjectile(world, world.player, 'player', 0, spec);
    for (let i = 0; i < 80 && world.projectiles.length > 0; i++) updateProjectiles(world, new Rng(i + 1), combat, 1);
    ok(world.projectiles.length === 0 && targetId === null, 'rocket detonates on the wall (impact targetId=null)');
    ok(z.health === 20, `far target behind the wall is unharmed (hp ${z.health})`);
  }
}

// ── 6. armor split (green 1/3, blue 1/2) ──────────────────────────────────────
function testArmorSplit(): void {
  console.log('armor damage split');
  // Green absorbs 1/3.
  {
    const { combat } = buses();
    const world = freshWorld();
    world.player.health = 100;
    world.player.armor = { points: 100, factor: ARMOR_GREEN_FACTOR };
    applyDamage(world, world.player, 9, 999, 'monster', new Rng(1), combat, { x: world.player.x - 10, y: world.player.y });
    ok(world.player.health === 94 && world.player.armor.points === 97, `green armor: 9 dmg → 6 to health, 3 to armor (hp=${world.player.health}, armor=${world.player.armor.points})`);
  }
  // Blue absorbs 1/2.
  {
    const { combat } = buses();
    const world = freshWorld();
    world.player.health = 100;
    world.player.armor = { points: 200, factor: ARMOR_BLUE_FACTOR };
    applyDamage(world, world.player, 10, 999, 'monster', new Rng(1), combat, { x: world.player.x - 10, y: world.player.y });
    ok(world.player.health === 95 && world.player.armor.points === 195, `blue armor: 10 dmg → 5 to health, 5 to armor (hp=${world.player.health}, armor=${world.player.armor.points})`);
  }
}

// ── 7. pain-chance, knockback, death events ───────────────────────────────────
function testPainKnockbackDeath(): void {
  console.log('pain / knockback / death');
  // Lost soul always flinches (painChance 256) and is knocked back (low mass 56).
  {
    const { combat } = buses();
    const world = freshWorld();
    const ls = createMonster(world.allocId(), 'lostSoul', 200, 0, 0);
    world.monsters.push(ls);
    let pain = 0;
    combat.on('entity:pain', () => pain++);
    applyDamage(world, ls, 10, 999, 'monster', new Rng(5), combat, { x: 100, y: 0 }); // hit from the left
    ok(ls.state === 'pain' && pain === 1, 'lost soul flinches (painChance 256) and emits entity:pain');
    const expectedThrust = (10 * KNOCKBACK_SCALE) / ENEMIES.lostSoul.mass;
    ok(ls.velX > 0 && near(ls.velX, expectedThrust, 1e-6), `knockback thrust ≈ dmg*12.5/mass pushed it +x (velX=${ls.velX.toFixed(3)})`);
  }
  // flinchImmune suppresses pain.
  {
    const { combat } = buses();
    const world = freshWorld();
    const ls = createMonster(world.allocId(), 'lostSoul', 200, 0, 0);
    ls.flinchImmune = true;
    world.monsters.push(ls);
    let pain = 0;
    combat.on('entity:pain', () => pain++);
    applyDamage(world, ls, 5, 999, 'monster', new Rng(5), combat);
    ok(ls.state === 'idle' && pain === 0, 'flinchImmune monster ignores pain');
  }
  // Overkill gibs; lethal-but-not-overkill is a normal death.
  {
    const { game, combat } = buses();
    const world = freshWorld();
    let died = 0;
    let deathGibbed: boolean | null = null;
    game.on('monster:died', () => died++);
    combat.on('entity:death', (p) => (deathGibbed = p.gibbed));
    const z = must(spawnMonster(world, 3004, 0, 0, 0), 'spawn zombie');
    applyDamage(world, z, 25, 999, 'player', new Rng(5), combat); // 20 HP → -5, not overkill
    ok(z.state === 'death' && died === 1 && deathGibbed === false, 'lethal hit → death + monster:died, not gibbed');
    const z2 = must(spawnMonster(world, 3004, 0, 0, 0), 'spawn zombie 2');
    applyDamage(world, z2, 50, 999, 'player', new Rng(5), combat); // -30 < -20 → gib
    ok(z2.state === 'gib', 'overkill (> spawnHealth) gibs the monster');
  }
}

// ── 8. infighting hook: cross-faction splash damages allies ───────────────────
function testInfightingSurface(): void {
  console.log('entity:damaged carries the source (infighting)');
  const { combat } = buses();
  const world = freshWorld();
  const a = must(spawnMonster(world, 3004, 100, 0, 0), 'monster A');
  const b = must(spawnMonster(world, 3004, 130, 0, 0), 'monster B');
  const events: Array<{ targetId: number; sourceId: number }> = [];
  combat.on('entity:damaged', (p) => events.push({ targetId: p.targetId, sourceId: p.sourceId }));
  // A rocket "owned by" monster A explodes between them → B takes splash from A.
  radiusDamage(world, 115, 0, 128, a.id, 'monster', new Rng(9), combat);
  const hitB = events.find((e) => e.targetId === b.id);
  ok(hitB !== undefined && hitB.sourceId === a.id, 'monster B got entity:damaged tagging monster A as source');
  ok((b as Monster).health < ENEMIES.zombieman.health, 'monster B actually took splash damage');
}

// ── run ──────────────────────────────────────────────────────────────────────
testFactories();
testPistolKillsZombieman();
testShotgunOneShotKill();
testRocketSplashLos();
testRocketFlight();
testArmorSplit();
testPainKnockbackDeath();
testInfightingSurface();
console.log(`\nAll ${passed} combat assertions passed.`);
