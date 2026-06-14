// MockLobbyTransport — an in-process fake "server" that implements LobbyTransport so
// the entire lobby UI + state machine is navigable and testable NOW, with no network
// (multiplayer-plan §3 — the lobby state machine, UI, and message set are
// transport-agnostic; only the substrate changes in P2). It maintains a single room,
// answers every ClientMessage exactly as the §3.2 transition rules require, and can
// inject a fake second player so the roster, ready-up, and all-ready START gate are
// demonstrable solo.
//
// Two ways to drive the fake player: timers (live UI demo, via constructor options)
// or the explicit `simulate*` methods (deterministic tests).
import { EPISODE1 } from '../levels';
import type {
  ClientMessage,
  LobbyColorId,
  LobbyPlayer,
  LobbyTransport,
  MatchConfig,
  RoomInfo,
  RoomState,
  ServerMessage,
} from './protocol';
import { computeStatus } from './protocol';

const EPISODES = [EPISODE1];

export interface MockOptions {
  /** Auto-spawn a fake second player this many ms after a room is created. 0 = never. */
  fakeJoinDelayMs?: number;
  /** Auto-ready the fake player this many ms after it joins. 0 = never. */
  fakeReadyDelayMs?: number;
}

export class MockLobbyTransport implements LobbyTransport {
  private handler: ((msg: ServerMessage) => void) | null = null;
  private room: RoomState | null = null;
  private localId: string | null = null;
  private nextId = 0;
  private readonly timers: ReturnType<typeof setTimeout>[] = [];
  private readonly opts: Required<MockOptions>;

  constructor(opts: MockOptions = {}) {
    this.opts = { fakeJoinDelayMs: opts.fakeJoinDelayMs ?? 0, fakeReadyDelayMs: opts.fakeReadyDelayMs ?? 0 };
  }

  connect(): Promise<void> {
    return Promise.resolve();
  }

  /** A couple of fake open rooms so the JOIN browser + tests work offline: one joinable co-op
   *  and one in-progress deathmatch (greyed in the browser). Their ids are never shown. */
  listRooms(): Promise<RoomInfo[]> {
    return Promise.resolve([
      { id: 'mock-coop', hostName: 'SARGE', mode: 'coop', skill: 3, episode: 0, startLevel: 0, players: 1, maxPlayers: 4, joinable: true },
      { id: 'mock-dm', hostName: 'RIPPER', mode: 'deathmatch', skill: 4, episode: 0, startLevel: 0, players: 8, maxPlayers: 8, joinable: false },
    ]);
  }

  onMessage(handler: (msg: ServerMessage) => void): void {
    this.handler = handler;
  }

  disconnect(): void {
    for (const t of this.timers) clearTimeout(t);
    this.timers.length = 0;
    this.room = null;
    this.localId = null;
  }

  send(msg: ClientMessage): void {
    switch (msg.t) {
      case 'createRoom':
        return this.onCreate(msg.config, msg.name, msg.color);
      case 'joinRoom':
        return this.onJoin(msg.name, msg.color);
      case 'setReady':
        return this.onSetReady(msg.ready);
      case 'setConfig':
        return this.onSetConfig(msg.config);
      case 'startMatch':
        return this.onStart();
      case 'rematch':
        return this.onRematch();
      case 'leaveRoom':
        return this.disconnect();
    }
  }

  // ── server logic ───────────────────────────────────────────────────────────────

  private onCreate(config: MatchConfig, name: string, color: LobbyColorId): void {
    const host = this.player(name, color, true);
    this.localId = host.id;
    this.room = { code: makeCode(), status: 'hosting', config, players: [host] };
    this.emit({ t: 'joinAccepted', yourPlayerId: host.id, room: this.snapshot() });
    this.scheduleFakePlayer();
  }

  /** Joining as a NON-host: spin up a room that already has a fake host, then add the
   *  local player. Demonstrates the read-only config panel a non-host sees. */
  private onJoin(name: string, color: LobbyColorId): void {
    if (!this.room) {
      const fakeHost = this.player('HOST MARINE', 1, true);
      fakeHost.ready = true;
      this.room = { code: makeCode(), status: 'hosting', config: defaultJoinConfig(), players: [fakeHost] };
    }
    if (this.room.players.length >= this.room.config.maxPlayers) {
      this.emit({ t: 'joinRejected', reason: 'ROOM FULL' });
      return;
    }
    const me = this.player(name, color, false);
    this.localId = me.id;
    this.room.players.push(me);
    this.recompute();
    this.emit({ t: 'joinAccepted', yourPlayerId: me.id, room: this.snapshot() });
    this.broadcast();
  }

