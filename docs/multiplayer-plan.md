# DOOM-TS Online — Multiplayer Implementation Plan

> **Status:** planning / implementation-ready. **No networking code yet.**
> This is the build plan that synthesizes the two research docs into an actionable,
> phased roadmap, and fully specifies the new **lobby/room** requirement the user asked for.
>
> **Read the research first — this doc builds on them and does not repeat them:**
> - `docs/research/multiplayer-netcode.md` — transport, server-authoritative netcode,
>   prediction/reconciliation/interpolation/lag-comp, the `GameSession.tic(TicCommand)`
>   replication seam, the single-player blockers, game-mode rules, library analysis.
>   Cross-referenced below as **[netcode §N]**.
> - `docs/research/multiplayer-deploy.md` — monorepo layout, `ws`/Caddy/Hetzner hosting,
>   join-by-IP via sslip.io + `wss`, deploy runbook, the "split DOM types out of core"
>   prerequisite. Cross-referenced below as **[deploy §N]**.
>
> Companion engine docs: `web-arch.md` (loop), `engine.md` (render), `ARCHITECTURE.md`
> (frozen contract). Memory: `online-multiplayer-plan`.

---

## 0. The one decision the two docs left open — resolve it first

The research docs deliberately disagree on the transport library and flagged it as the
coupling point ([netcode §11], [deploy §11]):

- **netcode doc** recommends **Colyseus** (rooms + matchmaking + binary delta state-sync
  for free; prediction/reconciliation/lag-comp still ours to build).
- **deploy doc** recommends **raw `ws` + hand-rolled rooms/lobby**, with Colyseus as the
  credible batteries-included alternative.

**This plan picks Colyseus.** Rationale, given the user's *new* lobby/room requirement:

- The user explicitly wants **host-a-room → share-a-code → player-list → ready-up →
  host-configures-the-match**. That is exactly the rooms + lobby + reconnection +
  per-room state-broadcast surface Colyseus gives for free. Hand-rolling it in `ws`
  (per [deploy §4]) re-implements Colyseus's `Room` + `LobbyRoom` lifecycle by hand.
- Colyseus `Room == one match` maps 1:1 onto our `GameSession`, and `LobbyRoom` /
  room metadata maps onto the lobby-listing UI ([netcode §9.1], [deploy §3]).
- Colyseus's `@type` Schema does the snapshot delta-encoding ([netcode §4.6]) we'd
  otherwise hand-write.
- It is still self-hosted Node + TS over WebSocket, so the **entire deploy doc still
  applies** (Caddy reverse-proxy, Hetzner, sslip.io/`wss`, systemd) — Colyseus is just the
  process behind Caddy instead of a bare `ws` server.

The costs we accept (both already catalogued in [netcode §9.1]): (1) TCP-only — HOL
blocking under loss, mitigated at 2–8-player scale and behind the `NetTransport` seam so a
geckos.io/WebRTC swap stays possible; (2) the Schema is a second representation of our
entity structs that we mirror each tick — mechanical duplication; (3) prediction,
reconciliation, and lag-comp are **still ours to build** — no framework does those.

> **Open decision for the user (D0):** confirm Colyseus over raw `ws`. Everything in §1, §3,
> and the phasing assumes Colyseus. If the user prefers minimal deps / full wire control, we
> fall back to the [deploy §4] hand-rolled `ws` lobby — the lobby *state machine, UI, and
> message set in §3 are transport-agnostic and do not change*, only their implementation
> substrate does.

---

## 1. Architecture summary

Server-authoritative fixed-tick simulation; one Node host runs the authoritative
`GameSession`, clients send inputs and render broadcast snapshots, with client prediction
for the local player and entity interpolation for everyone/everything else. Full rationale
in [netcode §4]; transport rationale (WebSocket/`wss` for v1, WebRTC as a later transport
swap) in [netcode §3] and [deploy §1.3].

```
   CLIENT (browser)                          SERVER (Node, the "host")
   ┌────────────────────────┐  TicCommand   ┌──────────────────────────────┐
   │ Input → TicCommand(seq) │ ───────────▶ │ Colyseus Room == one match    │
   │ predict local player    │              │  authoritative GameSession    │
   │ (applyPlayerCommand)     │  snapshot    │  tic() @30Hz over players map │
   │ interpolate remotes      │ ◀─────────── │  RNG, AI, combat, doors, items│
   │ render (Canvas2D)        │  @~20Hz      │  lag-comp ring buffer         │
   └────────────────────────┘              └──────────────────────────────┘
              ▲ reconcile on snapshot via lastProcessedInput per player
```

