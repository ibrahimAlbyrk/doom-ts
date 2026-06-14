// Title screen. Drawn full-screen to the visible 2D context at internal resolution.
// The state machine (src/game) owns the TITLE state: it calls drawTitle each frame
// and transitions to MENU on 'use' / CREDITS on the secondary key.
import { TextureCache, drawText, HUD_FONT } from './gfx';

/** Render the title screen (logo + prompts) using the STCFN bitmap font. */
export function drawTitle(ctx: CanvasRenderingContext2D, cache: TextureCache, w: number, h: number): void {
  ctx.fillStyle = '#0b0606';
  ctx.fillRect(0, 0, w, h);
  ctx.imageSmoothingEnabled = false;

  const logoScale = Math.max(2, Math.round((w / 320) * 4));
  drawText(ctx, cache, HUD_FONT, 'DOOM // TS', w / 2, h * 0.26, { scale: logoScale, align: 'center' });
  drawText(ctx, cache, HUD_FONT, 'A CANVAS 2D RAYCASTER', w / 2, h * 0.46, {
    scale: Math.max(1, Math.round(w / 320)),
    align: 'center',
  });

  const promptScale = Math.max(1, Math.round((w / 320) * 1.5));
  drawText(ctx, cache, HUD_FONT, 'PRESS E TO START', w / 2, h * 0.66, { scale: promptScale, align: 'center' });
  drawText(ctx, cache, HUD_FONT, 'TAB - CREDITS', w / 2, h * 0.8, {
    scale: Math.max(1, Math.round(w / 320)),
    align: 'center',
  });
}
