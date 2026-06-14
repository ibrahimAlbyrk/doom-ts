// P5b deathmatch — headless integration over the REAL authoritative code paths (multiplayer-plan
// §4/§5). Drives a live GameSession + the DeathmatchMode rule set + the snapshot/score sync,
// asserting the P5b deliverables without a browser:
//   1. GameMode (deathmatch): FF on, monsters off, DM spawns spread across the arena.
//   2. Player-vs-player hitscan: a marine's shot now collects + damages OTHER marines (the fix
//      that makes DM damage register), while co-op (FF off) still rejects it.
//   3. Frag scoring: a kill credits the killer a frag + the victim a death; a suicide is -1.
//   4. Respawn: a fragged marine returns after a delay at a DM spawn with the DM loadout.
//   5. Limits: the frag limit and the time limit each end the match (update → true).
//   6. Score sync: frags/deaths + the match clock round-trip snapshot → client score fields.
//   7. Lag compensation: the sim rewinds other marines around a shooter's weapon step, so a shot
//      registers where the shooter saw a moving target (and misses without the rewind).
//   8. No level exit: a deathmatch ignores an exit trigger (onLevelExit → 'stay').
// Run: `npx tsx server/deathmatch.test.ts`. Throws on the first failed assertion.
import {
  EventBus,
  Rng,
  DEFAULT_SEED,
  HEALTH_START,
  SECONDS_PER_TIC,
  type GameEventMap,
  type SimContext,
} from '../src/core';
import { World } from '../src/entities';
import { applyDamage, collectAttackTargets, segmentBlocked } from '../src/combat';
import { GameSession, type TicCommand, type LagCompensator } from '../src/game/session';
import { buildSnapshot } from '../src/session/snapshot';
import { deathmatchSpawns } from '../src/levels';
import { defaultMatchConfig, type MatchConfig } from '../src/lobby/protocol';
import { createGameMode, type ModeContext } from './modes/game-mode';
import { DeathmatchMode } from './modes/deathmatch';

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

/** A started deathmatch sim with `n` marines (sim ids 0..n-1), seeded exactly as MatchRoom does:
 *  startNewGame → FF on → clear monsters → mode.onLevelStart (scatters marines to DM spawns). */
function startDM(n: number, over: Partial<MatchConfig> = {}): {
  sim: GameSession;
  world: World;
  events: EventBus<GameEventMap>;
  mode: DeathmatchMode;
  config: MatchConfig;
} {
  const events = new EventBus<GameEventMap>();
  const world = new World();
  const rng = new Rng(DEFAULT_SEED);
  const config = { ...defaultMatchConfig('deathmatch'), ...over };
  const ctx: SimContext = { world, events, rng, skill: config.skill, episodeLevel: 0 };
  const sim = new GameSession(ctx, { presentation: true });
  while (world.players.size < n) world.addPlayer(0, 0, 0);
  sim.startNewGame(config.skill);
  const mode = createGameMode(config) as DeathmatchMode;
  world.friendlyFire = mode.friendlyFire;
  if (!mode.monstersEnabled) world.monsters.length = 0;
  mode.onLevelStart(modeCtx(sim, world, config, n));
  return { sim, world, events, mode, config };
}

function modeCtx(sim: GameSession, world: World, config: MatchConfig, n: number): ModeContext {
  return { world, sim, config, level: sim.currentLevelData!, playerCount: n };
}

// ── 1. GameMode (deathmatch) rule set + spread spawns ───────────────────────────
function testModeRules(): void {
  console.log('1. GameMode strategy — deathmatch rules');
  const mode = createGameMode(defaultMatchConfig('deathmatch'));
  ok(mode.id === 'deathmatch', 'createGameMode(deathmatch) builds the deathmatch mode');
  ok(mode.friendlyFire === true, 'deathmatch friendly fire is ON');
  ok(mode.monstersEnabled === false, 'deathmatch clears the level monsters');

  const { world } = startDM(4);
  ok(world.friendlyFire === true, 'the seeded world has FF on');
  ok(world.monsters.length === 0, 'the seeded world has no monsters');

  // The four marines land on distinct, mutually-distant DM spawns (not the single co-op start).
  const ps = [...world.players.values()];
  let minSep = Infinity;
  for (let i = 0; i < ps.length; i++) {
    for (let j = i + 1; j < ps.length; j++) {
      minSep = Math.min(minSep, Math.hypot(ps[i]!.x - ps[j]!.x, ps[i]!.y - ps[j]!.y));
    }
  }
  ok(minSep > 64, `marines spawn spread apart (closest pair ${Math.round(minSep)}mu > one cell)`);
}

