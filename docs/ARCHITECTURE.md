# DOOM-TS — Architecture Contract

The frozen contract parallel workers build against. **`src/core` is the frozen root:
every module imports from it; nothing edits it without a contract change here.** When a
decision below conflicts with what you're implementing, this document wins — raise the
conflict rather than diverging silently.

Engine class: a **grid raycaster** (Wolfenstein lineage) wearing DOOM's *look*
(textured flats, diminishing light, sprites, sectors-lite). Not a BSP renderer.
Source-of-truth research lives in `docs/research/` — `doom-design.md` (stats/flow),
`engine.md` (render math), `assets.md` (Freedoom extraction), `web-arch.md` (app shape).

---

## 1. Frozen decisions log

These were decided by the orchestrator. Encoded here; do not relitigate.

| # | Decision | Encoded in |
|---|----------|-----------|
| 1 | **TypeScript + Vite** (vanilla-ts, strict + `noUncheckedIndexedAccess`). | `package.json`, `tsconfig.json`, `vite.config.ts` |
| 2 | **Canvas 2D raycaster** (no WebGL). | `src/render` |
| 3 | **Internal resolution configurable, default 480×270, 320×200 selectable; nearest-neighbor upscale.** | `core/constants.ts`, `core/render.ts` (`RenderConfig`), `index.html` (`image-rendering: pixelated`) |
| 4 | **FOV camera-plane ratio 0.66 (~66°); 32-level colormap banding.** | `core/constants.ts`, `render/colormap.ts` |
| 5 | **Entity model = struct-of-entities** (plain TS classes + swap-pop arrays). NOT an ECS. | `core/types.ts` (entity structs), `entities/world.ts` |
| 6 | **Combat resolves on the 2D plane**: DOOM-style vertical autoaim degenerates to "first thing along the 2D ray". No player pitch-aim. | `core/enums.ts` (`AttackKind`), `combat/combat.ts` |
| 7 | **Map = axis-aligned grid.** Supports doors, teleporters, simple lifts, and a few **discrete floor/ceiling height tiers** (engine.md §7 fake-height). **NO crushers / arbitrary sector geometry / non-orthogonal walls in v1.** | `core/types.ts` (`MapData`), `world/` |
| 8 | **Audio = Web Audio API.** OGG primary (WAV ok for short SFX), positional by distance+angle, music secondary. | `core/audio.ts`, `audio/audio-manager.ts` |
| 9 | **Assets = Freedoom 0.13.0 (`freedoom2.wad`)**, extracted by a custom Node/TS tool to `public/assets` + a single JSON manifest. | `assets/manifest.ts`, `tools/extract-wad/` |
| 10 | **Freedoom is BSD-3-Clause** → an in-game **About/Credits screen** reproducing the copyright notice + AS-IS disclaimer is a **REQUIRED deliverable**. | `ui/credits.ts` (implemented), `CreditsState` in `game/states.ts` |
| 11 | **Scope = one full episode of 3–5 levels** (+ optional secret map). | `levels/episode.ts` (`EPISODE1`: 5 maps + 1 secret) |
| 12 | **`core` DOM split + headless sim (multiplayer foundation, P0).** The shared sim must compile/run under Node, so DOM-coupled contracts left `core`: the **`Renderer`** service interface → `src/render/contract.ts`; **`GameContext`/`IGameState`** → `src/game/types.ts`; a DOM-free **`SimContext`** was added to `core`. Render DATA shapes (Camera/Texture/SpriteFrame/RenderScene/RenderConfig/ScreenTint) and the DOM-free `Audio`/`Input` interfaces stay in `core`. `GameSession` is now the headless deterministic sim; presentation lives in `GameClient`. Enforced by `tsconfig.sim.json` (no `lib.dom`). **This ratifies the core-contract change anticipated for the online phase.** | `core/render.ts`, `core/types.ts`, `render/contract.ts`, `game/{session,client,types}.ts`, `session/`, `tsconfig.sim.json`; rationale in `docs/multiplayer-plan.md` §0.1/§2 |

**Consistency note (decision 7):** doom-design.md §9 and engine.md §7 *recommend* cutting
height for v1, but engine.md §7.1/§7.2 also describe how to *fake* discrete floor/ceiling
tiers and animated floors on a grid. The frozen decision picks the fake-height path, which
is implementable and not contradictory. `MapData` carries `floorHeights[]`/`ceilHeights[]`
discrete tiers; lifts animate a cell's floor tier between `lowHeight`/`highHeight`. Crushers
and arbitrary geometry remain out of scope.

**World units:** the sim runs in DOOM **map units (mu)**; `CELL_SIZE = 64` mu per grid cell.
The renderer divides positions by `CELL_SIZE` for cell-space DDA. This keeps the `src/data`
tables usable verbatim from doom-design.md.

