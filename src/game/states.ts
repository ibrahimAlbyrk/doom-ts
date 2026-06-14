// Game-state machine — implements the IGameState contract (web-arch.md §3).
// BOOT → LOADING → TITLE → MENU → PLAYING ⇄ PAUSED → INTERMISSION → (next | VICTORY),
// PLAYING → GAMEOVER, and the Freedoom CREDITS screen. Each state delegates the real
// work to the shared GameSession; the states own only screen flow + per-screen draw.
import type { GameStateId } from '../core';
import { FIXED_STEP } from '../core';
import type { IGameState, GameContext } from './types';
import { AssetStore, AssetLoader } from '../assets';
import { drawTitle, drawGameOver, drawCredits, readMenuInput } from '../ui';
import type { GameClient } from './client';

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

  constructor(protected readonly session: GameClient) {}

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
  private done = false;
  private started = false;
  private error: string | null = null;

  override onEnter(ctx: GameContext): void {
    super.onEnter(ctx);
    if (this.started) return;
    this.started = true;
    void this.load();
  }

  private async load(): Promise<void> {
    try {
      const loader = new AssetLoader(this.ctx.assets as AssetStore, this.ctx.audio);
      await loader.loadAll((p) => {
        this.progress = p.total ? p.loaded / p.total : 0;
      });
      const palette = this.ctx.assets.getPalette();
      if (palette) this.ctx.renderer.setPalette(palette);
      this.ctx.renderer.setAssets(this.ctx.assets);
      this.done = true;
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err);
    }
  }

  override update(): void {
    if (this.done) this.ctx.transition('title');
  }

  render(ctx2d: CanvasRenderingContext2D): void {
    fill(ctx2d, this.w, this.h, '#000');
    if (this.error) {
      centerText(ctx2d, 'LOAD ERROR', this.w / 2, this.h / 2 - 10, '10px monospace', '#c0392b');
      centerText(ctx2d, this.error, this.w / 2, this.h / 2 + 6, '6px monospace', '#888');
      return;
    }
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
    if (this.ctx.input.wasPressed('use')) {
      void this.ctx.audio.resume();
      this.ctx.transition('menu');
    } else if (this.ctx.input.wasPressed('automap')) {
      this.ctx.transition('credits');
    }
  }
  render(ctx2d: CanvasRenderingContext2D): void {
    drawTitle(ctx2d, this.session.cache, this.w, this.h);
  }
}

class MenuState extends BaseState {
  readonly id = 'menu' as const;
  override onEnter(ctx: GameContext): void {
    super.onEnter(ctx);
    this.session.menus.open('main');
  }
  override update(): void {
    const cmd = this.session.menus.update(readMenuInput(this.ctx.input));
    if (!cmd) return;
    switch (cmd.type) {
      case 'startGame':
        void this.ctx.audio.resume();
        this.session.startNewGame(cmd.skill);
        this.ctx.transition('playing');
        break;
      case 'showCredits':
        this.ctx.transition('credits');
        break;
      case 'quit':
      case 'exitMenu':
        this.ctx.transition('title');
        break;
      default:
        break;
    }
  }
  render(ctx2d: CanvasRenderingContext2D): void {
    fill(ctx2d, this.w, this.h, '#0c0c10');
    this.session.menus.draw(ctx2d, this.w, this.h);
  }
}

class PlayingState extends BaseState {
  readonly id = 'playing' as const;

  override update(): void {
    // Read input per tick: continuous actions (movement/fire-hold) sample live held
    // state, discrete edges (use/weapon/automap) are consumed by exactly this tick.
    const cmd = this.session.readCommand();
    if (cmd.pause) {
      this.ctx.transition('paused');
      return;
    }
    const result = this.session.tic(cmd);
    if (result === 'dead') {
      this.ctx.transition('gameover');
    } else if (result === 'exit') {
      this.ctx.transition('intermission');
    }
  }

  render(ctx2d: CanvasRenderingContext2D, alpha: number): void {
    this.session.renderWorld(ctx2d, alpha);
  }
}

class PausedState extends BaseState {
  readonly id = 'paused' as const;
  override onEnter(ctx: GameContext): void {
    super.onEnter(ctx);
    this.session.menus.open('pause');
  }
  override update(): void {
    const cmd = this.session.menus.update(readMenuInput(this.ctx.input));
    if (!cmd) return;
    if (cmd.type === 'resume') {
      this.ctx.transition('playing');
    } else if (cmd.type === 'endGame' || cmd.type === 'quit' || cmd.type === 'exitMenu') {
      this.session.teardownLevel();
      this.ctx.transition('title');
    }
  }
  render(ctx2d: CanvasRenderingContext2D, alpha: number): void {
    this.session.renderWorld(ctx2d, alpha); // frozen world behind the menu
    this.session.menus.draw(ctx2d, this.w, this.h);
  }
}

class IntermissionState extends BaseState {
  readonly id = 'intermission' as const;
  override onEnter(ctx: GameContext): void {
    super.onEnter(ctx);
    this.session.beginIntermission();
  }
  override update(): void {
    this.session.intermission.update(FIXED_STEP);
    if (readMenuInput(this.ctx.input).select) {
      if (!this.session.intermission.skip()) {
        const next = this.session.advanceAfterIntermission();
        this.ctx.transition(next === 'victory' ? 'victory' : 'playing');
      }
    }
  }
  render(ctx2d: CanvasRenderingContext2D): void {
    this.session.intermission.draw(ctx2d, this.w, this.h);
  }
}

class GameoverState extends BaseState {
  readonly id = 'gameover' as const;
  override update(): void {
    if (this.ctx.input.wasPressed('use')) {
      this.session.teardownLevel();
      this.ctx.transition('title');
    }
  }
  render(ctx2d: CanvasRenderingContext2D, alpha: number): void {
    this.session.renderWorld(ctx2d, alpha); // the death scene, frozen
    drawGameOver(ctx2d, this.session.cache, this.w, this.h);
  }
}

class VictoryState extends BaseState {
  readonly id = 'victory' as const;
  override update(): void {
    if (this.ctx.input.wasPressed('use')) {
      this.session.teardownLevel();
      this.ctx.transition('title');
    }
  }
  render(ctx2d: CanvasRenderingContext2D): void {
    fill(ctx2d, this.w, this.h, '#08100a');
    centerText(ctx2d, 'VICTORY', this.w / 2, this.h / 2 - 18, 'bold 22px monospace', '#c9b070');
    centerText(ctx2d, 'Knee-Deep in the Dead — complete', this.w / 2, this.h / 2 + 6, '8px monospace', '#9c9');
    centerText(ctx2d, '[E] Return to title', this.w / 2, this.h - 22, '7px monospace', '#888');
  }
}

class CreditsState extends BaseState {
  readonly id = 'credits' as const;
  override update(): void {
    if (this.ctx.input.wasPressed('pause') || this.ctx.input.wasPressed('use')) {
      this.ctx.transition('title');
    }
  }
  render(ctx2d: CanvasRenderingContext2D): void {
    drawCredits(ctx2d, this.w, this.h);
  }
}

export function createStates(session: GameClient): Record<GameStateId, IGameState> {
  return {
    boot: new BootState(session),
    loading: new LoadingState(session),
    title: new TitleState(session),
    menu: new MenuState(session),
    playing: new PlayingState(session),
    paused: new PausedState(session),
    intermission: new IntermissionState(session),
    gameover: new GameoverState(session),
    victory: new VictoryState(session),
    credits: new CreditsState(session),
  };
}
