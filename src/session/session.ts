// The Session abstraction — the boundary between the CLIENT app (the GameClient
// presenter + state machine) and the AUTHORITATIVE simulation. ONE interface, TWO
// implementations:
//   • LocalSession  — OFFLINE single-player: runs the sim in-process (a GameSession),
//     no server needed. Every current SP feature works through it. It is the default
//     the client boots with, so playing solo never requires a network. (local-session.ts)
//   • RemoteSession — ONLINE: sends TicCommands to a Colyseus host and mirrors the
//     broadcast snapshots into a local world. NOT built yet — only the seam. (remote-session.ts)
// The presenter renders from `world`/`currentLevel` and advances the authority with
// `tic()`, never caring which implementation backs it. See docs/multiplayer-plan.md §0.1.
import type { IWorld, ILevelRuntime, MapData, SkillId } from '../core';
import type { CombatBus } from '../combat';
import type { WeaponView } from '../weapons';
import type { TicCommand, TicResult } from '../game/session';
import type { NetSound, RemoteAvatar } from './snapshot';

export type { TicCommand, TicResult } from '../game/session';

/** Per-level progress counters the intermission tally reads. */
export interface SimStats {
  kills: number;
  totalKills: number;
  items: number;
  totalItems: number;
  secrets: number;
  totalSecrets: number;
  timeTics: number;
}

export interface Session {
  /** The world the client renders/reads. Local: the in-process sim's world.
   *  Remote: the snapshot-mirrored world. */
  readonly world: IWorld;
  readonly currentLevel: ILevelRuntime | null;
  readonly currentLevelData: MapData | null;
  readonly levelActive: boolean;
  /** The active level's combat event bus the presenter binds local SFX to. Null when
   *  remote or between levels (remote gameplay SFX arrive as networked events instead). */
  readonly combat: CombatBus | null;
  /** Last command seq the authority has applied (client reconciliation, P3a). */
  readonly processedSeq: number;

  /** The local player's weapon view-model for this frame (sprite ids + bob offsets). */
  getWeaponView(): WeaponView | null;
  /** Per-level counters for the intermission screen. */
  stats(): SimStats;

  /** Begin a fresh single-player / co-op game at the episode's first level. */
  startNewGame(skill: SkillId): void;
  /** Load a specific level by id. */
  startLevel(mapId: string): void;
  /** Advance one fixed sim tic from the local player's command; returns the outcome. */
  tic(cmd: TicCommand): TicResult;
  /** Tear down the active level's systems. */
  teardownLevel(): void;
  /** After the intermission: load the next level, or 'victory' if the episode is done. */
  advanceAfterIntermission(): 'next' | 'victory';
  /** The id of the level following the current one (intermission "next" label). */
  peekNextLevelId(): string | null;

  /** ONLINE only: the OTHER co-op marines to draw as billboard avatars + nametags this
   *  frame (the local player stays first-person). Offline LocalSession omits it — a
   *  single-player world has no other players to render. */
  remotePlayers?(): RemoteAvatar[];

  /** ONLINE only: positional SFX the latest snapshots carried, drained once per frame and
   *  played relative to the local marine. Offline LocalSession omits it — solo SFX play
   *  straight off the in-process event bus. */
  takeSounds?(): NetSound[];
}
