// Sprite-prefix → entity roster (assets.md §6), derived from the sprite ids
// referenced in src/data/{enemies,weapons,items}.ts. The extractor emits every
// sprite frame for each prefix listed here and labels its set with `entity`.
// Keep in sync with src/data if a new entity/weapon/item sprite is referenced.

export interface RosterEntry {
  prefix: string;
  entity: string;
}

export const SPRITE_ROSTER: RosterEntry[] = [
  // ── Monsters (enemies.ts `sprite`) ──────────────────────────────────────
  { prefix: 'POSS', entity: 'zombieman' },
  { prefix: 'SPOS', entity: 'shotgunGuy' },
  { prefix: 'TROO', entity: 'imp' },
  { prefix: 'SARG', entity: 'demon/spectre' }, // spectre reuses SARG (drawn fuzzy)
  { prefix: 'SKUL', entity: 'lostSoul' },
  { prefix: 'HEAD', entity: 'cacodemon' },
  { prefix: 'BOSS', entity: 'baron' },
  { prefix: 'BOS2', entity: 'hellKnight' },
  { prefix: 'CYBR', entity: 'cyberdemon' },
  { prefix: 'SPID', entity: 'spiderMastermind' },
  { prefix: 'PLAY', entity: 'player' },

  // ── Weapon view models + muzzle flashes (weapons.ts view/flash) ─────────
  { prefix: 'PUNG', entity: 'fist/view' },
  { prefix: 'SAWG', entity: 'chainsaw/view' },
  { prefix: 'PISG', entity: 'pistol/view' },
  { prefix: 'PISF', entity: 'pistol/flash' },
  { prefix: 'SHTG', entity: 'shotgun/view' },
  { prefix: 'SHT2', entity: 'superShotgun/view' },
  { prefix: 'CHGG', entity: 'chaingun/view' },
  { prefix: 'CHGF', entity: 'chaingun/flash' },
  { prefix: 'MISG', entity: 'rocketLauncher/view' },
  { prefix: 'MISF', entity: 'rocketLauncher/flash' },
  { prefix: 'PLSG', entity: 'plasmaRifle/view' },
  { prefix: 'PLSF', entity: 'plasmaRifle/flash' },
  { prefix: 'BFGG', entity: 'bfg9000/view' },
  { prefix: 'BFGF', entity: 'bfg9000/flash' },

  // ── Weapon world pickups (items.ts `sprite`) ────────────────────────────
  { prefix: 'CSAW', entity: 'pickup:chainsaw' },
  { prefix: 'SHOT', entity: 'pickup:shotgun' },
  { prefix: 'SGN2', entity: 'pickup:superShotgun' },
  { prefix: 'MGUN', entity: 'pickup:chaingun' },
  { prefix: 'LAUN', entity: 'pickup:rocketLauncher' },
  { prefix: 'PLAS', entity: 'pickup:plasmaRifle' },
  { prefix: 'BFUG', entity: 'pickup:bfg9000' },

  // ── Projectiles + impacts (weapons.ts/enemies.ts projectile sprites) ────
  { prefix: 'BAL1', entity: 'projectile:impFireball' },
  { prefix: 'BAL2', entity: 'projectile:cacoFireball' },
  { prefix: 'BAL7', entity: 'projectile:baronFireball' },
  { prefix: 'MISL', entity: 'projectile:rocket' },
  { prefix: 'PLSS', entity: 'projectile:plasmaBolt' },
  { prefix: 'PLSE', entity: 'projectile:plasmaImpact' },
  { prefix: 'BFS1', entity: 'projectile:bfgBall' },
  { prefix: 'BFE1', entity: 'projectile:bfgImpact' },
  { prefix: 'BFE2', entity: 'projectile:bfgImpact2' },

  // ── Health / armor / powerups (items.ts `sprite`) ───────────────────────
  { prefix: 'BON1', entity: 'healthBonus' },
  { prefix: 'BON2', entity: 'armorBonus' },
  { prefix: 'STIM', entity: 'stimpack' },
  { prefix: 'MEDI', entity: 'medikit' },
  { prefix: 'SOUL', entity: 'soulsphere' },
  { prefix: 'MEGA', entity: 'megasphere' },
  { prefix: 'ARM1', entity: 'greenArmor' },
  { prefix: 'ARM2', entity: 'blueArmor' },
  { prefix: 'PSTR', entity: 'berserk' },
  { prefix: 'PINV', entity: 'invulnerability' },
  { prefix: 'PINS', entity: 'invisibility' },
  { prefix: 'PVIS', entity: 'lightVisor' },
  { prefix: 'PMAP', entity: 'computerMap' },
  { prefix: 'SUIT', entity: 'radSuit' },

  // ── Ammo (items.ts `sprite`) ────────────────────────────────────────────
  { prefix: 'CLIP', entity: 'clip' },
  { prefix: 'AMMO', entity: 'boxBullets' },
  { prefix: 'SHEL', entity: 'shells' },
  { prefix: 'SBOX', entity: 'boxShells' },
  { prefix: 'ROCK', entity: 'rocket' },
  { prefix: 'BROK', entity: 'boxRockets' },
  { prefix: 'CELL', entity: 'cell' },
  { prefix: 'CELP', entity: 'cellPack' },
  { prefix: 'BPAK', entity: 'backpack' },

  // ── Keys (items.ts `sprite`) ────────────────────────────────────────────
  { prefix: 'BKEY', entity: 'blueCard' },
  { prefix: 'BSKU', entity: 'blueSkull' },
  { prefix: 'YKEY', entity: 'yellowCard' },
  { prefix: 'YSKU', entity: 'yellowSkull' },
  { prefix: 'RKEY', entity: 'redCard' },
  { prefix: 'RSKU', entity: 'redSkull' },
];

