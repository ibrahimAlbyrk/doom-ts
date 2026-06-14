// Game-over screen. Drawn full-screen to the visible context; the state machine
// (src/game) shows it on player death and transitions to TITLE on 'use'.
import { TextureCache, drawText, HUD_FONT } from './gfx';

/** Render the game-over screen (dead mugshot + GAME OVER + prompt). */
export function drawGameOver(ctx: CanvasRenderingContext2D, cache: TextureCache, w: number, h: number): void {
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, w, h);
  ctx.imageSmoothingEnabled = false;

  const face = cache.image('STFDEAD0');
  if (face) {
    const fs = Math.max(2, Math.round(w / 320) + 1);
    ctx.drawImage(face, Math.round(w / 2 - (face.width * fs) / 2), Math.round(h * 0.14), face.width * fs, face.height * fs);
  }

  const scale = Math.max(2, Math.round((w / 320) * 3));
  drawText(ctx, cache, HUD_FONT, 'GAME OVER', w / 2, h * 0.58, { scale, align: 'center' });
  drawText(ctx, cache, HUD_FONT, 'PRESS E TO CONTINUE', w / 2, h * 0.82, {
    scale: Math.max(1, Math.round(w / 320)),
    align: 'center',
  });
}
