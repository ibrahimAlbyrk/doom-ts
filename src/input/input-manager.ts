// InputManager — implements the Input contract (keyboard + mouse, Pointer Lock;
// web-arch.md §5). Held/edge sets are polled by systems through the Input interface.
import type { Input, Action, Bindings } from '../core';
import { loadBindings, saveBindings } from './bindings-store';

const SCROLL_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Tab']);

/** Optional construction flags. Backward-compatible: omit for today's behaviour
 *  plus automatic persistence of rebinds. */
export interface InputManagerOptions {
  /** Layer persisted user overrides over the passed bindings and save on rebind.
   *  Defaults to true. Set false to ignore localStorage entirely. */
  persist?: boolean;
}

export class InputManager implements Input {
  private readonly held = new Set<string>();
  private readonly pressed = new Set<string>();
  private readonly released = new Set<string>();
  private readonly bindings: Bindings;
  private readonly persist: boolean;

  private _mouseDX = 0;
  private _mouseDY = 0;
  private _locked = false;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    bindings: Bindings,
    options?: InputManagerOptions,
  ) {
    this.persist = options?.persist ?? true;
    this.bindings = this.persist ? loadBindings(bindings) : { ...bindings };
    window.addEventListener('keydown', this.onKey);
    window.addEventListener('keyup', this.onKey);
    window.addEventListener('mousedown', this.onMouseButton);
    window.addEventListener('mouseup', this.onMouseButton);
    document.addEventListener('mousemove', this.onMouseMove);
    canvas.addEventListener('click', this.requestLock);
    document.addEventListener('pointerlockchange', this.onLockChange);
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  get mouseDX(): number {
    return this._mouseDX;
  }
  get mouseDY(): number {
    return this._mouseDY;
  }
  get pointerLocked(): boolean {
    return this._locked;
  }

  isDown(action: Action): boolean {
    return this.held.has(this.bindings[action]);
  }
  wasPressed(action: Action): boolean {
    return this.pressed.has(this.bindings[action]);
  }
  wasReleased(action: Action): boolean {
    return this.released.has(this.bindings[action]);
  }

  beginTick(): void {
    // Snapshot hook — held/edge sets are already current from event handlers.
  }

  flush(): void {
    this.pressed.clear();
    this.released.clear();
    this._mouseDX = 0;
    this._mouseDY = 0;
  }

  setBinding(action: Action, code: string): void {
    this.bindings[action] = code;
    if (this.persist) saveBindings(this.bindings);
  }
  getBindings(): Bindings {
    return { ...this.bindings };
  }

  private onKey = (e: KeyboardEvent): void => {
    if (SCROLL_KEYS.has(e.code)) e.preventDefault();
    if (e.type === 'keydown') {
      if (!this.held.has(e.code)) this.pressed.add(e.code);
      this.held.add(e.code);
    } else {
      this.released.add(e.code);
      this.held.delete(e.code);
    }
  };

  private onMouseButton = (e: MouseEvent): void => {
    const code = e.button === 0 ? 'MouseLeft' : e.button === 2 ? 'MouseRight' : `Mouse${e.button}`;
    if (e.type === 'mousedown') {
      if (!this.held.has(code)) this.pressed.add(code);
      this.held.add(code);
    } else {
      this.released.add(code);
      this.held.delete(code);
    }
  };

  private onMouseMove = (e: MouseEvent): void => {
    if (!this._locked) return;
    this._mouseDX += e.movementX;
    this._mouseDY += e.movementY;
  };

  private requestLock = (): void => {
    void this.canvas.requestPointerLock();
  };

  private onLockChange = (): void => {
    this._locked = document.pointerLockElement === this.canvas;
  };

  private onVisibility = (): void => {
    if (document.hidden) {
      this.held.clear(); // avoid stuck keys on tab-out
      this.pressed.clear();
      this.released.clear();
    }
  };
}
