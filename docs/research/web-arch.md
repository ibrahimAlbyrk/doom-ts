# Web Game Architecture — TypeScript + Vite DOOM-style FPS

> Scope: surrounding app architecture only. Rendering internals are covered in the raycaster doc.
> Single HTML5 canvas, Canvas 2D, ~hundreds of active entities.

---

## 1. Project Setup — Vite + TypeScript

### Scaffold & config

```
npm create vite@latest doom-ts -- --template vanilla-ts
```

**`vite.config.ts`**
```ts
import { defineConfig } from 'vite';

export default defineConfig({
  base: './',                    // relative paths → works from any subdir
  publicDir: 'public',           // assets copied verbatim to dist/
  build: {
    target: 'es2022',
    outDir: 'dist',
    assetsInlineLimit: 0,        // never inline audio/images as base64
  },
  server: {
    headers: {
      // required for SharedArrayBuffer / AudioWorklet cross-origin isolation
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
});
```

**`tsconfig.json`** (key options)
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "paths": { "@/*": ["src/*"] }
  }
}
```

### Entry point

**`index.html`** — single canvas, no framework
```html
<canvas id="screen" width="640" height="400"></canvas>
<script type="module" src="/src/main.ts"></script>
```

**`src/main.ts`**
```ts
import { Game } from '@/game';

const canvas = document.getElementById('screen') as HTMLCanvasElement;
new Game(canvas).start();
```

### Folder structure

```
doom-ts/
├── public/
│   ├── manifest.json            # asset manifest (paths + metadata)
│   └── assets/
│       ├── textures/            # wall/ceiling/floor PNGs
│       ├── sprites/             # enemy/item PNGs
│       ├── maps/                # level JSON files
│       └── audio/
│           ├── sfx/             # one-shot effects
│           └── music/           # looping tracks
├── src/
│   ├── main.ts
│   ├── game.ts                  # Game class — owns loop + state machine
│   ├── states/
│   │   ├── state.ts             # IGameState interface
│   │   ├── boot.ts
│   │   ├── loading.ts
│   │   ├── title.ts
│   │   ├── menu.ts
│   │   ├── playing.ts
│   │   ├── paused.ts
│   │   ├── intermission.ts
│   │   └── gameover.ts
│   ├── entities/
│   │   ├── world.ts             # entity registry / pool
│   │   ├── player.ts
│   │   ├── monster.ts
│   │   ├── projectile.ts
│   │   └── pickup.ts
│   ├── input/
│   │   ├── input-manager.ts
│   │   └── bindings.ts
│   ├── audio/
│   │   ├── audio-manager.ts
│   │   └── sfx-pool.ts
│   ├── assets/
│   │   ├── asset-loader.ts
│   │   └── asset-store.ts
│   ├── renderer/                # raycaster — see separate doc
│   └── utils/
│       ├── math.ts
│       └── storage.ts
└── vite.config.ts
```

---

## 2. Main Game Loop

### Fixed-timestep accumulator + interpolated render

```ts
// src/game.ts
const FIXED_STEP = 1 / 60;   // seconds — deterministic physics/AI tick
const MAX_FRAME_TIME = 0.25;  // prevent spiral-of-death on tab-restore

export class Game {
  private accumulator = 0;
  private lastTime = 0;
  private rafHandle = 0;

  constructor(
    private canvas: HTMLCanvasElement,
    private ctx = canvas.getContext('2d')!,
  ) {}

  start(): void {
    this.lastTime = performance.now() / 1000;
    this.rafHandle = requestAnimationFrame(this.loop);
  }

  private loop = (nowMs: number): void => {
    this.rafHandle = requestAnimationFrame(this.loop);

    const now = nowMs / 1000;
    let dt = now - this.lastTime;
    this.lastTime = now;

    if (dt > MAX_FRAME_TIME) dt = MAX_FRAME_TIME;

    this.accumulator += dt;

    // Fixed-step update
    while (this.accumulator >= FIXED_STEP) {
      this.currentState.update(FIXED_STEP);
      this.accumulator -= FIXED_STEP;
    }

    // Interpolated render — alpha ∈ [0,1) tells renderer how far into
    // the next fixed step we are; use to lerp visual positions.
    const alpha = this.accumulator / FIXED_STEP;
    this.currentState.render(this.ctx, alpha);
  };

