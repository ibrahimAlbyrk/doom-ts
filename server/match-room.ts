// MatchRoom — ONE Colyseus room == one match (multiplayer-plan §1/§2/§3). It owns BOTH
// phases over a single connection (the protocol's SEAM NOTE):
//   • LOBBY: roster + ready-up + host config + START gate (src/lobby/protocol message set),
//   • MATCH: the authoritative headless GameSession — steps the shared sim at the fixed
//     step from each client's TicCommand stream and broadcasts full snapshots at ~20Hz.
// State is broadcast as plain JSON messages (not a Colyseus @type Schema): our struct-of-
// entities IS the one representation, built by buildSnapshot server-side and applied by
// the client — no second schema to mirror (D8 deferred; measure snapshot size after P2).
import { Room, Client, generateId } from 'colyseus';
import { EventBus, Rng, FIXED_STEP, SECONDS_PER_TIC } from '../src/core';
import type { GameEventMap, SimContext } from '../src/core';
import { World } from '../src/entities';
import { GameSession, type TicCommand } from '../src/game/session';
import { EPISODE1 } from '../src/levels';
import { buildSnapshot } from '../src/session/snapshot';
import type {
  ClientMessage,
  MatchConfig,
  RoomState,
  LobbyPlayer,
  ServerMessage,
} from '../src/lobby/protocol';
import { computeStatus, defaultMatchConfig } from '../src/lobby/protocol';
import { createGameMode, type GameMode, type ModeContext } from './modes/game-mode';
import { ServerSoundCollector } from './sound-collector';

/** Sim steps per network snapshot: 60Hz sim / 3 ≈ 20Hz broadcast ([netcode §4.5]). */
const STEPS_PER_SNAPSHOT = 3;
/** Doom-tics advanced per fixed sim step (same factor the sim/client use). */
const TICS_PER_STEP = FIXED_STEP / SECONDS_PER_TIC;
const EPISODES = [EPISODE1];

type CreateOptions = { config?: MatchConfig; name?: string; color?: number };
type JoinOptions = { name?: string; color?: number };

export class MatchRoom extends Room {
  private roomState!: RoomState;

  // sessionId ↔ lobby roster id (join order = the roster array order).
  private readonly lobbyIdBySession = new Map<string, string>();
  private readonly sessionByLobbyId = new Map<string, string>();

  // Match phase (null until START).
  private started = false;
  private sim: GameSession | null = null;
  private world: World | null = null;
  /** The injected rule set (FF / monsters / spawns / respawn / level flow) — co-op now,
   *  deathmatch in P5 (server/modes). Null until START. */
  private mode: GameMode | null = null;
  /** Turns the authoritative sim's gameplay events into positional NetSounds for the
   *  snapshot, so co-op SFX play on every client (server/sound-collector). */
  private sounds: ServerSoundCollector | null = null;
  private levelId = '';
  private tick = 0;
  private accumulatorSec = 0;
  private snapCounter = 0;
  /** sessionId → authoritative sim player id (0..N-1, assigned at START in join order). */
  private readonly simIdBySession = new Map<string, number>();
  /** sim id → snapshot metadata the lobby owns (how a client finds itself + nametag). */
  private readonly metaBySimId = new Map<number, { sid: string; name: string; color: number }>();
  /** sim id → that client's latest command (held until replaced — loss-tolerant). */
  private readonly commands = new Map<number, TicCommand>();

  // ── lifecycle ────────────────────────────────────────────────────────────────

  override onCreate(options: CreateOptions): void {
    const config = options.config ?? defaultMatchConfig('coop');
    this.maxClients = config.maxPlayers;
    this.roomState = { code: this.roomId, status: 'hosting', config, players: [] };

    this.onMessage('setReady', (client, msg: Extract<ClientMessage, { t: 'setReady' }>) =>
      this.onSetReady(client, msg.ready),
    );
    this.onMessage('setConfig', (client, msg: Extract<ClientMessage, { t: 'setConfig' }>) =>
      this.onSetConfig(client, msg.config),
    );
    this.onMessage('startMatch', (client) => this.onStart(client));
    this.onMessage('rematch', () => this.onRematch());
    this.onMessage('leaveRoom', (client) => client.leave());
    // Gameplay channel: the client's per-tick command for its own marine.
    this.onMessage('cmd', (client, cmd: TicCommand) => {
      const simId = this.simIdBySession.get(client.sessionId);
      if (simId !== undefined) this.commands.set(simId, cmd);
    });

    // The authoritative loop runs at the fixed step; it no-ops until START.
    this.setSimulationInterval((dtMs) => this.step(dtMs), (FIXED_STEP * 1000) | 0);
    console.log(`[room ${this.roomId}] created (${config.mode}, max ${config.maxPlayers})`);
  }

