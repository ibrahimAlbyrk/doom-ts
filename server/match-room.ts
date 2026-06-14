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
import { GameSession, type TicCommand, type LagCompensator } from '../src/game/session';
import { EPISODE1 } from '../src/levels';
import { buildSnapshot } from '../src/session/snapshot';
import type {
  ClientMessage,
  MatchConfig,
  MatchResults,
  ResultScore,
  RoomState,
  LobbyPlayer,
  ServerMessage,
} from '../src/lobby/protocol';
import { computeStatus, defaultMatchConfig } from '../src/lobby/protocol';
import { createGameMode, isScoreKeeper, type GameMode, type ModeContext } from './modes/game-mode';
import { ServerSoundCollector } from './sound-collector';

/** Sim steps per network snapshot: 60Hz sim / 3 ≈ 20Hz broadcast ([netcode §4.5]). */
const STEPS_PER_SNAPSHOT = 3;
/** Doom-tics advanced per fixed sim step (same factor the sim/client use). */
const TICS_PER_STEP = FIXED_STEP / SECONDS_PER_TIC;
/** Broadcasts of marine positions kept for hitscan lag-comp rewind (~2s at 20Hz) — long
 *  enough to cover plausible RTT + interpolation delay ([netcode §5.6]). */
const LAG_HISTORY = 40;
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

  // Hitscan lag-compensation (deathmatch, multiplayer-plan §5 / [netcode §5.6]). The server keeps
  // a short ring of past marine positions (one entry per broadcast, keyed by the network tick the
  // client interpolates against) and, around a DM shooter's weapon step, rewinds the OTHER marines
  // to where that shooter saw them — so a shot on a moving target registers under latency.
  private readonly posHistory: { tick: number; pos: Map<number, { x: number; y: number }> }[] = [];
  private lagSaved: Map<number, { x: number; y: number }> | null = null;
  private readonly lagComp: LagCompensator = {
    rewind: (shooterId, cmd) => this.lagRewind(shooterId, cmd),
    restore: () => this.lagRestore(),
  };

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
    this.onMessage('rematch', (client) => this.onRematch(client));
    this.onMessage('leaveRoom', (client) => client.leave());
    // Gameplay channel: the client's per-tick command for its own marine.
    this.onMessage('cmd', (client, cmd: TicCommand) => {
      const simId = this.simIdBySession.get(client.sessionId);
      if (simId !== undefined) this.commands.set(simId, cmd);
    });

    // The authoritative loop runs at the fixed step; it no-ops until START.
    this.setSimulationInterval((dtMs) => this.step(dtMs), (FIXED_STEP * 1000) | 0);
    this.updateMetadata(); // list the room for the JOIN browser the moment it exists
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

  private onRematch(client: Client): void {
    const p = this.playerOf(client);
    if (!p?.isHost || this.started || this.roomState.status !== 'postMatch') return;
    // Restart with the SAME config: startMatch re-seeds a fresh sim + zeroed scores and
    // re-broadcasts matchStarting, so every client drops into a new round (multiplayer-plan §4).
    this.startMatch();
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
    this.posHistory.length = 0;
    this.started = true;

    this.roomState.status = 'inMatch';
    this.updateMetadata(); // now IN PROGRESS — the browser greys this room
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
      // Deathmatch hitscan is lag-compensated (rewind other marines to the shooter's view-time);
      // co-op passes none, so its world is never rewound.
      const r = this.sim.stepNetwork(this.commands, this.mode.id === 'deathmatch' ? this.lagComp : undefined);
      this.accumulatorSec -= FIXED_STEP;
      this.tick++;
      // Mode bookkeeping each step: co-op respawn timers; dm respawns + frag/time limits.
      const limitHit = this.mode.update(this.modeContext(), TICS_PER_STEP);
      this.sounds.notePickups();
      if (r.exit) {
        // Co-op: a marine reached the exit → advance the whole party, or end on the final level.
        // Deathmatch: 'stay' — the arena has no exit, so a stumbled-onto exit is ignored.
        const outcome = this.mode.onLevelExit(this.modeContext());
        if (outcome === 'advance') this.advanceLevel();
        else if (outcome === 'victory') this.endMatch();
        if (outcome !== 'stay') {
          if (!this.started) return; // match ended (episode complete) — stop stepping
          continue; // new level seeded; advanceLevel already broadcast its baseline
        }
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
    const mode = this.mode;
    const snap = buildSnapshot(world, level, {
      tick: this.tick,
      mode: mode?.id ?? 'coop',
      isFiring: (id) => sim.isFiring(id),
      processedSeq: (id) => sim.processedSeqFor(id),
      metaFor: (id) => this.metaBySimId.get(id) ?? { sid: '', name: '', color: 0 },
      scoreFor: (id) => this.scoreFor(id),
      timeRemaining: mode && isScoreKeeper(mode) ? mode.timeRemainingSec : 0,
    });
    snap.sounds = this.sounds?.flush() ?? []; // positional SFX collected since the last broadcast
    this.broadcast('snapshot', snap);
    this.recordPositions(); // remember this broadcast's marine positions for lag-comp rewind
  }

  /** Authoritative frags/deaths for a sim player id (zeroed in co-op / for an unseen id). */
  private scoreFor(id: number): { frags: number; deaths: number } {
    return this.mode && isScoreKeeper(this.mode) ? this.mode.scoreFor(id) : { frags: 0, deaths: 0 };
  }

  /** Snapshot the live marine positions into the lag-comp ring, keyed by the network tick this
   *  broadcast carries (the value clients interpolate against), trimmed to the ring length. */
  private recordPositions(): void {
    const world = this.world;
    if (!world) return;
    const pos = new Map<number, { x: number; y: number }>();
    for (const p of world.players.values()) pos.set(p.id, { x: p.x, y: p.y });
    this.posHistory.push({ tick: this.tick, pos });
    while (this.posHistory.length > LAG_HISTORY) this.posHistory.shift();
  }

  /** Move every OTHER live marine back to where `shooterId` saw it at `cmd.viewTick` — the same
   *  interpolated point the client rendered — so the upcoming weapon step resolves against it.
   *  Saves the live positions for restore(). No-op without a usable view-tick / history. */
  private lagRewind(shooterId: number, cmd: TicCommand): void {
    this.lagSaved = null;
    const world = this.world;
    const vt = cmd.viewTick;
    if (vt == null || vt <= 0 || this.posHistory.length < 2 || !world) return;

    const hist = this.posHistory;
    let bIdx = hist.length - 1;
    for (let i = 0; i < hist.length; i++) {
      if (hist[i]!.tick >= vt) {
        bIdx = i;
        break;
      }
    }
    const a = hist[Math.max(0, bIdx - 1)]!;
    const b = hist[bIdx]!;
    const span = b.tick - a.tick;
    const t = span > 0 ? Math.min(1, Math.max(0, (vt - a.tick) / span)) : 0;

    const saved = new Map<number, { x: number; y: number }>();
    for (const p of world.players.values()) {
      if (p.id === shooterId || p.health <= 0) continue;
      const pa = a.pos.get(p.id);
      const pb = b.pos.get(p.id);
      if (!pa || !pb) continue;
      saved.set(p.id, { x: p.x, y: p.y });
      p.x = pa.x + (pb.x - pa.x) * t;
      p.y = pa.y + (pb.y - pa.y) * t;
    }
    this.lagSaved = saved;
  }

  /** Restore the live positions the matching lagRewind() saved (called right after the shot). */
  private lagRestore(): void {
    const world = this.world;
    if (this.lagSaved && world) {
      for (const [id, pos] of this.lagSaved) {
        const p = world.players.get(id);
        if (p) {
          p.x = pos.x;
          p.y = pos.y;
        }
      }
    }
    this.lagSaved = null;
  }

  private endMatch(): void {
    this.started = false;
    this.sounds?.dispose();
    const results = this.buildResults(); // read scores BEFORE tearing the mode down
    this.sim = null;
    this.world = null;
    this.sounds = null;
    this.mode = null;
    this.posHistory.length = 0;
    this.roomState.status = 'postMatch';
    this.updateMetadata(); // match over — but still not joinable (postMatch), stays greyed
    this.broadcastLobby({ t: 'matchEnded', results });
    console.log(`[room ${this.roomId}] match ended (${results.mode}) — ${results.scores.length} players`);
  }

  /** The final standings the results screen draws: one row per marine (sim id, nametag, color,
   *  frags/deaths) plus the mode + its limits. Co-op rows carry zero frags. */
  private buildResults(): MatchResults {
    const cfg = this.roomState.config;
    const scores: ResultScore[] = [];
    for (const [simId, meta] of this.metaBySimId) {
      const s = this.scoreFor(simId);
      scores.push({ id: String(simId), name: meta.name, color: meta.color, frags: s.frags, deaths: s.deaths });
    }
    return { mode: this.mode?.id ?? cfg.mode, fragLimit: cfg.fragLimit, timeLimit: cfg.timeLimit, scores };
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
    this.updateMetadata(); // keep the JOIN browser's host/mode/player-count/joinable in sync
    this.broadcastLobby({ t: 'roomState', room: this.snapshot() });
  }

  /** Publish the browser-relevant fields to the matchmaker cache so GET /rooms (the JOIN
   *  browser) sees them. `joinable` is false once the match starts or the room fills, so the
   *  browser greys the row (IN PROGRESS / FULL) instead of letting it be selected. */
  private updateMetadata(): void {
    const r = this.roomState;
    const host = r.players.find((p) => p.isHost);
    const joinable = !this.started && r.status !== 'starting' && r.players.length < r.config.maxPlayers;
    void this.setMetadata({
      hostName: host?.name ?? 'MARINE',
      mode: r.config.mode,
      skill: r.config.skill,
      episode: r.config.episode,
      startLevel: r.config.startLevel,
      joinable,
    });
  }

  private broadcastLobby(msg: ServerMessage): void {
    this.broadcast('lobby', msg);
  }

  private sendLobby(client: Client, msg: ServerMessage): void {
    client.send('lobby', msg);
  }
}