  pause(): void  { cancelAnimationFrame(this.rafHandle); }
  resume(): void { this.lastTime = performance.now() / 1000; this.start(); }
}
```

**Pausing on focus loss** — wire once in `Game.start()`:
```ts
document.addEventListener('visibilitychange', () => {
  if (document.hidden) this.pause();
  else                  this.resume();
});
```

The renderer uses `alpha` to lerp entity positions between the last two fixed ticks, giving sub-frame-smooth motion even at 144 Hz with a 60 Hz simulation.

---

## 3. Top-Level State Machine

### Interface

```ts
// src/states/state.ts
export interface IGameState {
  onEnter(ctx: GameContext): void;
  onExit(ctx: GameContext): void;
  update(dt: number): void;
  render(ctx: CanvasRenderingContext2D, alpha: number): void;
}
```

`GameContext` is a thin bag of shared services (audio, input, assets, world) threaded into states on entry.

### Transitions

```
BOOT → LOADING → TITLE → MENU → PLAYING ⇄ PAUSED
                                   ↓
                             INTERMISSION → PLAYING (next level)
                                   ↓
                              GAMEOVER → TITLE
```

```ts
// src/game.ts (partial)
export class Game {
  private stateMap: Record<string, IGameState> = {
    boot:          new BootState(),
    loading:       new LoadingState(),
    title:         new TitleState(),
    menu:          new MenuState(),
    playing:       new PlayingState(),
    paused:        new PausedState(),
    intermission:  new IntermissionState(),
    gameover:      new GameoverState(),
  };

  private currentKey = 'boot';

  transition(next: string): void {
    this.stateMap[this.currentKey]?.onExit(this.context);
    this.currentKey = next;
    this.stateMap[next].onEnter(this.context);
  }
}
```

Each state only knows about the transition it triggers (e.g. `PlayingState` calls `game.transition('paused')` on Escape). No global mutable enum needed.

**PAUSED** only renders the frozen PLAYING frame behind an overlay — it does not re-tick the world.

---

## 4. Entity Model

### Recommendation: struct-of-entities with typed component bags

> **FLAG FOR ORCHESTRATOR:** This is the main architectural fork. Options are:
> - **(A) Struct-of-entities (recommended here)** — plain TS classes per entity type, pooled into typed arrays. Simple, fast enough for ~hundreds of entities, no framework.
> - **(B) Archetypal ECS (e.g. bitECS)** — correct choice if entity counts or component churn grows to thousands, or if you want data-locality guarantees. Adds dependency + learning curve.
>
> For a DOOM-scale game (player + ~100–300 monsters + ~50 projectiles + pickups), **(A) is sufficient** and eliminates ECS ceremony. Confirm before treating this as locked.

### Shape (option A)

```ts
// src/entities/world.ts
export interface Player {
  x: number; y: number; angle: number;
  velX: number; velY: number;
  health: number; armor: number; ammo: number;
}

export interface Monster {
  id: number;
  x: number; y: number; angle: number;
  type: MonsterType;
  health: number;
  state: MonsterAIState;
  stateTimer: number;
}

export interface Projectile {
  id: number;
  x: number; y: number;
  velX: number; velY: number;
  damage: number;
  ownerType: 'player' | 'monster';
}

export interface Pickup {
  id: number;
  x: number; y: number;
  kind: PickupKind;
  active: boolean;
}

export class World {
  player: Player = createPlayer();
  monsters: Monster[]    = [];
  projectiles: Projectile[] = [];
  pickups: Pickup[]      = [];

  private nextId = 1;
  allocId(): number { return this.nextId++; }

  // O(1) removal — swap with last, pop
  removeMonster(id: number): void {
    const i = this.monsters.findIndex(m => m.id === id);
    if (i === -1) return;
    this.monsters[i] = this.monsters[this.monsters.length - 1]!;
    this.monsters.pop();
  }
}
```

Update in `PlayingState.update()`:
```ts
update(dt: number): void {
  updatePlayer(this.world.player, dt, this.input, this.map);
  updateMonsters(this.world, dt);
  updateProjectiles(this.world, dt);
  checkPickups(this.world);
}
```

Keeping update functions as free functions (not methods on entity objects) keeps data and logic separate — easy to profile, test, and later migrate to a real ECS if needed.

---

## 5. Input

### Keyboard + mouse with Pointer Lock

```ts
// src/input/input-manager.ts
export class InputManager {
  private held = new Set<string>();
  private justPressed = new Set<string>();
  private justReleased = new Set<string>();
  mouseDX = 0;
  mouseDY = 0;
  locked = false;