### 1.1 The replication seam (already exists)

`GameSession.tic(cmd: TicCommand): TicResult` (`src/game/session.ts:148`, command struct at
`session.ts:59`) is a canvas-free, deterministic-ish sim step driven by a serializable
command. That is the seam: run `tic()` on the server, feed one `TicCommand` per player per
tick, broadcast the resulting world. See [netcode §2.1] for the full canonical tic order.

### 1.2 The blockers and the concrete fix for each

These are the single-player assumptions that must die before networking. Sourced from
[netcode §2.3, §2.5, §5]; restated here as a fix checklist so this doc is self-contained.

| # | Blocker (current code) | Concrete fix |
|---|------------------------|--------------|
| B1 | **`world.player` is singular** (`src/entities/world.ts`, `IWorld.player`; `createPlayer(id,x,y,angle)` at `session.ts:151`) | Replace with `world.players: Map<playerId, Player>`. Update every reader: combat (`applyDamage` already takes `target: Entity` — fine), items/pickups, weapons, AI targeting (`lookForTarget` considers all players in co-op), camera/render (local client picks *its own* player). The local SP path becomes "a players map of size 1." |
| B2 | **Array index is not a stable identity** — removal is swap-pop (O(1), unordered) in the World registry | All replication keyed by **`id`**, never array position. Snapshots are `{id → state}` maps. (Already true for monsters/projectiles; extend to players.) |
| B3 | **`allocId()` is a local monotonic counter** (`nextId++`) | Entity-id allocation becomes **host-authoritative**: only the server calls `allocId()`. A client never spawns an entity locally except its own *predicted* player (which uses the server-assigned id handed back at join). |
| B4 | **Mouse-yaw is applied outside the command** — `readCommand()` mutates `world.player.angle` from a per-frame mouse delta (`session.ts:~202`, `MOUSE_RADIANS_PER_PX` at `session.ts:44`) that never enters `TicCommand` | Fold mouse-look into `TicCommand.turn` so a command **fully describes** a tick's input. Add a `seq: number` field for reconciliation. Without this, prediction replay can't reproduce the tick. |
| B5 | **Presentation coupled to sim** — `tic()` calls `this.hud.update()` and emits `'sfx'` events mid-step | Add a `presentation` flag to `GameSession`; on the headless server build these are no-ops. The server emits **gameplay** events (damage/death/pickup/exit/frag) which become reliable network messages; the client turns those into local SFX. |
| B6 | **DOM types live in `core`** — `core/render.ts`, `core/audio.ts`, `core/input.ts` carry browser types, so `shared` can't compile under Node without `lib.dom` | Split per [deploy §2.3 option A]: keep `render/audio/input` interfaces in the **client** package; `shared/core` keeps only DOM-free contracts (`types`, `vec2`, `math`, `rng`, `events`, `enums`, `constants`, `defs`, `MapData`, `IWorld`, `ILevelRuntime`, `IGameState`). **This is a change to the frozen `ARCHITECTURE.md` core contract (decision #5) and must be ratified there before the online phase starts** ([deploy §11]). |
| B7 | **Single-player walkover/door predicate** — `updateDoors`/`checkWalkoverTriggers` are driven by a single player cell (`session.ts:~260`) | Iterate **all** players for door/lift/teleporter walkover triggers. `walkoverOccupancy` is already id-keyed, so once players have ids this is a loop change. |

Two derived refactors that prediction depends on (from [netcode §5.2]):

- Extract the player-movement portion of `tic()` (turn + thrust + `stepMovement` +
  `tryUse` + weapon intent) into a **pure** `applyPlayerCommand(world, playerId, cmd,
  level, T)` reusable by client prediction/replay **and** the server authority.
  Everything else in `tic()` (AI, projectiles, doors, items, monster damage) is
  **server-only**.
- Server owns the **only `Rng` instance** (`src/core/rng.ts`, Mulberry32, seeded);
  reseed per level. Clients never call combat/AI RNG. This sidesteps the shared-stream
  determinism hazard in [netcode §2.4].

### 1.3 Tick / snapshot rates

Use the rates settled in [netcode §4.5]: client input send 30–60Hz (1 per fixed step);
**server sim 30Hz**; **snapshot broadcast 15–20Hz** (Colyseus `setSimulationInterval` vs
`setPatchRate`); client renders at display refresh, interpolating remotes ~100ms in the
past. Keep `FIXED_STEP`/`TICS_PER_STEP` (`session.ts:42`) identical client/server so
prediction replay uses the same math.

