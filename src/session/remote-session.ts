// RemoteSession — the ONLINE Session (multiplayer-plan P2 + P3a netcode smoothing). It
// implements the SAME Session interface as LocalSession, but over the wire: it sends each
// local TicCommand to the authoritative Colyseus host and mirrors the broadcast snapshots
// into a local world, so the unchanged GameClient presenter renders/HUDs/audio exactly as
// it does offline. P3a makes it feel lag-free with three pieces ([netcode §4.3/§4.4]):
//   • PREDICTION — the local marine applies its own command immediately (applyPlayerMovement)
//     and buffers it unacked, so movement/turn never wait a round-trip.
//   • RECONCILIATION — on each snapshot the local marine snaps to the authoritative state and
//     replays the still-unacked commands on top, so corrections are invisible when prediction
//     matched and ease out (no rubber-band) when it didn't.
//   • INTERPOLATION — every OTHER entity is rendered ~100ms in the past, lerped between the
//     two bracketing snapshots, so remotes glide instead of teleporting.
// Offline single-player NEVER touches this file.
import type { ILevelRuntime, MapData, SkillId } from '../core';
import { FIXED_STEP, SECONDS_PER_TIC } from '../core';
import type { CombatBus } from '../combat';
import { WEAPONS } from '../data';
import type { WeaponView } from '../weapons';
import { World, createPlayer } from '../entities';
import { LevelRuntime } from '../world';
import { mapDataFor } from '../levels';
import { applyPlayerMovement } from '../game/player-movement';
import type { Session, SimStats, TicCommand, TicResult } from './session';
import {
  applySnapshot,
  applyPlayerInventory,
  interpolateRemotes,
  type AvatarState,
  type NetSound,
  type PlayerSnap,
  type RemoteAvatar,
  type Snapshot,
} from './snapshot';
import { NETCODE } from './netcode-config';

/** A doom-tics-per-fixed-step factor: 60 Hz step → 35 Hz sim — same constant the server +
 *  LocalSession use, so prediction/replay math matches the authority exactly. */
const TICS_PER_STEP = FIXED_STEP / SECONDS_PER_TIC;

/** Monotonic-ish ms clock for the interpolation buffer (browser + Node). */
const defaultNow = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/** The network boundary a RemoteSession drives — the single place Colyseus plugs in.
 *  Send the local command up; receive authoritative snapshots + reliable gameplay
 *  events down. ColyseusTransport implements this over the live match room. */
export interface SessionTransport {
  /** Open the connection to the host (Colyseus room / ws). */
  connect(): Promise<void>;
  /** Send the local player's command for one tick (unreliable/best-effort). */
  sendCommand(cmd: TicCommand): void;
  /** Subscribe to authoritative world snapshots (server broadcast ~20Hz). */
  onSnapshot(handler: (snapshot: unknown) => void): void;
  /** Subscribe to reliable gameplay events (damage/death/pickup/exit/frag) the client
   *  turns into local SFX/HUD updates. */
  onEvent(handler: (event: unknown) => void): void;
  /** Close the connection. */
  disconnect(): void;
}

/** How the RemoteSession learns which marine in the snapshot is THIS client's. The
 *  Colyseus sessionId travels on every PlayerSnap (`sid`); the transport exposes ours. */
export interface LocalIdentity {
  readonly sessionId: string;
}

const ZERO_STATS: SimStats = {
  kills: 0,
  totalKills: 0,
  items: 0,
  totalItems: 0,
  secrets: 0,
  totalSecrets: 0,
  timeTics: 0,
};

export class RemoteSession implements Session {
  readonly transport: SessionTransport;
  /** The snapshot-mirrored world the presenter renders (its own, not the offline one). */
  readonly world: World = new World();

  private readonly identity: LocalIdentity;
  private level: LevelRuntime | null = null;
  private levelData: MapData | null = null;
  private localResolved = false;
  private localSeq = -1;
  private localState: AvatarState = 'idle';
  private matchOver = false;
  /** Per-player nametag/state metadata from the latest snapshot (drives the avatars). */
  private readonly avatarMeta = new Map<number, { state: AvatarState; name: string; color: number }>();

