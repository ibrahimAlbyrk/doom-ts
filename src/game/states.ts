// Game-state machine — implements the IGameState contract (web-arch.md §3).
// BOOT → LOADING → TITLE → MENU → PLAYING ⇄ PAUSED → INTERMISSION → … and CREDITS.
//
// SCAFFOLD NOTE: states render simple placeholders to the 2D context so the app boots
// to a real title/loading screen. The world simulation + raycaster render path is wired
// by their respective workers (PlayingState dispatches into world/render/ai/etc.). The
// CREDITS state is implemented (the required Freedoom About screen).
import type { GameStateId, IGameState, GameContext } from '../core';
import { drawCredits } from '../ui';

const LOAD_SECONDS = 1.2;

function fill(ctx: CanvasRenderingContext2D, w: number, h: number, color: string): void {
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, w, h);
}

function centerText(
  ctx: CanvasRenderingContext2D,
  text: string,
  cx: number,
  y: number,
  font: string,
  color: string,
): void {
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, cx, y);
}

abstract class BaseState implements IGameState {
  abstract readonly id: GameStateId;
  protected ctx!: GameContext;

  onEnter(ctx: GameContext): void {
    this.ctx = ctx;
  }
  onExit(_ctx: GameContext): void {}
  update(_dt: number): void {}
  abstract render(ctx2d: CanvasRenderingContext2D, alpha: number): void;

  protected get w(): number {
    return this.ctx.config.internalWidth;
  }
  protected get h(): number {
    return this.ctx.config.internalHeight;
  }
}

class BootState extends BaseState {
  readonly id = 'boot' as const;
  override update(): void {
    this.ctx.transition('loading');
  }
  render(ctx2d: CanvasRenderingContext2D): void {
    fill(ctx2d, this.w, this.h, '#000');
  }
}

class LoadingState extends BaseState {
  readonly id = 'loading' as const;
  private progress = 0;

  override onEnter(ctx: GameContext): void {
    super.onEnter(ctx);
    this.progress = 0;
  }

  override update(dt: number): void {
    // SCAFFOLD: simulate load progress (the real AssetLoader.loadAll drops in here).
    this.progress = Math.min(1, this.progress + dt / LOAD_SECONDS);
    if (this.progress >= 1) this.ctx.transition('title');
  }

  render(ctx2d: CanvasRenderingContext2D): void {
    fill(ctx2d, this.w, this.h, '#000');
    centerText(ctx2d, 'LOADING', this.w / 2, this.h / 2 - 14, '12px monospace', '#c9b070');
    const barW = Math.floor(this.w * 0.6);
    const barX = Math.floor((this.w - barW) / 2);
    const barY = Math.floor(this.h / 2);
    ctx2d.strokeStyle = '#555';
    ctx2d.strokeRect(barX + 0.5, barY + 0.5, barW, 6);
    ctx2d.fillStyle = '#a33';
    ctx2d.fillRect(barX + 1, barY + 1, Math.floor((barW - 1) * this.progress), 5);
  }
}

class TitleState extends BaseState {
  readonly id = 'title' as const;
  override update(): void {
    if (this.ctx.input.wasPressed('use')) this.ctx.transition('menu');
    else if (this.ctx.input.wasPressed('automap')) this.ctx.transition('credits');
  }
  render(ctx2d: CanvasRenderingContext2D): void {
    fill(ctx2d, this.w, this.h, '#100808');
    centerText(ctx2d, 'DOOM // TS', this.w / 2, this.h / 2 - 16, 'bold 20px monospace', '#c0392b');
    centerText(ctx2d, 'Canvas 2D Raycaster', this.w / 2, this.h / 2 + 4, '8px monospace', '#888');
    centerText(ctx2d, '[E] Start    [Tab] Credits', this.w / 2, this.h - 24, '7px monospace', '#c9b070');
  }
}

class MenuState extends BaseState {
  readonly id = 'menu' as const;
  override update(): void {
    if (this.ctx.input.wasPressed('use')) {
      void this.ctx.audio.resume(); // unlock audio on a user gesture
      this.ctx.transition('playing');
    } else if (this.ctx.input.wasPressed('automap')) {
      this.ctx.transition('credits');
    } else if (this.ctx.input.wasPressed('pause')) {
      this.ctx.transition('title');
    }
  }
  render(ctx2d: CanvasRenderingContext2D): void {
    fill(ctx2d, this.w, this.h, '#0c0c10');
    centerText(ctx2d, 'MAIN MENU', this.w / 2, 40, 'bold 14px monospace', '#c9b070');
    centerText(ctx2d, '[E] New Game', this.w / 2, this.h / 2 - 8, '9px monospace', '#ddd');
    centerText(ctx2d, '[Tab] Credits', this.w / 2, this.h / 2 + 8, '9px monospace', '#ddd');
    centerText(ctx2d, '[Esc] Back', this.w / 2, this.h / 2 + 24, '9px monospace', '#888');
  }
}

class PlayingState extends BaseState {
  readonly id = 'playing' as const;
  override update(): void {
    // SCAFFOLD: the fixed-step sim (player/monsters/projectiles/pickups, world doors)
    // is dispatched here once those systems land. Pause is wired now.
    if (this.ctx.input.wasPressed('pause')) this.ctx.transition('paused');
  }
  render(ctx2d: CanvasRenderingContext2D): void {
    fill(ctx2d, this.w, this.h, '#000');
    centerText(ctx2d, 'PLAYING (renderer stub)', this.w / 2, this.h / 2, '9px monospace', '#3a3');
    centerText(ctx2d, '[Esc] Pause', this.w / 2, this.h - 16, '7px monospace', '#666');
  }
}

class PausedState extends BaseState {
  readonly id = 'paused' as const;
  override update(): void {
    if (this.ctx.input.wasPressed('pause')) this.ctx.transition('playing');
  }
  render(ctx2d: CanvasRenderingContext2D): void {
    fill(ctx2d, this.w, this.h, '#000');
    centerText(ctx2d, 'PAUSED', this.w / 2, this.h / 2, 'bold 16px monospace', '#c9b070');
  }
}

class IntermissionState extends BaseState {
  readonly id = 'intermission' as const;
  override update(): void {
    if (this.ctx.input.wasPressed('use')) this.ctx.transition('playing');
  }
  render(ctx2d: CanvasRenderingContext2D): void {
    fill(ctx2d, this.w, this.h, '#06080c');
    centerText(ctx2d, 'INTERMISSION', this.w / 2, this.h / 2, '12px monospace', '#c9b070');
  }
}

class GameoverState extends BaseState {
  readonly id = 'gameover' as const;
  override update(): void {
    if (this.ctx.input.wasPressed('use')) this.ctx.transition('title');
  }
  render(ctx2d: CanvasRenderingContext2D): void {
    fill(ctx2d, this.w, this.h, '#000');
    centerText(ctx2d, 'GAME OVER', this.w / 2, this.h / 2, 'bold 18px monospace', '#c0392b');
  }
}

class CreditsState extends BaseState {
  readonly id = 'credits' as const;
  override update(): void {
    if (this.ctx.input.wasPressed('pause')) this.ctx.transition('title');
  }
  render(ctx2d: CanvasRenderingContext2D): void {
    drawCredits(ctx2d, this.w, this.h);
  }
}

export function createStates(): Record<GameStateId, IGameState> {
  return {
    boot: new BootState(),
    loading: new LoadingState(),
    title: new TitleState(),
    menu: new MenuState(),
    playing: new PlayingState(),
    paused: new PausedState(),
    intermission: new IntermissionState(),
    gameover: new GameoverState(),
    credits: new CreditsState(),
  };
}