  constructor(private canvas: HTMLCanvasElement, private bindings: Bindings) {
    window.addEventListener('keydown',  this.onKey);
    window.addEventListener('keyup',    this.onKey);
    canvas.addEventListener('click',    () => canvas.requestPointerLock());
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
    });
    document.addEventListener('mousemove', this.onMouse);
  }

  private onKey = (e: KeyboardEvent): void => {
    e.preventDefault();
    if (e.type === 'keydown' && !this.held.has(e.code)) this.justPressed.add(e.code);
    if (e.type === 'keyup')   this.justReleased.add(e.code);
    e.type === 'keydown' ? this.held.add(e.code) : this.held.delete(e.code);
  };

  private onMouse = (e: MouseEvent): void => {
    if (!this.locked) return;
    this.mouseDX += e.movementX;
    this.mouseDY += e.movementY;
  };

  // Call once at end of each fixed update tick
  flush(): void {
    this.justPressed.clear();
    this.justReleased.clear();
    this.mouseDX = 0;
    this.mouseDY = 0;
  }

  isAction(action: Action): boolean   { return this.held.has(this.bindings[action]); }
  wasAction(action: Action): boolean  { return this.justPressed.has(this.bindings[action]); }
}
```

### Action mapping & rebinding

```ts
// src/input/bindings.ts
export type Action =
  | 'moveForward' | 'moveBack' | 'strafeLeft' | 'strafeRight'
  | 'fire' | 'use' | 'jump' | 'pause' | 'weapon1' | 'weapon2';

export type Bindings = Record<Action, string>;  // code string e.g. 'KeyW'

export const DEFAULT_BINDINGS: Bindings = {
  moveForward:  'KeyW',
  moveBack:     'KeyS',
  strafeLeft:   'KeyA',
  strafeRight:  'KeyD',
  fire:         'MouseLeft',
  use:          'KeyE',
  jump:         'Space',
  pause:        'Escape',
  weapon1:      'Digit1',
  weapon2:      'Digit2',
};
```

Rebinding: write changed key to `Bindings` object, persist to localStorage (see §8).

**Focus loss**: `visibilitychange` → clear `held` set to prevent stuck keys:
```ts
document.addEventListener('visibilitychange', () => {
  if (document.hidden) this.held.clear();
});
```

---

## 6. Audio — Web Audio API

### Manager skeleton

```ts
// src/audio/audio-manager.ts
export class AudioManager {
  private ctx: AudioContext;
  private master: GainNode;
  private sfxBus: GainNode;
  private musicBus: GainNode;
  private musicSource: AudioBufferSourceNode | null = null;
  private buffers = new Map<string, AudioBuffer>();

  constructor() {
    this.ctx = new AudioContext();
    this.master   = this.ctx.createGain();
    this.sfxBus   = this.ctx.createGain();
    this.musicBus = this.ctx.createGain();
    this.sfxBus.connect(this.master);
    this.musicBus.connect(this.master);
    this.master.connect(this.ctx.destination);
  }

  async load(id: string, url: string): Promise<void> {
    const res = await fetch(url);
    const raw = await res.arrayBuffer();
    this.buffers.set(id, await this.ctx.decodeAudioData(raw));
  }

  playSFX(id: string, volume = 1, pan = 0): void {
    const buf = this.buffers.get(id);
    if (!buf) return;
    const src    = this.ctx.createBufferSource();
    const gain   = this.ctx.createGain();
    const panner = this.ctx.createStereoPanner();
    src.buffer = buf;
    gain.gain.value   = volume;
    panner.pan.value  = Math.max(-1, Math.min(1, pan));
    src.connect(gain).connect(panner).connect(this.sfxBus);
    src.start();
  }

  // volume ∈ [0,1], pan ∈ [-1,1] from distance + angle relative to player
  playSFXSpatial(id: string, dx: number, dy: number, maxDist = 800): void {
    const dist   = Math.hypot(dx, dy);
    if (dist > maxDist) return;
    const volume = 1 - dist / maxDist;
    const pan    = Math.max(-1, Math.min(1, dx / (maxDist * 0.5)));
    this.playSFX(id, volume, pan);
  }

  playMusic(id: string, loop = true): void {
    this.stopMusic();
    const buf = this.buffers.get(id);
    if (!buf) return;
    this.musicSource = this.ctx.createBufferSource();
    this.musicSource.buffer = buf;
    this.musicSource.loop   = loop;
    this.musicSource.connect(this.musicBus);
    this.musicSource.start();
  }

  stopMusic(): void {
    this.musicSource?.stop();
    this.musicSource = null;
  }

  setMasterVolume(v: number): void { this.master.gain.value   = v; }
  setSFXVolume(v: number):    void { this.sfxBus.gain.value   = v; }
  setMusicVolume(v: number):  void { this.musicBus.gain.value = v; }

