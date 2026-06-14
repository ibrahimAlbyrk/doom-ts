// P4 co-op completeness — headless integration over the REAL authoritative code paths
// (multiplayer-plan P4). Drives a live GameSession + the CoopMode rule set + the server sound
// collector + the snapshot/HUD sync, asserting the five P4 deliverables without a browser:
//   1. GameMode (coop): FF off, monsters on, co-op spawns.
//   2. Respawn (D3): a dead marine returns after a delay with a fresh loadout; monsters/level intact.
//   3. Full state sync: a marine's whole loadout round-trips snapshot → client HUD fields.
//   4. Per-player weapons: a weapon pickup grants ONLY to the marine who touched it.
//   5. Networked SFX: gunfire / monster / door / pickup become positional NetSounds.
//   6. Level flow: reaching the exit advances the party to the next level.
// Run: `npx tsx server/coop-complete.test.ts`. Throws on the first failed assertion.
import {
  EventBus,
  Rng,
  DEFAULT_SEED,
  HEALTH_START,
  type GameEventMap,
  type SimContext,
} from '../src/core';
import { World, spawnMonster, spawnPickup } from '../src/entities';
import { applyDamage } from '../src/combat';
import { GameSession, type TicCommand } from '../src/game/session';
import { buildSnapshot, applyPlayerInventory } from '../src/session/snapshot';
import { defaultMatchConfig } from '../src/lobby/protocol';
import { createGameMode, type ModeContext } from './modes/game-mode';
import { CoopMode } from './modes/coop';
import { ServerSoundCollector } from './sound-collector';

let passed = 0;
function ok(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
  passed++;
  console.log(`  ok  ${msg}`);
}

function cmd(seq: number, over: Partial<TicCommand> = {}): TicCommand {
  return {
    forward: 0, strafe: 0, turn: 0, lookTurn: 0, run: false, fire: false,
    use: false, weaponSlot: 0, weaponCycle: 0, pause: false, seq, ...over,
  };
}

/** A started co-op sim with `n` marines (sim ids 0..n-1), seeded exactly as MatchRoom does. */
function startCoop(n: number): { sim: GameSession; world: World; events: EventBus<GameEventMap>; mode: CoopMode } {
  const events = new EventBus<GameEventMap>();
  const world = new World();
  const rng = new Rng(DEFAULT_SEED);
  const ctx: SimContext = { world, events, rng, skill: 3, episodeLevel: 0 };
  const sim = new GameSession(ctx, { presentation: true });
  while (world.players.size < n) world.addPlayer(0, 0, 0);
  sim.startNewGame(3);
  const mode = createGameMode(defaultMatchConfig('coop')) as CoopMode;
  world.friendlyFire = mode.friendlyFire;
  mode.onLevelStart(modeCtx(sim, world, n));
  return { sim, world, events, mode };
}

function modeCtx(sim: GameSession, world: World, n: number): ModeContext {
  return { world, sim, config: defaultMatchConfig('coop'), level: sim.currentLevelData!, playerCount: n };
}

// ── 1. GameMode (coop) rule set ─────────────────────────────────────────────────
function testModeRules(): void {
  console.log('1. GameMode strategy — co-op rules');
  const mode = createGameMode(defaultMatchConfig('coop'));
  ok(mode.id === 'coop', 'createGameMode(coop) builds the co-op mode');
  ok(mode.friendlyFire === false, 'co-op friendly fire is OFF');
  ok(mode.monstersEnabled === true, 'co-op runs the level monsters');

  // FF gate the mode drives: a marine's shot never hurts ANOTHER marine.
  const { world, mode: m } = startCoop(2);
  const [p0, p1] = [...world.players.values()];
  p1!.health = 100;
  applyDamage(world, p1!, 60, p0!.id, 'player', new Rng(1));
  ok(p1!.health === 100 && world.friendlyFire === false, 'FF off: player→player damage is a no-op (p1 untouched)');
  // Control: the same hit with FF on (deathmatch-style) DOES land.
  world.friendlyFire = true;
  applyDamage(world, p1!, 60, p0!.id, 'player', new Rng(1));
  ok(p1!.health < 100, 'control: with FF on the identical shot damages p1 — the gate is the only difference');
  void m;
}