---

## 2. Repo restructure — monorepo (shared sim / client / server)

Adopt the npm-workspaces monorepo from [deploy §2] verbatim; summarized here so the phasing
in §6 references concrete targets. **Do not** introduce pnpm/turbo/nx ([deploy §2.2]).

```
doom-ts/
├── package.json            # { "private": true, "workspaces": ["packages/*"] }
├── tsconfig.base.json      # today's strict options
└── packages/
    ├── shared/   @doom/shared  — THE SIM, runs on Node AND browser
    │   └── src/{core, data, world, combat, ai, entities, weapons, items, net}
    │       core/ = DOM-free contracts only (B6); net/ = NEW shared message + Schema types
    ├── client/  @doom/client  — existing Vite app
    │   └── src/{render, audio, input, ui, game, main.ts}  + core/{render,audio,input}.ts (the DOM interfaces moved out of shared)
    └── server/  @doom/server  — authoritative Colyseus/Node server
        └── src/{index.ts, room.ts(=match), lobby.ts, net/, headless-context.ts}
```

What moves where (maps onto the [netcode §5.5] server/client table):

- **To `shared/`:** `core` (DOM-free parts), `data`, `world`, `combat`, `ai`, `entities`,
  `weapons` (cooldown/ammo logic), `items`. These are the authoritative sim, imported by
  both client (for prediction) and server (as authority).
- **Stays client-only:** `render`, `audio`, `input`, `ui`, the canvas half of
  `game/session.ts`, `main.ts`.
- **New `server/`:** the Colyseus `Room` wrapping a headless `GameSession`, the lobby
  metadata, the authoritative loop, mode rules, lag-comp ring buffer.
- **New `shared/net/`:** the message/event types and Colyseus `@type` Schema classes that
  client and server agree on (room lifecycle messages from §3.4, `TicCommand` wire form,
  snapshot Schema).
- **The split (B6):** `core/render.ts`, `core/audio.ts`, `core/input.ts` relocate to the
  client package.

Mechanics (symlinking, Vite consuming `@doom/shared`, server via `tsx`/`tsc`, TS project
references): [deploy §2.1].

---

## 3. LOBBY / ROOM SYSTEM (the user's specific ask — full spec)

This is the new requirement. It sits **in front of** the netcode: a player must be able to
host a room, others join by code/IP, everyone sees the roster + ready state, the host
configures the match, and the match starts only when everyone is ready. The lobby is pure
selection + lifecycle + config; the *rules* it selects (FF, monsters, scoring) are
implemented in `shared/combat` per §4 and [netcode §7].

### 3.1 Where the lobby lives in the app's state machine

The existing client state machine (`src/game/states.ts`) is
`BOOT→LOADING→TITLE→MENU→PLAYING⇄PAUSED→INTERMISSION→VICTORY/GAMEOVER`. We add an **online
branch** off `MENU` and a set of lobby states. The single-player path is untouched.

```
TITLE → MENU ──"MULTIPLAYER"──▶ MP_CONNECT
                                  │ host? ─────▶ MP_LOBBY(host)   ─┐
                                  │ join? ─────▶ MP_JOIN → MP_LOBBY(client) ─┤
                                                                              │ all ready + host start
                                                                              ▼
                                            PLAYING(networked) ◀── MP_LOADING (server seeds match)
                                                  │ match end
                                                  ▼
                                            MP_POSTMATCH (scoreboard) ──▶ back to MP_LOBBY (rematch) or TITLE
```

New `GameStateId`s: `mpConnect`, `mpJoin`, `mpLobby`, `mpLoading`, `mpPostmatch`.
`PLAYING` is reused but in a **networked** sub-mode (renders from snapshots + predicts).

### 3.2 The LOBBY/ROOM state machine (authoritative, server-side)

The **room's** lifecycle is the authority; client lobby screens are a view of it. Mirrors
[deploy §4.1] `status` field, expanded for ready-up:

```
            create room
   (none) ───────────────▶  HOSTING
                              │  host present, 1 player, no others yet
                              ▼
   player joins / leaves   WAITING_FOR_PLAYERS  ◀──────┐ (someone un-readies,
   ready toggles            │  ≥1 player, NOT all ready │  or a new player joins)
                            ▼                           │
                          ALL_READY ───────────────────┘
                            │  every connected player ready==true
                            │  host presses START
                            ▼
                          IN_MATCH   (sim ticking; snapshots broadcast)
                            │  win condition met (frag/time limit, co-op exit→last level, team wipe)
                            ▼
                          POST_MATCH (scoreboard; host may "rematch" → WAITING_FOR_PLAYERS, or close room)
```

