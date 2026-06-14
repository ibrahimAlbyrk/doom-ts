// Lobby / room PROTOCOL — the transport-neutral message set, MatchConfig, and room
// state the client lobby state machine (lobby-client.ts) and the mock/real server
// agree on. This is docs/multiplayer-plan.md §3.4 (messages) + §3.5 (MatchConfig) +
// §3.2 (room status), defined once so the UI, the mock transport, and the future P2
// network worker all key off the same shapes.
//
// SEAM NOTE for the P2 network worker: this `LobbyTransport` is the ROOM-LIFECYCLE
// seam (create/join/ready/config/start). It is DISTINCT from the gameplay
// `SessionTransport` in src/session/remote-session.ts, which carries per-tic
// TicCommands + snapshots once a match is running. The lobby drives LobbyTransport
// until `matchStarting`, then hands the MatchConfig off to a RemoteSession that owns
// SessionTransport. Colyseus would back both with one room; a raw-ws server with two
// message channels. The message NAMES below are the contract either must match.
import type { SkillId } from '../core';

export type GameMode = 'coop' | 'deathmatch';

/** Co-op death rule (multiplayer-plan §3.5 / D3). */
export type CoopRespawn = 'levelStart' | 'waitForRevive' | 'partyWipe';

/** The host-configured match parameters the lobby carries and that seed the sim
 *  (multiplayer-plan §3.5/§3.6). Mode-specific fields are always present with sane
 *  defaults; the UI just shows/hides them per `mode`. */
export interface MatchConfig {
  mode: GameMode;
  skill: SkillId; // 1..5 — feeds the existing SKILLS table
  episode: number; // index into the available episodes
  startLevel: number; // level index within the episode
  maxPlayers: number; // per-room cap (co-op 4, dm 8 by default)
  fragLimit: number; // deathmatch — first to N frags; 0 = no limit
  timeLimit: number; // deathmatch — minutes; 0 = no limit
  itemRespawn: boolean; // deathmatch — pickups respawn
  coopRespawn: CoopRespawn; // co-op death rule
}

/** Marine swatch colors (DOOM translation ramps); index into this list travels in
 *  LobbyPlayer.color and later remaps the PLAY sprite ([netcode §6]). */
export const LOBBY_COLORS = ['GREEN', 'INDIGO', 'BROWN', 'RED'] as const;
export type LobbyColorId = number; // index into LOBBY_COLORS

/** Room lifecycle status — the authority's state, mirrored to every client
 *  (multiplayer-plan §3.2). The client lobby screen is a view of this. */
export type RoomStatus =
  | 'hosting' // host present, 1 player, no others yet
  | 'waiting' // ≥2 players, not all ready
  | 'allReady' // every connected player ready
  | 'starting' // host pressed START; match seeding (→ networked PLAYING in P2)
  | 'inMatch'
  | 'postMatch';

export interface LobbyPlayer {
  id: string;
  name: string;
  color: LobbyColorId;
  ready: boolean;
  isHost: boolean;
}

/** The whole lobby view pushed to clients (the `roomState` synced field, §3.4). */
export interface RoomState {
  code: string;
  status: RoomStatus;
  config: MatchConfig;
  players: LobbyPlayer[];
}

/** One competitor's final standing in the post-match results (multiplayer-plan §4). Mirrors
 *  src/score PlayerScore by shape but is declared here so the protocol carries no dependency on
 *  the client score/UI module (the client maps it straight onto a PlayerScore). `id` is the sim
 *  player id as a string — what the client highlights as "you" (its own sim id). */
export interface ResultScore {
  id: string;
  name: string;
  color: LobbyColorId;
  frags: number;
  deaths: number;
}

/** Post-match results: the mode + its limits + the final per-player table the results screen
 *  draws (multiplayer-plan §4). For co-op the table carries the roster with zero frags. */
export interface MatchResults {
  mode: GameMode;
  fragLimit: number;
  timeLimit: number;
  scores: ResultScore[];
}

/** Client → server (multiplayer-plan §3.4). */
export type ClientMessage =
  | { t: 'createRoom'; config: MatchConfig; name: string; color: LobbyColorId }
  | { t: 'joinRoom'; roomCode?: string; addr?: string; name: string; color: LobbyColorId }
  | { t: 'leaveRoom' }
  | { t: 'setReady'; ready: boolean }
  | { t: 'setConfig'; config: Partial<MatchConfig> }
  | { t: 'startMatch' }
  | { t: 'rematch' };

/** Server → client lifecycle (gameplay snapshots/events are the SessionTransport's job). */
export type ServerMessage =
  | { t: 'roomState'; room: RoomState }
  | { t: 'joinAccepted'; yourPlayerId: string; room: RoomState }
  | { t: 'joinRejected'; reason: string }
  | { t: 'playerJoined'; id: string; name: string }
  | { t: 'playerLeft'; id: string; name: string }
  | { t: 'matchStarting'; config: MatchConfig; seed: number; levelId: string }
  | { t: 'matchEnded'; results: MatchResults };

/** The room-lifecycle transport seam. The mock implements it now; P2 swaps in a
 *  Colyseus/ws-backed implementation with the same surface (see SEAM NOTE above). */
export interface LobbyTransport {
  connect(): Promise<void>;
  send(msg: ClientMessage): void;
  onMessage(handler: (msg: ServerMessage) => void): void;
  disconnect(): void;
}

export function defaultMatchConfig(mode: GameMode = 'coop'): MatchConfig {
  return {
    mode,
    skill: 3,
    episode: 0,
    startLevel: 0,
    maxPlayers: mode === 'deathmatch' ? 8 : 4,
    fragLimit: 20,
    timeLimit: 0,
    itemRespawn: false,
    coopRespawn: 'levelStart',
  };
}

/** Server-side status recompute (multiplayer-plan §3.2): 1 player = hosting; otherwise
 *  all-ready ⇒ allReady, else waiting. Shared by the mock today, the real server in P2. */
export function computeStatus(players: LobbyPlayer[]): RoomStatus {
  if (players.length <= 1) return 'hosting';
  return players.every((p) => p.ready) ? 'allReady' : 'waiting';
}

/** START gate: every connected player ready (host included, D2 = explicit host ready). */
export function allPlayersReady(room: RoomState): boolean {
  return room.players.length > 0 && room.players.every((p) => p.ready);
}
