// FROZEN CONTRACT — entity struct shapes, the level/map data format, and the
// service interfaces threaded through the game. These are the shapes implementers
// build against; changing them ripples across every module, so they are frozen.
import type {
  WeaponId,
  AmmoType,
  MonsterType,
  ItemKind,
  PowerupKind,
  KeyColor,
  Faction,
  MonsterAIState,
  GameStateId,
  SkillId,
} from './enums';
import type { DamageRoll } from './defs';
import type { Renderer, RenderConfig, Texture, SpriteFrame } from './render';
import type { Audio } from './audio';
import type { Input } from './input';
import type { EventBus, GameEventMap } from './events';
import type { Rng } from './rng';

// ════════════════════════════════════════════════════════════════════════════
// Entity structs (struct-of-entities model — web-arch.md §4 option A).
// Positions are in MAP UNITS (mu); `angle` in radians. Pooled in swap-pop arrays.
// ════════════════════════════════════════════════════════════════════════════

export interface Entity {
  id: number;
  x: number;
  y: number;
  angle: number;
  radius: number;
  active: boolean;
}

export interface ArmorState {
  points: number;
  factor: number; // 1/3 (green) or 1/2 (blue); 0 when no armor
}

export interface PlayerInventory {
  weapons: Record<WeaponId, boolean>;
  ammo: Record<AmmoType, number>;
  ammoMax: Record<AmmoType, number>;
  keys: Record<KeyColor, { card: boolean; skull: boolean }>;
  backpack: boolean;
}

export interface Player extends Entity {
  velX: number;
  velY: number;
  health: number;
  armor: ArmorState;
  inventory: PlayerInventory;
  currentWeapon: WeaponId;
  pendingWeapon: WeaponId | null; // weapon being switched to (lower/raise anim)
  weaponCooldown: number; // tics until next shot
  bob: number; // accumulated walk-bob phase
  /** Remaining tics per active powerup; -1 = rest of level. */
  powerups: Partial<Record<PowerupKind, number>>;
}

export interface Monster extends Entity {
  type: MonsterType;
  health: number;
  state: MonsterAIState;
  stateTimer: number; // tics spent in current state
  reactionTime: number; // tics until first attack after sighting
  target: number | null; // entity id of current target
  velX: number;
  velY: number;
  flinchImmune: boolean; // e.g. lost soul mid-charge ignores pain
}

export interface Projectile extends Entity {
  velX: number;
  velY: number;
  damage: DamageRoll;
  speed: number; // mu/tic
  ownerId: number;
  ownerFaction: Faction;
  splashRadius: number; // 0 if none
  sprite: string;
}

export interface Pickup extends Entity {
  thingId: number; // DoomEd id → ItemDef
  kind: ItemKind;
  respawns: boolean;
}

// ════════════════════════════════════════════════════════════════════════════
// Level / map data — the on-disk JSON format (axis-aligned grid).
// Grid layers are row-major: index = y * width + x. See docs/ARCHITECTURE.md
// for the authoritative schema + example.
// ════════════════════════════════════════════════════════════════════════════

export interface SpawnPoint {
  x: number; // map units
  y: number;
  angle: number; // degrees
}

export interface ThingSpec {
  id: number; // DoomEd thing id (src/data things table)
  x: number; // map units
  y: number;
  angle: number; // degrees
  skill: number; // MTF bitmask: 1=easy, 2=normal, 4=hard
}

export type TriggerKind = 'walkover' | 'switch' | 'use';

export interface TriggerSpec {
  kind: TriggerKind;
  x: number; // primary trigger cell (sfx origin; the single cell for switch/use)
  y: number;
  once: boolean; // W1/S1 (once) vs WR/SR (repeatable)
  tag?: number; // links a trigger to its target (door/lift/teleport dest)
  cells?: Array<{ x: number; y: number }>; // walkover footprint: every cell that trips it (defaults to [x,y])
}

export type DoorKind = 'normal' | 'locked';

export interface DoorSpec {
  x: number; // door cell
  y: number;
  kind: DoorKind;
  key?: KeyColor; // required key when kind === 'locked'
  speed: number; // open fraction per tic (0..1)
  waitTics: number; // stay-open time before auto-close; -1 = stays open
  texture: string; // closed-face texture key
}

export interface LiftSpec {
  cells: Array<{ x: number; y: number }>;
  lowHeight: number; // map units (discrete floor tier)
  highHeight: number;
  speed: number; // units per tic
  waitTics: number;
  trigger: TriggerSpec;
}

