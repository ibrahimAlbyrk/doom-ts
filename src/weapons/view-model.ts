// First-person view-model state (engine.md §10). The weapon system produces a
// WeaponView each frame; the game state resolves the sprite ids through the asset
// store and copies bobX/bobY/extralight onto the frozen RenderScene fields.

/** Screen-space weapon view-model for one frame (sprite ids, not resolved frames). */
export interface WeaponView {
  /** Gun lump prefix from the weapon manifest (PISG/SHTG/SHT2/CHGG/MISG/PLSG/BFGG/PUNG/SAWG). */
  sprite: string;
  /** Gun animation frame letter ('A' ready; 'B'+ while firing). */
  frame: string;
  /** Muzzle-flash lump prefix ('' when not flashing). */
  flashSprite: string;
  /** Muzzle-flash frame letter ('' when not flashing). */
  flashFrame: string;
  /** Horizontal walk-bob offset (px at internal resolution). */
  bobX: number;
  /** Vertical offset: raise/lower travel plus walk-bob (px; down = positive). */
  bobY: number;
  /** Whole-scene brightness bump on the frames the muzzle flashes. */
  extralight: number;
}

// Raise/lower timing — DOOM lowers/raises the psprite over ~16 tics.
export const RAISE_TICS = 16;
export const LOWER_TICS = 16;
/** Screen travel between the ready (top) and stowed (bottom) view-model positions. */
export const LOWER_TRAVEL = 96;

// Walk-bob amplitude (px). DOOM bobs the gun on the player's momentum phase.
export const WALK_BOB_X = 8;
export const WALK_BOB_Y = 6;
/** Speed (mu/tic) at which the bob reaches full amplitude; it scales to 0 at rest. */
export const BOB_SPEED_REF = 16;

// Muzzle flash duration + the brightness bump it adds (engine.md §5 extralight).
export const FLASH_TICS = 5;
export const FIRE_EXTRALIGHT = 2;

const FIRE_FRAMES = ['B', 'C', 'D'] as const;

/** Gun frame while firing: walk through the fire frames over the shot's tic span. */
export function fireFrame(fireTics: number, fireAnimTics: number): string {
  const total = Math.max(1, fireTics);
  const elapsed = total - fireAnimTics;
  const idx = Math.min(FIRE_FRAMES.length - 1, Math.floor((elapsed / total) * FIRE_FRAMES.length));
  return FIRE_FRAMES[Math.max(0, idx)]!;
}

/** Bob amplitude scale [0,1] from the player's speed — 0 at rest, full when running. */
export function bobMagnitude(velX: number, velY: number): number {
  return Math.min(1, Math.hypot(velX, velY) / BOB_SPEED_REF);
}

/** Map the bob phase + magnitude to a screen offset. y uses |sin| so the gun dips, never rises. */
export function weaponBob(phase: number, magnitude: number): { x: number; y: number } {
  return {
    x: Math.cos(phase) * WALK_BOB_X * magnitude,
    y: Math.abs(Math.sin(phase)) * WALK_BOB_Y * magnitude,
  };
}
