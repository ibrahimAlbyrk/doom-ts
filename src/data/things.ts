// DoomEd thing-id reference — docs/research/doom-design.md §8. Freedoom reuses these
// exact editor numbers, so keying the spawner on the id guarantees interchangeability.
import type { ThingDef } from '../core';

export const THING_DEFS: ThingDef[] = [
  // Starts / engine
  { id: 1, name: 'Player 1 start', category: 'start' },
  { id: 14, name: 'Teleport destination', category: 'teleport' },

  // Monsters (§3)
  { id: 3004, name: 'Zombieman', category: 'monster' },
  { id: 9, name: 'Shotgun Guy', category: 'monster' },
  { id: 3001, name: 'Imp', category: 'monster' },
  { id: 3002, name: 'Demon', category: 'monster' },
  { id: 58, name: 'Spectre', category: 'monster' },
  { id: 3006, name: 'Lost Soul', category: 'monster' },
  { id: 3005, name: 'Cacodemon', category: 'monster' },
  { id: 3003, name: 'Baron of Hell', category: 'monster' },
  { id: 69, name: 'Hell Knight', category: 'monster' },
  { id: 16, name: 'Cyberdemon', category: 'monster' },
  { id: 7, name: 'Spider Mastermind', category: 'monster' },

  // Weapons (§2)
  { id: 2005, name: 'Chainsaw', category: 'weapon' },
  { id: 2001, name: 'Shotgun', category: 'weapon' },
  { id: 82, name: 'Super Shotgun', category: 'weapon' },
  { id: 2002, name: 'Chaingun', category: 'weapon' },
  { id: 2003, name: 'Rocket Launcher', category: 'weapon' },
  { id: 2004, name: 'Plasma Rifle', category: 'weapon' },
  { id: 2006, name: 'BFG9000', category: 'weapon' },

  // Ammo (§4)
  { id: 2007, name: 'Clip', category: 'ammo' },
  { id: 2048, name: 'Box of Bullets', category: 'ammo' },
  { id: 2008, name: '4 Shells', category: 'ammo' },
  { id: 2049, name: 'Box of Shells', category: 'ammo' },
  { id: 2010, name: 'Rocket', category: 'ammo' },
  { id: 2046, name: 'Box of Rockets', category: 'ammo' },
  { id: 2047, name: 'Energy Cell', category: 'ammo' },
  { id: 17, name: 'Energy Cell Pack', category: 'ammo' },
  { id: 8, name: 'Backpack', category: 'ammo' },

  // Health (§5)
  { id: 2014, name: 'Health Bonus', category: 'health' },
  { id: 2011, name: 'Stimpack', category: 'health' },
  { id: 2012, name: 'Medikit', category: 'health' },
  { id: 2013, name: 'Soulsphere', category: 'health' },
  { id: 83, name: 'Megasphere', category: 'health' },

  // Armor (§5)
  { id: 2015, name: 'Armor Bonus', category: 'armor' },
  { id: 2018, name: 'Green Armor', category: 'armor' },
  { id: 2019, name: 'Blue Armor', category: 'armor' },

  // Powerups (§5)
  { id: 2023, name: 'Berserk', category: 'powerup' },
  { id: 2022, name: 'Invulnerability', category: 'powerup' },
  { id: 2025, name: 'Radiation Suit', category: 'powerup' },
  { id: 2024, name: 'Partial Invisibility', category: 'powerup' },
  { id: 2026, name: 'Computer Area Map', category: 'powerup' },
  { id: 2045, name: 'Light Amp Visor', category: 'powerup' },

  // Keys (§5)
  { id: 5, name: 'Blue Keycard', category: 'key' },
  { id: 40, name: 'Blue Skull Key', category: 'key' },
  { id: 6, name: 'Yellow Keycard', category: 'key' },
  { id: 39, name: 'Yellow Skull Key', category: 'key' },
  { id: 13, name: 'Red Keycard', category: 'key' },
  { id: 38, name: 'Red Skull Key', category: 'key' },
];

/** Lookup by DoomEd id. */
export const THINGS_BY_ID: ReadonlyMap<number, ThingDef> = new Map(THING_DEFS.map((t) => [t.id, t]));
