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
import type { SimContext, SkillId, MapData, ILevelRuntime, IWorld, Player } from '../core';
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
  /** One weapon system per player (B1): offline single-player is a map of size 1 (id 0);
   *  the authoritative server drives one per connected marine. */
  private readonly weapons = new Map<number, WeaponSystem>();
  private ai: MonsterAI | null = null;
  /** The player whose command is currently being applied — so a gunshot's AI-noise
   *  originates at the firing marine, not always the local one (set around weapons.update). */
  private activePlayer: Player | null = null;

  private readonly presentation: boolean;
  private currentMapId = '';
  private levelTimeTics = 0;
  private kills = 0;
  private items = 0;
  private secrets = 0;
  private totalKills = 0;
  private totalItems = 0;
  private totalSecrets = 0;
  /** Last command seq applied for the LOCAL player (snapshots/reconciliation, P3a). */
  private lastProcessedSeq = -1;
  /** Last command seq applied per player id (the server stamps each snapshot, P3a). */
  private readonly processedSeqByPlayer = new Map<number, number>();

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
      const p = this.activePlayer ?? this.ctx.world.player;
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
    return this.weapons.get(this.ctx.world.localPlayerId)?.getView() ?? null;
  }

  /** Last command seq the authority applied for `playerId` (per-player reconciliation). */
  processedSeqFor(playerId: number): number {
    return this.processedSeqByPlayer.get(playerId) ?? -1;
  }

  /** Whether `playerId` is mid-shot this tick — the server maps it to the marine's
   *  PLAY attack frame in the snapshot so remote avatars animate firing. */
  isFiring(playerId: number): boolean {
    return this.weapons.get(playerId)?.firing ?? false;
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

  /** Start a brand-new game at the episode's first level with a fresh loadout for
   *  every player (each keeps its id; loadLevel repositions them at the spawn). */
  startNewGame(skill: SkillId, levelId: string = EPISODE1.levels[0]!.id): void {
    this.ctx.skill = skill;
    const w = this.ctx.world;
    for (const id of [...w.players.keys()]) w.players.set(id, createPlayer(id, 0, 0, 0));
    this.ctx.episodeLevel = 0;
    this.startLevel(levelId);
  }

  /** Load `mapId`: tear down the previous level's systems, build new ones, spawn. */
  startLevel(mapId: string): void {
    this.teardownLevel();
    const data = mapDataFor(mapId);
    if (!data) throw new Error(`startLevel: unknown map ${mapId}`);

    this.currentMapId = mapId;
    this.combatBus = new CombatBus(this.ctx.events);
    this.level = loadLevel(this.ctx.world, data, this.ctx.skill, this.ctx.events);
    // One weapon system per player (each marine fires + carries its own loadout).
    this.weapons.clear();
    this.processedSeqByPlayer.clear();
    for (const id of this.ctx.world.players.keys()) {
      this.weapons.set(id, new WeaponSystem(this.ctx.world, this.ctx.rng, this.combatBus, id));
    }
    this.ai = createMonsterAI(this.ctx.world, this.ctx.rng, this.combatBus);

    this.computeTotals(data);
    this.kills = 0;
    this.items = 0;
    this.secrets = 0;
    this.levelTimeTics = 0;
  }

  teardownLevel(): void {
    this.ai?.dispose();
    for (const w of this.weapons.values()) w.dispose();
    this.weapons.clear();
    this.ai = null;
    this.combatBus = null;
    this.level = null;
  }

  /** Register a freshly-added player's weapon system mid-level (authoritative server,
   *  late co-op join). No-op offline (single-player never adds players mid-level). */
  registerPlayer(playerId: number): void {
    if (!this.level || !this.combatBus || this.weapons.has(playerId)) return;
    this.weapons.set(playerId, new WeaponSystem(this.ctx.world, this.ctx.rng, this.combatBus, playerId));
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
    const { world } = this.ctx;
    const level = this.level;
    const localId = world.localPlayerId;
    const weapons = this.weapons.get(localId);
    if (!level || !weapons || !this.ai || !this.combatBus) return 'continue';

    const p = world.players.get(localId)!;
    this.lastProcessedSeq = cmd.seq;
    this.processedSeqByPlayer.set(localId, cmd.seq);

    // Apply the local marine's command, then simulate the shared world once. For a
    // size-1 players map (offline single-player) this is the exact canonical order +
    // result the original single-stream tic produced.
    this.applyPlayerInput(p, weapons, cmd);
    this.simulateWorld();

    if (p.health <= 0) return 'dead';
    if (level.pendingExit) {
      level.pendingExit = null;
      return 'exit';
    }
    return 'continue';
  }

  /**
   * Authoritative N-player step (the server's tick). Apply EVERY connected marine's
   * latest command to its own entity, then simulate the shared world once — so all
   * inputs land before AI/projectiles/doors/items resolve. Dead marines idle (no
   * respawn in P2). Returns whether any player tripped a level exit.
   */
  stepNetwork(commands: Map<number, TicCommand>): { exit: boolean } {
    const level = this.level;
    if (!level || !this.ai || !this.combatBus) return { exit: false };

    for (const [id, cmd] of commands) {
      const player = this.ctx.world.players.get(id);
      const weapons = this.weapons.get(id);
      if (!player || !weapons || player.health <= 0) continue;
      this.processedSeqByPlayer.set(id, cmd.seq);
      this.applyPlayerInput(player, weapons, cmd);
    }
    this.simulateWorld();

    if (level.pendingExit) {
      level.pendingExit = null;
      return { exit: true };
    }
    return { exit: false };
  }

  // ── one player's command + the shared world step ───────────────────────────

  /** Apply ONE marine's command: turn (keyboard + folded mouse-look), movement thrust
   *  with wall-slide collision, use, fire + weapon switching, then advance its weapon. */
  private applyPlayerInput(p: Player, weapons: WeaponSystem, cmd: TicCommand): void {
    const level = this.level!;
    const T = TICS_PER_STEP;

    const turnRate = degToRad(cmd.run ? TURN_RUN_DEG_PER_SEC : TURN_WALK_DEG_PER_SEC);
    p.angle += cmd.turn * turnRate * FIXED_STEP + cmd.lookTurn;

    const thrust = cmd.run ? PLAYER_THRUST_RUN : PLAYER_THRUST_WALK;
    if (cmd.forward !== 0) applyThrust(p, p.angle, thrust * cmd.forward, T);
    if (cmd.strafe !== 0) applyThrust(p, p.angle + Math.PI / 2, thrust * cmd.strafe, T);
    stepMovement(p, level, T);

    if (cmd.use) this.tryUse(p);

    if (cmd.fire) weapons.startFire();
    else weapons.stopFire();
    if (cmd.weaponSlot > 0) weapons.selectSlot(cmd.weaponSlot);
    if (cmd.weaponCycle > 0) weapons.nextWeapon();
    else if (cmd.weaponCycle < 0) weapons.prevWeapon();

    // weapons.update fires hitscan/melee/projectile + emits weapon:fired → ai.noise; the
    // active marine is tracked so that noise originates at the shooter, not always p0.
    this.activePlayer = p;
    weapons.update(T);
    this.activePlayer = null;
  }

  /** Simulate the shared world once after all inputs: AI, projectiles, doors/lifts
   *  (non-crushing for ANY player), per-player walkover triggers (B7), item pickups,
   *  and the level clock / per-player walk-bob phase. */
  private simulateWorld(): void {
    const { world, rng, events } = this.ctx;
    const level = this.level!;
    const T = TICS_PER_STEP;

    this.ai!.update(T);
    updateProjectiles(world, rng, this.combatBus!, T);

    updateDoors(level, FIXED_STEP, (cx, cy) => playerInCell(world, cx, cy), events);
    for (const player of world.players.values()) checkWalkoverTriggers(level, player, events);

    updateItems({ world, giverFor: (id) => this.weapons.get(id)!, skill: this.ctx.skill, events }, T);

    this.levelTimeTics += T;
    // Advance every marine's shared walk-bob phase off the level clock (DOOM leveltime);
    // the eye + weapon bob both read p.bob, so they ride one wave.
    for (const player of world.players.values()) player.bob = bobPhase(this.levelTimeTics);
  }

  /** Use-press: open a door or trip a switch-triggered exit/lift just ahead of `p`. */
  private tryUse(p: Player): void {
    const level = this.level;
    if (!level) return;
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

/** Any player standing in cell (cx,cy)? Drives the non-crushing door predicate so a
 *  door reopens for whichever player is underneath it (B7). */
function playerInCell(world: IWorld, cx: number, cy: number): boolean {
  for (const player of world.players.values()) {
    if (cellOf(player.x) === cx && cellOf(player.y) === cy) return true;
  }
  return false;
}
