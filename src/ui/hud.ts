// In-game HUD / status bar — STUB. Ammo, health%, arms panel, mugshot face states,
// armor%, keys, ammo-count table, plus screen-edge damage/pickup flashes
// (doom-design.md §6). Drawn over the world frame.
import type { IWorld, RenderConfig } from '../core';

/** Draw the status bar + overlays for the current player state. */
export function drawHud(
  _ctx: CanvasRenderingContext2D,
  _world: IWorld,
  _config: RenderConfig,
): void {
  throw new Error('NotImplemented: drawHud (doom-design §6)');
}