  /** Local commands the server hasn't acked yet — replayed on top of each correction. */
  private pending: TicCommand[] = [];
  /** Interpolation buffer: each broadcast stamped with its client receive time. */
  private readonly snapBuf: { recv: number; snap: Snapshot }[] = [];
  /** Newest snapshot tick accepted — drops stale/reordered arrivals under jitter. */
  private lastSnapTick = -1;
  /** Decaying visual offset that eases a reconciliation correction so it never pops. */
  private smoothX = 0;
  private smoothY = 0;
  /** Ticks left showing the local gun's firing frame (predicted trigger feedback). */
  private fireView = 0;
  /** Positional SFX from the latest snapshots, drained by the presenter each frame and
   *  played relative to the local marine (networked co-op SFX, multiplayer-plan §4). */
  private soundQueue: NetSound[] = [];
  /** Clock for the interpolation buffer (injectable so tests drive a virtual time). */
  private readonly now: () => number;

  constructor(
    transport: SessionTransport & Partial<LocalIdentity>,
    identity?: LocalIdentity,
    opts?: { now?: () => number },
  ) {
    this.transport = transport;
    this.identity = identity ?? (transport as LocalIdentity);
    this.now = opts?.now ?? defaultNow;
  }

  /** Enter a started match: load the level locally from the MatchConfig, then start
   *  mirroring snapshots. Called by GameClient.startNetworkedMatch on matchStarting. */
  enterMatch(levelId: string): void {
    const data = mapDataFor(levelId);
    if (!data) throw new Error(`RemoteSession: unknown level ${levelId}`);
    this.levelData = data;
    this.level = new LevelRuntime(data);
    this.world.level = this.level;
    this.matchOver = false;
    this.localResolved = false;
    this.pending = [];
    this.snapBuf.length = 0;
    this.lastSnapTick = -1;
    this.smoothX = 0;
    this.smoothY = 0;
    this.fireView = 0;
    this.soundQueue = [];
    this.transport.onSnapshot((s) => this.onSnapshot(s as Snapshot));
    this.transport.onEvent((e) => this.onEvent(e));
    void this.transport.connect();
  }

  /** Swap to a new level mid-match (co-op exit advanced the party). Loads the geometry the
   *  renderer/HUD need and resets the prediction/interpolation buffers; the local marine's
   *  identity is kept and the next snapshot snaps it to the new spawn (a >1-cell correction,
   *  so reconciliation hard-snaps rather than rubber-bands). Server time keeps advancing, so
   *  lastSnapTick is NOT reset — the level-change snapshot's tick is already the newest. */
  private loadLevelLocally(levelId: string): void {
    const data = mapDataFor(levelId);
    if (!data) return;
    this.levelData = data;
    this.level = new LevelRuntime(data);
    this.world.level = this.level;
    this.snapBuf.length = 0;
    this.pending = [];
    this.smoothX = 0;
    this.smoothY = 0;
  }

  // ── Session reads ──────────────────────────────────────────────────────────────

  get currentLevel(): ILevelRuntime | null {
    return this.level;
  }
  get currentLevelData(): MapData | null {
    return this.levelData;
  }
  get levelActive(): boolean {
    return this.level !== null;
  }
  /** No local combat bus online — gameplay SFX arrive as networked events instead. */
  get combat(): CombatBus | null {
    return null;
  }
  get processedSeq(): number {
    return this.localSeq;
  }

  getWeaponView(): WeaponView | null {
    const p = this.world.players.get(this.world.localPlayerId);
    if (!p) return null;
    const def = WEAPONS[p.currentWeapon];
    // Predicted trigger feedback: show the firing frame the instant fire is pressed
    // (fireView latch) instead of waiting a round-trip for the authoritative state.
    const firing = this.localState === 'fire' || this.fireView > 0;
    const hasFlash = def.flashSprite !== '';
    return {
      sprite: def.viewSprite,
      frame: firing ? 'B' : 'A',
      flashSprite: firing && hasFlash ? def.flashSprite : '',
      flashFrame: firing && hasFlash ? 'A' : '',
      bobX: 0,
      bobY: 0,
      extralight: firing && hasFlash ? 2 : 0,
    };
  }

  stats(): SimStats {
    return ZERO_STATS;
  }

  /** The OTHER marines to render this frame (everyone but the local point-of-view). */
  remotePlayers(): RemoteAvatar[] {
    const out: RemoteAvatar[] = [];
    for (const p of this.world.players.values()) {
      if (p.id === this.world.localPlayerId) continue;
      const meta = this.avatarMeta.get(p.id);
      out.push({
        id: p.id,
        x: p.x,
        y: p.y,
        angle: p.angle,
        state: meta?.state ?? 'idle',
        name: meta?.name ?? '',
        color: meta?.color ?? 0,
      });
    }
    return out;
  }

