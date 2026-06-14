// GameSession — the HEADLESS, deterministic simulation core. It owns the per-level
// systems (combat bus, weapons, AI, LevelRuntime) and runs one fixed sim tic in the
// canonical order, driven entirely by a serializable TicCommand. It has NO presentation:
// no canvas, audio, HUD, menus, or DOM — so it compiles and runs identically in the
// browser (driven by LocalSession) AND under Node (the authoritative multiplayer server).
// This is the replication seam the online build runs server-side; see
// docs/multiplayer-plan.md §0.1/§1.1. The browser presentation (render/HUD/audio/input)
// lives in the GameClient presenter (src/game/client.ts).
//
// Per-level systems are rebuilt on every startLevel and torn down first, so combat
// subscriptions never leak between maps. Shared services live on the SimContext.
import type { SimContext, SkillId, MapData, ILevelRuntime } from '../core';
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
import { WeaponSystem, bobPhase, type WeaponView } from '../weapons';
import { createMonsterAI, type MonsterAI } from '../ai';
import { updateItems } from '../items';
import { ITEMS_BY_ID } from '../data';

/** A doom-tics-per-fixed-step factor: 60 Hz render step → 35 Hz sim. */
const TICS_PER_STEP = FIXED_STEP / SECONDS_PER_TIC;
/** Use-press probe distances ahead of the player (map units). */
const USE_REACHES = [28, 52, 76] as const;

const SFX_SWITCH = 'DSSWTCHN';
const SFX_LIFT_START = 'DSPSTART';

/** One tick's complete input. Serializable + self-contained: a tick is fully described
 *  by this command (mouse-look folded into `lookTurn`, `seq` for client reconciliation),
 *  so the same command replays to the same result on client and server. */
export interface TicCommand {
  forward: number; // -1..1 (forward +)
  strafe: number; // -1..1 (right +)
  turn: number; // -1..1 keyboard turn (right +)
  /** Mouse-look yaw delta for this tick, in RADIANS (already sensitivity-scaled).
   *  Folds the per-frame mouse delta into the command so prediction can replay it. */
  lookTurn: number;
  run: boolean;
  fire: boolean;
  use: boolean;
  weaponSlot: number; // 0 = none, else 1..7
  weaponCycle: number; // -1 prev, +1 next, 0 none
  pause: boolean;
  /** Monotonic per-player command sequence (client→server reconciliation, P3a). */
  seq: number;
}

export type TicResult = 'continue' | 'exit' | 'dead';

/** Options for a session instance. `presentation` true = a client-driven sim (emits
 *  cosmetic SFX events for local audio); false = the headless server (gameplay events
 *  only — the client turns those into SFX over the wire). */
export interface SessionOptions {
  presentation: boolean;
}

export class GameSession {
  private level: LevelRuntime | null = null;
  private combatBus: CombatBus | null = null;
  private weapons: WeaponSystem | null = null;
  private ai: MonsterAI | null = null;

  private readonly presentation: boolean;
  private currentMapId = '';
  private levelTimeTics = 0;
  private kills = 0;
  private items = 0;
  private secrets = 0;
  private totalKills = 0;
  private totalItems = 0;
  private totalSecrets = 0;
  /** Last command seq applied (handed back in snapshots for reconciliation, P3a). */
  private lastProcessedSeq = -1;

  constructor(
    private readonly ctx: SimContext,
    opts: SessionOptions = { presentation: true },
  ) {
    this.presentation = opts.presentation;

    // Game-state counters + the gunshot→AI-noise hookup. These live for the whole
    // session; counters are zeroed per level and `this.ai` is the current level's.
    ctx.events.on('monster:died', () => this.kills++);
    ctx.events.on('pickup:collected', () => this.items++);
    ctx.events.on('secret:found', () => this.secrets++);
    ctx.events.on('weapon:fired', () => {
      const p = this.ctx.world.player;
      this.ai?.noise(p.x, p.y);
    });
  }

  // ── read access for the presenter / replication ─────────────────────────────

