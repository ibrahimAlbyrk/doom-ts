// Weapon table — values from docs/research/doom-design.md §2 (DOOM canonical).
// Damage is the `d N × M` idiom: ((P_Random()%n)+1)*m per pellet.
// fireTics ≈ 35 / shots-per-sec. rangeMu: 64 melee, 2048 (MISSILERANGE) hitscan.
// Sprite prefixes from assets.md §6.
import type { WeaponDef, WeaponId } from '../core';

export const WEAPONS: Record<WeaponId, WeaponDef> = {
  fist: {
    id: 'fist',
    name: 'Fist',
    slot: 1,
    attack: 'hitscanMelee',
    ammo: null,
    ammoPerShot: 0,
    pellets: 1,
    damage: { n: 10, m: 2 }, // 2–20, ×10 under Berserk → 20–200
    fireTics: 18, // ~2/s (animation-bound)
    rangeMu: 64,
    projectileSpeed: 0,
    spreadShift: 0,
    firstShotAccurate: true,
    splashRadius: 0,
    viewSprite: 'PUNG',
    flashSprite: '',
    pickupSprite: '',
    projectileSprite: '',
    fireSound: 'DSPUNCH',
    berserkMultiplier: 10,
  },
  chainsaw: {
    id: 'chainsaw',
    name: 'Chainsaw',
    slot: 1,
    attack: 'hitscanMelee',
    ammo: null,
    ammoPerShot: 0,
    pellets: 1,
    damage: { n: 10, m: 2 }, // 2–20, continuous
    fireTics: 4, // ~8.7/s
    rangeMu: 65,
    projectileSpeed: 0,
    spreadShift: 0,
    firstShotAccurate: true,
    splashRadius: 0,
    viewSprite: 'SAWG',
    flashSprite: '',
    pickupSprite: 'CSAW',
    projectileSprite: '',
    fireSound: 'DSSAWHIT',
  },
  pistol: {
    id: 'pistol',
    name: 'Pistol',
    slot: 2,
    attack: 'hitscan',
    ammo: 'bullets',
    ammoPerShot: 1,
    pellets: 1,
    damage: { n: 3, m: 5 }, // 5/10/15
    fireTics: 14, // ~2.5/s
    rangeMu: 2048,
    projectileSpeed: 0,
    spreadShift: 18, // ±~5.6° on held shots
    firstShotAccurate: true,
    splashRadius: 0,
    viewSprite: 'PISG',
    flashSprite: 'PISF',
    pickupSprite: '',
    projectileSprite: '',
    fireSound: 'DSPISTOL',
  },
  shotgun: {
    id: 'shotgun',
    name: 'Shotgun',
    slot: 3,
    attack: 'hitscan',
    ammo: 'shells',
    ammoPerShot: 1,
    pellets: 7,
    damage: { n: 3, m: 5 },
    fireTics: 36, // ~0.97/s
    rangeMu: 2048,
    projectileSpeed: 0,
    spreadShift: 18, // every pellet spreads horizontally
    firstShotAccurate: false,
    splashRadius: 0,
    viewSprite: 'SHTG',
    flashSprite: '',
    pickupSprite: 'SHOT',
    projectileSprite: '',
    fireSound: 'DSSHOTGN',
  },
  superShotgun: {
    id: 'superShotgun',
    name: 'Super Shotgun',
    slot: 3,
    attack: 'hitscan',
    ammo: 'shells',
    ammoPerShot: 2,
    pellets: 20,
    damage: { n: 3, m: 5 },
    fireTics: 50, // ~0.7/s
    rangeMu: 2048,
    projectileSpeed: 0,
    spreadShift: 19, // wider ±~11.2° H spread (+ V scatter, doom-design §2)
    firstShotAccurate: false,
    splashRadius: 0,
    viewSprite: 'SHT2',
    flashSprite: '',
    pickupSprite: 'SGN2',
    projectileSprite: '',
    fireSound: 'DSDSHTGN',
  },
  chaingun: {
    id: 'chaingun',
    name: 'Chaingun',
    slot: 4,
    attack: 'hitscan',
    ammo: 'bullets',
    ammoPerShot: 1,
    pellets: 1,
    damage: { n: 3, m: 5 },
    fireTics: 4, // ~8.8/s (~530/min)
    rangeMu: 2048,
    projectileSpeed: 0,
    spreadShift: 18,
    firstShotAccurate: true,
    splashRadius: 0,
    viewSprite: 'CHGG',
    flashSprite: 'CHGF',
    pickupSprite: 'MGUN',
    projectileSprite: '',
    fireSound: 'DSPISTOL',
  },
  rocketLauncher: {
    id: 'rocketLauncher',
    name: 'Rocket Launcher',
    slot: 5,
    attack: 'projectile',
    ammo: 'rockets',
    ammoPerShot: 1,
    pellets: 1,
    damage: { n: 8, m: 20 }, // 20–160 direct + splash
    fireTics: 20, // ~1.7/s
    rangeMu: 0,
    projectileSpeed: 20,
    spreadShift: 0,
    firstShotAccurate: true,
    splashRadius: 128, // P_RadiusAttack: damage = 128 − dist
    viewSprite: 'MISG',
    flashSprite: 'MISF',
    pickupSprite: 'LAUN',
    projectileSprite: 'MISL',
    fireSound: 'DSRLAUNC',
  },
  plasmaRifle: {
    id: 'plasmaRifle',
    name: 'Plasma Rifle',
    slot: 6,
    attack: 'projectile',
    ammo: 'cells',
    ammoPerShot: 1,
    pellets: 1,
    damage: { n: 8, m: 5 }, // 5–40, no splash
    fireTics: 3, // ~11.7/s (+21-tic cool-down on release)
    rangeMu: 0,
    projectileSpeed: 25,
    spreadShift: 0,
    firstShotAccurate: true,
    splashRadius: 0,
    viewSprite: 'PLSG',
    flashSprite: 'PLSF',
    pickupSprite: 'PLAS',
    projectileSprite: 'PLSS',
    fireSound: 'DSPLASMA',
  },
  bfg9000: {
    id: 'bfg9000',
    name: 'BFG9000',
    slot: 7,
    attack: 'projectileSpray',
    ammo: 'cells',
    ammoPerShot: 40, // consumed up front
    pellets: 1,
    damage: { n: 8, m: 100 }, // ball 100–800 direct
    fireTics: 30, // 30-tic charge before the ball spawns
    rangeMu: 0,
    projectileSpeed: 25,
    spreadShift: 0,
    firstShotAccurate: true,
    splashRadius: 0,
    viewSprite: 'BFGG',
    flashSprite: 'BFGF',
    pickupSprite: 'BFUG',
    projectileSprite: 'BFS1',
    fireSound: 'DSBFG',
    // Tracer mechanic (doom-design §2): on ball impact, fire 40 tracer rays from
    // the PLAYER toward facing; each hit deals sum of 15×d8 (15–120). Implement in
    // src/weapons / src/combat — not expressible as a single uniform field.
  },
};

/** Ammo granted when picking up a weapon for the first time (doom-design §4). */
export const WEAPON_PICKUP_AMMO: Partial<Record<WeaponId, number>> = {
  shotgun: 8,
  superShotgun: 8,
  chaingun: 20,
  rocketLauncher: 2,
  plasmaRifle: 40,
  bfg9000: 40,
};