export interface TeleporterSpec {
  trigger: TriggerSpec;
  destX: number; // map units (MT_TELEPORTMAN destination)
  destY: number;
  destAngle: number; // degrees
}

export type ExitKind = 'normal' | 'secret';

export interface ExitSpec {
  kind: ExitKind;
  trigger: TriggerSpec;
}

export interface MapData {
  id: string; // "E1M1"
  name: string; // display name ("Hangar")
  width: number; // grid width (cells)
  height: number; // grid height (cells)
  cellSize: number; // map units per cell (default 64)

  // Grid layers — each length width*height, row-major.
  walls: number[]; // wall texture id; 0 = passable (no wall)
  floors: number[]; // floor flat id
  ceilings: number[]; // ceiling flat id; -1 = sky
  floorHeights: number[]; // discrete floor tier (map units; fake-height, engine.md §7.2)
  ceilHeights: number[]; // discrete ceiling tier (map units)
  light: number[]; // sector light 0..255 per cell

  // Texture id → asset-manifest key.
  wallTextures: string[]; // indexed by (wall id − 1)
  flatTextures: string[]; // indexed by flat id
  sky: string; // sky texture key

  // Dynamic / special features.
  doors: DoorSpec[];
  lifts: LiftSpec[];
  teleporters: TeleporterSpec[];
  exits: ExitSpec[];
  secretSectors: number[]; // cell indices flagged secret (sector special 9)

  things: ThingSpec[]; // monster/item/decoration spawns
  playerStart: SpawnPoint;

  par: number; // par time (seconds)
  music?: string; // music id (optional in v1)
}

// ════════════════════════════════════════════════════════════════════════════
// Service contracts implemented by sibling modules. Defined here so src/core
// stays the single import root and never depends on a sibling.
// ════════════════════════════════════════════════════════════════════════════

/** Runtime view of the current level (owned by src/world). Door open amounts,
 *  per-cell accessors the renderer + collision read. (x,y) are cell coords. */
export interface ILevelRuntime {
  readonly data: MapData;
  isSolid(cx: number, cy: number): boolean;
  wallTextureAt(cx: number, cy: number): string | null;
  floorTextureAt(cx: number, cy: number): string;
  ceilTextureAt(cx: number, cy: number): string | null; // null = sky
  floorHeightAt(cx: number, cy: number): number;
  ceilHeightAt(cx: number, cy: number): number;
  lightAt(cx: number, cy: number): number;
  /** 0 = closed .. 1 = fully open; returns 1 for non-door cells. */
  doorOpenAt(cx: number, cy: number): number;
}

/** Entity registry (owned by src/entities). Concrete World implements this. */
export interface IWorld {
  player: Player;
  monsters: Monster[];
  projectiles: Projectile[];
  pickups: Pickup[];
  level: ILevelRuntime | null;
  skill: SkillId; // active skill — drives the player-damage multiplier (loadLevel sets it)
  allocId(): number;
  removeMonster(id: number): void;
  removeProjectile(id: number): void;
  removePickup(id: number): void;
  reset(): void;
}

/** Decoded-asset lookups (owned by src/assets). */
export interface IAssetStore {
  getTexture(id: string): Texture | undefined;
  /** rotation 1..8, or 0 for angle-independent frames (assets.md §3.8). */
  getSprite(prefix: string, frame: string, rotation: number): SpriteFrame | undefined;
  getMap(id: string): MapData | undefined;
  getPalette(): Uint32Array | null;
  has(id: string): boolean;
}

// ════════════════════════════════════════════════════════════════════════════
// Game-state machine contract (web-arch.md §3).
// ════════════════════════════════════════════════════════════════════════════

/** Shared-services bag threaded into every state. */
export interface GameContext {
  readonly canvas: HTMLCanvasElement;
  readonly renderer: Renderer;
  readonly audio: Audio;
  readonly input: Input;
  readonly assets: IAssetStore;
  readonly world: IWorld;
  readonly events: EventBus<GameEventMap>;
  readonly rng: Rng;
  /** Request a state transition (the Game owns the actual swap). */
  transition(to: GameStateId): void;
  config: RenderConfig; // live render settings
  skill: SkillId;
  episodeLevel: number; // index into the episode's level list
}

export interface IGameState {
  readonly id: GameStateId;
  onEnter(ctx: GameContext): void;
  onExit(ctx: GameContext): void;
  update(dt: number): void;
  /** Draw to the visible 2D context; `alpha` is fixed-step interpolation. */
  render(ctx2d: CanvasRenderingContext2D, alpha: number): void;
}
