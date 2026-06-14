// ColyseusTransport — the real network substrate that replaces the lobby's mock. ONE
// object backs BOTH transport seams over ONE Colyseus room (the protocol SEAM NOTE):
//   • LobbyTransport (create/join/ready/config/start) — drives the pre-match lobby,
//   • SessionTransport (per-tick TicCommands up, snapshots/events down) — drives the match.
// The lobby creates/joins the room; the same room instance is handed to the RemoteSession
// when the match starts, so there is no reconnect between lobby and gameplay.
//
// Wire mapping: lobby ServerMessages ride one Colyseus message type ('lobby'); authoritative
// snapshots ride 'snapshot'; reliable gameplay events ride 'gameEvent'. createRoom/joinRoom
// map to the Colyseus matchmaking API (create / joinById / joinOrCreate); every other client
// message is a plain room.send.
import { Client, Room } from 'colyseus.js';
import type { ClientMessage, LobbyTransport, ServerMessage } from '../lobby/protocol';
import type { SessionTransport } from './remote-session';
import type { TicCommand } from '../game/session';
import type { Snapshot } from './snapshot';

export class ColyseusTransport implements LobbyTransport, SessionTransport {
  private client: Client | null = null;
  private room: Room | null = null;
  private lobbyHandler: ((msg: ServerMessage) => void) | null = null;
  private snapshotHandler: ((snap: Snapshot) => void) | null = null;
  private eventHandler: ((event: unknown) => void) | null = null;

  constructor(private readonly endpoint: string) {}

  // ── shared ───────────────────────────────────────────────────────────────────

  connect(): Promise<void> {
    if (!this.client) this.client = new Client(this.endpoint);
    return Promise.resolve();
  }

  disconnect(): void {
    void this.room?.leave();
    this.room = null;
  }

  /** This client's Colyseus sessionId — how the RemoteSession finds its own marine in a
   *  broadcast snapshot (the per-player `sid` field). Empty until a room is joined. */
  get sessionId(): string {
    return this.room?.sessionId ?? '';
  }

  // ── LobbyTransport ─────────────────────────────────────────────────────────────

  onMessage(handler: (msg: ServerMessage) => void): void {
    this.lobbyHandler = handler;
  }

  send(msg: ClientMessage): void {
    void this.route(msg);
  }

  private async route(msg: ClientMessage): Promise<void> {
    await this.connect();
    const client = this.client!;
    try {
      if (msg.t === 'createRoom') {
        this.room = await client.create('match', { config: msg.config, name: msg.name, color: msg.color });
        this.wire();
      } else if (msg.t === 'joinRoom') {
        const opts = { name: msg.name, color: msg.color };
        this.room = msg.roomCode
          ? await client.joinById(msg.roomCode, opts)
          : await client.joinOrCreate('match', opts);
        this.wire();
      } else {
        this.room?.send(msg.t, msg);
      }
    } catch (err) {
      this.lobbyHandler?.({ t: 'joinRejected', reason: errorText(err) });
    }
  }

  private wire(): void {
    const room = this.room;
    if (!room) return;
    room.onMessage('lobby', (m: ServerMessage) => this.lobbyHandler?.(m));
    room.onMessage('snapshot', (s: Snapshot) => this.snapshotHandler?.(s));
    room.onMessage('gameEvent', (e: unknown) => this.eventHandler?.(e));
    room.onError((code: number, message?: string) =>
      this.lobbyHandler?.({ t: 'joinRejected', reason: message ?? `error ${code}` }),
    );
  }

  // ── SessionTransport ───────────────────────────────────────────────────────────

  sendCommand(cmd: TicCommand): void {
    this.room?.send('cmd', cmd);
  }

  onSnapshot(handler: (snapshot: unknown) => void): void {
    this.snapshotHandler = handler as (snap: Snapshot) => void;
  }

  onEvent(handler: (event: unknown) => void): void {
    this.eventHandler = handler;
  }
}

function errorText(err: unknown): string {
  if (err && typeof err === 'object' && 'message' in err) return String((err as { message: unknown }).message);
  return 'CONNECTION FAILED';
}