Transition rules (server-enforced — clients never decide these; [netcode §8]):

- **create** → `HOSTING`. Host is auto-added as player 0, `ready=false`, `isHost=true`.
- Any **join** while `status ∈ {HOSTING, WAITING_FOR_PLAYERS, ALL_READY}` and
  `players.size < maxPlayers` → add player (`ready=false`), recompute status. A join while
  `IN_MATCH` → reject *or* (config option) join as spectator / late-join at a spawn (DM
  only). Default: reject with "match in progress."
- **leave / disconnect** → remove player (grace period for reconnect, [deploy §4.1]); if
  the **host** leaves → migrate host to the oldest remaining player *or* (simpler, matches
  [netcode §4.2] "host drops, match ends") close the room. **Open decision D1.**
- **ready toggle** → flip that player's `ready`; recompute: all-ready ⇒ `ALL_READY`, else
  `WAITING_FOR_PLAYERS`. Host's own ready is implicit-or-explicit (D2 below).
- **config change** (host only) → mutate room config, broadcast, and **reset every
  player's `ready` to false** (so nobody "readies" a config they didn't see), drop to
  `WAITING_FOR_PLAYERS`.
- **start** (host only, only in `ALL_READY`) → `IN_MATCH`: server seeds the sim from config
  (§3.6), spawns players, begins broadcasting snapshots.
- **win condition** (mode-specific, §4) → `POST_MATCH`.

### 3.3 Lobby UI screens (client)

Built by **extending the existing `Menus` controller** (`src/ui/menus.ts`) — same
page-stack + `MenuItem`/`MenuCommand` pattern, same `drawText`/`HUD_FONT` rendering, same
`readMenuInput` navigation. New `PageId`s and `MenuCommand` variants are added; nothing in
the existing menu rendering changes. The lobby screens are **driven by room state pushed
from the server**, so they re-`draw()` whenever a roster/config/ready update arrives.

Screens:

1. **Multiplayer entry (`MP_CONNECT`)** — added to the main menu as a new `MULTIPLAYER`
   item alongside `NEW GAME`. Options: `HOST GAME`, `JOIN GAME`, `BACK`.
2. **Host create** — host picks the initial config (a config panel, see 3.5) and confirms;
   client sends `createRoom` (§3.4); on ack it shows the **room code** + the shareable
   join target (`wss://<host>/  code: QUAKE` or the bare URL for the default-room path,
   [deploy §6.3]). Transitions to the lobby screen as host.
3. **Join (`MP_JOIN`)** — a text field for **room code** and/or **host address**
   (`host:port` or the sslip.io URL). For the simplest UX we also support the [deploy §4.2]
   **default-room** path: opening the host URL with no code auto-joins room `DEFAULT`.
   Sends `joinRoom`; on reject shows the reason (full / not found / already started).
4. **Lobby room (`MP_LOBBY`)** — the core screen. Three regions:
   - **Player list:** one row per player — name, a colored marine swatch (DM team color),
     `[HOST]` tag, and a **READY / NOT READY** indicator. Updates live from roster
     broadcasts.
   - **Ready toggle:** the local player toggles their own ready (a key / menu row). Host
     sees a **START** action that is **disabled until `ALL_READY`**.
   - **Config panel:** the match parameters (3.5). **Editable by the host only**;
     non-host players see them **read-only** (greyed, no `onLeft`/`onRight`). Any host edit
     re-broadcasts and clears everyone's ready (3.2).
5. **Loading (`MP_LOADING`)** — shown while the server seeds the match and sends the first
   snapshot; flips to networked `PLAYING`.
6. **Post-match (`MP_POSTMATCH`)** — scoreboard (co-op: kills/items/secrets tally, reusing
   `Intermission`; DM: frag table). Host options: `REMATCH` (→ lobby) or `CLOSE ROOM`
   (→ title). Non-host: `READY UP AGAIN` / `LEAVE`.

New `MenuCommand` variants to add (the state machine in §3.1 acts on them, exactly as
`startGame`/`resume` work today): `mpHost`, `mpJoin{code,addr}`, `mpToggleReady`,
`mpConfigChange{field,value}`, `mpStart`, `mpLeave`, `mpRematch`.

