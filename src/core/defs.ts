// FROZEN CONTRACT — definition (template) types. The const tables in src/data are
// typed against these; gameplay systems read defs to parameterize behavior. Every
// instance-varying number lives on a Def; per-entity runtime state lives on the
// structs in ./types.
import type {
  WeaponId,
  AmmoType,
  AttackKind,
  MonsterType,
  ItemKind,
  PowerupKind,
  KeyColor,
  KeyForm,
  SkillId,
} from './enums';

/** The `d N × M` damage idiom: value = ((P_Random() % n) + 1) * m (doom-design.md §0). */
export interface DamageRoll {
  n: number;
  m: number;
}

// ── Weapons (doom-design.md §2) ────────────────────────────────────────────
export interface WeaponDef {
  id: WeaponId;
  name: string;
  slot: number; // selection key 1..7
  attack: AttackKind;
  ammo: AmmoType | null; // null = no ammo (fist/chainsaw)
  ammoPerShot: number;
  pellets: number; // hitscan pellets per shot (shotgun 7, SSG 20)
  damage: DamageRoll; // per pellet / direct hit
  fireTics: number; // tics between shots (≈ 35 / shots-per-sec)
  rangeMu: number; // melee/hitscan reach; 0 for projectile
  projectileSpeed: number; // mu/tic; 0 if hitscan
  /** BAM left-shift for horizontal spread; 0 = perfectly accurate. */
  spreadShift: number;
  firstShotAccurate: boolean; // pistol/chaingun first shot has no spread
  splashRadius: number; // mu; 0 if none
  viewSprite: string; // first-person gun lump prefix (e.g. PISG)
  flashSprite: string; // muzzle-flash prefix ('' if none)
  pickupSprite: string; // world pickup prefix ('' if start weapon)
  projectileSprite: string; // '' if hitscan
  fireSound: string; // DS* lump
  /** Berserk multiplies fist damage (doom-design.md §5); undefined = unaffected. */
  berserkMultiplier?: number;
}

// ── Monsters (doom-design.md §3) ───────────────────────────────────────────
export interface MonsterAttackDef {
  kind: AttackKind;
  melee?: DamageRoll;
  hitscan?: { roll: DamageRoll; pellets: number };
  projectile?: { roll: DamageRoll; speed: number; sprite: string; splashRadius?: number };
}

export interface MonsterSounds {
  sight?: string[];
  attack?: string;
  pain?: string;
  death?: string[];
  active?: string;
}

export interface EnemyDef {
  type: MonsterType;
  name: string; // DOOM name
  freedoomName: string; // approximate Freedoom counterpart
  thingId: number; // DoomEd id (doom-design.md §8) — the interchange anchor
  health: number;
  speed: number; // mu/tic
  chargeSpeed: number; // charging speed (lost soul); 0 if none
  radiusMu: number; // collision radius — canonical id mobjinfo value (not in §3 table)
  attack: MonsterAttackDef;
  painChance: number; // 0..256 compared against P_Random()
  mass: number; // affects knockback taken
  floats: boolean; // caco/lost soul ignore floor height
  sprite: string; // 4-char sprite prefix (assets.md §6)
  sounds: MonsterSounds;
}

// ── Ammo (doom-design.md §4) ───────────────────────────────────────────────
export interface AmmoDef {
  type: AmmoType;
  name: string;
  normalMax: number;
  backpackMax: number;
  smallPickup: number; // clip/4-shells/rocket/cell amount
  boxPickup: number; // box amount
}

// ── Items / pickups (doom-design.md §5, §8) ────────────────────────────────
export interface ItemDef {
  thingId: number; // DoomEd id
  id: string; // stable string key
  name: string;
  kind: ItemKind;
  sprite: string; // sprite prefix
  // Effect fields — only those relevant to `kind` are set.
  health?: number;
  healthCap?: number;
  armorPoints?: number;
  armorFactor?: number;
  ammoType?: AmmoType;
  ammoAmount?: number; // for ammo pickups / weapon-grant ammo
  weapon?: WeaponId; // for weapon pickups
  powerup?: PowerupKind;
  keyColor?: KeyColor;
  keyForm?: KeyForm;
}

// ── Powerups (doom-design.md §5) ───────────────────────────────────────────
export interface PowerupDef {
  kind: PowerupKind;
  thingId: number;
  name: string;
  /** Remaining-time in tics; -1 = lasts the rest of the level. */
  durationTics: number;
}

// ── DoomEd thing-id reference (doom-design.md §8) ──────────────────────────
export type ThingCategory =
  | 'start'
  | 'teleport'
  | 'monster'
  | 'weapon'
  | 'ammo'
  | 'health'
  | 'armor'
  | 'powerup'
  | 'key'
  | 'misc';

export interface ThingDef {
  id: number; // DoomEd editor number
  name: string;
  category: ThingCategory;
}

// ── Skill levels (doom-design.md §7) ───────────────────────────────────────
export interface SkillDef {
  id: SkillId;
  name: string;
  monsterFlag: 'easy' | 'normal' | 'hard'; // which MTF flag spawns
  damageTaken: number; // multiplier on damage the player takes
  ammoMultiplier: number; // multiplier on ammo pickups
  fastMonsters: boolean;
  respawn: boolean;
}
