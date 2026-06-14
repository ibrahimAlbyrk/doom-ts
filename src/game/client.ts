// GameClient — the BROWSER-side game runtime the state machine drives. It owns all
// presentation (render scene assembly, HUD, menus, intermission, audio, input→command)
// and routes the simulation through a Session. For offline single-player that Session
// is a LocalSession running the sim in-process (no server); the SAME presenter will
// later drive a RemoteSession for online play. The headless sim lives in session.ts;
// this is everything that needs a canvas/audio/DOM. See docs/multiplayer-plan.md §0.1.
import type { GameContext } from './types';
import type { Action, ScreenTint, PowerupKind, SkillId } from '../core';
import { FIXED_STEP, SECONDS_PER_TIC, CELL_SIZE, VIEW_HEIGHT } from '../core';
import { cellOf } from '../world';
import { mapDataFor } from '../levels';
import { GameSoundEvents, type AudioManager } from '../audio';
import { TextureCache, HudController, Intermission, Menus, drawAutomap, type LevelTally } from '../ui';
import {
  LocalSession,
  RemoteSession,
  ColyseusTransport,
  LatencyTransport,
  type LatencyOptions,
  type Session,
  type RemoteAvatar,
  type TicCommand,
  type TicResult,
} from '../session';
import { LobbyClient, type MatchConfig } from '../lobby';
import { buildRenderScene } from './scene';
import { saveResolution } from './resolution-store';

/** A doom-tics-per-fixed-step factor: 60 Hz render step → 35 Hz sim. */
const TICS_PER_STEP = FIXED_STEP / SECONDS_PER_TIC;
/** Radians of yaw per mouse pixel before the user sensitivity multiplier. */
const MOUSE_RADIANS_PER_PX = 0.0022;

// View-floor smoothing (DOOM P_CalcHeight feel): the rendered eye eases toward the
// player's standing floor tier instead of snapping when stepping up/down a tier or
// riding a lift. Each doom-tic closes this fraction of the remaining gap, with a
// minimum step so the proportional tail lands quickly.
const VIEW_FLOOR_LERP = 0.3;
const VIEW_FLOOR_MIN_STEP = 2; // mu per doom-tic

/** Default match-server endpoint (same host, Colyseus port). The lobby connects lazily
 *  on host/join, so offline single-player never touches the network. */
const MP_SERVER_URL = `ws://${location.hostname || 'localhost'}:2567`;
/** Nametag tint per LOBBY_COLORS index (GREEN, INDIGO, BROWN, RED). */
const NAMETAG_COLORS = ['#56c84c', '#6f78ff', '#b9803f', '#ff4d4d'] as const;
/** Nominal PLAY sprite texel height — for placing a nametag just above the avatar's head. */
const AVATAR_SPRITE_H = 56;

/** Read the dev latency-sim flag (localStorage 'mpNetSim' or ?netsim=base,jitter), e.g.
 *  "120,30" → 120ms ± 30ms on the session channel. Null (the default) = no added latency. */
function netSimOptions(): LatencyOptions | null {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem('mpNetSim');
  } catch {
    /* localStorage may be unavailable */
  }
  raw ??= new URLSearchParams(location.search).get('netsim');
  if (!raw) return null;
  const [base, jitter] = raw.split(',').map((n) => Number(n.trim()));
  if (!Number.isFinite(base)) return null;
  return { baseMs: base!, jitterMs: Number.isFinite(jitter) ? jitter! : 0 };
}

export class GameClient {
  readonly cache: TextureCache;
  readonly hud: HudController;
  readonly intermission: Intermission;
  readonly menus: Menus;
  /** The client lobby state machine the multiplayer menus drive. Backed by a real
   *  Colyseus-room transport (multiplayer-plan §3 / P2): host/join hit the match server,
   *  ready-up + the all-ready START gate run against the authority. Connecting is lazy
   *  (only on host/join), so offline single-player never needs the server. */
  readonly lobby: LobbyClient;

  /** The shared Colyseus connection backing BOTH the lobby and (once a match starts) the
   *  RemoteSession's gameplay channel — one room for the whole online session. */
  private readonly transport: ColyseusTransport;

  /** The offline authority the client boots with; kept so teardown can fall back to it
   *  after an online match (so single-player still works after playing co-op). */
  private readonly localSession: LocalSession;
  /** The authority the client renders/steps — LocalSession offline, RemoteSession online. */
  private session: Session;
  /** The concrete audio manager (ctx.audio is the narrower core Audio interface). */
  private readonly audio: AudioManager;
  /** Rebuilt per level — binds the level's combat bus to local SFX playback. */
  private gse: GameSoundEvents | null = null;

