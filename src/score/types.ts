// The DEATHMATCH score model (multiplayer-plan §4: "new per-player frag counter in
// room state, shown on a scoreboard UI + post-match"). This is the typed contract the
// P5b deathmatch RULES populate and the scoreboard/results UI reads — defined here once,
// independent of any rendering, so the sim side and the UI side never disagree on shape.
//
// Per-player identity (id/name/color) intentionally mirrors lobby/protocol.ts LobbyPlayer
// so P5b can build a PlayerScore straight from the roster it already has.
import type { GameMode, LobbyColorId } from '../lobby';

/** One competitor's running tally. `ping` is a placeholder until P6 wires real RTT. */
export interface PlayerScore {
  id: string;
  name: string;
  color: LobbyColorId; // index into LOBBY_COLORS / PLAYER_COLORS
  frags: number;
  deaths: number;
  ping?: number; // ms round-trip; undefined renders as a placeholder
}

/** The whole scoreboard view. Match meta (mode + limits + clock) sits alongside the
 *  per-player rows so both the in-match overlay and the post-match results draw from one
 *  object. P5b owns mutating this each frag/death/tick; the UI only reads it. */
export interface ScoreState {
  mode: GameMode; // 'deathmatch' today; 'coop' reserved for the co-op tally
  fragLimit: number; // first to N frags wins; 0 = no limit
  timeLimit: number; // match length in minutes; 0 = no limit
  timeRemaining: number; // seconds left in the match; ignored when timeLimit is 0
  players: PlayerScore[];
  localPlayerId: string; // the row the scoreboard highlights as "you"
}

/** Canvas tints per LOBBY_COLORS index (GREEN, INDIGO, BROWN, RED). Kept in step with
 *  the nametag ramp in src/game/client.ts so a player's swatch matches their avatar. */
export const PLAYER_COLORS = ['#56c84c', '#6f78ff', '#b9803f', '#ff4d4d'] as const;

/** The swatch color for a LOBBY_COLORS index, falling back to the first ramp. */
export function colorOf(color: LobbyColorId): string {
  return PLAYER_COLORS[color] ?? PLAYER_COLORS[0];
}

/** Players ranked for display: most frags first, then fewest deaths, then name. Returns
 *  a new array; the source order (join order) is left untouched. */
export function rankedPlayers(state: ScoreState): PlayerScore[] {
  return [...state.players].sort(
    (a, b) => b.frags - a.frags || a.deaths - b.deaths || a.name.localeCompare(b.name),
  );
}

/** The match winner, or null on a frag tie for the lead (a DRAW). */
export function matchWinner(state: ScoreState): PlayerScore | null {
  const ranked = rankedPlayers(state);
  const top = ranked[0];
  if (!top) return null;
  const tiedForLead = ranked[1] && ranked[1].frags === top.frags;
  return tiedForLead ? null : top;
}

/** Format a seconds count as M:SS for the match clock. */
export function clockString(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
