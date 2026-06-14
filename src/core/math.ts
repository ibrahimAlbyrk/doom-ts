// FROZEN CONTRACT — scalar/angle math helpers shared everywhere.
import { Rng } from './rng';

export const TAU = Math.PI * 2;
export const DEG2RAD = Math.PI / 180;
export const RAD2DEG = 180 / Math.PI;

export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Inverse lerp — where `v` sits in [a,b], unclamped. */
export function invLerp(a: number, b: number, v: number): number {
  return b === a ? 0 : (v - a) / (b - a);
}

export function sign(v: number): number {
  return v > 0 ? 1 : v < 0 ? -1 : 0;
}

/** Wrap an angle (radians) into [-PI, PI). */
export function normalizeAngle(rad: number): number {
  let a = rad % TAU;
  if (a < -Math.PI) a += TAU;
  else if (a >= Math.PI) a -= TAU;
  return a;
}

/** Shortest signed angular difference `to - from`, in [-PI, PI). */
export function angleDiff(from: number, to: number): number {
  return normalizeAngle(to - from);
}

/** Interpolate angles the short way around the circle. */
export function lerpAngle(from: number, to: number, t: number): number {
  return normalizeAngle(from + angleDiff(from, to) * t);
}

export function degToRad(deg: number): number {
  return deg * DEG2RAD;
}

export function radToDeg(rad: number): number {
  return rad * RAD2DEG;
}

/**
 * The DOOM damage idiom `((P_Random() % n) + 1) * m` → 1..n then ×m
 * (doom-design.md §0). One helper covers ~90% of all DOOM combat rolls.
 */
export function rollDamage(rng: Rng, n: number, m: number): number {
  return ((rng.p() % n) + 1) * m;
}