  private automapOn = false;
  private cmdSeq = 0;
  /** Decaying 0..1 tint strengths: red on taking damage, gold on a pickup. */
  private damageFlash = 0;
  private bonusFlash = 0;
  private animTic = 0;
  /** Smoothed view-floor height (mu) the eye rides; eases toward the standing tier. */
  private smoothViewFloorZ = 0;

  constructor(private readonly ctx: GameContext) {
    this.audio = ctx.audio as AudioManager;
    this.localSession = new LocalSession(ctx);
    this.session = this.localSession;
    this.transport = new ColyseusTransport(MP_SERVER_URL);
    this.cache = new TextureCache(ctx.assets);
    this.hud = new HudController(this.cache, ctx.events);
    this.intermission = new Intermission(this.cache);
    this.lobby = new LobbyClient(this.transport, { name: 'PLAYER 1' });
    this.menus = new Menus(this.cache, {
      config: ctx.config,
      getBindings: () => ctx.input.getBindings(),
      setBinding: (action, code) => ctx.input.setBinding(action, code),
      audio: ctx.audio,
      lobby: this.lobby,
      onResolutionChange: () => {
        ctx.renderer.resize(ctx.config);
        saveResolution({ width: ctx.config.internalWidth, height: ctx.config.internalHeight });
      },
    });

    // Screen-flash tints (presentation): red on taking damage, gold on a pickup. Capped
    // to the renderer-fx reference strength so they never fully occlude the view.
    ctx.events.on('player:damaged', (e) => {
      this.damageFlash = Math.min(0.55, this.damageFlash + 0.18 + e.amount / 60);
    });
    ctx.events.on('pickup:collected', () => {
      this.bonusFlash = Math.min(0.45, this.bonusFlash + 0.22);
    });
  }

  get levelActive(): boolean {
    return this.session.levelActive;
  }

  // ── lifecycle ──────────────────────────────────────────────────────────────

  /** Start a brand-new offline single-player game (routes through the LocalSession). */
  startNewGame(skill: SkillId): void {
    this.session.startNewGame(skill);
    this.onLevelLoaded();
  }

  /**
   * The lobby reached ALL_READY and the host pressed START (the server broadcast
   * matchStarting). The single handoff point: build a RemoteSession over the SAME Colyseus
   * room the lobby used, load the MatchConfig's level locally so the renderer/HUD have
   * geometry, swap it in for the LocalSession, and enter networked PLAYING. The server is
   * authoritative — snapshots fill the world in. Single-player offline is untouched.
   */
  startNetworkedMatch(_config: MatchConfig, levelId: string): void {
    // Dev netcode-smoothness check: an optional artificial-latency wrapper around the session
    // channel (set localStorage 'mpNetSim' = "120,30" or ?netsim=120,30). Off by default, so a
    // real match — and all of offline single-player — is never delayed.
    const sim = netSimOptions();
    const transport = sim ? new LatencyTransport(this.transport, sim) : this.transport;
    const remote = new RemoteSession(transport);
    remote.enterMatch(levelId);
    this.session = remote;
    this.onLevelLoaded();
  }

  teardownLevel(): void {
    this.gse?.unbindAll();
    this.gse = null;
    this.audio.stopAllSfx();
    this.audio.stopMusic();
    this.session.teardownLevel();
    // After an online match, fall back to the offline authority so a subsequent
    // single-player game runs locally again (the RemoteSession is single-use).
    if (this.session !== this.localSession) this.session = this.localSession;
  }

  beginIntermission(): void {
    const s = this.session.stats();
    const data = this.session.currentLevelData;
    const tally: LevelTally = {
      kills: s.kills,
      totalKills: s.totalKills,
      items: s.items,
      totalItems: s.totalItems,
      secrets: s.secrets,
      totalSecrets: s.totalSecrets,
      timeSeconds: s.timeTics * SECONDS_PER_TIC,
      parSeconds: data?.par ?? 0,
    };
    const nextId = this.session.peekNextLevelId();
    const nextName = nextId ? mapDataFor(nextId)?.name : undefined;
    this.intermission.start(tally, { finishedName: data?.name ?? '', nextName });
  }

  /** Advance once the intermission screen finishes (loads next level or signals victory). */
  advanceAfterIntermission(): 'next' | 'victory' {
    const result = this.session.advanceAfterIntermission();
    if (result === 'next') this.onLevelLoaded();
    return result;
  }