  get world() {
    return this.ctx.world;
  }
  get currentLevel(): ILevelRuntime | null {
    return this.level;
  }
  /** The current level's per-level combat bus (the presenter binds audio to it). */
  get combat(): CombatBus | null {
    return this.combatBus;
  }
  get levelActive(): boolean {
    return this.level !== null;
  }
  get currentLevelData(): MapData | null {
    return this.level?.data ?? null;
  }
  get processedSeq(): number {
    return this.lastProcessedSeq;
  }
  /** The local player's screen-space weapon view-model (the presenter resolves sprites). */
  getWeaponView(): WeaponView | null {
    return this.weapons?.getView() ?? null;
  }
  /** Per-level progress counters for the intermission tally (presenter builds the UI). */
  stats(): {
    kills: number;
    totalKills: number;
    items: number;
    totalItems: number;
    secrets: number;
    totalSecrets: number;
    timeTics: number;
  } {
    return {
      kills: this.kills,
      totalKills: this.totalKills,
      items: this.items,
      totalItems: this.totalItems,
      secrets: this.secrets,
      totalSecrets: this.totalSecrets,
      timeTics: this.levelTimeTics,
    };
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
    this.combatBus = new CombatBus(this.ctx.events);
    this.level = loadLevel(this.ctx.world, data, this.ctx.skill, this.ctx.events);
    this.weapons = new WeaponSystem(this.ctx.world, this.ctx.rng, this.combatBus);
    this.ai = createMonsterAI(this.ctx.world, this.ctx.rng, this.combatBus);

    this.computeTotals(data);
    this.kills = 0;
    this.items = 0;
    this.secrets = 0;
    this.levelTimeTics = 0;
  }

  teardownLevel(): void {
    this.ai?.dispose();
    this.weapons?.dispose();
    this.ai = null;
    this.weapons = null;
    this.combatBus = null;
    this.level = null;
  }

  /** Compute next level after the just-finished one: load it, or signal victory. */
  advanceAfterIntermission(): 'next' | 'victory' {
    const nextId = nextLevelId(EPISODE1, this.currentMapId);
    if (nextId === null) {
      this.teardownLevel();
      return 'victory';
    }
    this.startLevel(nextId);
    return 'next';
  }

  /** The level that follows the current one (for the intermission "next" label). */
  peekNextLevelId(): string | null {
    return nextLevelId(EPISODE1, this.currentMapId);
  }

  // ── one sim tic (canonical order) ───────────────────────────────────────────

  tic(cmd: TicCommand): TicResult {
    const { world, rng, events } = this.ctx;
    const level = this.level;
    const weapons = this.weapons;
    const ai = this.ai;
    const combat = this.combatBus;
    if (!level || !weapons || !ai || !combat) return 'continue';

    this.lastProcessedSeq = cmd.seq;
    const p = world.player;
    const T = TICS_PER_STEP;

    // 1) turn (keyboard + folded mouse-look) + movement thrust with wall-slide collision.
    const turnRate = degToRad(cmd.run ? TURN_RUN_DEG_PER_SEC : TURN_WALK_DEG_PER_SEC);
    p.angle += cmd.turn * turnRate * FIXED_STEP + cmd.lookTurn;

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

    this.levelTimeTics += T;
    // Advance the shared walk-bob phase off the level clock (DOOM leveltime). The eye
    // bob and weapon bob both read p.bob, so they ride the same wave.
    p.bob = bobPhase(this.levelTimeTics);

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
      if (this.presentation) events.emit('sfx', { sound: SFX_SWITCH, x: cellX, y: cellY });
      if (t.once) level.markFired('exit', i);
      return true;
    }

    for (let i = 0; i < data.lifts.length; i++) {
      const t = data.lifts[i]!.trigger;
      if ((t.kind !== 'switch' && t.kind !== 'use') || t.x !== cx || t.y !== cy) continue;
      const rt = level.lifts[i];
      if (rt && triggerLift(rt)) {
        if (this.presentation) events.emit('sfx', { sound: SFX_LIFT_START, x: cellX, y: cellY });
        if (t.once) level.markFired('lift', i);
        return true;
      }
    }
    return false;
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
}
