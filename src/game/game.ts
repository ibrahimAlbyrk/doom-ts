// Game — owns the fixed-timestep loop + the top-level state machine, and wires the
// frozen service interfaces (src/core) to their concrete implementations. This is the
// integration hub: it sits at the top of the dependency graph and nothing imports it
// back. Loop math: web-arch.md §2 / engine.md §8.
import type { GameStateId, RenderConfig } from '../core';
import {
  DEFAULT_BINDINGS,
  FIXED_STEP,
  MAX_FRAME_TIME,
  FOV_PLANE_RATIO,
  COLORMAP_LEVELS,
} from '../core';
import type { IGameState, GameContext } from './types';
import { DEFAULT_SKILL } from '../data';
import { createServices } from './context';
import { createStates } from './states';
import { GameClient } from './client';
import { loadResolution } from './resolution-store';

export class Game {
  private readonly ctx2d: CanvasRenderingContext2D;
  private readonly context: GameContext;
  private readonly session: GameClient;
  private readonly states: Record<GameStateId, IGameState>;
  private currentKey: GameStateId = 'boot';

  private accumulator = 0;
  private lastTime = 0;
  private raf = 0;
  private running = false;

  constructor(canvas: HTMLCanvasElement) {
    const ctx2d = canvas.getContext('2d');
    if (!ctx2d) throw new Error('Game: 2D context unavailable');
    this.ctx2d = ctx2d;

    const services = createServices(canvas, { ...DEFAULT_BINDINGS });
    const res = loadResolution();
    const config: RenderConfig = {
      internalWidth: res.width,
      internalHeight: res.height,
      fovRatio: FOV_PLANE_RATIO,
      colormapLevels: COLORMAP_LEVELS,
    };
    services.renderer.init(canvas, config);

    this.context = {
      canvas,
      renderer: services.renderer,
      audio: services.audio,
      input: services.input,
      assets: services.assets,
      world: services.world,
      events: services.events,
      rng: services.rng,
      transition: (to) => this.transition(to),
      config,
      skill: DEFAULT_SKILL,
      episodeLevel: 0,
    };

    this.session = new GameClient(this.context);
    this.states = createStates(this.session);
    this.states[this.currentKey].onEnter(this.context);
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastTime = performance.now() / 1000;
    this.raf = requestAnimationFrame(this.loop);
  }

  pause(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  resume(): void {
    if (this.running) return;
    this.running = true;
    this.lastTime = performance.now() / 1000;
    this.raf = requestAnimationFrame(this.loop);
  }

  transition(to: GameStateId): void {
    if (to === this.currentKey) return;
    this.states[this.currentKey].onExit(this.context);
    this.currentKey = to;
    this.states[to].onEnter(this.context);
  }

  /** Dev/automation hook: inspect live state + drive the machine from the console. */
  get debug(): {
    state: () => GameStateId;
    context: GameContext;
    session: GameClient;
    transition: (to: GameStateId) => void;
  } {
    return {
      state: () => this.currentKey,
      context: this.context,
      session: this.session,
      transition: (to) => this.transition(to),
    };
  }

  private readonly loop = (nowMs: number): void => {
    this.raf = requestAnimationFrame(this.loop);

    const now = nowMs / 1000;
    let dt = now - this.lastTime;
    this.lastTime = now;
    if (dt > MAX_FRAME_TIME) dt = MAX_FRAME_TIME;
    this.accumulator += dt;

    // Input edges are latched per fixed tick, never per render frame: each tick gets
    // its own begin/flush window so a press is consumed by exactly one tick. A
    // tickless frame keeps edges pending (no drop); a multi-tick frame consumes each
    // edge once (no replay / double-fire). web-arch.md §5 (begin/flush are per-tick).
    while (this.accumulator >= FIXED_STEP) {
      this.context.input.beginTick();
      this.states[this.currentKey].update(FIXED_STEP);
      this.context.input.flush();
      this.accumulator -= FIXED_STEP;
    }

    const alpha = this.accumulator / FIXED_STEP;
    this.states[this.currentKey].render(this.ctx2d, alpha);
  };

  private readonly onVisibility = (): void => {
    if (document.hidden) this.pause();
    else this.resume();
  };
}
