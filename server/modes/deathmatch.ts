// DeathmatchMode — the PvP rule set (multiplayer-plan §4 / [netcode §7]). The SAME authoritative
// GameSession co-op runs, with the rules that make it a frag match injected: friendly fire ON so
// marines damage each other, the level's monsters cleared (D4), spawns spread across DERIVED DM
// points instead of the single co-op start (D5 = pick a spawn far from other marines, no telefrag
// needed since separation avoids the collision), dead marines RESPAWN after a short delay, and the
// match ENDS the instant the frag limit or time limit is reached (no level exit — onLevelExit stays
// put). Frag scoring lives here (ScoreKeeper): a player killing ANOTHER player scores the killer a
// frag, a suicide scores -1 (classic DOOM), and every death bumps the victim's death count.
import { SECONDS_PER_TIC } from '../../src/core';
import { deathmatchSpawns, pickDeathmatchSpawn, type SpawnPose } from '../../src/levels';
import type { MatchConfig } from '../../src/lobby/protocol';
import type { GameMode, LevelOutcome, ModeContext, ScoreKeeper } from './game-mode';

/** Delay before a fragged marine pops back in — long enough to register the death, short enough
 *  to keep the match flowing (multiplayer-plan §4: "respawn after ~1-2s"). Counted in doom-tics. */
const RESPAWN_DELAY_TICS = 1.5 / SECONDS_PER_TIC;

interface Score {
  frags: number;
  deaths: number;
}

export class DeathmatchMode implements GameMode, ScoreKeeper {
  readonly id = 'deathmatch' as const;
  readonly friendlyFire = true; // marines damage each other
  readonly monstersEnabled = false; // DM clears the level's monsters (D4)

  private readonly fragLimit: number;
  private readonly timeLimitSec: number;

  /** Derived arena spawns for the current level (computed once at onLevelStart). */
  private spawns: SpawnPose[] = [];
  /** sim player id → running frags/deaths (the snapshot + results read this). */
  private readonly scores = new Map<number, Score>();
  /** sim player id → doom-tics until respawn; present only while a marine is dead. */
  private readonly respawnAt = new Map<number, number>();
  private elapsedTics = 0;
  /** Unsubscribe the entity:death frag handler from the current level's combat bus. */
  private unbindDeath: (() => void) | null = null;

  constructor(config: MatchConfig) {
    this.fragLimit = config.fragLimit;
    this.timeLimitSec = config.timeLimit * 60; // config is minutes; the clock counts seconds
  }

  // ── spawns (multiplayer-plan §4, D5) ────────────────────────────────────────────

  /** A DM spawn for the marine `playerId`: the derived arena point farthest from every OTHER
   *  live marine (so an initial spawn spreads the field and a respawn isn't instant death). */
  spawnPoint(ctx: ModeContext, playerId: number): SpawnPose {
    const spawns = this.spawns.length ? this.spawns : deathmatchSpawns(ctx.level);
    const avoid: { x: number; y: number }[] = [];
    for (const p of ctx.world.players.values()) {
      if (p.id !== playerId && p.health > 0) avoid.push({ x: p.x, y: p.y });
    }
    return pickDeathmatchSpawn(spawns, avoid, playerId);
  }

  // ── lifecycle ───────────────────────────────────────────────────────────────────

  onLevelStart(ctx: ModeContext): void {
    this.spawns = deathmatchSpawns(ctx.level);
    this.respawnAt.clear();
    this.elapsedTics = 0;
    this.scores.clear();
    for (const id of ctx.world.players.keys()) this.scoreOf(id); // zeroed row per marine

    // Frag scoring: a player death on the authoritative combat bus credits a frag / death.
    // Re-bound here (the bus is rebuilt per level) and unbound first so it never doubles up.
    this.unbindDeath?.();
    this.unbindDeath = ctx.sim.combat?.on('entity:death', (e) => this.onDeath(e.id, e.faction, e.sourceId, e.sourceFaction)) ?? null;

    // Scatter every marine across the arena (a distinct DM spawn each), with the standard DM
    // starting loadout (respawnPlayer = fresh pistol + fist), processed in id order so each
    // placement spreads away from the marines already moved off the co-op start cluster.
    for (const id of [...ctx.world.players.keys()].sort((a, b) => a - b)) {
      ctx.sim.respawnPlayer(id, this.spawnPoint(ctx, id));
    }
  }

  update(ctx: ModeContext, tics: number): boolean {
    this.elapsedTics += tics;
    if (this.timeLimitSec > 0 && this.elapsedTics * SECONDS_PER_TIC >= this.timeLimitSec) return true;

    // Schedule a respawn for any marine fragged since the last step, then count timers down and
    // respawn at a fresh DM spawn when one elapses (a marine that left mid-wait is simply dropped).
    for (const p of ctx.world.players.values()) {
      if (p.health <= 0 && !this.respawnAt.has(p.id)) this.respawnAt.set(p.id, RESPAWN_DELAY_TICS);
    }
    for (const [id, left] of [...this.respawnAt]) {
      const remaining = left - tics;
      if (remaining <= 0) {
        this.respawnAt.delete(id);
        if (ctx.world.players.has(id)) ctx.sim.respawnPlayer(id, this.spawnPoint(ctx, id));
      } else {
        this.respawnAt.set(id, remaining);
      }
    }

    if (this.fragLimit > 0) {
      for (const s of this.scores.values()) if (s.frags >= this.fragLimit) return true;
    }
    return false;
  }

  /** Deathmatch has no exit: a marine that wanders onto a level exit trigger does not end or
   *  advance the match — it just keeps going (the room ignores a 'stay' outcome). */
  onLevelExit(_ctx: ModeContext): LevelOutcome {
    return 'stay';
  }

  // ── ScoreKeeper (multiplayer-plan §4) ────────────────────────────────────────────

  scoreFor(playerId: number): { frags: number; deaths: number } {
    return this.scoreOf(playerId);
  }

  get timeRemainingSec(): number {
    if (this.timeLimitSec <= 0) return 0;
    return Math.max(0, this.timeLimitSec - this.elapsedTics * SECONDS_PER_TIC);
  }

  // ── frag scoring ──────────────────────────────────────────────────────────────--

  /** A combat death: only marine deaths score. The victim's death count rises; a player killer
   *  earns a frag, or loses one for fragging themselves (suicide = -1, classic DOOM). */
  private onDeath(victimId: number, victimFaction: string, killerId: number, killerFaction: string): void {
    if (victimFaction !== 'player') return;
    this.scoreOf(victimId).deaths += 1;
    if (killerFaction === 'player') {
      if (killerId === victimId) this.scoreOf(victimId).frags -= 1;
      else this.scoreOf(killerId).frags += 1;
    }
  }

  private scoreOf(id: number): Score {
    let s = this.scores.get(id);
    if (!s) {
      s = { frags: 0, deaths: 0 };
      this.scores.set(id, s);
    }
    return s;
  }
}
