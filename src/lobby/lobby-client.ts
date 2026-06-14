// LobbyClient — the CLIENT-side lobby/room state machine (multiplayer-plan §3.1/§3.2).
// It is a thin VIEW over the authoritative room: it sends ClientMessages through a
// LobbyTransport and folds the ServerMessages it receives into a single `room`
// snapshot the UI reads each frame. The room status drives the §3.2 lifecycle the
// directive asks for: create → waiting ↔ allReady → starting.
//
// Phase mapping (client phase ⟶ what it reflects):
//   idle        no room yet (menu)
//   connecting  createRoom/joinRoom sent, awaiting joinAccepted
//   inRoom      a RoomState is live; room.status carries hosting/waiting/allReady
//   starting    host pressed START and the server accepted (matchStarting received)
//   rejected    joinRejected (full / not found / already started)
//
// The actual networked match start is NOT this module's job: when `starting` is
// reached the integration hands `matchStarting.config` to a RemoteSession (P2 TODO).
import type {
  ClientMessage,
  LobbyColorId,
  LobbyPlayer,
  LobbyTransport,
  MatchConfig,
  MatchResults,
  RoomState,
  ServerMessage,
} from './protocol';
import { allPlayersReady } from './protocol';

export type LobbyPhase = 'idle' | 'connecting' | 'inRoom' | 'starting' | 'rejected';

export interface MatchStarting {
  config: MatchConfig;
  seed: number;
  levelId: string;
}

export class LobbyClient {
  private readonly transport: LobbyTransport;
  private readonly name: string;
  private readonly color: LobbyColorId;

  phase: LobbyPhase = 'idle';
  room: RoomState | null = null;
  localPlayerId: string | null = null;
  rejectReason: string | null = null;
  matchStarting: MatchStarting | null = null;
  /** Final standings from the last `matchEnded`; the integration shows the results screen on
   *  it and clears it once consumed (multiplayer-plan §4). Null until a match ends. */
  matchEnded: MatchResults | null = null;

  private readonly changeListeners = new Set<() => void>();

  constructor(transport: LobbyTransport, opts: { name: string; color?: LobbyColorId }) {
    this.transport = transport;
    this.name = opts.name;
    this.color = opts.color ?? 0;
    this.transport.onMessage((msg) => this.handle(msg));
  }

  // ── actions (client → server) ────────────────────────────────────────────────

  /** Host a new room with the given initial config, then land in the lobby. */
  host(config: MatchConfig): void {
    this.reset('connecting');
    void this.transport.connect().then(() =>
      this.send({ t: 'createRoom', config, name: this.name, color: this.color }),
    );
  }

  /** Join an existing room by code and/or address (the mock ignores the values). */
  join(target: { roomCode?: string; addr?: string }): void {
    this.reset('connecting');
    void this.transport.connect().then(() =>
      this.send({ t: 'joinRoom', ...target, name: this.name, color: this.color }),
    );
  }

  /** Flip the local player's ready flag. */
  toggleReady(): void {
    const me = this.localPlayer;
    if (!me) return;
    this.send({ t: 'setReady', ready: !me.ready });
  }

  /** Host-only: change the match config (server clears everyone's ready, §3.2). */
  setConfig(config: Partial<MatchConfig>): void {
    if (!this.isHost) return;
    this.send({ t: 'setConfig', config });
  }

  /** Host-only: start the match. Server validates ALL_READY and replies matchStarting. */
  start(): void {
    if (!this.canStart) return;
    this.send({ t: 'startMatch' });
  }

  /** Post-match: ask the server to restart the match with the same config (host-only on the
   *  server; a non-host's request is ignored, it just follows the host's next matchStarting). */
  rematch(): void {
    this.send({ t: 'rematch' });
  }

  /** Leave the room and return to the idle (menu) phase. */
  leave(): void {
    this.send({ t: 'leaveRoom' });
    this.transport.disconnect();
    this.reset('idle');
    this.emit();
  }

  // ── derived view ─────────────────────────────────────────────────────────────

  get localPlayer(): LobbyPlayer | null {
    if (!this.room || !this.localPlayerId) return null;
    return this.room.players.find((p) => p.id === this.localPlayerId) ?? null;
  }

  get isHost(): boolean {
    return this.localPlayer?.isHost ?? false;
  }

  get allReady(): boolean {
    return this.room ? allPlayersReady(this.room) : false;
  }

  /** START is host-only and unlocks exactly when every player is ready (§3.2). */
  get canStart(): boolean {
    return this.isHost && this.allReady;
  }

  /** Subscribe to any room/phase change (so a redraw or handoff can react). Returns
   *  an unsubscribe fn. The menu redraws every frame anyway; this is for integration. */
  onChange(cb: () => void): () => void {
    this.changeListeners.add(cb);
    return () => this.changeListeners.delete(cb);
  }

  // ── server → client ──────────────────────────────────────────────────────────

  private handle(msg: ServerMessage): void {
    switch (msg.t) {
      case 'joinAccepted':
        this.localPlayerId = msg.yourPlayerId;
        this.room = msg.room;
        this.phase = 'inRoom';
        break;
      case 'joinRejected':
        this.rejectReason = msg.reason;
        this.phase = 'rejected';
        break;
      case 'roomState':
        this.room = msg.room;
        if (this.phase !== 'starting') this.phase = 'inRoom';
        break;
      case 'matchStarting':
        this.matchStarting = { config: msg.config, seed: msg.seed, levelId: msg.levelId };
        this.phase = 'starting';
        if (this.room) this.room = { ...this.room, status: 'starting' };
        break;
      case 'matchEnded':
        // The match reached its win condition; surface the final standings so the integration
        // can show the results screen (it clears this once consumed).
        this.matchEnded = msg.results;
        break;
      case 'playerJoined':
      case 'playerLeft':
        // Roster deltas are already reflected in the synced roomState; nothing extra
        // to do for the lobby view. (Used in-match by the P2 avatar spawn path.)
        break;
    }
    this.emit();
  }

  private send(msg: ClientMessage): void {
    this.transport.send(msg);
  }

  private reset(phase: LobbyPhase): void {
    this.phase = phase;
    this.room = null;
    this.localPlayerId = null;
    this.rejectReason = null;
    this.matchStarting = null;
    this.matchEnded = null;
  }

  private emit(): void {
    for (const cb of this.changeListeners) cb();
  }
}