/** SFX lump names referenced by src/data/{enemies,weapons}.ts — used only to
 *  report coverage. The extractor emits every digital DS* lump regardless. */
export const REQUIRED_SOUNDS: string[] = [
  // enemies.ts
  'DSPOSIT1', 'DSPOSIT2', 'DSPOSIT3', 'DSPISTOL', 'DSPOPAIN',
  'DSPODTH1', 'DSPODTH2', 'DSPODTH3', 'DSPOSACT', 'DSSHOTGN', 'DSSGTDTH',
  'DSBGSIT1', 'DSBGSIT2', 'DSFIRSHT', 'DSBGDTH1', 'DSBGDTH2', 'DSBGACT',
  'DSSGTSIT', 'DSSGTATK', 'DSDMPAIN', 'DSDMACT', 'DSSKLATK', 'DSFIRXPL',
  'DSCACSIT', 'DSCACDTH', 'DSBRSSIT', 'DSBRSDTH', 'DSKNTSIT', 'DSKNTDTH',
  'DSCYBSIT', 'DSRLAUNC', 'DSCYBDTH', 'DSSPISIT', 'DSSPIDTH',
  // weapons.ts
  'DSPUNCH', 'DSSAWHIT', 'DSDSHTGN', 'DSPLASMA', 'DSBFG',
];

/** Per-level music lumps the levels reference (src/levels/maps/*.ts `music`). These are
 *  Doom-1 episode tracks (ExMy names) and live in freedoom1.wad, not freedoom2.wad. */
export const MUSIC_TRACKS: string[] = ['D_E1M1', 'D_E1M2', 'D_E1M3', 'D_E1M4'];

/** UI / status-bar / HUD graphics (assets.md §3.11) — global-namespace lumps.
 *  STCFN* (font) is handled separately. */
export function isUiLump(name: string): boolean {
  if (name.startsWith('STCFN')) return false;
  return (
    name === 'STBAR' ||
    name === 'STARMS' ||
    name === 'STDISK' ||
    name === 'STCDROM' ||
    name.startsWith('STF') || // player face (STFST*, STFGOD0, STFDEAD0, STFEVL0, ...)
    name.startsWith('STT') || // big red digits STTNUM0-9 / STTMINUS / STTPRCNT
    name.startsWith('STYSNUM') || // small yellow digits
    name.startsWith('STGNUM') || // gray digits
    name.startsWith('STKEYS') || // key indicator icons
    name.startsWith('STPB') // multiplayer player-colour blocks (harmless extras)
  );
}

/** STCFN HUD font lump range (assets.md §3.12): ASCII 33 ('!') .. 95 ('_'). */
export const FONT_FIRST_CODE = 33;
export const FONT_LAST_CODE = 95;

export function fontLumpName(code: number): string {
  return `STCFN${String(code).padStart(3, '0')}`;
}
