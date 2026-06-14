// Level validation harness — run directly with `npx tsx src/levels/levels.test.ts`
// (throws + non-zero exit on the first failed assertion; `tsc` also typechecks it).
// Proves the acceptance criteria for every authored level:
//   1. validateMap() reports no structural errors
//   2. loadLevel() builds a LevelRuntime + populates the World without throwing
//   3. every spawn (player, monsters, pickups) sits in a non-solid cell its body fits
//   4. thing angles are converted DEGREES → RADIANS
//   5. skill flags filter spawns (easy ≤ normal ≤ hard; hard-only things appear only on hard)
//   6. keys are reachable, every locked door is solvable, and an exit is reachable
import type { MapData, SkillId } from '../core';
import { degToRad, TAU } from '../core';
import { World } from '../entities';
import { positionFits, cellOf } from '../world';
import { EPISODE1_MAPS } from './maps';
import { loadLevel, validateMap, thingSpawnsAtSkill } from './level-loader';
import { analyze } from './solver';
import { EPISODE1, nextLevelId } from './episode';

let passed = 0;
function ok(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
  passed++;
}
function near(a: number, b: number, eps = 1e-3): boolean {
  return Math.abs(a - b) <= eps;
}

function load(map: MapData, skill: SkillId): World {
  const world = new World();
  loadLevel(world, map, skill);
  return world;
}

// ── thingSpawnsAtSkill unit checks (MTF bitmask 1=easy 2=normal 4=hard) ──────────
ok(thingSpawnsAtSkill(7, 1) && thingSpawnsAtSkill(7, 3) && thingSpawnsAtSkill(7, 5), 'skill 7 spawns on all skills');
ok(!thingSpawnsAtSkill(4, 1) && !thingSpawnsAtSkill(4, 2), 'hard-only thing excluded on easy skills');
ok(thingSpawnsAtSkill(4, 4) && thingSpawnsAtSkill(4, 5), 'hard-only thing spawns on UV/Nightmare');
ok(thingSpawnsAtSkill(6, 3) && !thingSpawnsAtSkill(6, 1), 'normal+hard thing: in on Hurt Me Plenty, out on ITYTD');
ok(thingSpawnsAtSkill(0, 3) === false, 'multiplayer-only (no skill bits) never spawns');
console.log(`thingSpawnsAtSkill: ${passed} checks ok`);

let episodeEasy = 0;
let episodeHard = 0;

for (const map of EPISODE1_MAPS) {
  const errs = validateMap(map);
  ok(errs.length === 0, `${map.id} validateMap clean (got: ${errs.join('; ')})`);

  // Load at Hurt Me Plenty and assert the world is populated + structurally sane.
  const world = load(map, 3);
  const level = world.level;
  ok(level !== null && level.data === map, `${map.id} loadLevel installs the runtime`);
  ok(world.monsters.length > 0, `${map.id} spawns at least one monster`);

  // (3) every spawn sits in a non-solid cell whose body fits (no wall overlap).
  const p = world.player;
  ok(positionFits(p.x, p.y, p.radius, level!), `${map.id} player start fits (non-solid)`);
  for (const m of world.monsters) {
    ok(!level!.isSolid(cellOf(m.x), cellOf(m.y)), `${map.id} monster ${m.type} in non-solid cell`);
    ok(positionFits(m.x, m.y, m.radius, level!), `${map.id} monster ${m.type} body fits at (${m.x},${m.y})`);
  }
  for (const pk of world.pickups) {
    ok(!level!.isSolid(cellOf(pk.x), cellOf(pk.y)), `${map.id} pickup ${pk.kind} in non-solid cell`);
    ok(positionFits(pk.x, pk.y, pk.radius, level!), `${map.id} pickup ${pk.kind} body fits`);
  }

  // (4) angle conversion deg → rad: all in range, and the authored 90°/180° headings survive.
  for (const m of world.monsters) ok(m.angle >= -TAU && m.angle <= TAU, `${map.id} ${m.type} angle in radians`);
  const angles = world.monsters.map((m) => m.angle);
  const wantsHalfPi = map.things.some((t) => t.angle === 90);
  const wantsPi = map.things.some((t) => t.angle === 180);
  if (wantsHalfPi) ok(angles.some((a) => near(a, degToRad(90))), `${map.id} a 90° thing → ~π/2 rad`);
  if (wantsPi) ok(angles.some((a) => near(a, degToRad(180))), `${map.id} a 180° thing → ~π rad`);

  // (5) skill filtering: easy ≤ normal ≤ hard spawn counts.
  const easy = load(map, 1).monsters.length;
  const normal = world.monsters.length;
  const hard = load(map, 4).monsters.length;
  ok(easy <= normal && normal <= hard, `${map.id} spawn counts monotonic by skill (${easy}/${normal}/${hard})`);
  episodeEasy += easy;
  episodeHard += hard;

  // (6) solvability: keys reachable, every locked door openable, an exit reachable.
  const r = analyze(map);
  ok(r.exitReachable, `${map.id} has a reachable exit`);
  ok(r.lockedDoorsSolvable, `${map.id} every locked door's key is collectable`);
  for (const [color, reachable] of r.keyCellReachable) ok(reachable, `${map.id} ${color} key is reachable`);

  // Each map must use at least one key-locked door (key-locked progression).
  ok(map.doors.some((d) => d.kind === 'locked'), `${map.id} has a key-locked door`);
  // ≥1 secret area flagged.
  ok(map.secretSectors.length > 0, `${map.id} flags a secret area`);

  console.log(
    `${map.id} "${map.name}" ok — ${world.monsters.length} mon, ${world.pickups.length} items, ` +
      `keys[${[...r.keys].join(',')}], secret ${map.secretSectors.length} cells`,
  );
}

ok(episodeHard > episodeEasy, `episode harder skill spawns more monsters (${episodeEasy} → ${episodeHard})`);

// ── Episode wiring ──────────────────────────────────────────────────────────────
ok(EPISODE1.levels.length >= 3 && EPISODE1.levels.length <= 5, 'episode has 3–5 levels');
for (const lvl of EPISODE1.levels) ok(EPISODE1_MAPS.some((m) => m.id === lvl.id), `${lvl.id} has compiled map data`);
const order = EPISODE1.levels.map((l) => l.id);
for (let i = 0; i < order.length - 1; i++) ok(nextLevelId(EPISODE1, order[i]!) === order[i + 1], `${order[i]} → ${order[i + 1]}`);
ok(nextLevelId(EPISODE1, order[order.length - 1]!) === null, 'final level ends the episode (victory)');

console.log(`\nALL LEVEL CHECKS PASSED (${passed} assertions across ${EPISODE1_MAPS.length} levels)`);
