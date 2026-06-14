// CLIENT-only game contracts (moved out of src/core in the multiplayer DOM-split,
// docs/multiplayer-plan.md §0.1). These carry DOM types (HTMLCanvasElement,
// CanvasRenderingContext2D) and the browser Renderer, so they cannot live in the
// shared sim. `GameContext` is the full browser services bag; the headless sim runs
// against the DOM-free `SimContext` (src/core) that this extends.
import type { SimContext, IAssetStore, RenderConfig, GameStateId, Audio, Input } from '../core';
import type { Renderer } from '../render';

/** Full CLIENT services bag threaded into every game state: the headless SimContext
 *  plus the browser-only services (canvas/renderer/audio/input/assets) and live config. */
export interface GameContext extends SimContext {
  readonly canvas: HTMLCanvasElement;
  readonly renderer: Renderer;
  readonly audio: Audio;
  readonly input: Input;
  readonly assets: IAssetStore;
  /** Request a state transition (the Game owns the actual swap). */
  transition(to: GameStateId): void;
  config: RenderConfig; // live render settings
}

export interface IGameState {
  readonly id: GameStateId;
  onEnter(ctx: GameContext): void;
  onExit(ctx: GameContext): void;
  update(dt: number): void;
  /** Draw to the visible 2D context; `alpha` is fixed-step interpolation. */
  render(ctx2d: CanvasRenderingContext2D, alpha: number): void;
}
