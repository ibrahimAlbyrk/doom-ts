// First-person view-model state (engine.md §10). The weapon system produces a
// WeaponView each frame; the game state resolves the sprite ids through the asset
// store and copies bobX/bobY/extralight onto the frozen RenderScene fields.
import { TAU } from '../core';

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

// Walk-bob, 1:1 with DOOM (P_CalcHeight + A_WeaponReady). The bob amplitude is the
// player's momentum-derived `player->bob`, capped at MAXBOB; the phase is the level tic
// clock so the eye bob and weapon bob ride the SAME wave. Both settle to 0 at rest.
/** DOOM MAXBOB: bob amplitude caps at 16 mu (the eye/weapon never swing past this). */
export const MAXBOB = 16;
/** DOOM view-bob period: the eye completes one full sine cycle every 20 tics. */
export const BOB_PERIOD_TICS = 20;

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

/** DOOM `player->bob`: momentum bob amplitude (mu) = (momx²+momy²)/4, capped at MAXBOB. */
export function bobAmount(velX: number, velY: number): number {
  return Math.min(MAXBOB, (velX * velX + velY * velY) / 4);
}

/** Walk-bob phase (radians) from the level tic clock — one full cycle per BOB_PERIOD_TICS. */
export function bobPhase(timeTics: number): number {
  return (TAU / BOB_PERIOD_TICS) * timeTics;
}

/** DOOM A_WeaponReady weapon bob: x = amount·cos(phase), y = amount·|sin(phase)| (px; y down). */
export function weaponBob(phase: number, amount: number): { x: number; y: number } {
  return {
    x: Math.cos(phase) * amount,
    y: Math.abs(Math.sin(phase)) * amount,
  };
}

/** DOOM P_CalcHeight eye bob: viewz offset (mu, +up) = (amount/2)·sin(phase), same phase as the gun. */
export function viewBob(phase: number, amount: number): number {
  return (amount / 2) * Math.sin(phase);
}
