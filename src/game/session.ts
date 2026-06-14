// GameSession — the live-game runtime that the PLAYING/PAUSED/INTERMISSION/…
// states drive. It owns the per-level systems (combat bus, weapons, AI, sounds,
// LevelRuntime), runs one fixed sim tic in the canonical order, assembles the
// render scene each frame, and threads the episode/intermission flow.
//
// Per-level systems are rebuilt on every startLevel and torn down first, so combat
// subscriptions never leak between maps. Shared services live on the GameContext.
import type { GameContext, SkillId, MapData, Action, ScreenTint, PowerupKind } from '../core';
import {
  CELL_SIZE,
  FIXED_STEP,
  SECONDS_PER_TIC,
  PLAYER_THRUST_WALK,
  PLAYER_THRUST_RUN,
  TURN_WALK_DEG_PER_SEC,
  TURN_RUN_DEG_PER_SEC,
  degToRad,
} from '../core';
import {
  applyThrust,
  stepMovement,
  updateDoors,
  tryUseDoor,
  triggerLift,
  checkWalkoverTriggers,
  cellOf,
  type LevelRuntime,
} from '../world';
import { loadLevel, mapDataFor, nextLevelId, thingSpawnsAtSkill, EPISODE1 } from '../levels';
import { createPlayer, enemyDefForThingId } from '../entities';
import { CombatBus, updateProjectiles } from '../combat';
import { WeaponSystem, bobPhase } from '../weapons';
import { createMonsterAI, type MonsterAI } from '../ai';
import { updateItems } from '../items';
import { GameSoundEvents, type AudioManager } from '../audio';
import { TextureCache, HudController, Intermission, Menus, drawAutomap, type LevelTally } from '../ui';
import { ITEMS_BY_ID } from '../data';
import { buildRenderScene } from './scene';

/** A doom-tics-per-fixed-step factor: 60 Hz render step → 35 Hz sim. */
const TICS_PER_STEP = FIXED_STEP / SECONDS_PER_TIC;
/** Radians of yaw per mouse pixel before the user sensitivity multiplier. */
const MOUSE_RADIANS_PER_PX = 0.0022;
/** Use-press probe distances ahead of the player (map units). */
const USE_REACHES = [28, 52, 76] as const;

const SFX_SWITCH = 'DSSWTCHN';
const SFX_LIFT_START = 'DSPSTART';

export interface TicCommand {
  forward: number; // -1..1 (forward +)
  strafe: number; // -1..1 (right +)
  turn: number; // -1..1 keyboard turn (right +)
  run: boolean;
  fire: boolean;
  use: boolean;
  weaponSlot: number; // 0 = none, else 1..7
  weaponCycle: number; // -1 prev, +1 next, 0 none
  pause: boolean;
}

export type TicResult = 'continue' | 'exit' | 'dead';

export class GameSession {
  readonly cache: TextureCache;
  readonly hud: HudController;
  readonly intermission: Intermission;
  readonly menus: Menus;

  /** The concrete audio manager (ctx.audio is the narrower core Audio interface). */
  private readonly audio: AudioManager;

  private level: LevelRuntime | null = null;
  private combat: CombatBus | null = null;
  private weapons: WeaponSystem | null = null;
  private ai: MonsterAI | null = null;
  private gse: GameSoundEvents | null = null;

  private currentMapId = '';
  private pendingNextId: string | null = null;
  private automapOn = false;
  /** Decaying 0..1 tint strengths: red on taking damage, gold on a pickup. */
  private damageFlash = 0;
  private bonusFlash = 0;
  private animTic = 0;
  private levelTimeTics = 0;
  private kills = 0;
  private items = 0;
  private secrets = 0;
  private totalKills = 0;
  private totalItems = 0;
  private totalSecrets = 0;