// ── 2. Co-op respawn (D3 = respawn) ─────────────────────────────────────────────
function testRespawn(): void {
  console.log('2. Co-op respawn — dead marine returns with a fresh loadout');
  const { sim, world, mode } = startCoop(2);
  const ctx = modeCtx(sim, world, 2);
  const start = sim.currentLevelData!.playerStart;
  const monstersBefore = world.monsters.length;

  // Give p0 a non-default loadout, then kill it.
  const p0 = world.players.get(0)!;
  p0.inventory.weapons.plasmaRifle = true;
  p0.currentWeapon = 'plasmaRifle';
  p0.inventory.ammo.cells = 40;
  p0.health = 0;
  p0.active = false;

  mode.update(ctx, 5); // schedules the respawn (delay ~52 tics)
  ok(world.players.get(0)!.health <= 0, 'just-dead marine is NOT respawned instantly (a delay applies)');

  let steps = 0;
  while (world.players.get(0)!.health <= 0 && steps < 40) {
    mode.update(ctx, 5);
    steps++;
  }
  const r = world.players.get(0)!;
  ok(r.health === HEALTH_START, `marine respawned to full health after the delay (~${steps * 5} tics)`);
  ok(r.currentWeapon === 'pistol' && r.inventory.weapons.plasmaRifle === false && r.inventory.ammo.cells === 0,
    'respawn grants a FRESH loadout (pistol, no carried plasma/cells)');
  ok(Math.round(r.x) === Math.round(start.x) && Math.round(r.y) === Math.round(start.y), 'respawns at a co-op spawn point');
  ok(world.monsters.length === monstersBefore, 'monsters/level state untouched by the respawn (match continues)');
  // The other marine never died — co-op never stalls on one death.
  ok(world.players.get(1)!.health === HEALTH_START, 'the surviving marine kept playing throughout');
}

// ── 3. Full state sync: loadout → snapshot → client HUD fields ───────────────────
function testFullStateSync(): void {
  console.log('3. Full state sync — snapshot carries everything the HUD reads');
  const { sim, world } = startCoop(2);
  const p0 = world.players.get(0)!;
  // A rich loadout touching every HUD field group.
  p0.inventory.ammo.cells = 123;
  p0.inventory.ammoMax.cells = 600; // a backpack would raise this
  p0.inventory.backpack = true;
  p0.inventory.weapons.plasmaRifle = true;
  p0.currentWeapon = 'plasmaRifle';
  p0.inventory.keys.blue.card = true;
  p0.inventory.keys.red.skull = true;
  p0.armor.points = 150;
  p0.armor.factor = 0.5; // blue armor

  const snap = buildSnapshot(world, sim.currentLevel!, {
    tick: 1, mode: 'coop',
    isFiring: (id) => sim.isFiring(id),
    processedSeq: (id) => sim.processedSeqFor(id),
    metaFor: (id) => ({ sid: `S${id}`, name: `M${id}`, color: 0 }),
  });
  const ps = snap.players.find((p) => p.id === 0)!;
  ok(ps.ammo.cells === 123 && ps.ammoMax.cells === 600, 'snapshot carries every ammo type + max');
  ok(ps.weapons.plasmaRifle === true && ps.weapon === 'plasmaRifle' && ps.backpack === true, 'snapshot carries weapons owned + current + backpack');
  ok(ps.keys.blue.card === true && ps.keys.red.skull === true, 'snapshot carries keys held');
  ok(ps.armor === 150 && ps.armorFactor === 0.5, 'snapshot carries armor amount AND tier (factor)');
  ok(snap.level === sim.currentLevelData!.id, 'snapshot tags the current level id');

  // Apply onto a fresh CLIENT player (default pistol loadout) — the status bar reads these.
  const client = new World();
  const cp = client.players.get(client.localPlayerId)!;
  applyPlayerInventory(cp, ps);
  ok(cp.inventory.ammo.cells === 123 && cp.inventory.ammoMax.cells === 600, 'client HUD: ammo + max are exact');
  ok(cp.currentWeapon === 'plasmaRifle' && cp.inventory.weapons.plasmaRifle === true, 'client HUD: current weapon + ARMS panel are exact');
  ok(cp.inventory.keys.blue.card === true && cp.inventory.keys.red.skull === true, 'client HUD: keys are exact');
  ok(cp.armor.points === 150 && cp.armor.factor === 0.5, 'client HUD: armor amount + tint tier are exact');
}