---

## 2. Module ownership map

Each folder is owned by one worker; ownership is **disjoint** so workers run in parallel.
Everyone imports `src/core`; only the owner edits their folder. `index.ts` in each folder is
the public barrel.

| Folder | Responsibility | Files owned |
|--------|---------------|-------------|
| **`src/core`** ⛔FROZEN (except the ratified #12 DOM split) | The **DOM-free** contract: shared types/interfaces, Vec2+math, constants, seeded RNG, typed event bus. Imported by everyone; edited by no one (without a contract change). | `enums.ts`, `constants.ts`, `vec2.ts`, `math.ts`, `rng.ts`, `events.ts`, `defs.ts` (Def types), `render.ts` (Camera/Texture/SpriteFrame/RenderScene/RenderConfig DATA — **`Renderer` iface moved to `render/contract.ts`, #12**), `audio.ts` (Audio), `input.ts` (Input/Bindings), `types.ts` (entity structs, `MapData`, `IWorld`/`ILevelRuntime`/`IAssetStore`, `SimContext` — **`GameContext`/`IGameState` moved to `game/types.ts`, #12**), `index.ts` |
| **`src/data`** | Typed const tables from doom-design.md. Read-only data, no behavior. | `weapons.ts`, `enemies.ts`, `ammo.ts`, `items.ts`, `powerups.ts`, `things.ts` (DoomEd ids), `skills.ts`, `index.ts` |
| **`src/assets`** | Asset manifest schema (assets.md §5) + boot-time loader + decoded-asset store (`IAssetStore`). | `manifest.ts`, `asset-loader.ts`, `asset-store.ts`, `index.ts` |
| **`src/render`** | Canvas 2D raycaster: DDA walls, floor/ceiling flats, billboard sprites, weapon overlay, colormap lighting, upscale blit. Implements + **owns the `Renderer` interface** (`contract.ts`, moved here in #12). | `contract.ts` (`Renderer`), `renderer.ts`, `raycaster.ts`, `sprites.ts`, `colormap.ts`, `index.ts` |
| **`src/world`** | Level runtime (`ILevelRuntime`): grid accessors, door/lift/teleporter state + animation, grid collision/movement. | `level-runtime.ts`, `collision.ts`, `doors.ts`, `index.ts` |
| **`src/entities`** | Entity registry `World` (`IWorld`, struct-of-entities + swap-pop) and the spawn factory. | `world.ts`, `factory.ts`, `index.ts` |
| **`src/ai`** | Monster AI state machine (idle→chase→melee/missile→pain→death), sight/sound wakeups, infighting. | `monster-ai.ts`, `index.ts` |
| **`src/weapons`** | Player weapon state: current/pending weapon, cooldown, ammo spend, fire dispatch, view-model anim. | `weapon-system.ts`, `index.ts` |
| **`src/combat`** | Damage resolution: hitscan (+spread/2D-autoaim), projectile spawn, radius/splash with 2D LOS, armor split, pain/knockback. | `combat.ts`, `index.ts` |
| **`src/items`** | Pickup overlap + effect application (health/armor/ammo/weapon/powerup/key/backpack), inventory mutations, powerup timers. | `pickups.ts`, `inventory.ts`, `index.ts` |
| **`src/audio`** | Web Audio service (`Audio`): SFX (positional), music bus, volumes. | `audio-manager.ts`, `index.ts` |
| **`src/input`** | Keyboard + mouse (Pointer Lock) service (`Input`); held/edge state. Bindings types live in `core/input.ts`. | `input-manager.ts`, `index.ts` |
| **`src/ui`** | HUD/status bar, menus, intermission tally, **About/Credits screen** (implemented). | `hud.ts`, `menus.ts`, `intermission.ts`, `credits.ts`, `index.ts` |
| **`src/game`** | Integration hub: fixed-timestep loop, state machine, service wiring. **`session.ts` = headless deterministic sim (`GameSession`); `client.ts` = browser presenter (`GameClient`); `types.ts` = `GameContext`/`IGameState` (#12).** Sits at the top of the dep graph; nothing imports it back. | `session.ts` (`GameSession`), `client.ts` (`GameClient`), `types.ts`, `game.ts`, `states.ts`, `context.ts`, `scene.ts`, `index.ts` |
| **`src/session`** | The **Session abstraction** (multiplayer-plan §0.1): `Session` interface + `LocalSession` (offline single-player, runs the sim in-process) + `RemoteSession`/`SessionTransport` (the online seam, P2+). | `session.ts`, `local-session.ts`, `remote-session.ts`, `index.ts` |
| **`server`** | Authoritative-sim host (placeholder). P0: `headless-sim.ts` runs a level headless under Node (DOM-free proof + deterministic checksum). P2: the Colyseus `Room` wrapping the same `GameSession`. | `headless-sim.ts`, `README.md` |
| **`src/levels`** | Episode progression + level loading/validation (`MapData` → `LevelRuntime` + spawns). | `episode.ts`, `level-loader.ts`, `index.ts` |
| **`tools/extract-wad`** | Freedoom WAD → web assets + manifest (Node/TS, headless). Outside the Vite build. | `extract.ts`, `README.md` |
| `src/main.ts` | Entry: boot the state machine. | `main.ts` |

**Dependency rule:** modules depend on `core` (+ `data` for tables) and, where needed, on
sibling *contracts* (never sibling internals). `game` is the only place that imports concrete
sibling classes to wire them. No module imports `game`.

---

## 3. Map / level JSON schema

The on-disk level format (`public/assets/maps/*.json`), typed as `MapData` in
`core/types.ts`. Axis-aligned grid; layers are row-major (`index = y*width + x`).

| Field | Type | Meaning |
|-------|------|---------|
| `id`, `name` | string | level id ("E1M1") + display name |
| `width`, `height` | number | grid dimensions (cells) |
| `cellSize` | number | map units per cell (default 64) |
| `walls[]` | number | wall texture id; **0 = passable** (no wall) |
| `floors[]`, `ceilings[]` | number | flat ids; ceiling **-1 = sky** |
| `floorHeights[]`, `ceilHeights[]` | number | discrete height tiers (mu; fake-height) |
| `light[]` | number | sector light 0..255 |
| `wallTextures[]` | string[] | wall id → manifest key (id − 1 indexes) |
| `flatTextures[]` | string[] | flat id → manifest key |
| `sky` | string | sky texture key |
| `doors[]` | `DoorSpec` | door cells (normal/locked + key, speed, wait, texture) |
| `lifts[]` | `LiftSpec` | lift cells + low/high tier + trigger |
| `teleporters[]` | `TeleporterSpec` | trigger + destination (mu, angle) |
| `exits[]` | `ExitSpec` | normal/secret exit triggers |
| `secretSectors[]` | number[] | cell indices flagged secret |
| `things[]` | `ThingSpec` | spawns by DoomEd id (x,y mu; angle deg; skill bitmask) |
| `playerStart` | `SpawnPoint` | x,y (mu), angle (deg) |
| `par` | number | par time (seconds) |
| `music?` | string | optional music id |

### Tiny example (`e1demo.json`)

```jsonc
{
  "id": "E1DEMO", "name": "Test Cell", "width": 4, "height": 4, "cellSize": 64,
  // 4x4: solid border (wall id 1), open interior (0)
  "walls":  [1,1,1,1, 1,0,0,1, 1,0,0,1, 1,1,1,1],
  "floors": [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0],
  "ceilings":[0,0,0,0, 0,-1,-1,0, 0,-1,-1,0, 0,0,0,0],  // -1 = sky over the interior
  "floorHeights":[0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0],
  "ceilHeights": [128,128,128,128, 128,128,128,128, 128,128,128,128, 128,128,128,128],
  "light": [160,160,160,160, 160,200,200,160, 160,200,200,160, 160,160,160,160],
  "wallTextures": ["STARTAN3"],
  "flatTextures": ["FLOOR4_8"],
  "sky": "SKY1",
  "doors": [], "lifts": [], "teleporters": [], "exits": [], "secretSectors": [],
  "things": [ { "id": 3001, "x": 160, "y": 160, "angle": 90, "skill": 7 } ], // one imp
  "playerStart": { "x": 96, "y": 96, "angle": 0 },
  "par": 30
}
```

`level-loader.validateMap` must check: every layer array length === `width*height`;
texture/flat ids in range; exactly one `playerStart`.

---

## 4. Asset manifest schema

`public/manifest.json`, typed as `AssetManifest` in `assets/manifest.ts` — **matches
assets.md §5 exactly**. Coordinates are source pixels; `origin` = picture
`[leftoffset, topoffset]` draw hotspot. Emitted by `tools/extract-wad`.

```jsonc
{
  "meta": { "source": "freedoom2.wad", "freedoomVersion": "0.13.0",
            "license": "BSD-3-Clause (modified BSD)",
            "attribution": "THIRD-PARTY/freedoom-LICENSE.txt", "palette": "PLAYPAL[0]" },
  "textures": { "STARTAN3": { "path": "textures/STARTAN3.png", "w": 128, "h": 128 } },
  "flats":    { "FLOOR4_8": { "path": "flats/FLOOR4_8.png", "w": 64, "h": 64 } },
  "sprites":  { "TROO": { "entity": "imp", "frames": {
                  "A1": { "path": "sprites/TROO/TROOA1.png", "w": 41, "h": 56, "origin": [20,53], "mirror": false },
                  "A8": { "path": "sprites/TROO/TROOA2A8.png", "w": 44, "h": 55, "origin": [22,53], "mirror": true }
                } } },
  "ui":     { "STBAR": { "path": "ui/STBAR.png", "w": 320, "h": 32, "origin": [0,0] } },
  "fonts":  { "hud": { "lumpRange": "STCFN033-STCFN095", "space": 4,
                       "glyphs": { "33": { "path": "fonts/STCFN/033.png", "w": 9, "h": 16 } } } },
  "sounds": { "DSPISTOL": { "path": "audio/sfx/DSPISTOL.ogg", "rate": 11025, "channels": 1, "format": "ogg" } },
  "music":  {}
}
```

Sprite frame keys are `frameLetter + rotation` (rotation `1..8`, or `0` = angle-independent).
The runtime picks rotation from the camera-to-entity angle. All PNGs are RGBA (transparency
baked; no runtime color-keying).

---

## 5. Game-state machine

States implement `IGameState` (`onEnter`/`onExit`/`update(dt)`/`render(ctx2d, alpha)`).
`Game` owns the swap; states call `ctx.transition(id)`.

```
BOOT ──▶ LOADING ──▶ TITLE ──▶ MENU ──▶ PLAYING ⇄ PAUSED
                       │         │          │
                       └────┬────┘          ▼
                       CREDITS          INTERMISSION ──▶ PLAYING (next level)
                    (About screen)          │
                                            ▼
                                        GAMEOVER ──▶ TITLE
```

Current scaffold wiring (placeholders draw to the 2D context; world sim/render land later):
BOOT→LOADING (immediate), LOADING→TITLE (after a simulated progress bar), TITLE→MENU (`[E]`)
or →CREDITS (`[Tab]`), MENU→PLAYING (`[E]`), PLAYING⇄PAUSED (`[Esc]`), CREDITS→TITLE (`[Esc]`).
`CreditsState` is the **required Freedoom About screen** and renders the full BSD-3-Clause
text for real.

---

## 6. Integration note — how `src/game` wires everything

1. `main.ts` finds `<canvas id="screen">` and calls `new Game(canvas).start()`.
2. `Game` constructs services via `context.createServices()` — the concrete sibling
   implementations bound to the frozen interfaces:
   `Canvas2DRenderer→Renderer`, `AudioManager→Audio`, `InputManager→Input`,
   `AssetStore→IAssetStore`, `World→IWorld`, `EventBus<GameEventMap>`, `Rng`.
3. `Game` builds the `RenderConfig` (480×270 default), calls `renderer.init(canvas, config)`,
   and assembles the `GameContext` bag (services + `transition` + `config`/`skill`/`episodeLevel`).
4. `Game` runs the **fixed-timestep loop** (`FIXED_STEP = 1/60`, `MAX_FRAME_TIME = 0.25`,
   web-arch.md §2): accumulate real time → run N fixed `update(FIXED_STEP)` steps →
   `render(ctx2d, alpha)` with the leftover interpolation factor. Input edges flush per frame;
   focus loss pauses the loop and clears held keys.
5. States receive `GameContext` on `onEnter`. `PlayingState` will dispatch the sim
   (`updatePlayer`/`updateMonsters`/`updateProjectiles`/`checkPickups`/`updateDoors`) and call
   `renderer.render(scene, alpha)` with a `RenderScene` (camera + `ILevelRuntime` + sprites +
   weapon). Today it's a placeholder so the app boots cleanly.

**Per-frame render order (engine.md §9), for the renderer worker:** floor/ceiling cast →
wall cast (+zBuffer) → sprites (z-tested) → weapon overlay → `putImageData` → upscale blit;
HUD drawn on top.

---

## 7. Open questions / interfaces to confirm before wide build-out

- **`EnemyDef.radiusMu`** — collision radii are **not** in doom-design.md §3; populated with
  canonical id `info.c` mobj radii (zombie 20, demon 30, caco 31, baron 24, cyber 40, spider
  128, …). Confirm these are acceptable or supply a source.
- **BFG tracer mechanic** — the 40-tracer/15×d8 spray (doom-design §2) can't be one uniform
  `WeaponDef` field; noted in `weapons.ts`, to be implemented in `weapons`/`combat`.
- **`MapData` schema** — designed here from engine.md §7 (no canonical source). Confirm the
  layer set + door/lift/teleporter specs before authoring levels / the extractor's map emit.
- **2D-autoaim degeneracy** (decision 6) — floating monsters (caco/lost soul) become ground
  threats; accepted per doom-design §9, flagged for design sign-off.
- **`Input` flush cadence** — edges flush once per rendered frame (not per fixed step); fine
  for menus, confirm acceptable for buffered fire on 144Hz.