  constructor(private readonly ctx: GameContext) {
    this.audio = ctx.audio as AudioManager;
    this.cache = new TextureCache(ctx.assets);
    this.hud = new HudController(this.cache, ctx.events);
    this.intermission = new Intermission(this.cache);
    this.menus = new Menus(this.cache, {
      config: ctx.config,
      getBindings: () => ctx.input.getBindings(),
      setBinding: (action, code) => ctx.input.setBinding(action, code),
      audio: ctx.audio,
      onResolutionChange: () => ctx.renderer.resize(ctx.config),
    });

    // Persistent counters + the fire→noise hookup. These live for the whole app;
    // counters are zeroed per level and `this.ai` is whatever the current level built.
    ctx.events.on('monster:died', () => this.kills++);
    ctx.events.on('pickup:collected', () => {
      this.items++;
      this.bonusFlash = Math.min(0.45, this.bonusFlash + 0.22);
    });
    ctx.events.on('secret:found', () => this.secrets++);
    // Damage red-flash: bump a decaying counter on each hit (doom-design §5 tint).
    // Capped to the renderer-fx reference strength (~0.5) so it never fully occludes
    // the view, even stacked over the HUD's own brief damage flash.
    ctx.events.on('player:damaged', (e) => {
      this.damageFlash = Math.min(0.55, this.damageFlash + 0.18 + e.amount / 60);
    });
    ctx.events.on('weapon:fired', () => {
      const p = this.ctx.world.player;
      this.ai?.noise(p.x, p.y);
    });
  }

  get levelActive(): boolean {
    return this.level !== null;
  }

  // ── lifecycle ──────────────────────────────────────────────────────────────

  /** Start a brand-new game at the episode's first level with a fresh loadout. */
  startNewGame(skill: SkillId): void {
    this.ctx.skill = skill;
    const w = this.ctx.world;
    w.player = createPlayer(w.player.id, 0, 0, 0); // reset health/weapons/ammo
    this.ctx.episodeLevel = 0;
    this.startLevel(EPISODE1.levels[0]!.id);
  }

  /** Load `mapId`: tear down the previous level's systems, build new ones, spawn. */
  startLevel(mapId: string): void {
    this.teardownLevel();
    const data = mapDataFor(mapId);
    if (!data) throw new Error(`startLevel: unknown map ${mapId}`);

    this.currentMapId = mapId;
    this.combat = new CombatBus(this.ctx.events);
    this.level = loadLevel(this.ctx.world, data, this.ctx.skill, this.ctx.events);
    this.weapons = new WeaponSystem(this.ctx.world, this.ctx.rng, this.combat);
    this.ai = createMonsterAI(this.ctx.world, this.ctx.rng, this.combat);
    this.gse = new GameSoundEvents(this.audio, (id) => this.locate(id));
    this.gse.bindGame(this.ctx.events);
    this.gse.bindCombat(this.combat);

    this.computeTotals(data);
    this.kills = 0;
    this.items = 0;
    this.secrets = 0;
    this.levelTimeTics = 0;
    this.animTic = 0;
    this.damageFlash = 0;
    this.bonusFlash = 0;
    this.hud.setMessage(data.name);

    // Per-level music: switch tracks on each load (no-op for unknown ids). The
    // AudioContext is resumed on the menu's start gesture, so playback starts here.
    if (data.music) this.audio.playMusic(data.music);
  }

  teardownLevel(): void {
    this.ai?.dispose();
    this.weapons?.dispose();
    this.gse?.unbindAll();
    this.audio.stopAllSfx();
    this.audio.stopMusic();
    this.ai = null;
    this.weapons = null;
    this.gse = null;
    this.combat = null;
    this.level = null;
  }

  // ── per-frame input (read once, applied to N sim steps) ─────────────────────

  /** Snapshot input into a command and apply discrete mouse-look to the player's
   *  yaw immediately (mouse delta is a per-frame quantity, not per sim tic). */
  readCommand(): TicCommand {
    const input = this.ctx.input;
    const axis = (pos: Action, neg: Action): number =>
      (input.isDown(pos) ? 1 : 0) - (input.isDown(neg) ? 1 : 0);

    let weaponSlot = 0;
    for (let n = 1; n <= 7; n++) {
      if (input.wasPressed(`weapon${n}` as Action)) weaponSlot = n;
    }

    // Automap toggle (edge): read once per frame, here in the per-frame command read.
    if (input.wasPressed('automap')) this.automapOn = !this.automapOn;

    if (input.pointerLocked && input.mouseDX !== 0) {
      const sens = this.menus.getSensitivity();
      this.ctx.world.player.angle += input.mouseDX * MOUSE_RADIANS_PER_PX * sens;
    }

    return {
      forward: axis('moveForward', 'moveBack'),
      strafe: axis('strafeRight', 'strafeLeft'),
      turn: axis('turnRight', 'turnLeft'),
      run: input.isDown('run'),
      // Held OR pressed this tick: a tap too fast to be sampled as held still fires
      // once (the trigger releases next tick → stopFire), so quick taps never drop.
      fire: input.isDown('fire') || input.wasPressed('fire'),
      use: input.wasPressed('use'),
      weaponSlot,
      weaponCycle: (input.wasPressed('nextWeapon') ? 1 : 0) - (input.wasPressed('prevWeapon') ? 1 : 0),
      pause: input.wasPressed('pause'),
    };
  }

