// GameMode — the injected rule set that makes ONE authoritative match co-op or deathmatch
// (multiplayer-plan §4 / [netcode §7]). MatchRoom runs a single shared GameSession for every
// mode and delegates the rules that DIFFER to a GameMode: friendly-fire policy, whether the
// level's monsters simulate, spawn selection, per-tick bookkeeping (respawn timers / score
// limits), and what a level exit means. Co-op is implemented (CoopMode); a DeathmatchMode
// (P5) implements this SAME interface — FF on, frag scoring, DM spawn points, respawn-on-death,
// frag/time limit → match end — so the room never branches on the mode string.
import type { MapData } from '../../src/core';
import type { World } from '../../src/entities';
import type { GameSession } from '../../src/game/session';
import type { GameMode as GameModeId, MatchConfig } from '../../src/lobby/protocol';
import type { SpawnPose } from '../../src/levels';
import { CoopMode } from './coop';
import { DeathmatchMode } from './deathmatch';

export type { SpawnPose } from '../../src/levels';

/** The live-match surface a GameMode reads and mutates. MatchRoom builds it fresh per call
 *  so a mode never imports the room. `playerCount` = marines in the match (sim ids 0..N-1,
 *  assigned in roster order, so a sim id IS its roster index → its spawn index). */
export interface ModeContext {
  readonly world: World;
  readonly sim: GameSession;
  readonly config: MatchConfig;
  readonly level: MapData; // the current level's data — spawn-point lookups read it
  readonly playerCount: number;
}

/** What the room should do when a player trips the level exit. Deathmatch returns 'stay' —
 *  the arena has no exit, so an exit a marine stumbles onto is ignored and the match runs on. */
export type LevelOutcome = 'advance' | 'victory' | 'stay';

/** A mode that keeps a per-player frag tally (deathmatch). Split off the base GameMode so co-op
 *  isn't forced to implement frag scoring (ISP): the room reads scores through `isScoreKeeper`,
 *  feeding the snapshot's per-player frags/deaths + the match clock + the post-match results. */
export interface ScoreKeeper {
  /** Running frags/deaths for a sim player id (zeroed entry for an unseen id). */
  scoreFor(playerId: number): { frags: number; deaths: number };
  /** Seconds left when a time limit is set; 0 when there is none (multiplayer-plan §4). */
  readonly timeRemainingSec: number;
}

/** Does this mode keep frag scores? (deathmatch yes, co-op no.) */
export function isScoreKeeper(mode: GameMode): mode is GameMode & ScoreKeeper {
  return typeof (mode as Partial<ScoreKeeper>).scoreFor === 'function';
}

export interface GameMode {
  readonly id: GameModeId;

  // ── match seeding ─────────────────────────────────────────────────────────────
  /** Player→player damage allowed? Sets world.friendlyFire (co-op false, dm true). */
  readonly friendlyFire: boolean;
  /** Do the level's monsters spawn + simulate? (co-op true; dm clears them by default). */
  readonly monstersEnabled: boolean;
  /** Spawn pose for the marine at roster index `i` — both initial placement and respawn. */
  spawnPoint(ctx: ModeContext, playerIndex: number): SpawnPose;

  // ── lifecycle ─────────────────────────────────────────────────────────────────
  /** A level has just loaded (initial start AND a co-op advance). Reset per-level mode
   *  state (respawn timers) and bring any marine that reached the exit dead back alive. */
  onLevelStart(ctx: ModeContext): void;
  /** One sim step of mode bookkeeping: co-op respawn timers; dm frag/time limits. Returns
   *  true when the mode's own win/limit condition ends the match (dm). Co-op returns false —
   *  it ends only via onLevelExit. */
  update(ctx: ModeContext, tics: number): boolean;
  /** A player tripped the level exit. Co-op advances the whole party (or victory on the last
   *  level); dm has no level exit (monsters off), so this is never called for it. */
  onLevelExit(ctx: ModeContext): LevelOutcome;
}

/** Build the GameMode for a match's config: deathmatch (FF on, frag scoring, DM spawns,
 *  respawn-on-death, frag/time limit) or co-op (FF off, shared monsters + progression). */
export function createGameMode(config: MatchConfig): GameMode {
  return config.mode === 'deathmatch' ? new DeathmatchMode(config) : new CoopMode();
}