  // ── Session drive ────────────────────────────────────────────────────────────--

  /** One networked tick: ship the local command, then PREDICT the local marine forward
   *  immediately (no round-trip wait) and INTERPOLATE every remote entity ~100ms in the
   *  past. Reconciliation against the authoritative state happens on snapshot receipt. */
  tic(cmd: TicCommand): TicResult {
    this.transport.sendCommand(cmd);
    if (this.level && this.localResolved) {
      this.predict(cmd);
      this.interpolate();
    }
    // Co-op death is NOT game-over (D3 = respawn): a dead local marine stays in PLAYING and
    // the server respawns it after a short delay, so we never transition to gameover here —
    // only a whole-match end (matchOver) exits. The dead window just renders the world.
    if (this.matchOver) return 'exit';
    return 'continue';
  }

  /** Drain the positional SFX queued from the latest snapshots so the presenter can play
   *  them relative to the local marine. Empty offline / when no snapshot has arrived. */
  takeSounds(): NetSound[] {
    if (this.soundQueue.length === 0) return [];
    const out = this.soundQueue;
    this.soundQueue = [];
    return out;
  }

  /** Apply the local command to the predicted marine NOW (instant movement/turn), buffer it
   *  unacked for reconciliation, and decay the reconciliation smoothing offset. */
  private predict(cmd: TicCommand): void {
    const p = this.world.players.get(this.world.localPlayerId);
    if (!p || !this.level) return;
    // Strip the decaying correction offset → the true predicted anchor, advance it, then
    // re-apply the (now smaller) offset for rendering, so a past correction keeps easing out.
    p.x -= this.smoothX;
    p.y -= this.smoothY;
    applyPlayerMovement(p, this.level, cmd, TICS_PER_STEP);
    this.pending.push(cmd);
    this.fireView = cmd.fire ? NETCODE.FIRE_VIEW_LATCH_TICS : Math.max(0, this.fireView - 1);

    this.smoothX *= NETCODE.RECONCILE_SMOOTH_DECAY;
    this.smoothY *= NETCODE.RECONCILE_SMOOTH_DECAY;
    if (Math.hypot(this.smoothX, this.smoothY) < NETCODE.RECONCILE_SMOOTH_EPS) {
      this.smoothX = 0;
      this.smoothY = 0;
    }
    p.x += this.smoothX;
    p.y += this.smoothY;
  }

  /** Reconcile the predicted marine against the authoritative snapshot: take its state +
   *  velocity, drop acked commands, replay the still-unacked ones on top. The residual
   *  between where we were drawing and the corrected anchor is kept as a decaying offset so
   *  the marine never visibly snaps (invisible when prediction matched). */
  private reconcile(me: PlayerSnap): void {
    const p = this.world.players.get(this.world.localPlayerId);
    if (!p || !this.level) return;
    const renderX = p.x;
    const renderY = p.y;

    p.x = me.x;
    p.y = me.y;
    p.angle = me.angle;
    p.velX = me.vx;
    p.velY = me.vy;
    p.health = me.health;
    p.bob = me.bob;
    p.active = me.health > 0;
    // Mirror the full authoritative loadout so the local status bar (ammo/keys/weapon/armor)
    // is exact — not just the position/health prediction owns.
    applyPlayerInventory(p, me);

    this.pending = this.pending.filter((c) => c.seq > me.seq);
    for (const c of this.pending) applyPlayerMovement(p, this.level, c, TICS_PER_STEP);

    this.smoothX = renderX - p.x;
    this.smoothY = renderY - p.y;
    // A correction larger than a cell is a real teleport (respawn/lift/telefrag) — snap it.
    if (Math.hypot(this.smoothX, this.smoothY) > NETCODE.RECONCILE_SNAP_MU) {
      this.smoothX = 0;
      this.smoothY = 0;
    }
    p.x += this.smoothX;
    p.y += this.smoothY;
  }

