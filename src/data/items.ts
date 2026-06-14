// Item / pickup table — docs/research/doom-design.md §5 (effects) + §8 (DoomEd ids).
// Sprite prefixes from assets.md §6. `ammoAmount` on a weapon pickup is the ammo
// granted on first pickup (doom-design §4). HEALTH_HARD_CAP = 200, soft = 100.
import type { ItemDef } from '../core';
import { ARMOR_GREEN_FACTOR, ARMOR_BLUE_FACTOR, HEALTH_SOFT_CAP, HEALTH_HARD_CAP } from '../core';

export const ITEMS: ItemDef[] = [
  // ── Health & armor (§5) ───────────────────────────────────────────────────
  { thingId: 2014, id: 'healthBonus', name: 'Health Bonus', kind: 'health', sprite: 'BON1', health: 1, healthCap: HEALTH_HARD_CAP },
  { thingId: 2011, id: 'stimpack', name: 'Stimpack', kind: 'health', sprite: 'STIM', health: 10, healthCap: HEALTH_SOFT_CAP },
  { thingId: 2012, id: 'medikit', name: 'Medikit', kind: 'health', sprite: 'MEDI', health: 25, healthCap: HEALTH_SOFT_CAP },
  { thingId: 2013, id: 'soulsphere', name: 'Soulsphere', kind: 'health', sprite: 'SOUL', health: 100, healthCap: HEALTH_HARD_CAP },
  { thingId: 83, id: 'megasphere', name: 'Megasphere', kind: 'health', sprite: 'MEGA', health: 200, healthCap: HEALTH_HARD_CAP, armorPoints: 200, armorFactor: ARMOR_BLUE_FACTOR },
  { thingId: 2015, id: 'armorBonus', name: 'Armor Bonus', kind: 'armor', sprite: 'BON2', armorPoints: 1, armorFactor: ARMOR_GREEN_FACTOR },
  { thingId: 2018, id: 'greenArmor', name: 'Green Armor', kind: 'armor', sprite: 'ARM1', armorPoints: 100, armorFactor: ARMOR_GREEN_FACTOR },
  { thingId: 2019, id: 'blueArmor', name: 'Blue Armor', kind: 'armor', sprite: 'ARM2', armorPoints: 200, armorFactor: ARMOR_BLUE_FACTOR },

  // ── Powerups (§5) ─────────────────────────────────────────────────────────
  { thingId: 2023, id: 'berserk', name: 'Berserk Pack', kind: 'powerup', sprite: 'PSTR', powerup: 'berserk' },
  { thingId: 2022, id: 'invulnerability', name: 'Invulnerability', kind: 'powerup', sprite: 'PINV', powerup: 'invulnerability' },
  { thingId: 2025, id: 'radSuit', name: 'Radiation Suit', kind: 'powerup', sprite: 'SUIT', powerup: 'radSuit' },
  { thingId: 2024, id: 'invisibility', name: 'Partial Invisibility', kind: 'powerup', sprite: 'PINS', powerup: 'invisibility' },
  { thingId: 2045, id: 'lightVisor', name: 'Light Amp Visor', kind: 'powerup', sprite: 'PVIS', powerup: 'lightVisor' },
  { thingId: 2026, id: 'computerMap', name: 'Computer Area Map', kind: 'powerup', sprite: 'PMAP', powerup: 'computerMap' },

  // ── Keys (§5) ─────────────────────────────────────────────────────────────
  { thingId: 5, id: 'blueCard', name: 'Blue Keycard', kind: 'key', sprite: 'BKEY', keyColor: 'blue', keyForm: 'card' },
  { thingId: 40, id: 'blueSkull', name: 'Blue Skull Key', kind: 'key', sprite: 'BSKU', keyColor: 'blue', keyForm: 'skull' },
  { thingId: 6, id: 'yellowCard', name: 'Yellow Keycard', kind: 'key', sprite: 'YKEY', keyColor: 'yellow', keyForm: 'card' },
  { thingId: 39, id: 'yellowSkull', name: 'Yellow Skull Key', kind: 'key', sprite: 'YSKU', keyColor: 'yellow', keyForm: 'skull' },
  { thingId: 13, id: 'redCard', name: 'Red Keycard', kind: 'key', sprite: 'RKEY', keyColor: 'red', keyForm: 'card' },
  { thingId: 38, id: 'redSkull', name: 'Red Skull Key', kind: 'key', sprite: 'RSKU', keyColor: 'red', keyForm: 'skull' },

  // ── Backpack (§4) ─────────────────────────────────────────────────────────
  { thingId: 8, id: 'backpack', name: 'Backpack', kind: 'backpack', sprite: 'BPAK' },

  // ── Weapon pickups (§2, ammo granted from §4) ─────────────────────────────
  { thingId: 2005, id: 'pickupChainsaw', name: 'Chainsaw', kind: 'weapon', sprite: 'CSAW', weapon: 'chainsaw' },
  { thingId: 2001, id: 'pickupShotgun', name: 'Shotgun', kind: 'weapon', sprite: 'SHOT', weapon: 'shotgun', ammoType: 'shells', ammoAmount: 8 },
  { thingId: 82, id: 'pickupSuperShotgun', name: 'Super Shotgun', kind: 'weapon', sprite: 'SGN2', weapon: 'superShotgun', ammoType: 'shells', ammoAmount: 8 },
  { thingId: 2002, id: 'pickupChaingun', name: 'Chaingun', kind: 'weapon', sprite: 'MGUN', weapon: 'chaingun', ammoType: 'bullets', ammoAmount: 20 },
  { thingId: 2003, id: 'pickupRocketLauncher', name: 'Rocket Launcher', kind: 'weapon', sprite: 'LAUN', weapon: 'rocketLauncher', ammoType: 'rockets', ammoAmount: 2 },
  { thingId: 2004, id: 'pickupPlasmaRifle', name: 'Plasma Rifle', kind: 'weapon', sprite: 'PLAS', weapon: 'plasmaRifle', ammoType: 'cells', ammoAmount: 40 },
  { thingId: 2006, id: 'pickupBfg9000', name: 'BFG9000', kind: 'weapon', sprite: 'BFUG', weapon: 'bfg9000', ammoType: 'cells', ammoAmount: 40 },

  // ── Ammo pickups (§4) ─────────────────────────────────────────────────────
  { thingId: 2007, id: 'clip', name: 'Clip', kind: 'ammo', sprite: 'CLIP', ammoType: 'bullets', ammoAmount: 10 },
  { thingId: 2048, id: 'boxBullets', name: 'Box of Bullets', kind: 'ammo', sprite: 'AMMO', ammoType: 'bullets', ammoAmount: 50 },
  { thingId: 2008, id: 'shells4', name: '4 Shells', kind: 'ammo', sprite: 'SHEL', ammoType: 'shells', ammoAmount: 4 },
  { thingId: 2049, id: 'boxShells', name: 'Box of Shells', kind: 'ammo', sprite: 'SBOX', ammoType: 'shells', ammoAmount: 20 },
  { thingId: 2010, id: 'rocket', name: 'Rocket', kind: 'ammo', sprite: 'ROCK', ammoType: 'rockets', ammoAmount: 1 },
  { thingId: 2046, id: 'boxRockets', name: 'Box of Rockets', kind: 'ammo', sprite: 'BROK', ammoType: 'rockets', ammoAmount: 5 },
  { thingId: 2047, id: 'cell', name: 'Energy Cell', kind: 'ammo', sprite: 'CELL', ammoType: 'cells', ammoAmount: 20 },
  { thingId: 17, id: 'cellPack', name: 'Energy Cell Pack', kind: 'ammo', sprite: 'CELP', ammoType: 'cells', ammoAmount: 100 },
];

/** Lookup by DoomEd thing id. */
export const ITEMS_BY_ID: ReadonlyMap<number, ItemDef> = new Map(ITEMS.map((it) => [it.thingId, it]));