  /** Per-level presentation setup: re-bind sound events to the new combat bus, seed the
   *  view-floor smoothing, reset flashes/anim, show the level name, switch music. */
  private onLevelLoaded(): void {
    const data = this.session.currentLevelData;
    if (!data) return;

    this.gse?.unbindAll();
    this.gse = new GameSoundEvents(this.audio, (id) => this.locate(id));
    this.gse.bindGame(this.ctx.events);
    const combat = this.session.combat;
    if (combat) this.gse.bindCombat(combat);

    const level = this.session.currentLevel;
    const sp = this.session.world.player;
    this.smoothViewFloorZ = level ? level.floorHeightAt(cellOf(sp.x), cellOf(sp.y)) : 0;
    this.animTic = 0;
    this.damageFlash = 0;
    this.bonusFlash = 0;
    this.hud.setMessage(data.name);

    // Per-level music: the AudioContext is resumed on the menu's start gesture, so
    // playback starts here (no-op for unknown ids).
    if (data.music) this.audio.playMusic(data.music);
  }

  // ── per-frame input → command ───────────────────────────────────────────────

  /** Snapshot input into a fully-describing TicCommand: continuous actions sample held
   *  state, discrete edges are consumed this tick, and the per-frame mouse delta is
   *  folded into `lookTurn` so the command alone reproduces the tick. */
  readCommand(): TicCommand {
    const input = this.ctx.input;
    const axis = (pos: Action, neg: Action): number =>
      (input.isDown(pos) ? 1 : 0) - (input.isDown(neg) ? 1 : 0);

    let weaponSlot = 0;
    for (let n = 1; n <= 7; n++) {
      if (input.wasPressed(`weapon${n}` as Action)) weaponSlot = n;
    }

    // Automap toggle (edge): a presentation-only view state, read here per frame.
    if (input.wasPressed('automap')) this.automapOn = !this.automapOn;

    let lookTurn = 0;
    if (input.pointerLocked && input.mouseDX !== 0) {
      lookTurn = input.mouseDX * MOUSE_RADIANS_PER_PX * this.menus.getSensitivity();
    }

    return {
      forward: axis('moveForward', 'moveBack'),
      strafe: axis('strafeRight', 'strafeLeft'),
      turn: axis('turnRight', 'turnLeft'),
      lookTurn,
      run: input.isDown('run'),
      // Held OR pressed this tick: a tap too fast to be sampled as held still fires
      // once (the trigger releases next tick → stopFire), so quick taps never drop.
      fire: input.isDown('fire') || input.wasPressed('fire'),
      use: input.wasPressed('use'),
      weaponSlot,
      weaponCycle: (input.wasPressed('nextWeapon') ? 1 : 0) - (input.wasPressed('prevWeapon') ? 1 : 0),
      pause: input.wasPressed('pause'),
      seq: this.cmdSeq++,
    };
  }

  // ── one tick: advance the authority, then the presentation ──────────────────

  tic(cmd: TicCommand): TicResult {
    const result = this.session.tic(cmd);
    const level = this.session.currentLevel;
    if (level) {
      const T = TICS_PER_STEP;
      const p = this.session.world.player;
      // Ease the rendered view-floor toward the standing tier (after lift/step motion)
      // so step-ups/downs and lift rides glide instead of snapping.
      this.advanceViewFloor(level.floorHeightAt(cellOf(p.x), cellOf(p.y)), T);
      this.hud.update(FIXED_STEP);
      this.animTic += T;
      this.damageFlash = Math.max(0, this.damageFlash - 0.025 * T);
      this.bonusFlash = Math.max(0, this.bonusFlash - 0.02 * T);
    }
    return result;
  }

  private advanceViewFloor(targetZ: number, tics: number): void {
    const dz = targetZ - this.smoothViewFloorZ;
    const adz = Math.abs(dz);
    if (adz < 0.01) {
      this.smoothViewFloorZ = targetZ;
      return;
    }
    const step = Math.min(adz, Math.max(VIEW_FLOOR_MIN_STEP, adz * VIEW_FLOOR_LERP) * tics);
    this.smoothViewFloorZ += Math.sign(dz) * step;
  }

  // ── rendering ────────────────────────────────────────────────────────────────

  renderWorld(ctx2d: CanvasRenderingContext2D, alpha: number): void {
    const level = this.session.currentLevel;
    const view = this.session.getWeaponView();
    if (!level || !view) return;
    const { renderer, assets, config } = this.ctx;
    const world = this.session.world;
    this.audio.setListener(world.player.x, world.player.y, world.player.angle);
    // The status bar owns the bottom strip; the 3D view + weapon render above it.
    const playViewHeight = config.internalHeight - this.hud.barHeightPx(config.internalWidth);
    // Offset = smoothed view-floor − the actual tier under the player; folding it into
    // viewZ makes the renderer's eyeZ glide across tiers.
    const p = world.player;
    const viewFloorOffset = this.smoothViewFloorZ - level.floorHeightAt(cellOf(p.x), cellOf(p.y));
    // Other co-op marines (online only) render as billboard avatars through the sprite path.
    const remotes = this.session.remotePlayers?.() ?? [];
    const scene = buildRenderScene(
      world,
      level,
      assets,
      view,
      this.animTic,
      config.fovRatio,
      playViewHeight,
      viewFloorOffset,
      remotes,
    );
    scene.tint = this.computeTint();
    renderer.render(scene, alpha);
    if (remotes.length > 0) this.drawNametags(ctx2d, remotes, playViewHeight);
    // Automap overlay sits over the world but under the HUD bar (classic DOOM look).
    if (this.automapOn) {
      drawAutomap(ctx2d, world, world.player, config.internalWidth, config.internalHeight, {
        monsters: world.monsters,
      });
    }
    this.hud.composite(renderer, world);
  }