  /** Render the remote world at `now − INTERP_DELAY`, lerping between the two snapshots that
   *  bracket that render time. Holds at the newest snapshot when the buffer runs dry (a late
   *  or dropped snapshot) rather than extrapolating into a guess. */
  private interpolate(): void {
    if (!this.level || this.snapBuf.length === 0) return;
    const target = this.now() - NETCODE.INTERP_DELAY_MS;
    let aIdx = 0;
    for (let i = 0; i < this.snapBuf.length; i++) {
      if (this.snapBuf[i]!.recv <= target) aIdx = i;
    }
    const a = this.snapBuf[aIdx]!;
    const b = this.snapBuf[Math.min(aIdx + 1, this.snapBuf.length - 1)]!;
    const span = b.recv - a.recv;
    const t = span > 0 ? Math.min(1, Math.max(0, (target - a.recv) / span)) : 0;
    interpolateRemotes(this.world, this.level, a.snap, b.snap, t, this.world.localPlayerId, this.avatarMeta);
  }

  /** Seed the predicted local marine at its authoritative spawn the first time we resolve
   *  which marine is ours, so prediction starts from the right place with no offset. */
  private seedLocal(me: PlayerSnap): void {
    let p = this.world.players.get(me.id);
    if (!p) {
      p = createPlayer(me.id, me.x, me.y, me.angle);
      this.world.players.set(me.id, p);
    }
    p.x = me.x;
    p.y = me.y;
    p.angle = me.angle;
    p.velX = me.vx;
    p.velY = me.vy;
    p.health = me.health;
    applyPlayerInventory(p, me);
    this.pending = [];
    this.smoothX = 0;
    this.smoothY = 0;
  }

  teardownLevel(): void {
    this.transport.disconnect();
    this.level = null;
    this.levelData = null;
  }

  // The lifecycle the offline session owns is server-driven online — these are no-ops so
  // an accidental call from the shared presenter can never crash a networked match.
  startNewGame(_skill: SkillId): void {
    /* server-driven */
  }
  startLevel(_mapId: string): void {
    /* server-driven */
  }
  advanceAfterIntermission(): 'next' | 'victory' {
    return 'victory';
  }
  peekNextLevelId(): string | null {
    return null;
  }

  // ── incoming authoritative state ───────────────────────────────────────────────

  private onSnapshot(snap: Snapshot): void {
    if (!this.level) return;
    // Drop stale/reordered arrivals — jitter can deliver an older snapshot late, and the
    // buffer + reconciliation must only ever move forward in server time.
    if (snap.tick <= this.lastSnapTick) return;
    this.lastSnapTick = snap.tick;

    // Co-op shared progression: the server advanced the whole party to the next level. Reload
    // it locally (geometry the renderer/HUD need) before applying this snapshot's entities.
    if (snap.level && this.levelData && snap.level !== this.levelData.id) {
      this.loadLevelLocally(snap.level);
      if (!this.level) return;
    }

    // Queue this tick's positional SFX for the presenter to play relative to the local marine.
    if (snap.sounds.length > 0) {
      for (const s of snap.sounds) this.soundQueue.push(s);
      const overflow = this.soundQueue.length - NETCODE.SOUND_QUEUE_MAX;
      if (overflow > 0) this.soundQueue.splice(0, overflow);
    }

    // Resolve which marine is ME (sessionId travels on every PlayerSnap); seed the predicted
    // local marine from its authoritative spawn the first time we find it.
    if (!this.localResolved) {
      const mine = snap.players.find((p) => p.sid === this.identity.sessionId);
      if (mine) {
        this.world.localPlayerId = mine.id;
        this.localResolved = true;
        this.seedLocal(mine);
      }
    }

    this.snapBuf.push({ recv: this.now(), snap });
    while (this.snapBuf.length > NETCODE.SNAPSHOT_BUFFER) this.snapBuf.shift();

    const me = snap.players.find((p) => p.id === this.world.localPlayerId);
    if (me) {
      this.localSeq = me.seq;
      this.localState = me.state;
    }

    if (this.localResolved && me) {
      this.reconcile(me); // local marine: authoritative + replay unacked (interpolation skips it)
    } else {
      // Cold start (our marine not resolved yet): mirror the newest snapshot raw so the world
      // isn't empty before prediction + interpolation take over.
      applySnapshot(this.world, this.level, snap);
      for (const ps of snap.players) {
        this.avatarMeta.set(ps.id, { state: ps.state, name: ps.name, color: ps.color });
      }
    }
  }

  private onEvent(_event: unknown): void {
    // Reliable gameplay events (damage/death/pickup/exit/frag → SFX/HUD) land in P3+;
    // P2's milestone is the visual see-each-other slice. Hook kept for the seam.
  }
}