  private onSetReady(ready: boolean): void {
    const me = this.find(this.localId);
    if (!me) return;
    me.ready = ready;
    this.recompute();
    this.broadcast();
  }

  private onSetConfig(partial: Partial<RoomState['config']>): void {
    if (!this.room) return;
    // Host-only is enforced client-side too; here we mirror §3.2: merge, clear every
    // player's ready (nobody readies a config they didn't see), drop to waiting/hosting.
    this.room.config = { ...this.room.config, ...partial };
    for (const p of this.room.players) p.ready = false;
    this.recompute();
    this.broadcast();
  }

  private onStart(): void {
    if (!this.room || this.room.status !== 'allReady') return;
    const { config } = this.room;
    const episode = EPISODES[config.episode] ?? EPISODES[0]!;
    const levelId = episode.levels[config.startLevel]?.id ?? episode.levels[0]!.id;
    this.room.status = 'starting';
    this.emit({ t: 'matchStarting', config, seed: makeSeed(), levelId });
  }

  private onRematch(): void {
    if (!this.room) return;
    for (const p of this.room.players) p.ready = false;
    this.recompute();
    this.broadcast();
  }

  // ── test / demo helpers (deterministic, synchronous) ─────────────────────────────

  /** Inject another player into the room (returns its id). For tests + demo. */
  simulatePlayerJoin(name = 'BOT MARINE', color: LobbyColorId = 2): string {
    if (!this.room) throw new Error('MockLobbyTransport: no room to join');
    const p = this.player(name, color, false);
    this.room.players.push(p);
    this.recompute();
    this.emit({ t: 'playerJoined', id: p.id, name: p.name });
    this.broadcast();
    return p.id;
  }

  simulatePlayerReady(id: string, ready = true): void {
    const p = this.find(id);
    if (!p) return;
    p.ready = ready;
    this.recompute();
    this.broadcast();
  }

  simulatePlayerLeave(id: string): void {
    if (!this.room) return;
    const p = this.find(id);
    this.room.players = this.room.players.filter((x) => x.id !== id);
    this.recompute();
    if (p) this.emit({ t: 'playerLeft', id, name: p.name });
    this.broadcast();
  }

  getRoom(): RoomState | null {
    return this.room ? this.snapshot() : null;
  }

  // ── internals ──────────────────────────────────────────────────────────────────

  private scheduleFakePlayer(): void {
    if (this.opts.fakeJoinDelayMs <= 0) return;
    this.timers.push(
      setTimeout(() => {
        const id = this.simulatePlayerJoin();
        if (this.opts.fakeReadyDelayMs > 0) {
          this.timers.push(setTimeout(() => this.simulatePlayerReady(id, true), this.opts.fakeReadyDelayMs));
        }
      }, this.opts.fakeJoinDelayMs),
    );
  }

  private player(name: string, color: LobbyColorId, isHost: boolean): LobbyPlayer {
    return { id: `P${this.nextId++}`, name, color, ready: false, isHost };
  }

  private find(id: string | null): LobbyPlayer | undefined {
    return id ? this.room?.players.find((p) => p.id === id) : undefined;
  }

  private recompute(): void {
    if (this.room) this.room.status = computeStatus(this.room.players);
  }

  private broadcast(): void {
    if (this.room) this.emit({ t: 'roomState', room: this.snapshot() });
  }

  /** Deep-enough copy so the LobbyClient/UI never aliases the mock's mutable state. */
  private snapshot(): RoomState {
    const r = this.room!;
    return { code: r.code, status: r.status, config: { ...r.config }, players: r.players.map((p) => ({ ...p })) };
  }

  private emit(msg: ServerMessage): void {
    this.handler?.(msg);
  }
}

function defaultJoinConfig(): RoomState['config'] {
  return {
    mode: 'coop',
    skill: 3,
    episode: 0,
    startLevel: 0,
    maxPlayers: 4,
    fragLimit: 20,
    timeLimit: 0,
    itemRespawn: false,
    coopRespawn: 'levelStart',
  };
}

function makeCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 4; i++) code += alphabet[Math.floor(Math.random() * alphabet.length)];
  return code;
}

function makeSeed(): number {
  return Math.floor(Math.random() * 0x7fffffff);
}
