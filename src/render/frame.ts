// Internal per-frame render context (src/render-private). Built once per render() and
// threaded into the wall/flat/sprite passes so they share hoisted constants instead of
// recomputing them (engine.md §6.3). Not part of the frozen Renderer contract.
import type { Camera, ILevelRuntime, Texture } from '../core';

export interface Frame {
  back: Uint32Array;
  zBuffer: Float64Array;
  W: number;
  H: number;
  cam: Camera;
  level: ILevelRuntime;
  /** key → decoded Texture, cached, with procedural fallback for missing assets. */
  resolve: (key: string) => Texture;

  // Lighting.
  brightness: Float64Array; // [levels]
  levels: number;
  extralight: number;

  // Height model (cell units). screenY(z) = H/2 + (eyeZ - z) * H / perpDist.
  eyeZ: number; // world height of the eye
  eyeAboveFloor: number; // eye height above the player's floor tier (bobbed) — sprite floor line
  posZFloor: number; // H * (eye height above player floor) — floor row-distance scale
  posZCeil: number; // H * (player ceiling above eye) — ceiling row-distance scale

  // Sky (engine.md §6.5).
  skyTex: Texture;
  skyColumn: Int32Array; // per screen-x sky texel column (angle-indexed)
}
