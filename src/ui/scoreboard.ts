// DEATHMATCH scoreboard overlay (multiplayer-plan §4) — the Tab-to-show frag table the
// player sees during a match, plus the shared frag-table renderer the post-match results
// screen reuses, plus a small kill-feed helper. Pure draw functions over a ScoreState
// (src/score): P5b populates the model and decides WHEN to show this; nothing here
// touches game state. Renders through the same TextureCache + STCFN bitmap font + integer
// scaling as every other UI screen, so it matches the DOOM look.
import type { ScoreState, PlayerScore } from '../score';
import { rankedPlayers, colorOf, clockString } from '../score';
import { TextureCache, drawText, FONT_LINE_HEIGHT, HUD_FONT } from './gfx';

/** Column positions as fractions of the table width (name is left-aligned from nameX;
 *  the rest are right-aligned at their fraction). */
const COL = { name: 0.06, frags: 0.6, deaths: 0.8, ping: 0.99 };

/** Draw the ranked frag table (header + one row per player) into the box at (x,y) of the
 *  given width. Shared by the in-match overlay and the post-match results screen so the
 *  two never drift. Returns the y just below the last row. */
export function drawFragTable(
  ctx: CanvasRenderingContext2D,
  cache: TextureCache,
  state: ScoreState,
  x: number,
  y: number,
  width: number,
  scale: number,
): number {
  const lineH = (FONT_LINE_HEIGHT + 5) * scale;
  const colX = (frac: number): number => x + width * frac;
  const swatchW = 5 * scale;
  const nameX = colX(COL.name) + swatchW + 4 * scale;

  ctx.globalAlpha = 0.7;
  drawText(ctx, cache, HUD_FONT, 'PLAYER', nameX, y, { scale });
  drawText(ctx, cache, HUD_FONT, 'FRAGS', colX(COL.frags), y, { scale, align: 'right' });
  drawText(ctx, cache, HUD_FONT, 'DEATHS', colX(COL.deaths), y, { scale, align: 'right' });
  drawText(ctx, cache, HUD_FONT, 'PING', colX(COL.ping), y, { scale, align: 'right' });
  ctx.globalAlpha = 1;
  y += lineH;

  for (const p of rankedPlayers(state)) {
    const isLocal = p.id === state.localPlayerId;
    if (isLocal) {
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      ctx.fillRect(x, y - 2 * scale, width, lineH);
    }
    // Color swatch keyed to the lobby marine color so frags stay legible per player.
    ctx.fillStyle = colorOf(p.color);
    ctx.fillRect(colX(COL.name), y + scale, swatchW, FONT_LINE_HEIGHT * scale - scale);

    ctx.globalAlpha = isLocal ? 1 : 0.78;
    if (isLocal) drawText(ctx, cache, HUD_FONT, '>', colX(COL.name) - 9 * scale, y, { scale });
    drawText(ctx, cache, HUD_FONT, p.name, nameX, y, { scale });
    // Co-op has no frags — the column reads N/A there (multiplayer-plan §4: scoreboard shown in
    // co-op too, frags hidden); deathmatch shows the live frag count.
    const fragText = state.mode === 'coop' ? '--' : String(p.frags);
    drawText(ctx, cache, HUD_FONT, fragText, colX(COL.frags), y, { scale, align: 'right' });
    drawText(ctx, cache, HUD_FONT, String(p.deaths), colX(COL.deaths), y, { scale, align: 'right' });
    drawText(ctx, cache, HUD_FONT, p.ping === undefined ? '--' : String(p.ping), colX(COL.ping), y, {
      scale,
      align: 'right',
    });
    ctx.globalAlpha = 1;
    y += lineH;
  }
  return y;
}

/** The match-limit / clock line: "FRAG LIMIT 20" + remaining time when a time limit is
 *  set. Empty string for the unlimited case is skipped by the caller's measure. */
function limitsLine(state: ScoreState): string {
  if (state.mode === 'coop') return ''; // co-op has no frag/time limit line
  const parts: string[] = [];
  if (state.fragLimit > 0) parts.push(`FRAG LIMIT ${state.fragLimit}`);
  if (state.timeLimit > 0) parts.push(clockString(state.timeRemaining));
  if (parts.length === 0) parts.push('NO LIMIT');
  return parts.join('     ');
}

/** The Tab-to-show in-match scoreboard: a centered DOOM-style panel with the frag limit /
 *  time remaining and the ranked frag table, the local player highlighted. */
export function drawScoreboard(
  ctx: CanvasRenderingContext2D,
  cache: TextureCache,
  state: ScoreState,
  w: number,
  h: number,
): void {
  ctx.imageSmoothingEnabled = false;
  const scale = Math.max(1, Math.round(w / 320));

  // Dimming backdrop + framed panel.
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(0, 0, w, h);
  const panelX = w * 0.08;
  const panelY = h * 0.12;
  const panelW = w * 0.84;
  const panelH = h * 0.76;
  ctx.fillStyle = 'rgba(8,10,14,0.92)';
  ctx.fillRect(panelX, panelY, panelW, panelH);
  ctx.strokeStyle = '#56c84c';
  ctx.lineWidth = scale;
  ctx.strokeRect(panelX + scale, panelY + scale, panelW - 2 * scale, panelH - 2 * scale);

  drawText(ctx, cache, HUD_FONT, state.mode === 'coop' ? 'CO-OP' : 'DEATHMATCH', w / 2, panelY + 8 * scale, {
    scale: scale * 2,
    align: 'center',
  });
  drawText(ctx, cache, HUD_FONT, limitsLine(state), w / 2, panelY + 28 * scale, { scale, align: 'center' });

  drawFragTable(ctx, cache, state, panelX + 12 * scale, panelY + 44 * scale, panelW - 24 * scale, scale);
}

/** One line of the kill feed (multiplayer-plan §4 optional helper). `t` is the remaining
 *  display time in seconds, set + decremented by the caller for fade-out. */
export interface KillFeedEntry {
  killer: string;
  victim: string;
  t: number;
}

/** Draw recent frags top-right ("KILLER > VICTIM"), newest first, fading as `t` → 0. */
export function drawKillFeed(
  ctx: CanvasRenderingContext2D,
  cache: TextureCache,
  entries: KillFeedEntry[],
  w: number,
  h: number,
): void {
  ctx.imageSmoothingEnabled = false;
  const scale = Math.max(1, Math.round(w / 320));
  const lineH = (FONT_LINE_HEIGHT + 3) * scale;
  let y = h * 0.06;
  for (const e of entries) {
    ctx.globalAlpha = Math.max(0, Math.min(1, e.t));
    drawText(ctx, cache, HUD_FONT, `${e.killer} > ${e.victim}`, w - 8 * scale, y, { scale, align: 'right' });
    ctx.globalAlpha = 1;
    y += lineH;
  }
}

export type { PlayerScore };
