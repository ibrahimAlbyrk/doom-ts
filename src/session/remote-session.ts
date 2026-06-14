// RemoteSession — the ONLINE Session (multiplayer-plan P2). It implements the SAME
// Session interface as LocalSession, but over the wire: it sends each local TicCommand to
// the authoritative Colyseus host and mirrors the broadcast snapshots into a local world,
// so the unchanged GameClient presenter renders/HUDs/audio exactly as it does offline. P2
// applies snapshots RAW (the local player rides the authoritative state, laggy-but-correct);
// prediction + interpolation are P3a. Offline single-player NEVER touches this file.
import type { ILevelRuntime, MapData, SkillId } from '../core';
import type { CombatBus } from '../combat';
import { WEAPONS } from '../data';
import type { WeaponView } from '../weapons';
import { World } from '../entities';
import { LevelRuntime } from '../world';
import { mapDataFor } from '../levels';
import type { Session, SimStats, TicCommand, TicResult } from './session';
import { applySnapshot, type AvatarState, type RemoteAvatar, type Snapshot } from './snapshot';

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

  constructor(transport: SessionTransport & Partial<LocalIdentity>, identity?: LocalIdentity) {
    this.transport = transport;
    this.identity = identity ?? (transport as LocalIdentity);
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
    this.transport.onSnapshot((s) => this.onSnapshot(s as Snapshot));
    this.transport.onEvent((e) => this.onEvent(e));
    void this.transport.connect();
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
    const firing = this.localState === 'fire';
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

  /** One networked tick: ship the local command; the world is advanced by incoming
   *  snapshots (applied on receipt), so this only reports the authoritative outcome. */
  tic(cmd: TicCommand): TicResult {
    this.transport.sendCommand(cmd);
    if (this.matchOver) return 'exit';
    const p = this.world.players.get(this.world.localPlayerId);
    if (p && p.health <= 0) return 'dead';
    return 'continue';
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
    // Resolve which marine is ME (sessionId travels on every PlayerSnap) before applying,
    // so the local point-of-view is never pruned by the apply pass.
    if (!this.localResolved) {
      const mine = snap.players.find((p) => p.sid === this.identity.sessionId);
      if (mine) {
        this.world.localPlayerId = mine.id;
        this.localResolved = true;
      }
    }
    applySnapshot(this.world, this.level, snap);
    this.avatarMeta.clear();
    for (const ps of snap.players) {
      this.avatarMeta.set(ps.id, { state: ps.state, name: ps.name, color: ps.color });
    }
    const me = snap.players.find((p) => p.id === this.world.localPlayerId);
    if (me) {
      this.localSeq = me.seq;
      this.localState = me.state;
    }
  }

  private onEvent(_event: unknown): void {
    // Reliable gameplay events (damage/death/pickup/exit/frag → SFX/HUD) land in P3+;
    // P2's milestone is the visual see-each-other slice. Hook kept for the seam.
  }
}
