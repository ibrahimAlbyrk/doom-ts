// Service construction for the GameContext. Game wires these concrete sibling-module
// implementations into the frozen service interfaces (src/core) and threads the
// resulting GameContext bag into every state.
import type { Bindings } from '../core';
import { EventBus } from '../core';
import type { GameEventMap } from '../core';
import { Rng } from '../core';
import { DEFAULT_SEED } from '../core';
import { Canvas2DRenderer } from '../render';
import { AudioManager } from '../audio';
import { InputManager } from '../input';
import { AssetStore } from '../assets';
import { World } from '../entities';

export interface Services {
  renderer: Canvas2DRenderer;
  audio: AudioManager;
  input: InputManager;
  assets: AssetStore;
  world: World;
  events: EventBus<GameEventMap>;
  rng: Rng;
}

export function createServices(canvas: HTMLCanvasElement, bindings: Bindings): Services {
  return {
    renderer: new Canvas2DRenderer(),
    audio: new AudioManager(),
    input: new InputManager(canvas, bindings),
    assets: new AssetStore(),
    world: new World(),
    events: new EventBus<GameEventMap>(),
    rng: new Rng(DEFAULT_SEED),
  };
}