### 3.4 Client ↔ server messages / events (room lifecycle)

Defined in `shared/net/`. With Colyseus these are: **room creation/joining via the
matchmaking API + `LobbyRoom`**, **client→room messages via `room.send(type, payload)`**,
and **server→client state via the synced Schema + `room.onMessage`** for one-shot events.
Listed transport-neutrally so the hand-rolled `ws` fallback (D0) uses the same names.

Client → server:

| Message | Payload | When | Server effect |
|---------|---------|------|---------------|
| `createRoom` | `{config: MatchConfig, name, color}` | host create | new Room, host added, returns `{roomCode}` |
| `joinRoom` | `{roomCode \| addr, name, color}` | join screen | validate code + capacity + status; add player; broadcast roster; or reject `{reason}` |
| `leaveRoom` | `{}` | leave / back | remove player; recompute status; maybe migrate/close (D1) |
| `setReady` | `{ready: boolean}` | ready toggle | flip player ready; recompute `ALL_READY`/`WAITING` |
| `setConfig` | `{partial MatchConfig}` | host edits config | host-only guard; merge; clear all ready; rebroadcast |
| `startMatch` | `{}` | host start | host-only + `ALL_READY` guard; seed sim (§3.6); → `IN_MATCH` |
| `rematch` | `{}` | post-match | host-only; reset sim/scores; → `WAITING_FOR_PLAYERS` |

Server → client (lifecycle; gameplay snapshots/events are [netcode §4]):

| Message / state field | Payload | Meaning |
|-----------------------|---------|---------|
| `roomState` (synced Schema) | `{status, code, config, players[]}` | the whole lobby view; drives the UI. `players[]` = `{id, name, color, ready, isHost}` |
| `joinAccepted` | `{yourPlayerId, roomState}` | join ok; client learns its **server-assigned id** (B3) |
| `joinRejected` | `{reason}` | full / not found / already started |
| `playerJoined`/`playerLeft` | `{id, name}` | roster deltas (also reflected in synced state) — also used in-match for avatar spawn/despawn ([netcode §6]) |
| `matchStarting` | `{config, seed, levelId}` | clients preload the level, go to `MP_LOADING` |
| `matchEnded` | `{results}` | → `POST_MATCH` scoreboard |

Colyseus mapping ([netcode §9.1], [deploy §3]): one **Colyseus `Room` subclass == one
match**; its `onCreate` reads `MatchConfig`, `onJoin`/`onLeave` manage the roster,
`onMessage("setReady"|"setConfig"|"startMatch"|…)` handle the table above, and the room's
synced **Schema state** *is* `roomState` — Colyseus delta-broadcasts it automatically. The
optional room **listing** (browse open rooms) uses Colyseus `LobbyRoom` ([deploy §4.2.4]).

### 3.5 The host config — `MatchConfig`

The host configures these before start; non-host players see them read-only. This is the
struct the lobby carries and that seeds the match (§3.6).

```ts
interface MatchConfig {
  mode: 'coop' | 'deathmatch';
  skill: SkillId;            // 1..5 — feeds the existing SKILLS table
  episode: number;           // index into available episodes (EPISODE1 today)
  startLevel: number;        // level index within the episode
  maxPlayers: number;        // coop default 4, dm default 8 (per-room, [deploy §4.4])
  // mode-specific:
  fragLimit?: number;        // deathmatch — first to N frags wins (e.g. 20); 0 = no limit
  timeLimit?: number;        // deathmatch — minutes; 0 = no limit
  itemRespawn?: boolean;     // deathmatch — pickups respawn
  coopRespawn?: 'levelStart' | 'waitForRevive' | 'partyWipe';  // co-op death rule (D3)
}
```

UI representation in the config panel (reusing the `Menus` value-row pattern with
`onLeft`/`onRight`, exactly like the existing volume/resolution rows):

- `MODE`  ◀ CO-OP / DEATHMATCH ▶  — switching mode shows/hides the mode-specific rows.
- `SKILL` ◀ I'm Too Young To Die … Nightmare! ▶ (the 5 `SKILLS[].name` strings).
- `EPISODE` / `LEVEL` ◀ ▶ (today only `EPISODE1`; list grows with content).
- `MAX PLAYERS` ◀ 2 … 8 ▶.
- DM only: `FRAG LIMIT`, `TIME LIMIT`, `ITEM RESPAWN`.
- Co-op only: `DEATH RULE` (D3).

