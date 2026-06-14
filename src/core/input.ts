// FROZEN CONTRACT — input service interface + action set (docs/research/web-arch.md §5).
// Keyboard + mouse (Pointer Lock). Systems poll edge/level state through `Input`.

export type Action =
  | 'moveForward'
  | 'moveBack'
  | 'strafeLeft'
  | 'strafeRight'
  | 'turnLeft'
  | 'turnRight'
  | 'run'
  | 'fire'
  | 'use'
  | 'pause'
  | 'automap'
  | 'nextWeapon'
  | 'prevWeapon'
  | 'weapon1'
  | 'weapon2'
  | 'weapon3'
  | 'weapon4'
  | 'weapon5'
  | 'weapon6'
  | 'weapon7';

/** Action → KeyboardEvent.code (or a synthetic 'MouseLeft'/'MouseRight'). */
export type Bindings = Record<Action, string>;

export const DEFAULT_BINDINGS: Bindings = {
  moveForward: 'KeyW',
  moveBack: 'KeyS',
  strafeLeft: 'KeyA',
  strafeRight: 'KeyD',
  turnLeft: 'ArrowLeft',
  turnRight: 'ArrowRight',
  run: 'ShiftLeft',
  fire: 'MouseLeft',
  use: 'KeyE',
  pause: 'Escape',
  automap: 'Tab',
  nextWeapon: 'BracketRight',
  prevWeapon: 'BracketLeft',
  weapon1: 'Digit1',
  weapon2: 'Digit2',
  weapon3: 'Digit3',
  weapon4: 'Digit4',
  weapon5: 'Digit5',
  weapon6: 'Digit6',
  weapon7: 'Digit7',
};

export interface Input {
  /** Held this tick. */
  isDown(action: Action): boolean;
  /** Went down since the last flush (edge). */
  wasPressed(action: Action): boolean;
  /** Went up since the last flush (edge). */
  wasReleased(action: Action): boolean;

  /** Accumulated mouse deltas since the last flush (pixels). */
  readonly mouseDX: number;
  readonly mouseDY: number;
  readonly pointerLocked: boolean;

  /** Called at the start of a fixed tick (snapshot). */
  beginTick(): void;
  /** Called at the end of a fixed tick — clears edges + mouse deltas. */
  flush(): void;

  setBinding(action: Action, code: string): void;
  getBindings(): Bindings;
}
