// Entry point — grab the single canvas and boot the game-state machine to
// LOADING/TITLE (web-arch.md §1).
import { Game } from './game';

const canvas = document.getElementById('screen');
if (!(canvas instanceof HTMLCanvasElement)) {
  throw new Error('main: <canvas id="screen"> not found');
}

const game = new Game(canvas);
game.start();

// Expose a dev/automation handle (used by the in-browser playtest harness).
(globalThis as unknown as { __doom?: unknown }).__doom = game.debug;
