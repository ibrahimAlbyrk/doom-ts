// GameClient — the BROWSER-side game runtime the state machine drives. It owns all
// presentation (render scene assembly, HUD, menus, intermission, audio, input→command)
// and routes the simulation through a Session. For offline single-player that Session
// is a LocalSession running the sim in-process (no server); the SAME presenter will
// later drive a RemoteSession for online play. The headless sim lives in session.ts;
// this is everything that needs a canvas/audio/DOM. See docs/multiplayer-plan.md §0.1.
import type { GameContext } from './types';
import type { Action, ScreenTint, PowerupKind, SkillId } from '../core';
import { FIXED_STEP, SECONDS_PER_TIC } from '../core';
import { cellOf } from '../world';
import { mapDataFor } from '../levels';
import { GameSoundEvents, type AudioManager } from '../audio';
import { TextureCache, HudController, Intermission, Menus, drawAutomap, type LevelTally } from '../ui';
import { LocalSession, type Session, type TicCommand, type TicResult } from '../session';
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

export class GameClient {
  readonly cache: TextureCache;
  readonly hud: HudController;
  readonly intermission: Intermission;
  readonly menus: Menus;

  /** The authority the client renders/steps. Offline default = a LocalSession. */
  private readonly session: Session;
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
    this.session = new LocalSession(ctx);
    this.cache = new TextureCache(ctx.assets);
    this.hud = new HudController(this.cache, ctx.events);
    this.intermission = new Intermission(this.cache);
    this.menus = new Menus(this.cache, {
      config: ctx.config,
      getBindings: () => ctx.input.getBindings(),
      setBinding: (action, code) => ctx.input.setBinding(action, code),
      audio: ctx.audio,
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

  teardownLevel(): void {
    this.gse?.unbindAll();
    this.gse = null;
    this.audio.stopAllSfx();
    this.audio.stopMusic();
    this.session.teardownLevel();
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
    const scene = buildRenderScene(
      world,
      level,
      assets,
      view,
      this.animTic,
      config.fovRatio,
      playViewHeight,
      viewFloorOffset,
    );
    scene.tint = this.computeTint();
    renderer.render(scene, alpha);
    // Automap overlay sits over the world but under the HUD bar (classic DOOM look).
    if (this.automapOn) {
      drawAutomap(ctx2d, world, world.player, config.internalWidth, config.internalHeight, {
        monsters: world.monsters,
      });
    }
    this.hud.composite(renderer, world);
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