### 3.6 How the config seeds the authoritative match

When the host starts, the server constructs the sim from `MatchConfig`. This reuses the
existing single-player seeding path almost verbatim:

- **skill →** set `ctx.skill = config.skill` (today `startNewGame(skill)` does exactly this
  at `session.ts:148-149`). The existing `SKILLS` table (`src/data/skills.ts`) then drives
  `loadLevel(world, data, ctx.skill, events)` (`session.ts:164`), `thingSpawnsAtSkill`
  monster filtering (`session.ts:456`), `damageTaken`, `ammoMultiplier`, `fastMonsters`,
  `respawn`. **No new difficulty code** — skill flows through the existing system.
- **episode/startLevel →** `startLevel(EPISODE[episode].levels[startLevel].id)` instead of
  the hardcoded `EPISODE1.levels[0]`.
- **mode →** construct the `GameMode` rule object ([netcode §7]) and hand it to the sim:
  - `coop`: `friendlyFire=false`, `spawnMonsters=true` (level's monsters),
    `sharedProgression=true`, scoring=kills, spawns = `playerStart` cluster.
  - `deathmatch`: `friendlyFire=true`, `spawnMonsters=false` (or few — D4), scoring=frags,
    spawns = DM spawn-point list, respawn-on-death after a delay.
  The mode object is injected where rules branch: the `applyDamage` FF gate
  (`src/combat/resolve.ts`, via the existing `Faction`/`sourceFaction` plumbing,
  [netcode §2.5, §7]), the death handler, spawn selection, and win condition. **The sim is
  not forked** ([netcode §7]).
- **seed →** server picks a level RNG seed and includes it in `matchStarting` so any
  cosmetic client-side replay matches; the authoritative RNG lives server-side ([netcode
  §4.7]).
- **players →** `allocId()` each connected player server-side (B3), `createPlayer(id, …)`
  at the chosen spawn, populate `world.players` (B1).

---

## 4. Co-op vs PvP Deathmatch — rules

Both modes run the **same authoritative sim**, differing only in a tiny injected
`GameMode` rule set. Full design in [netcode §7]; the table below is the implementation
contract this plan commits to.

| Aspect | **Co-op** | **Deathmatch** |
|--------|-----------|----------------|
| Friendly fire | **OFF** — `applyDamage` rejects player→player (`canDamage` false) | **ON** — players damage each other |
| Monsters | shared level monsters, server-simmed; AI targets nearest visible player (B1) | none by default (D4) |
| Spawns | `playerStart` cluster (+ co-op extra starts) | dedicated **DM spawn-point list** — new `MapData.deathmatchStarts` field + extractor support ([netcode §7]); pick farthest from other players; telefrag-or-repick (D5) |
| Death | per `coopRespawn` rule (D3): respawn at level start / wait-for-revive / party-wipe = game over | respawn after ~1–2s delay at a DM spawn point |
| Win / progress | shared exit (`LevelRuntime.pendingExit`) advances the whole room to the next level; finishing the episode → victory; team wipe (if D3=party-wipe) → game over | first to `fragLimit`, or highest frags at `timeLimit` → winner → `POST_MATCH` |
| Scoring | existing kills/items/secrets counters (`session.ts:97-103`); intermission tally reused | **new per-player frag counter** in room state, shown on a scoreboard UI + post-match |

**Player avatars + nametags (both modes)** — from [netcode §6], summarized:

- Reuse Freedoom **`PLAY`** sprite set (the marine) — add `PLAY` to the extractor roster
  (`tools/extract-wad/lib/roster.ts`) + manifest. A remote player is just another billboard
  in the existing 8-rotation sprite system (`render/sprites.ts`), rotation chosen from
  `cameraAngle → playerAngle`. Walk `PLAYA–D`, pain `PLAYG`, death `PLAYH–N`.
- **Sync intent/state, not frame indices**: send `{moving, firing, pain, dead}` + position
  + angle in the snapshot; each client drives its own animation clock. Loss-tolerant.
- **Nametags:** short text label above the avatar's projected top, depth-faded; name comes
  from the reliable `playerJoined` message (id → name, color).
- **DM team color:** per-player color index in the snapshot remaps the `PLAY` green ramp
  (DOOM translation table) so frags are legible.

---

## 5. Deploy summary

Hosting is fully specified in **[deploy]** — this plan does not change it; it only notes
that picking Colyseus (§0) means the long-lived Node process behind Caddy *is* the Colyseus
server instead of a bare `ws` server. Everything else holds:

- **Host:** Hetzner CX23 Ubuntu LTS (or DigitalOcean), public IPv4 ([deploy §6.2]).
- **Topology:** **Caddy** reverse-proxy on 80/443 serving the static Vite client from
  `dist/` and proxying `wss://…/ws` → the Node (Colyseus) port on `:8080` (never exposed),
  with **automatic TLS** ([deploy §5.2, §5.4]). Caddy must also re-send the COOP/COEP
  headers ([deploy §5.5]).
- **Join by IP:** the clean path is a free hostname mapping to the IP —
  `<dashed-ip>.sslip.io` — so Caddy gets a real cert and the browser allows `wss://` +
  secure context ([deploy §6.3 variant B]). The raw-IP plain-HTTP `ws://` path ([variant
  A]) stays as the 5-minute smoke test.
- **Process mgmt:** systemd unit (or pm2 for zero-downtime reloads); **single instance** —
  in-memory rooms, do not cluster without Redis ([deploy §7]).
- **Security:** non-root user, SSH keys, UFW 22/80/443 only, fail2ban, per-room player cap,
  validate every inbound message, rate-limit ([deploy §8]).
- **Runbook:** the exact provision → firewall → ship → systemd → Caddy → connect steps are
  in [deploy §10]. With Colyseus, `npm run -w @doom/server build` builds the Colyseus app;
  the rest is unchanged.

---

## 6. Phased implementation plan

Each phase is independently testable. Build the netcode **behind a `NetTransport` seam from
day one** ([netcode §3.3]) so the Colyseus→geckos/WebRTC option stays open. This expands
[netcode §10] with the monorepo phase (P0), an explicit lobby phase (the user's ask, P3b),
and per-phase acceptance.

**P0 — Monorepo + shared + DOM split (no networking).** *~M (mechanical but wide).*
- Convert to npm workspaces; create `shared`/`client`/`server` packages (§2).
- Split DOM types out of `core` (B6) — **ratify the `ARCHITECTURE.md` core-contract change
  first**.
- Headless-ize `GameSession`: `presentation` flag (B5); fold mouse-yaw into `TicCommand`
  + add `seq` (B4); extract `applyPlayerCommand` (§1.2).
- ✅ *Accept:* SP game still runs unchanged from `client`; a Node script in `server` runs
  one full level headless with null Renderer/Audio/Input, same seed → same end-state
  checksum.

**P1 — Multi-player state, single process.** *~M.*
- `world.player` → `world.players` map (B1); update all readers; server-only `allocId`
  (B3); iterate players in doors/walkover/AI-targeting (B7).
- ✅ *Accept:* two scripted command streams drive two players in one headless sim; they
  move/collide/shoot monsters; **no `world.player` references remain**.

**P2 — Transport + authoritative server + room skeleton (co-op, no prediction).** *~L.*
- Stand up the Colyseus server; one Room == one match running the headless sim at 30Hz;
  client sends `TicCommand`s, server broadcasts full snapshots at 20Hz; client renders
  remotes (interpolated) **and its own player from snapshots** (laggy but correct).
- `NetTransport` seam in `shared/net`; `PLAY` avatar sprite + nametags ([netcode §6]).
- Minimal room: hardcoded single default room, fixed co-op config (no lobby UI yet).
- ✅ *Accept:* two browsers on a LAN join one room, see each other move and fight shared
  monsters. (Movement feels laggy — expected.)

**P3a — Prediction + reconciliation + interpolation polish.** *~L.*
- Predict local player via `applyPlayerCommand`; reconcile on snapshot via
  `lastProcessedInput`; tune remote interp buffer (~100ms); delta-encode snapshots
  (Colyseus Schema). ([netcode §4.3, §4.4, §4.6].)
- ✅ *Accept:* local movement feels instant; remotes smooth; 100ms induced latency
  (devtools throttle) stays playable.

**P3b — Full lobby / ready-up / host-config (the user's ask).** *~L.*
- Implement the §3 lobby: state machine (3.2), the `MP_*` client states (3.1), the lobby
  UI screens extending `Menus` (3.3), the room-lifecycle messages (3.4), `MatchConfig`
  (3.5), and config→match seeding (3.6). Host create + join-by-code/IP + player list +
  ready toggles + host config panel + start-when-all-ready.
- ✅ *Accept:* a host creates a room, shares a code; ≥1 friend joins and appears in the
  roster; both toggle ready; host's START unlocks only when all ready; host changes
  difficulty/mode and it clears everyone's ready and shows on non-host screens; pressing
  START seeds the chosen skill+mode+level and drops everyone into the match.

**P4 — Co-op complete.** *~M.*
- Co-op rules wired through `GameMode`: FF off, shared monsters/progression, the co-op
  death rule (D3), shared exit advances the room, intermission tally as scoreboard.
- ✅ *Accept:* a full co-op level: friendly fire off, monsters shared, exit advances all
  players to the next level, deaths follow the chosen rule.

**P5 — PvP Deathmatch + the `GameMode` abstraction complete.** *~M–L.*
- DM rules: FF on, `MapData.deathmatchStarts` + extractor support, spawn selection +
  telefrag/repick (D5), respawn-on-death, **frag scoring** in room state + scoreboard UI,
  frag/time limit → `POST_MATCH`. Hitscan **lag compensation** ([netcode §5.6]) lands here
  (server position ring-buffer + rewind around `hitscan`/`autoaimTarget`, capped) since DM
  is where competitive hit-registration matters.
- ✅ *Accept:* DM room: FF on, frags counted + scoreboard, respawns work, frag/time limit
  ends the match to a post-match screen; shooting a moving remote registers where the
  shooter saw them under simulated latency; co-op still FF-off.

**P6 — Deploy + hardening.** *~M.*
- Reliable channel for must-arrive events (death/pickup/exit/frag/chat); command
  rate-limit + validation/clamping ([netcode §8]); reconnection grace; the [deploy §10]
  runbook on the user's Hetzner box with Caddy + sslip.io + `wss`.
- ✅ *Accept:* a friend connects over the internet by IP/host over `wss` and plays a full
  co-op level **and** a DM round.

Rough order/effort: **P0→P1** are prerequisite refactors (do not skip — they're the
blocker fixes); **P2→P3a** are the netcode core; **P3b** is the user's lobby ask and can be
built in parallel with P3a once P2's room skeleton exists; **P4/P5** are the two modes;
**P6** ships it. Optional later: geckos.io/WebRTC transport swap if latency telemetry
warrants ([netcode §10 P6], [deploy §1.3]).

---

## 7. Open design decisions to confirm (flagged for the user)

| # | Decision | Options | This plan's default |
|---|----------|---------|---------------------|
| **D0** | Transport library | Colyseus vs raw `ws` (hand-rolled lobby) | **Colyseus** (§0) — best fit for the lobby/room ask |
| **D1** | Host leaves the room | migrate host to oldest player vs close the room/end match | close room (simplest; matches [netcode §4.2]) |
| **D2** | Host's own ready state | host implicitly ready (just presses START) vs host must ready like everyone | host implicitly ready; START is the host's "ready+go" |
| **D3** | Co-op death rule | respawn at level start / wait-for-revive / party-wipe = game over ([netcode §11]) | respawn at level start (configurable in `MatchConfig`) |
| **D4** | DM monster policy | no monsters vs a few for item/hazard flavor ([netcode §11]) | none by default; config toggle later |
| **D5** | DM spawn collision | telefrag the occupant (classic DOOM) vs re-pick a free spawn ([netcode §11]) | telefrag (classic feel) |
| **D6** | Join-by-IP UX | room codes (multi-room) vs single auto-join default room ([deploy §4.2]) | support both: codes for multi-room, default-room for "just send the URL" |
| **D7** | Late join during a match | reject vs spectator vs DM late-spawn | reject by default (D-configurable) |
| **D8** | Colyseus Schema duplication cost | accept the `@type` mirror vs hand-rolled binary snapshots ([netcode §11], [deploy §11]) | accept; revisit after P2 once snapshot size is measured |

Also pending and **not** a lobby concern but gating P0: ratifying the **`core` DOM-split**
as a change to the frozen `ARCHITECTURE.md` contract (B6, [deploy §2.3, §11]).

---

## 8. Cross-reference index

- Transport, server-authority, prediction/reconciliation/interpolation, lag-comp, blockers,
  game-mode rules, libraries, avatars → **`docs/research/multiplayer-netcode.md`**.
- Monorepo layout, DOM-split prerequisite, `ws`/Colyseus/Caddy, Hetzner, sslip.io/`wss`,
  systemd, security, deploy runbook → **`docs/research/multiplayer-deploy.md`**.
- This doc adds: the transport decision (§0), the consolidated blocker→fix table (§1.2),
  and the full **lobby/room system** (§3) the user asked for.
