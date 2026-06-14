// Monster table — values from docs/research/doom-design.md §3 (DOOM canonical;
// Freedoom reuses identical stats + thing IDs). Sounds from §3 lump table.
// radiusMu is the canonical id `info.c` mobj radius (needed for collision/combat;
// not listed in the §3 stat table — flagged in ARCHITECTURE.md).
import type { EnemyDef, MonsterType } from '../core';

export const ENEMIES: Record<MonsterType, EnemyDef> = {
  zombieman: {
    type: 'zombieman',
    name: 'Zombieman',
    freedoomName: 'Zombie / Former Human',
    thingId: 3004,
    health: 20,
    speed: 8,
    chargeSpeed: 0,
    radiusMu: 20,
    attack: { kind: 'hitscan', hitscan: { roll: { n: 5, m: 3 }, pellets: 1 } }, // 3–15
    painChance: 200,
    mass: 100,
    floats: false,
    sprite: 'POSS',
    sounds: {
      sight: ['DSPOSIT1', 'DSPOSIT2', 'DSPOSIT3'],
      attack: 'DSPISTOL',
      pain: 'DSPOPAIN',
      death: ['DSPODTH1', 'DSPODTH2', 'DSPODTH3'],
      active: 'DSPOSACT',
    },
  },
  shotgunGuy: {
    type: 'shotgunGuy',
    name: 'Shotgun Guy',
    freedoomName: 'Shotgun Zombie',
    thingId: 9,
    health: 30,
    speed: 8,
    chargeSpeed: 0,
    radiusMu: 20,
    attack: { kind: 'hitscan', hitscan: { roll: { n: 5, m: 3 }, pellets: 3 } }, // 3–15 ×3
    painChance: 170,
    mass: 100,
    floats: false,
    sprite: 'SPOS',
    sounds: {
      sight: ['DSPOSIT1', 'DSPOSIT2', 'DSPOSIT3'],
      attack: 'DSSHOTGN',
      pain: 'DSPOPAIN',
      death: ['DSPODTH1', 'DSSGTDTH'],
      active: 'DSPOSACT',
    },
  },
  imp: {
    type: 'imp',
    name: 'Imp',
    freedoomName: 'Serpentipede',
    thingId: 3001,
    health: 60,
    speed: 8,
    chargeSpeed: 0,
    radiusMu: 20,
    attack: {
      kind: 'projectile',
      melee: { n: 8, m: 3 }, // 3–24
      projectile: { roll: { n: 8, m: 3 }, speed: 10, sprite: 'BAL1' }, // 3–24
    },
    painChance: 200,
    mass: 100,
    floats: false,
    sprite: 'TROO',
    sounds: {
      sight: ['DSBGSIT1', 'DSBGSIT2'],
      attack: 'DSFIRSHT',
      pain: 'DSPOPAIN',
      death: ['DSBGDTH1', 'DSBGDTH2'],
      active: 'DSBGACT',
    },
  },
  demon: {
    type: 'demon',
    name: 'Demon (Pinky)',
    freedoomName: 'Flesh Worm / Pinky',
    thingId: 3002,
    health: 150,
    speed: 10,
    chargeSpeed: 0,
    radiusMu: 30,
    attack: { kind: 'melee', melee: { n: 10, m: 4 } }, // 4–40 bite
    painChance: 180,
    mass: 400,
    floats: false,
    sprite: 'SARG',
    sounds: {
      sight: ['DSSGTSIT'],
      attack: 'DSSGTATK',
      pain: 'DSDMPAIN',
      death: ['DSSGTDTH'],
      active: 'DSDMACT',
    },
  },
  spectre: {
    type: 'spectre',
    name: 'Spectre',
    freedoomName: 'invisible Demon',
    thingId: 58,
    health: 150,
    speed: 10,
    chargeSpeed: 0,
    radiusMu: 30,
    attack: { kind: 'melee', melee: { n: 10, m: 4 } }, // 4–40 bite
    painChance: 180,
    mass: 400,
    floats: false,
    sprite: 'SARG', // drawn with fuzz (partial-invis style)
    sounds: {
      sight: ['DSSGTSIT'],
      attack: 'DSSGTATK',
      pain: 'DSDMPAIN',
      death: ['DSSGTDTH'],
      active: 'DSDMACT',
    },
  },
  lostSoul: {
    type: 'lostSoul',
    name: 'Lost Soul',
    freedoomName: 'Dark Soul / flying skull',
    thingId: 3006,
    health: 100,
    speed: 8,
    chargeSpeed: 20, // skullfly charge
    radiusMu: 16,
    attack: { kind: 'charge', melee: { n: 8, m: 3 } }, // 3–24 charge bite
    painChance: 256, // always flinches (except mid-charge — flinchImmune)
    mass: 56,
    floats: true,
    sprite: 'SKUL',
    sounds: {
      attack: 'DSSKLATK',
      pain: 'DSDMPAIN',
      death: ['DSFIRXPL'],
      active: 'DSDMACT',
    },
  },
  cacodemon: {
    type: 'cacodemon',
    name: 'Cacodemon',
    freedoomName: 'Trilobite',
    thingId: 3005,
    health: 400,
    speed: 8,
    chargeSpeed: 0,
    radiusMu: 31,
    attack: {
      kind: 'projectile',
      melee: { n: 6, m: 10 }, // 10–60
      projectile: { roll: { n: 8, m: 5 }, speed: 10, sprite: 'BAL2' }, // 5–40
    },
    painChance: 128,
    mass: 400,
    floats: true,
    sprite: 'HEAD',
    sounds: {
      sight: ['DSCACSIT'],
      attack: 'DSFIRSHT',
      pain: 'DSDMPAIN',
      death: ['DSCACDTH'],
      active: 'DSDMACT',
    },
  },
  baron: {
    type: 'baron',
    name: 'Baron of Hell',
    freedoomName: 'Bruiser Demon',
    thingId: 3003,
    health: 1000,
    speed: 8,
    chargeSpeed: 0,
    radiusMu: 24,
    attack: {
      kind: 'projectile',
      melee: { n: 8, m: 10 }, // 10–80
      projectile: { roll: { n: 8, m: 8 }, speed: 15, sprite: 'BAL7' }, // 8–64
    },
    painChance: 50,
    mass: 1000,
    floats: false,
    sprite: 'BOSS',
    sounds: {
      sight: ['DSBRSSIT'],
      pain: 'DSDMPAIN',
      death: ['DSBRSDTH'],
      active: 'DSDMACT',
    },
  },
  hellKnight: {
    type: 'hellKnight',
    name: 'Hell Knight',
    freedoomName: 'lesser Bruiser',
    thingId: 69,
    health: 500,
    speed: 8,
    chargeSpeed: 0,
    radiusMu: 24,
    attack: {
      kind: 'projectile',
      melee: { n: 8, m: 10 }, // 10–80
      projectile: { roll: { n: 8, m: 8 }, speed: 15, sprite: 'BAL7' }, // 8–64
    },
    painChance: 50,
    mass: 1000,
    floats: false,
    sprite: 'BOS2',
    sounds: {
      sight: ['DSKNTSIT'],
      pain: 'DSDMPAIN',
      death: ['DSKNTDTH'],
      active: 'DSDMACT',
    },
  },
  cyberdemon: {
    type: 'cyberdemon',
    name: 'Cyberdemon',
    freedoomName: 'Assault Tripod',
    thingId: 16,
    health: 4000,
    speed: 16,
    chargeSpeed: 0,
    radiusMu: 40,
    attack: {
      kind: 'projectile',
      projectile: { roll: { n: 8, m: 20 }, speed: 20, sprite: 'MISL', splashRadius: 128 }, // 3× rockets
    },
    painChance: 20, // near-immune to flinch
    mass: 1000,
    floats: false,
    sprite: 'CYBR',
    sounds: {
      sight: ['DSCYBSIT'],
      attack: 'DSRLAUNC',
      pain: 'DSDMPAIN',
      death: ['DSCYBDTH'],
      active: 'DSDMACT',
    },
  },
  spiderMastermind: {
    type: 'spiderMastermind',
    name: 'Spider Mastermind',
    freedoomName: 'Large Technospider',
    thingId: 7,
    health: 3000,
    speed: 12,
    chargeSpeed: 0,
    radiusMu: 128,
    attack: { kind: 'hitscan', hitscan: { roll: { n: 5, m: 3 }, pellets: 1 } }, // rapid chaingun
    painChance: 40,
    mass: 1000,
    floats: false,
    sprite: 'SPID',
    sounds: {
      sight: ['DSSPISIT'],
      attack: 'DSSHOTGN',
      pain: 'DSDMPAIN',
      death: ['DSSPIDTH'],
      active: 'DSDMACT',
    },
  },
};

/** Episode-1 (Knee-Deep in the Dead) core bestiary (doom-design §3). */
export const EPISODE1_MONSTERS: MonsterType[] = [
  'zombieman',
  'shotgunGuy',
  'imp',
  'demon',
  'spectre',
  'lostSoul',
  'cacodemon',
  'baron',
];