  // ── one sim tic (canonical order) ───────────────────────────────────────────

  tic(cmd: TicCommand): TicResult {
    const { world, rng, events } = this.ctx;
    const level = this.level;
    const weapons = this.weapons;
    const ai = this.ai;
    const combat = this.combat;
    if (!level || !weapons || !ai || !combat) return 'continue';

    const p = world.player;
    const T = TICS_PER_STEP;

    // 1) turn (keyboard) + movement thrust with wall-slide collision.
    const turnRate = degToRad(cmd.run ? TURN_RUN_DEG_PER_SEC : TURN_WALK_DEG_PER_SEC);
    p.angle += cmd.turn * turnRate * FIXED_STEP;

    const thrust = cmd.run ? PLAYER_THRUST_RUN : PLAYER_THRUST_WALK;
    if (cmd.forward !== 0) applyThrust(p, p.angle, thrust * cmd.forward, T);
    if (cmd.strafe !== 0) applyThrust(p, p.angle + Math.PI / 2, thrust * cmd.strafe, T);
    stepMovement(p, level, T);

    // 2) use (doors + switches), 3) fire + weapon switching.
    if (cmd.use) this.tryUse();

    if (cmd.fire) weapons.startFire();
    else weapons.stopFire();
    if (cmd.weaponSlot > 0) weapons.selectSlot(cmd.weaponSlot);
    if (cmd.weaponCycle > 0) weapons.nextWeapon();
    else if (cmd.weaponCycle < 0) weapons.prevWeapon();

    // 4) weapons (fires hitscan/melee/projectile; emits weapon:fired → ai.noise).
    weapons.update(T);
    // 5) AI, 6) projectiles.
    ai.update(T);
    updateProjectiles(world, rng, combat, T);

    // 7) world dynamics: doors/lifts (non-crushing) + walkover triggers.
    updateDoors(level, FIXED_STEP, (cx, cy) => cellOf(p.x) === cx && cellOf(p.y) === cy, events);
    checkWalkoverTriggers(level, p, events);

    // 8) item pickups.
    updateItems({ world, weapons, skill: this.ctx.skill, events }, T);

    this.hud.update(FIXED_STEP);
    this.levelTimeTics += T;
    this.animTic += T;
    // Advance the shared walk-bob phase off the level clock (DOOM leveltime). The eye
    // bob (scene.viewZ) and weapon bob both read p.bob, so they ride the same wave.
    p.bob = bobPhase(this.levelTimeTics);
    this.damageFlash = Math.max(0, this.damageFlash - 0.025 * T);
    this.bonusFlash = Math.max(0, this.bonusFlash - 0.02 * T);

    // 9) death + level exit.
    if (p.health <= 0) return 'dead';
    if (level.pendingExit) {
      level.pendingExit = null;
      return 'exit';
    }
    return 'continue';
  }

  /** Use-press: open a door or trip a switch-triggered exit/lift just ahead. */
  private tryUse(): void {
    const level = this.level;
    if (!level) return;
    const p = this.ctx.world.player;
    const dirX = Math.cos(p.angle);
    const dirY = Math.sin(p.angle);
    for (const reach of USE_REACHES) {
      const cx = cellOf(p.x + dirX * reach);
      const cy = cellOf(p.y + dirY * reach);
      if (tryUseDoor(level, cx, cy, p, this.ctx.events)) return;
      if (this.tryUseSwitch(cx, cy)) return;
    }
  }

