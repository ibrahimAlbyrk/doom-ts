// Post-match DEATHMATCH results screen (multiplayer-plan §3.3 screen 6 / §4): a winner
// banner, the full final frag table, and REMATCH / LEAVE actions navigable by keyboard in
// the existing menu style. Mirrors the Menus controller pattern — own a ScoreState via
// start(), advance with update(MenuInput), render with draw() — so the state machine
// (P5b) drives it exactly like it drives Menus/Intermission. No game state touched here.
import type { ScoreState } from '../score';
import { matchWinner } from '../score';
import { TextureCache, drawText, HUD_FONT } from './gfx';
import { drawFragTable } from './scoreboard';
import type { MenuInput } from './menus';

/** What the player chose on the results screen; the integration acts on it (REMATCH →
 *  back to the lobby, LEAVE → title), exactly like a MenuCommand. */
export type ResultsAction = 'rematch' | 'leave';

const ACTIONS: { label: string; action: ResultsAction }[] = [
  { label: 'REMATCH', action: 'rematch' },
  { label: 'LEAVE', action: 'leave' },
];

export class Results {
  private readonly cache: TextureCache;
  private state: ScoreState | null = null;
  private cursor = 0;

  constructor(cache: TextureCache) {
    this.cache = cache;
  }

  /** Show the final standings for `state`; resets the action cursor to REMATCH. */
  start(state: ScoreState): void {
    this.state = state;
    this.cursor = 0;
  }

  /** Advance the action cursor for one input frame; returns the chosen action or null. */
  update(input: MenuInput): ResultsAction | null {
    if (!this.state) return null;
    const n = ACTIONS.length;
    if (input.left || input.up) this.cursor = (this.cursor - 1 + n) % n;
    if (input.right || input.down) this.cursor = (this.cursor + 1) % n;
    if (input.select) return ACTIONS[this.cursor]!.action;
    return null;
  }

  draw(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    ctx.fillStyle = '#06080c';
    ctx.fillRect(0, 0, w, h);
    ctx.imageSmoothingEnabled = false;
    const state = this.state;
    if (!state) return;

    const scale = Math.max(1, Math.round(w / 320));
    const winner = matchWinner(state);
    const banner = winner ? `${winner.name} WINS` : 'DRAW';
    drawText(ctx, this.cache, HUD_FONT, banner, w / 2, h * 0.1, { scale: scale * 2, align: 'center' });

    drawFragTable(ctx, this.cache, state, w * 0.1, h * 0.3, w * 0.8, scale);

    // Actions row, centered side by side, selected one at full alpha (menu convention).
    const actionY = h * 0.82;
    const gap = w * 0.3;
    for (let i = 0; i < ACTIONS.length; i++) {
      const selected = i === this.cursor;
      ctx.globalAlpha = selected ? 1 : 0.55;
      const cx = w / 2 + (i - (ACTIONS.length - 1) / 2) * gap;
      const label = selected ? `> ${ACTIONS[i]!.label} <` : ACTIONS[i]!.label;
      drawText(ctx, this.cache, HUD_FONT, label, cx, actionY, { scale, align: 'center' });
      ctx.globalAlpha = 1;
    }

    drawText(ctx, this.cache, HUD_FONT, 'A/D MOVE   E SELECT', w / 2, h - 12 * scale, {
      scale,
      align: 'center',
    });
  }
}