  /**
   * Depth-correct nametags over each remote marine: project its world position with the
   * same camera math the sprite pass uses, place a centered label just above the avatar's
   * head, tinted by its lobby color. Drawn on the display context after the world blit.
   */
  private drawNametags(ctx2d: CanvasRenderingContext2D, remotes: readonly RemoteAvatar[], viewH: number): void {
    const level = this.session.currentLevel;
    if (!level) return;
    const { config } = this.ctx;
    const p = this.session.world.player;
    const W = config.internalWidth;
    const H = viewH;
    const dirX = Math.cos(p.angle);
    const dirY = Math.sin(p.angle);
    const planeX = -dirY * config.fovRatio;
    const planeY = dirX * config.fovRatio;
    const invDet = 1 / (planeX * dirY - dirX * planeY);
    const camX = p.x / CELL_SIZE;
    const camY = p.y / CELL_SIZE;
    const eyeZ = level.floorHeightAt(cellOf(p.x), cellOf(p.y)) / CELL_SIZE + VIEW_HEIGHT / CELL_SIZE;
    const half = H / 2;

    ctx2d.save();
    ctx2d.font = '6px monospace';
    ctx2d.textAlign = 'center';
    ctx2d.textBaseline = 'bottom';
    ctx2d.lineWidth = 2;
    for (const r of remotes) {
      const dx = r.x / CELL_SIZE - camX;
      const dy = r.y / CELL_SIZE - camY;
      const tX = invDet * (dirY * dx - dirX * dy);
      const tY = invDet * (-planeY * dx + planeX * dy); // depth
      if (tY <= 0.1) continue;
      const screenX = (W / 2) * (1 + tX / tY);
      if (screenX < -20 || screenX > W + 20) continue;
      const scale = H / tY;
      const spriteFloorZ = level.floorHeightAt(cellOf(r.x), cellOf(r.y)) / CELL_SIZE;
      const headY = half + (eyeZ - spriteFloorZ) * scale - (AVATAR_SPRITE_H / CELL_SIZE) * scale;
      const label = r.name || `P${r.id}`;
      ctx2d.strokeStyle = 'rgba(0,0,0,0.85)';
      ctx2d.strokeText(label, screenX, Math.max(8, headY - 2));
      ctx2d.fillStyle = NAMETAG_COLORS[r.color] ?? '#ffffff';
      ctx2d.fillText(label, screenX, Math.max(8, headY - 2));
    }
    ctx2d.restore();
  }

  /**
   * Derive the full-screen palette tint from player state (doom-design §5). One tint
   * slot, by priority: invulnerability invert → decaying damage red → decaying pickup
   * gold → light-amp bright → radiation green → berserk red. Undefined when nothing active.
   */
  private computeTint(): ScreenTint | undefined {
    const pw = this.session.world.player.powerups;
    const active = (k: PowerupKind): boolean => {
      const v = pw[k];
      return v !== undefined && v !== 0;
    };
    if (active('invulnerability')) return { r: 255, g: 255, b: 255, a: 0.15, mode: 'invert' };
    if (this.damageFlash > 0) return { r: 255, g: 0, b: 0, a: Math.min(0.55, this.damageFlash) };
    if (this.bonusFlash > 0) return { r: 215, g: 186, b: 69, a: Math.min(0.45, this.bonusFlash) };
    if (active('lightVisor')) return { r: 255, g: 255, b: 210, a: 0.25, mode: 'bright' };
    if (active('radSuit')) return { r: 0, g: 255, b: 0, a: 0.18 };
    if (active('berserk')) return { r: 255, g: 0, b: 0, a: 0.1 };
    return undefined;
  }

  // ── helpers ──────────────────────────────────────────────────────────────────

  /** Resolve an entity id to a world position, for positioning id-only sound events. */
  private locate(id: number): { x: number; y: number } | undefined {
    const w = this.session.world;
    if (w.player.id === id) return { x: w.player.x, y: w.player.y };
    return (
      w.monsters.find((e) => e.id === id) ??
      w.projectiles.find((e) => e.id === id) ??
      w.pickups.find((e) => e.id === id)
    );
  }
}