  /** Switch/use-trigger handling the world module only does for walkovers. */
  private tryUseSwitch(cx: number, cy: number): boolean {
    const level = this.level!;
    const data = level.data;
    const events = this.ctx.events;
    const cellX = (cx + 0.5) * CELL_SIZE;
    const cellY = (cy + 0.5) * CELL_SIZE;

    for (let i = 0; i < data.exits.length; i++) {
      const t = data.exits[i]!.trigger;
      if ((t.kind !== 'switch' && t.kind !== 'use') || t.x !== cx || t.y !== cy) continue;
      if (t.once && level.hasFired('exit', i)) return false;
      level.pendingExit = data.exits[i]!.kind;
      events.emit('sfx', { sound: SFX_SWITCH, x: cellX, y: cellY });
      if (t.once) level.markFired('exit', i);
      return true;
    }

    for (let i = 0; i < data.lifts.length; i++) {
      const t = data.lifts[i]!.trigger;
      if ((t.kind !== 'switch' && t.kind !== 'use') || t.x !== cx || t.y !== cy) continue;
      const rt = level.lifts[i];
      if (rt && triggerLift(rt)) {
        events.emit('sfx', { sound: SFX_LIFT_START, x: cellX, y: cellY });
        if (t.once) level.markFired('lift', i);
        return true;
      }
    }
    return false;
  }

  // ── rendering ────────────────────────────────────────────────────────────────

  renderWorld(ctx2d: CanvasRenderingContext2D, alpha: number): void {
    const level = this.level;
    const weapons = this.weapons;
    if (!level || !weapons) return;
    const { world, renderer, assets, config } = this.ctx;
    this.audio.setListener(world.player.x, world.player.y, world.player.angle);
    // The status bar owns the bottom strip; the 3D view + weapon render above it.
    const playViewHeight = config.internalHeight - this.hud.barHeightPx(config.internalWidth);
    const scene = buildRenderScene(
      world,
      level,
      assets,
      weapons.getView(),
      this.animTic,
      config.fovRatio,
      playViewHeight,
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
   * Derive the full-screen palette tint from player state (doom-design §5, the
   * renderer-fx mapping). One tint slot, so by priority: invulnerability invert →
   * decaying damage red → decaying pickup gold → light-amp bright → radiation green →
   * berserk red. Returns undefined when nothing is active.
   */
  private computeTint(): ScreenTint | undefined {
    const pw = this.ctx.world.player.powerups;
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

  // ── episode / intermission flow ──────────────────────────────────────────────

  beginIntermission(): void {
    const level = this.level;
    const tally: LevelTally = {
      kills: this.kills,
      totalKills: this.totalKills,
      items: this.items,
      totalItems: this.totalItems,
      secrets: this.secrets,
      totalSecrets: this.totalSecrets,
      timeSeconds: this.levelTimeTics * SECONDS_PER_TIC,
      parSeconds: level?.data.par ?? 0,
    };
    this.pendingNextId = nextLevelId(EPISODE1, this.currentMapId);
    const nextName = this.pendingNextId ? mapDataFor(this.pendingNextId)?.name : undefined;
    this.intermission.start(tally, { finishedName: level?.data.name ?? '', nextName });
  }

  /** Advance once the intermission screen finishes. */
  advanceAfterIntermission(): 'next' | 'victory' {
    if (this.pendingNextId === null) {
      this.teardownLevel();
      return 'victory';
    }
    this.startLevel(this.pendingNextId);
    return 'next';
  }

  // ── helpers ──────────────────────────────────────────────────────────────────

  private computeTotals(data: MapData): void {
    let monsters = 0;
    let items = 0;
    for (const t of data.things) {
      if (!thingSpawnsAtSkill(t.skill, this.ctx.skill)) continue;
      if (enemyDefForThingId(t.id)) monsters++;
      else if (ITEMS_BY_ID.has(t.id)) items++;
    }
    this.totalKills = monsters;
    this.totalItems = items;
    this.totalSecrets = data.secretSectors.length;
  }

  private locate(id: number): { x: number; y: number } | undefined {
    const w = this.ctx.world;
    if (w.player.id === id) return { x: w.player.x, y: w.player.y };
    return (
      w.monsters.find((e) => e.id === id) ??
      w.projectiles.find((e) => e.id === id) ??
      w.pickups.find((e) => e.id === id)
    );
  }
}