// ── 2. Player-vs-player hitscan targeting (the DM damage fix) ────────────────────
function testPvpTargeting(): void {
  console.log('2. Player-vs-player — a marine attack now collects + damages other marines');
  const { world } = startDM(2);
  const [p0, p1] = [...world.players.values()];

  // With FF on (DM), a player-sourced attack collects the OTHER marine (never the shooter).
  const dmTargets = collectAttackTargets(world, 'player', p0!.id);
  ok(dmTargets.includes(p1!) && !dmTargets.includes(p0!), 'DM: a marine targets the other marine, not itself');

  // With FF off (co-op), a player-sourced attack collects NO players — co-op is unaffected.
  world.friendlyFire = false;
  ok(collectAttackTargets(world, 'player', p0!.id).length === 0, 'co-op: a marine targets no players (FF gate)');
  world.friendlyFire = true;

  // And the damage actually lands (resolve's FF gate lets player→player through in DM).
  p1!.health = HEALTH_START;
  applyDamage(world, p1!, 40, p0!.id, 'player', new Rng(1));
  ok(p1!.health < HEALTH_START, 'a marine-sourced hit damages the other marine in DM');
}

// ── 3. Frag scoring ─────────────────────────────────────────────────────────────
function testFragScoring(): void {
  console.log('3. Frag scoring — kill, suicide, and death counts');
  const { sim, world, mode } = startDM(3);
  const [p0, p1, p2] = [...world.players.values()];

  // p0 frags p1 (lethal hit through the combat bus the mode is listening on).
  applyDamage(world, p1!, 500, p0!.id, 'player', new Rng(2), sim.combat!);
  ok(mode.scoreFor(p0!.id).frags === 1, 'killer earns a frag');
  ok(mode.scoreFor(p1!.id).deaths === 1, 'victim earns a death');
  ok(mode.scoreFor(p0!.id).deaths === 0 && mode.scoreFor(p1!.id).frags === 0, 'no stray frags/deaths credited');

  // p2 suicides (sourceId === victim) → -1 frag, +1 death (classic DOOM).
  applyDamage(world, p2!, 500, p2!.id, 'player', new Rng(3), sim.combat!);
  ok(mode.scoreFor(p2!.id).frags === -1, 'a suicide is -1 frag');
  ok(mode.scoreFor(p2!.id).deaths === 1, 'a suicide still counts as a death');
}

// ── 4. Respawn at a DM spawn with the DM loadout ─────────────────────────────────
function testRespawn(): void {
  console.log('4. Respawn — a fragged marine returns at a DM spawn with the DM loadout');
  const { sim, world, mode, config } = startDM(2);
  const ctx = modeCtx(sim, world, config, 2);
  const spawns = deathmatchSpawns(sim.currentLevelData!);

  const p0 = world.players.get(0)!;
  p0.inventory.weapons.plasmaRifle = true;
  p0.currentWeapon = 'plasmaRifle';
  p0.health = 0; // fragged

  mode.update(ctx, 5);
  ok(world.players.get(0)!.health <= 0, 'a just-fragged marine is NOT respawned instantly (a delay applies)');

  let steps = 0;
  while (world.players.get(0)!.health <= 0 && steps < 40) {
    mode.update(ctx, 5);
    steps++;
  }
  const r = world.players.get(0)!;
  ok(r.health === HEALTH_START, `marine respawned to full health after the delay (~${steps * 5} tics)`);
  ok(r.currentWeapon === 'pistol' && r.inventory.weapons.plasmaRifle === false, 'respawn grants the FRESH DM loadout');
  const onSpawn = spawns.some((s) => Math.round(s.x) === Math.round(r.x) && Math.round(s.y) === Math.round(r.y));
  ok(onSpawn, 'the marine respawned exactly on a derived DM spawn point');
}

// ── 5. Frag limit + time limit end the match ─────────────────────────────────────
function testLimits(): void {
  console.log('5. Limits — frag limit and time limit each end the match');

  // Frag limit: one kill reaches a limit of 1 → update returns true.
  const fl = startDM(2, { fragLimit: 1, timeLimit: 0 });
  const ctxF = modeCtx(fl.sim, fl.world, fl.config, 2);
  ok(fl.mode.update(ctxF, 5) === false, 'before any frag the match runs on');
  const [a, b] = [...fl.world.players.values()];
  applyDamage(fl.world, b!, 500, a!.id, 'player', new Rng(4), fl.sim.combat!);
  ok(fl.mode.update(ctxF, 5) === true, 'reaching the frag limit ends the match');

  // Time limit: 1 minute = 60s; advance the clock and confirm it expires.
  const tl = startDM(2, { fragLimit: 0, timeLimit: 1 });
  const ctxT = modeCtx(tl.sim, tl.world, tl.config, 2);
  ok(Math.round(tl.mode.timeRemainingSec) === 60, 'a 1-minute match starts with 60s on the clock');
  tl.mode.update(ctxT, 30 / SECONDS_PER_TIC); // 30 seconds of tics
  ok(Math.round(tl.mode.timeRemainingSec) === 30, 'the clock counts down with elapsed time');
  ok(tl.mode.update(ctxT, 31 / SECONDS_PER_TIC) === true, 'reaching the time limit ends the match');
}

