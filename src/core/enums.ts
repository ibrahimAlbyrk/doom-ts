// FROZEN CONTRACT — shared string/numeric union types every module keys off.
// Adding a member is backward compatible; renaming/removing is a breaking change.

/** Top-level game-state-machine node ids (docs/research/web-arch.md §3). */
export type GameStateId =
  | 'boot'
  | 'loading'
  | 'title'
  | 'menu'
  | 'playing'
  | 'paused'
  | 'intermission'
  | 'gameover'
  | 'credits';

/** Skill levels 1..5 (doom-design.md §7). */
export type SkillId = 1 | 2 | 3 | 4 | 5;

/** Who an entity / attack belongs to (drives infighting + friendly-fire rules). */
export type Faction = 'player' | 'monster' | 'neutral';

/** The 8 compass move directions DOOM monsters step along (doom-design.md §3 A_Chase). */
export type Direction8 = 'E' | 'NE' | 'N' | 'NW' | 'W' | 'SW' | 'S' | 'SE';

/** The nine player weapons (doom-design.md §2). */
export type WeaponId =
  | 'fist'
  | 'chainsaw'
  | 'pistol'
  | 'shotgun'
  | 'superShotgun'
  | 'chaingun'
  | 'rocketLauncher'
  | 'plasmaRifle'
  | 'bfg9000';

/** The four ammo pools (doom-design.md §4). */
export type AmmoType = 'bullets' | 'shells' | 'rockets' | 'cells';

/** How a weapon / monster attack resolves (combat module dispatches on this). */
export type AttackKind =
  | 'melee'
  | 'hitscan'
  | 'hitscanMelee'
  | 'projectile'
  | 'projectileSpray'
  | 'charge';

/** Monster archetypes (doom-design.md §3). */
export type MonsterType =
  | 'zombieman'
  | 'shotgunGuy'
  | 'imp'
  | 'demon'
  | 'spectre'
  | 'lostSoul'
  | 'cacodemon'
  | 'baron'
  | 'hellKnight'
  | 'cyberdemon'
  | 'spiderMastermind';

/** Broad pickup category (doom-design.md §5, §8). */
export type ItemKind = 'health' | 'armor' | 'ammo' | 'weapon' | 'powerup' | 'key' | 'backpack';

/** Timed / level-scoped powerups (doom-design.md §5). */
export type PowerupKind =
  | 'berserk'
  | 'invulnerability'
  | 'radSuit'
  | 'invisibility'
  | 'lightVisor'
  | 'computerMap';

/** Keycard / skull-key colours (doom-design.md §5). */
export type KeyColor = 'blue' | 'yellow' | 'red';

/** A key exists as a card or a skull; a locked door accepts either form. */
export type KeyForm = 'card' | 'skull';

/** Live AI state for a monster (doom-design.md §3 state machine). */
export type MonsterAIState =
  | 'idle'
  | 'chase'
  | 'melee'
  | 'missile'
  | 'pain'
  | 'death'
  | 'gib'
  | 'dead';