  // Call on first user gesture — AudioContext starts suspended
  resume(): Promise<void> { return this.ctx.resume(); }
}
```

**SFX pool pattern** — for rapid-fire sounds (gunshots) that can overlap:
```ts
playSFX() already creates a new BufferSource per call — AudioBufferSourceNode
is designed for one-shot use and GC'd after playback ends. No manual pool needed.
```

---

## 7. Asset Loading

### Manifest format (`public/manifest.json`)

```json
{
  "textures": [
    { "id": "wall_brick",  "url": "assets/textures/wall_brick.png" },
    { "id": "wall_metal",  "url": "assets/textures/wall_metal.png" }
  ],
  "sprites": [
    { "id": "imp",         "url": "assets/sprites/imp.png" }
  ],
  "audio": [
    { "id": "sfx_shoot",   "url": "assets/audio/sfx/shoot.wav" },
    { "id": "music_e1m1",  "url": "assets/audio/music/e1m1.ogg" }
  ],
  "maps": [
    { "id": "e1m1",        "url": "assets/maps/e1m1.json" }
  ]
}
```

### Loader with progress

```ts
// src/assets/asset-loader.ts
export type Progress = { loaded: number; total: number };

export class AssetLoader {
  constructor(
    private store: AssetStore,
    private audio: AudioManager,
  ) {}

  async loadAll(onProgress: (p: Progress) => void): Promise<void> {
    const manifest = await fetch('/manifest.json').then(r => r.json());

    const tasks: Array<() => Promise<void>> = [
      ...manifest.textures.map((t: any) => () => this.loadImage(t.id, t.url)),
      ...manifest.sprites.map( (s: any) => () => this.loadImage(s.id, s.url)),
      ...manifest.audio.map(   (a: any) => () => this.audio.load(a.id, a.url)),
      ...manifest.maps.map(    (m: any) => () => this.loadJSON(m.id, m.url)),
    ];

    const total = tasks.length;
    let loaded = 0;
    for (const task of tasks) {
      await task();
      onProgress({ loaded: ++loaded, total });
    }
  }

  private async loadImage(id: string, url: string): Promise<void> {
    const img = new Image();
    img.src = url;
    await img.decode();
    this.store.images.set(id, img);
  }

  private async loadJSON(id: string, url: string): Promise<void> {
    this.store.json.set(id, await fetch(url).then(r => r.json()));
  }
}
```

**LoadingState** renders a progress bar from `onProgress` callbacks and calls `game.transition('title')` on completion.

```ts
// src/assets/asset-store.ts
export class AssetStore {
  images = new Map<string, HTMLImageElement>();
  json   = new Map<string, unknown>();
}
```

---

## 8. Persistence — localStorage

```ts
// src/utils/storage.ts

export interface Settings {
  masterVolume: number;  // 0–1
  sfxVolume:    number;
  musicVolume:  number;
  mouseSens:    number;
  screenWidth:  number;
  screenHeight: number;
}

const DEFAULTS: Settings = {
  masterVolume: 0.8,
  sfxVolume:    1.0,
  musicVolume:  0.7,
  mouseSens:    0.003,
  screenWidth:  640,
  screenHeight: 400,
};

const KEYS = {
  settings: 'doom_settings',
  bindings: 'doom_bindings',
  progress: 'doom_progress',
} as const;

export const Storage = {
  loadSettings(): Settings {
    try {
      const raw = localStorage.getItem(KEYS.settings);
      return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : { ...DEFAULTS };
    } catch { return { ...DEFAULTS }; }
  },

  saveSettings(s: Settings): void {
    localStorage.setItem(KEYS.settings, JSON.stringify(s));
  },

  loadBindings(): Partial<Bindings> {
    try {
      const raw = localStorage.getItem(KEYS.bindings);
      return raw ? JSON.parse(raw) : {};
    } catch { return {}; }
  },

  saveBindings(b: Bindings): void {
    localStorage.setItem(KEYS.bindings, JSON.stringify(b));
  },

  loadProgress(): { episodesUnlocked: number[] } {
    try {
      const raw = localStorage.getItem(KEYS.progress);
      return raw ? JSON.parse(raw) : { episodesUnlocked: [1] };
    } catch { return { episodesUnlocked: [1] }; }
  },

  saveProgress(p: { episodesUnlocked: number[] }): void {
    localStorage.setItem(KEYS.progress, JSON.stringify(p));
  },
};
```

All three concerns share the same `try/catch` pattern — localStorage can throw in private browsing or when storage is full.

---

## Decision Points (flag before locking)

| # | Topic | Recommendation | Alternative |
|---|-------|---------------|-------------|
| 1 | Entity model | Struct-of-entities (plain TS classes + arrays) | archetypal ECS (bitECS) — needed if entity count or churn grows significantly |
| 2 | Asset parallelism | Serial load with progress | `Promise.all` batches — faster but progress bar is coarser |
| 3 | Map format | Custom JSON in `public/assets/maps/` | WAD parsing or Tiled TMJ — depends on level authoring workflow |
| 4 | Renderer integration | `renderer/` is a sibling module passed `World` + `alpha` | If renderer needs full ownership of the loop, revisit Game class split |