// ── 6. Score sync: frags/deaths + clock → snapshot → client fields ───────────────
function testScoreSync(): void {
  console.log('6. Score sync — the snapshot carries frags/deaths + the match clock');
  const { sim, world, mode } = startDM(2, { timeLimit: 2 });
  const [p0, p1] = [...world.players.values()];
  applyDamage(world, p1!, 500, p0!.id, 'player', new Rng(5), sim.combat!);

  const snap = buildSnapshot(world, sim.currentLevel!, {
    tick: 1, mode: 'deathmatch',
    isFiring: (id) => sim.isFiring(id),
    processedSeq: (id) => sim.processedSeqFor(id),
    metaFor: (id) => ({ sid: `S${id}`, name: `M${id}`, color: id }),
    scoreFor: (id) => mode.scoreFor(id),
    timeRemaining: mode.timeRemainingSec,
  });
  const k = snap.players.find((p) => p.id === p0!.id)!;
  const v = snap.players.find((p) => p.id === p1!.id)!;
  ok(k.frags === 1 && k.deaths === 0, 'snapshot carries the killer’s frags');
  ok(v.deaths === 1 && v.frags === 0, 'snapshot carries the victim’s deaths');
  ok(Math.round(snap.timeRemaining) === 120, 'snapshot carries the match clock (2 min = 120s)');
  ok(snap.mode === 'deathmatch', 'snapshot is tagged deathmatch');
}

// ── 7. Lag compensation ──────────────────────────────────────────────────────────
function testLagComp(): void {
  console.log('7. Lag compensation — the sim rewinds targets around a shooter’s weapon step');
  const { sim, world } = startDM(2);
  const p0 = world.players.get(0)!;
  const p1 = world.players.get(1)!;
  const level = sim.currentLevel!;

  // Put the shooter on a known-open cell (the player start) and find a direction with clear LOS
  // ~96mu out — that's where the shooter SAW the target a moment ago (its rewound position).
  const start = sim.currentLevelData!.playerStart;
  p0.x = start.x;
  p0.y = start.y;
  let shotAngle = 0;
  let pastX = 0;
  let pastY = 0;
  for (let i = 0; i < 16; i++) {
    const ang = (i / 16) * Math.PI * 2;
    const tx = p0.x + Math.cos(ang) * 96;
    const ty = p0.y + Math.sin(ang) * 96;
    if (!segmentBlocked(level, p0.x, p0.y, tx, ty)) {
      shotAngle = ang;
      pastX = tx;
      pastY = ty;
      break;
    }
  }
  p0.angle = shotAngle;

  // The target's LIVE position is off to the side (≈90° away), out of the shooter's autoaim cone.
  const liveX = p0.x + Math.cos(shotAngle + Math.PI / 2) * 200;
  const liveY = p0.y + Math.sin(shotAngle + Math.PI / 2) * 200;
  const placeLive = (): void => {
    p1.x = liveX;
    p1.y = liveY;
    p1.health = HEALTH_START;
  };

  // The lag compensator the room would build: rewind p1 to where the shooter saw it, restore after.
  let saved: { x: number; y: number } | null = null;
  const lag: LagCompensator = {
    rewind: (shooterId) => {
      ok(shooterId === p0.id, 'sim invokes rewind with the shooter id around its weapon step');
      saved = { x: p1.x, y: p1.y };
      p1.x = pastX;
      p1.y = pastY;
    },
    restore: () => {
      if (saved) {
        p1.x = saved.x;
        p1.y = saved.y;
      }
    },
  };

  // WITH lag-comp: the shot resolves against the rewound (in-front) position → it registers.
  placeLive();
  for (let i = 0; i < 4; i++) sim.stepNetwork(new Map([[p0.id, cmd(i, { fire: true })]]), lag);
  ok(p1.health < HEALTH_START, 'a shot registers on the target at its rewound (past) position');
  ok(Math.round(p1.x) === Math.round(liveX) && Math.round(p1.y) === Math.round(liveY), 'the target is restored to its live position after the shot');

  // WITHOUT lag-comp: the same shot at the live (moved-away) target misses.
  placeLive();
  for (let i = 0; i < 4; i++) sim.stepNetwork(new Map([[p0.id, cmd(100 + i, { fire: true })]]));
  ok(p1.health === HEALTH_START, 'without lag-comp the same shot misses the moved target');
}

// ── 8. Deathmatch ignores level exits ────────────────────────────────────────────
function testNoLevelExit(): void {
  console.log('8. No level exit — a deathmatch ignores an exit trigger');
  const { sim, world, mode, config } = startDM(2);
  ok(mode.onLevelExit(modeCtx(sim, world, config, 2)) === 'stay', 'onLevelExit returns "stay" (arena never advances/ends)');
}

testModeRules();
testPvpTargeting();
testFragScoring();
testRespawn();
testLimits();
testScoreSync();
testLagComp();
testNoLevelExit();
console.log(`\nAll ${passed} P5b deathmatch assertions passed.`);
