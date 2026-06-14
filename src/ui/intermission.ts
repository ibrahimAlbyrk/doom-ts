// Intermission / tally screen (doom-design.md §6/§7): Kills/Items/Secret %, level
// time vs par, the finished/entering level banner, with a count-up reveal. The state
// machine (src/game) starts it on level exit, ticks update(dt), and advances when the
// player presses use (skip() fast-forwards a still-animating tally first).
import { TextureCache, drawText, FONT_LINE_HEIGHT, HUD_FONT } from './gfx';

export interface LevelTally {
  kills: number;
  totalKills: number;
  items: number;
  totalItems: number;
  secrets: number;
  totalSecrets: number;
  timeSeconds: number;
  parSeconds: number;
}

export interface IntermissionInfo {
  finishedName: string;
  nextName?: string;
}

// Per-row reveal start + count-up duration (seconds).
const ROW_REVEAL = [0.4, 0.9, 1.4]; // kills, items, secrets
const TIME_REVEAL = 1.9;
const COUNT_DUR = 0.6;
const TOTAL_REVEAL = TIME_REVEAL + COUNT_DUR + 0.4;

function percent(count: number, total: number): number {
  return total > 0 ? Math.round((100 * count) / total) : 100;
}

function clockString(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

export class Intermission {
  private readonly cache: TextureCache;
  private tally: LevelTally | null = null;
  private info: IntermissionInfo | null = null;
  private t = 0;
  private done = false;

  constructor(cache: TextureCache) {
    this.cache = cache;
  }

  /** Begin a new tally reveal. */
  start(tally: LevelTally, info: IntermissionInfo): void {
    this.tally = tally;
    this.info = info;
    this.t = 0;
    this.done = false;
  }

  update(dt: number): void {
    if (this.done) return;
    this.t += dt;
    if (this.t >= TOTAL_REVEAL) this.done = true;
  }

  /** Fast-forward the count-up. Returns true if it was still animating. */
  skip(): boolean {
    if (this.done) return false;
    this.done = true;
    return true;
  }

  isComplete(): boolean {
    return this.done;
  }

  draw(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    ctx.fillStyle = '#06080c';
    ctx.fillRect(0, 0, w, h);
    ctx.imageSmoothingEnabled = false;
    const tally = this.tally;
    const info = this.info;
    if (!tally || !info) return;

    const scale = Math.max(1, Math.round(w / 320));
    drawText(ctx, this.cache, HUD_FONT, 'FINISHED', w / 2, h * 0.1, { scale: scale * 2, align: 'center' });
    drawText(ctx, this.cache, HUD_FONT, info.finishedName.toUpperCase(), w / 2, h * 0.22, { scale, align: 'center' });

    const labelX = w * 0.28;
    const valueX = w * 0.72;
    const lineH = (FONT_LINE_HEIGHT + 6) * scale;
    let y = h * 0.32;

    const rowFrac = (i: number): number => {
      if (this.done) return 1;
      const start = ROW_REVEAL[i] ?? 0;
      return Math.max(0, Math.min(1, (this.t - start) / COUNT_DUR));
    };

    const drawRow = (label: string, target: number, frac: number, suffix: string): void => {
      drawText(ctx, this.cache, HUD_FONT, label, labelX, y, { scale });
      const shown = Math.round(target * frac);
      drawText(ctx, this.cache, HUD_FONT, `${shown}${suffix}`, valueX, y, { scale, align: 'right' });
      y += lineH;
    };

    drawRow('KILLS', percent(tally.kills, tally.totalKills), rowFrac(0), '%');
    drawRow('ITEMS', percent(tally.items, tally.totalItems), rowFrac(1), '%');
    drawRow('SECRET', percent(tally.secrets, tally.totalSecrets), rowFrac(2), '%');

    const timeRevealed = this.done || this.t >= TIME_REVEAL;
    drawText(ctx, this.cache, HUD_FONT, 'TIME', labelX, y, { scale });
    drawText(ctx, this.cache, HUD_FONT, timeRevealed ? clockString(tally.timeSeconds) : '', valueX, y, {
      scale,
      align: 'right',
    });
    y += lineH;
    drawText(ctx, this.cache, HUD_FONT, 'PAR', labelX, y, { scale });
    drawText(ctx, this.cache, HUD_FONT, timeRevealed ? clockString(tally.parSeconds) : '', valueX, y, {
      scale,
      align: 'right',
    });

    if (this.done) {
      if (info.nextName) {
        drawText(ctx, this.cache, HUD_FONT, `ENTERING ${info.nextName.toUpperCase()}`, w / 2, h * 0.87, {
          scale,
          align: 'center',
        });
      }
      drawText(ctx, this.cache, HUD_FONT, 'PRESS E', w / 2, h - 11 * scale, { scale, align: 'center' });
    }
  }
}