// ── 4. Per-player weapons: a pickup grants only to the toucher ───────────────────
function testPerPlayerWeapons(): void {
  console.log('4. Per-player weapons — a pickup routes to the marine who touched it');
  const { sim, world } = startCoop(2);
  const p1 = world.players.get(1)!;
  // Move p1 well away from p0/the spawn ring, then drop a plasma rifle (thing 2004) on it.
  p1.x = sim.currentLevelData!.playerStart.x + 256;
  p1.y = sim.currentLevelData!.playerStart.y + 256;
  spawnPickup(world, 2004, p1.x, p1.y);

  sim.stepNetwork(new Map()); // no input — simulateWorld runs the per-player pickup pass

  ok(world.players.get(1)!.inventory.weapons.plasmaRifle === true, 'the toucher (p1) now owns the plasma rifle');
  ok(world.players.get(0)!.inventory.weapons.plasmaRifle === false, 'the OTHER marine (p0) did NOT get it — per-player inventory');
  ok(world.players.get(1)!.inventory.ammo.cells > 0, 'p1 also got the weapon’s first-pickup ammo (its own WeaponSystem)');
  ok(!world.pickups.some((pk) => pk.thingId === 2004), 'the plasma pickup was consumed');
}

// ── 5. Networked SFX: positional sounds for fire / monster / door / pickup ───────
function testNetworkedSfx(): void {
  console.log('5. Networked SFX — the server collects positional sounds');
  const { sim, world, events } = startCoop(1);
  const collector = new ServerSoundCollector(world, () => sim.firingPlayerPos);
  collector.bindGame(events);
  collector.bindCombat(sim.combat!);
  collector.resetPickups();

  // Gunfire: the local marine fires its pistol this tic.
  sim.tic(cmd(0, { fire: true }));

  // Monster sound: kill a freshly-spawned imp via the combat bus.
  const p0 = world.players.get(0)!;
  const imp = spawnMonster(world, 3001, p0.x + 64, p0.y, 0)!;
  applyDamage(world, imp, 500, p0.id, 'player', new Rng(7), sim.combat!);

  // Door/lift class sound: the world emits positioned 'sfx' the collector mirrors.
  events.emit('sfx', { sound: 'DSDOROPN', x: p0.x, y: p0.y });

  // Pickup blip: an item leaving the world reads as a collection at its spot.
  const pk = spawnPickup(world, 2007, p0.x + 32, p0.y)!;
  collector.resetPickups();
  world.removePickup(pk.id);
  collector.notePickups();

  const sounds = collector.flush();
  const lumps = new Set(sounds.map((s) => s.sound));
  ok(sounds.length >= 4, `collector produced ${sounds.length} positional sounds this tick`);
  ok(lumps.has('DSPISTOL'), 'gunfire: the marine’s pistol shot is networked at its position');
  ok([...lumps].some((l) => l.startsWith('DSPO') || l.startsWith('DSBG')), 'monster: the imp’s death sound is networked');
  ok(lumps.has('DSDOROPN'), 'door: the positioned door sound is networked');
  ok(lumps.has('DSITEMUP'), 'pickup: the collected item blip is networked');
  ok(sounds.every((s) => Number.isFinite(s.x) && Number.isFinite(s.y) && s.priority > 0), 'every sound carries a finite world position + priority');
}

// ── 6. Co-op level flow: the exit advances the whole party ───────────────────────
function testLevelFlow(): void {
  console.log('6. Co-op level flow — the exit advances the party to the next level');
  const { sim, world, mode } = startCoop(2);
  const ctx = modeCtx(sim, world, 2);
  ok(sim.currentLevelData!.id === 'E1M1', 'party starts on E1M1');
  ok(mode.onLevelExit(ctx) === 'advance', 'a mid-episode exit advances (a next level exists)');

  const result = sim.advanceAfterIntermission();
  ok(result === 'next' && sim.currentLevelData!.id === 'E1M2', 'the whole sim loaded the next level (E1M2)');
  // Players are repositioned together near the new level's start.
  const start = sim.currentLevelData!.playerStart;
  const near = [...world.players.values()].every((p) => Math.hypot(p.x - start.x, p.y - start.y) < 64 && p.health > 0);
  ok(near, 'both marines spawned alive near the E1M2 start (spawn near each other)');

  // onLevelStart on advance revives a marine that exited dead (so the new level starts clean).
  const p0 = world.players.get(0)!;
  p0.health = 0;
  mode.onLevelStart(modeCtx(sim, world, 2));
  ok(world.players.get(0)!.health === HEALTH_START, 'a marine that reached the exit dead is revived on the next level');
}

testModeRules();
testRespawn();
testFullStateSync();
testPerPlayerWeapons();
testNetworkedSfx();
testLevelFlow();
console.log(`\nAll ${passed} P4 co-op-completeness assertions passed.`);