  override onJoin(client: Client, options: JoinOptions): void {
    if (this.started) throw new Error('MATCH IN PROGRESS'); // D7: reject late join (P2 default)

    const isHost = this.roomState.players.length === 0;
    const player: LobbyPlayer = {
      id: generateId(),
      name: options.name ?? `MARINE ${this.roomState.players.length + 1}`,
      color: options.color ?? 0,
      ready: false,
      isHost,
    };
    this.lobbyIdBySession.set(client.sessionId, player.id);
    this.sessionByLobbyId.set(player.id, client.sessionId);
    this.roomState.players.push(player);
    this.recompute();

    this.sendLobby(client, { t: 'joinAccepted', yourPlayerId: player.id, room: this.snapshot() });
    this.broadcastLobby({ t: 'playerJoined', id: player.id, name: player.name });
    this.broadcastRoomState();
    console.log(`[room ${this.roomId}] ${player.name} joined (${this.roomState.players.length} in room)`);
  }

  override onLeave(client: Client): void {
    const lobbyId = this.lobbyIdBySession.get(client.sessionId);
    this.lobbyIdBySession.delete(client.sessionId);
    if (lobbyId) this.sessionByLobbyId.delete(lobbyId);

    const left = this.roomState.players.find((p) => p.id === lobbyId);
    this.roomState.players = this.roomState.players.filter((p) => p.id !== lobbyId);

    // Promote a new host if the host left and others remain (keeps the lobby alive; D1's
    // "close the room" default is harsher than P2 needs for a small co-op session).
    if (left?.isHost && this.roomState.players[0]) this.roomState.players[0].isHost = true;

    if (this.started) {
      const simId = this.simIdBySession.get(client.sessionId);
      if (simId !== undefined) {
        this.world?.players.delete(simId);
        this.commands.delete(simId);
        this.metaBySimId.delete(simId);
      }
      this.simIdBySession.delete(client.sessionId);
    }

    this.recompute();
    if (left) this.broadcastLobby({ t: 'playerLeft', id: left.id, name: left.name });
    this.broadcastRoomState();
  }

  // ── lobby message handlers ─────────────────────────────────────────────────────

  private onSetReady(client: Client, ready: boolean): void {
    const p = this.playerOf(client);
    if (!p) return;
    p.ready = ready;
    this.recompute();
    this.broadcastRoomState();
  }

  private onSetConfig(client: Client, partial: Partial<MatchConfig>): void {
    const p = this.playerOf(client);
    if (!p?.isHost || this.started) return;
    this.roomState.config = { ...this.roomState.config, ...partial };
    this.maxClients = this.roomState.config.maxPlayers;
    for (const pl of this.roomState.players) pl.ready = false; // nobody readied this config
    this.recompute();
    this.broadcastRoomState();
  }

  private onStart(client: Client): void {
    const p = this.playerOf(client);
    if (!p?.isHost || this.started || this.roomState.status !== 'allReady') return;
    this.startMatch();
  }

  private onRematch(): void {
    for (const pl of this.roomState.players) pl.ready = false;
    this.recompute();
    this.broadcastRoomState();
  }

  // ── match seeding (multiplayer-plan §3.6) ──────────────────────────────────────

  private startMatch(): void {
    const cfg = this.roomState.config;
    const episode = EPISODES[cfg.episode] ?? EPISODES[0]!;
    this.levelId = episode.levels[cfg.startLevel]?.id ?? episode.levels[0]!.id;
    const mode = createGameMode(cfg);
    this.mode = mode;
    const seed = (Math.random() * 0x7fffffff) | 0;

    const world = new World();
    const events = new EventBus<GameEventMap>();
    const rng = new Rng(seed);
    // One sim player per connected marine (join order = roster order = sim id 0..N-1).
    while (world.players.size < this.roomState.players.length) world.addPlayer(0, 0, 0);
    const ctx: SimContext = { world, events, rng, skill: cfg.skill, episodeLevel: cfg.startLevel };
    // presentation:true so the sim emits the switch/lift 'sfx' the sound collector networks
    // (it never changes deterministic state — only whether cosmetic sound events are emitted).
    const sim = new GameSession(ctx, { presentation: true });
    this.sim = sim;
    this.world = world;

    // skill → SKILLS, episode/level → startLevel (multiplayer-plan §3.6); then the mode injects
    // its rules: friendly fire, and whether the level's monsters simulate (co-op keeps them).
    sim.startNewGame(cfg.skill, this.levelId);
    world.friendlyFire = mode.friendlyFire;
    if (!mode.monstersEnabled) world.monsters.length = 0;
    mode.onLevelStart(this.modeContext());

    this.roomState.players.forEach((lp, i) => {
      const sid = this.sessionByLobbyId.get(lp.id);
      if (sid === undefined) return;
      this.simIdBySession.set(sid, i);
      this.metaBySimId.set(i, { sid, name: lp.name, color: lp.color });
    });

    // Networked SFX: collect the sim's gameplay sounds into each snapshot.
    this.sounds = new ServerSoundCollector(world, () => sim.firingPlayerPos);
    this.sounds.bindGame(events);
    this.sounds.bindCombat(sim.combat!);
    this.sounds.resetPickups();

    this.tick = 0;
    this.accumulatorSec = 0;
    this.snapCounter = 0;
    this.commands.clear();
    this.started = true;

    this.roomState.status = 'inMatch';
    this.broadcastLobby({ t: 'matchStarting', config: cfg, seed, levelId: this.levelId });
    this.broadcastSnapshot(); // an immediate baseline so both clients spawn at once
    console.log(`[room ${this.roomId}] MATCH START — ${this.levelId} (${mode.id}), ${this.roomState.players.length} marines, FF ${world.friendlyFire}`);
  }

  /** Build the rule-set context for the current step (the GameMode reads/mutates the live
   *  sim through it, so a mode never imports the room). `playerCount` = marines in the match. */
  private modeContext(): ModeContext {
    return {
      world: this.world!,
      sim: this.sim!,
      config: this.roomState.config,
      level: this.sim!.currentLevelData!,
      playerCount: this.roomState.players.length,
    };
  }

  // ── authoritative loop ─────────────────────────────────────────────────────────

  private step(dtMs: number): void {
    if (!this.started || !this.sim || !this.mode || !this.sounds) return;
    // Fixed-step accumulator so the sim advances at exactly the client's cadence (so
    // co-op movement speed matches single-player) regardless of timer jitter.
    this.accumulatorSec += Math.min(dtMs / 1000, 0.25);
    while (this.accumulatorSec >= FIXED_STEP) {
      const r = this.sim.stepNetwork(this.commands);
      this.accumulatorSec -= FIXED_STEP;
      this.tick++;
      // Mode bookkeeping each step: co-op respawn timers (dm frag/time limits in P5).
      const limitHit = this.mode.update(this.modeContext(), TICS_PER_STEP);
      this.sounds.notePickups();
      if (r.exit) {
        // Shared progression: a marine reached the exit → advance the whole party, or end the
        // match on the final level (multiplayer-plan §4 / §5).
        if (this.mode.onLevelExit(this.modeContext()) === 'advance') this.advanceLevel();
        else this.endMatch();
        if (!this.started) return; // match ended (episode complete) — stop stepping
        continue; // new level seeded; advanceLevel already broadcast its baseline
      }
      if (limitHit) {
        this.endMatch();
        return;
      }
      if (++this.snapCounter >= STEPS_PER_SNAPSHOT) {
        this.snapCounter = 0;
        this.broadcastSnapshot();
      }
    }
  }

  /** Co-op shared progression: load the next level into the running sim, re-seed the mode +
   *  sound collector for it, and broadcast a baseline so clients reload + spawn together. The
   *  network tick keeps advancing (never reset), so clients accept the level-change snapshot. */
  private advanceLevel(): void {
    if (this.sim!.advanceAfterIntermission() === 'victory') {
      this.endMatch();
      return;
    }
    if (!this.mode!.monstersEnabled) this.world!.monsters.length = 0;
    this.levelId = this.sim!.currentLevelData?.id ?? this.levelId;
    this.mode!.onLevelStart(this.modeContext()); // clear respawn timers, revive dead marines
    this.sounds!.bindCombat(this.sim!.combat!); // the combat bus is rebuilt per level
    this.sounds!.resetPickups();
    this.broadcastSnapshot();
    console.log(`[room ${this.roomId}] LEVEL → ${this.levelId}`);
  }

  private broadcastSnapshot(): void {
    const sim = this.sim;
    const world = this.world;
    const level = world?.level;
    if (!sim || !world || !level) return;
    const snap = buildSnapshot(world, level, {
      tick: this.tick,
      mode: this.mode?.id ?? 'coop',
      isFiring: (id) => sim.isFiring(id),
      processedSeq: (id) => sim.processedSeqFor(id),
      metaFor: (id) => this.metaBySimId.get(id) ?? { sid: '', name: '', color: 0 },
    });
    snap.sounds = this.sounds?.flush() ?? []; // positional SFX collected since the last broadcast
    this.broadcast('snapshot', snap);
  }

  private endMatch(): void {
    this.started = false;
    this.sounds?.dispose();
    const mode = this.mode?.id ?? 'coop';
    this.sim = null;
    this.world = null;
    this.sounds = null;
    this.mode = null;
    this.roomState.status = 'postMatch';
    this.broadcastLobby({ t: 'matchEnded', results: { mode } });
    console.log(`[room ${this.roomId}] match ended (episode complete)`);
  }

  // ── helpers ──────────────────────────────────────────────────────────────────

  private playerOf(client: Client): LobbyPlayer | undefined {
    const id = this.lobbyIdBySession.get(client.sessionId);
    return id ? this.roomState.players.find((p) => p.id === id) : undefined;
  }

  private recompute(): void {
    if (!this.started) this.roomState.status = computeStatus(this.roomState.players);
  }

  private snapshot(): RoomState {
    const r = this.roomState;
    return { code: r.code, status: r.status, config: { ...r.config }, players: r.players.map((p) => ({ ...p })) };
  }

  private broadcastRoomState(): void {
    this.broadcastLobby({ t: 'roomState', room: this.snapshot() });
  }

  private broadcastLobby(msg: ServerMessage): void {
    this.broadcast('lobby', msg);
  }

  private sendLobby(client: Client, msg: ServerMessage): void {
    client.send('lobby', msg);
  }
}
