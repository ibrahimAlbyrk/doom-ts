# Multiplayer Netcode — DOOM-TS Online Co-op + Deathmatch

> Scope: how to turn the single-player Canvas-2D raycaster into a **real-time online
> multiplayer** game for a handful of friends, self-hosted, connecting by IP. Covers
> transport, netcode architecture, retrofitting *our* engine, player representation,
> game modes, anti-cheat, libraries, and a phased plan.
>
> **Research only.** No implementation code lives here. File/line references point at
> the current trunk (post-merge of `eos-trunk-integrate-r1`). Where a claim came from
> the web it is cited inline; see [§12 Sources](#12-sources).
>
> Companion docs: `web-arch.md` (app shape / loop), `engine.md` (render math),
> `doom-design.md` (stats), `ARCHITECTURE.md` (frozen contract).

---

## 0. TL;DR — primary recommendation

For this project (small scale, self-hosted, host-by-IP, friends, simplicity-first):

| Decision | Recommendation | One-line why |
|----------|---------------|--------------|
| **Architecture** | **Server-authoritative** fixed-tick sim; client prediction for the local player; entity interpolation for remotes; server-side lag compensation for hitscan. | The only model that gives anti-cheat, deterministic co-op, and fair DM at once. |
| **Transport** | **WebSocket over TLS (`wss://`)** for v1, behind a thin swappable transport interface. | Trivial to host (one TCP port + reverse proxy), works everywhere, "good enough" at this scale. Upgrade path to WebRTC/UDP if latency bites. |
| **Library** | **Colyseus** (authoritative Node/TS framework: rooms, matchmaking, binary delta state sync). | Collapses the rooms + serialization + lobby boilerplate; rooms map 1:1 onto co-op/DM game sessions; same language as the client. |
| **Latency upgrade** | **geckos.io** (WebRTC DataChannel, unreliable UDP) if TCP head-of-line blocking hurts. | Keep prediction/interp/lag-comp transport-agnostic so this is a transport swap, not a rewrite. |

**The single most important codebase fact:** `GameSession.tic(cmd: TicCommand): TicResult`
(`src/game/session.ts`) is already a clean, canvas-free, deterministic simulation step
driven by a serializable command struct. That is our replication seam. The retrofit is
mostly "run `tic()` on the server, feed it one `TicCommand` per player per tick, broadcast
the resulting world state" — plus removing three single-player assumptions (§5).

---

## 1. What we are building (requirements)

From the project goal (see memory `online-multiplayer-plan`):

- **Self-hosted**, friends connect by IP. No central matchmaker, no relay infra.
- **See each other in-game**: remote players rendered as avatar sprites with name tags.
- **Co-op mode**: friendly fire **OFF**, shared monsters + level + progression.
- **PvP Deathmatch mode**: friendly fire **ON**, frag scoring, respawns, arena spawn
  points, few/no monsters.
- **Small scale**: 2–8 players. This relaxes nearly every scaling concern (no sharding,
  no interest management beyond a level, no 64-player snapshot budgets).

Non-goals (explicitly out): dedicated cloud infra, ranked matchmaking, mobile, rollback
fighting-game netcode, P2P mesh, spectators.

---

## 2. Our engine today — the netcode-relevant shape

Grounded in a read of `src/`. This determines everything downstream.

### 2.1 The simulation seam already exists

`src/game/session.ts`:

```ts
export interface TicCommand {
  forward: number; strafe: number; turn: number; run: boolean;
  fire: boolean; use: boolean; weaponSlot: number; weaponCycle: number; pause: boolean;
}
export type TicResult = 'continue' | 'exit' | 'dead';

class GameSession {
  readCommand(): TicCommand          // reads Input service; builds the command
  tic(cmd: TicCommand): TicResult    // THE deterministic sim step — no canvas access
  renderWorld(ctx2d, alpha): void    // the ONLY canvas consumer
}
```

`tic()` runs a fixed canonical order (session.ts ~224–282): turn + thrust + `stepMovement`
→ `tryUse` → fire / weapon-switch → `weapons.update(T)` → `ai.update(T)` →
`updateProjectiles` → `updateDoors` + `checkWalkoverTriggers` → `updateItems` → bookkeeping
(hud, clock, bob, flash). It is pure-ish over `(world, rng, level, cmd)`.

**Two leaks** make `tic()` not yet fully headless/deterministic-per-input:
1. It calls `this.hud.update()` and emits `'sfx'` events mid-step (presentation coupled to
   sim). Both must be made no-ops / decoupled on a server build.
2. Mouse-look yaw is applied to `world.player.angle` **inside `readCommand()`**, *outside*
   the command (session.ts ~202–205), using a per-frame mouse delta that is never part of
   `TicCommand`. For networking, **turn-from-mouse must be folded into `TicCommand.turn`**
   so the command fully describes a tick's input.

### 2.2 The loop and tick rate

`src/game/game.ts` runs a fixed-timestep accumulator (web-arch.md §2):

```
accumulator += clamp(dt, 0, 0.25)
while (accumulator >= FIXED_STEP) {
  input.beginTick(); state.update(FIXED_STEP); input.flush();
  accumulator -= FIXED_STEP;
}
render(ctx2d, accumulator / FIXED_STEP)   // alpha = render interpolation
```

Tick rate is **layered** (important and slightly confusing):
- `FIXED_STEP = 1/60` (`src/core/constants.ts`) — wall-clock step the loop runs at.
- `TIC_RATE = 35`, `SECONDS_PER_TIC = 1/35` — DOOM's *logical* tic unit.
- `TICS_PER_STEP = FIXED_STEP / SECONDS_PER_TIC ≈ 0.583` — every system takes a fractional
  `tics` count `T` and scales by it.

So the sim advances at **60 fixed steps/sec, each worth ~0.583 DOOM tics**. The "~35Hz"
in the directive is the *logical* rate; the *step* rate is 60Hz. Input edges are latched
per fixed step (`beginTick`/`flush`) — exactly the granularity netcode wants.

**Implication for netcode:** we should pick a **network tick rate** independent of both.
Recommended **server sim tick = 30Hz** (every other 60Hz step, or run the server loop at
30Hz directly) and **snapshot/broadcast rate = ~20Hz**. See §4.5.

### 2.3 State is plain serializable data

`src/core/types.ts` — entity structs are pure data, no methods, no DOM refs (great for
snapshots):

- `Entity { id, x, y, angle, radius, active }`
- `Player { …Entity, velX, velY, health, armor, inventory, currentWeapon, pendingWeapon,
  weaponCooldown, bob, powerups }`
- `Monster { …Entity, type, health, state, stateTimer, reactionTime, target, velX, velY,
  flinchImmune }`
- `Projectile { …Entity, velX, velY, damage, speed, ownerId, ownerFaction, splashRadius, sprite }`
- `Pickup { …Entity, thingId, kind, respawns }`

`IWorld` = `{ player, monsters[], projectiles[], pickups[], level, skill, allocId(),
removeMonster/Projectile/Pickup(id), reset() }` (`src/entities/world.ts`).

Three structural facts:
- **`world.player` is singular.** This is the #1 blocker — MP needs N players.
- **Removal is swap-pop** (O(1), unordered). So array *index is not stable* → all
  replication must be **keyed by `id`**, never by array position.
- **`allocId()` is a monotonic counter** (`nextId++`). Entity-id allocation must become
  **host-authoritative** so ids match across machines.

### 2.4 Determinism primitives

`src/core/rng.ts` — `Rng` is **Mulberry32, seeded, reseedable**, `DEFAULT_SEED = 0x1d00d`.
Single mutable `state`. Methods `next()/int()/range()/p()/chance256()`.

This is *almost* lockstep-ready, with one sharp edge: it is **one shared stream** consumed
in a fixed order across weapons → AI → projectiles → combat within `tic()`. Any divergence
in call count/order between machines desyncs. Notably, **AI consumes RNG for cosmetic
audio** (`rng.chance256(3)` active-sound grunt; sight-sound `rng.int`, `src/ai/monster-ai.ts`),
which still advances the shared stream. For a deterministic server we either (a) keep cosmetic
draws on the server too (the server owns the stream, clients just render snapshots → fine),
or (b) move cosmetics off the netcode RNG. With server-authoritative + snapshots (our pick),
**only the server runs RNG**, so this is a non-issue; it only matters if we ever attempt
deterministic lockstep (§4.2).

### 2.5 Single-player assumptions to remove

- `src/world/level-runtime.ts`: `walkoverOccupancy` is keyed by entity id (OK once players
  have ids) but `updateDoors` is called with a **single player-cell predicate**
  (session.ts ~260). Door/lift/teleporter walkover triggers must consider *all* players.
- `src/combat/*`: damage choke point is `applyDamage(world, target, amount, sourceId,
  sourceFaction, rng, events?, origin?)` (`src/combat/resolve.ts`). `hitscan(...)` and
  `radiusDamage(...)` route through it. **Faction already exists** (`ownerFaction: Faction`,
  `sourceFaction`) — this is exactly the hook for friendly-fire on/off (§8). Today there's
  one player faction; co-op needs "players don't hurt players," DM needs "they do."

---

## 3. Transport: WebSocket vs WebRTC DataChannel

Browsers give a real-time game three realistic transports. (Raw UDP is **not** available
to browser JS — this constraint drives everything.)

### 3.1 The options

| | **WebSocket** | **WebRTC DataChannel** | **WebTransport** |
|---|---|---|---|
| Underlying | TCP | SCTP over DTLS over UDP | HTTP/3 (QUIC/UDP) |
| Reliability | reliable, ordered (only) | **configurable**: reliable/unreliable, ordered/unordered | configurable (datagrams + streams) |
| Head-of-line blocking | **yes** (TCP) — a lost packet stalls everything behind it | **no** in unreliable/unordered mode | no |
| Latency under loss | degrades; at ~15% loss TCP suffers badly ([rune.ai], [websocket.org]) | best; lost packets just skipped | best |
| NAT traversal | none needed (client→server TCP) | **needs STUN** (+ TURN as fallback); ICE negotiation | none needed (client→server) |
| Server port model | one TCP port (e.g. 443 behind proxy) | signaling TCP port **+ a wide UDP range** (geckos: `1025–65535/udp`) ([geckos README]) | one UDP/443 |
| TLS | `wss://` (required on HTTPS pages) | DTLS mandatory (encrypted by spec) | TLS mandatory |
| Browser support (2026) | universal | universal | Chrome/Edge/Firefox; **Safari lagging** |
| Setup complexity | **trivial** | high (signaling + ICE + STUN/TURN + UDP firewall) | medium, but Safari gap |

### 3.2 TLS / `wss` reality

A page served over HTTPS **cannot** open an insecure `ws://` or unencrypted connection —
browsers block mixed content. So any production deployment needs:
- **WebSocket:** terminate `wss://` at a reverse proxy (Caddy/nginx/Traefik) with a cert,
  proxy to the Node server. Friends hit `wss://your-host`.
- **WebRTC:** DTLS is mandatory and automatic, but the **signaling** channel (how peers
  exchange SDP/ICE) is itself usually a WebSocket/HTTPS endpoint that needs TLS. geckos.io
  uses a TCP signaling port (default `9208`) for this.

For pure host-by-IP with friends, the simplest secure path is WebSocket + a reverse proxy
with a Let's Encrypt cert (or a self-signed cert friends trust once). Self-signed +
host-by-raw-IP is the friction point either way.

### 3.3 Why WebSocket is the right v1 choice *here*

The textbook answer for a "real-time FPS" is "UDP, always" — and for a 64-player
competitive twitch shooter it is. But for **this** project:

- **Scale is tiny** (2–8 friends), so per-message bandwidth and server fan-out are trivial.
- **The game is a grid raycaster**, not a 250Hz competitive arena. Hit detection is
  server-side and lag-compensated regardless of transport.
- **TCP head-of-line blocking only bites under packet loss.** On the LAN/decent-broadband
  connections friends actually use, loss is low and TCP's penalty is small. With small
  delta snapshots at ~20Hz, a stalled packet costs at most one extra RTT of staleness,
  which interpolation already hides.
- **Deployment is one port + a proxy** vs. WebRTC's signaling + ICE + STUN/TURN + a
  65k-port UDP firewall rule. For self-hosting friends, that complexity is the actual
  project risk, not 20ms of latency.
- **Debuggability:** WebSocket frames are inspectable in DevTools; WebRTC is opaque.

> **Decision:** Build the netcode layer (commands, snapshots, prediction, interpolation,
> lag-comp) **transport-agnostic** behind a `NetTransport` interface
> (`send(reliable|unreliable, bytes)`, `onMessage`). Implement it on WebSocket first.
> If real-world play shows latency spikes from HOL blocking, swap in a WebRTC
> implementation (geckos.io) — the netcode above the interface doesn't change. This is the
> [Gaffer "transport is a detail"] discipline.

WebTransport is the future-proof option (UDP-like, no ICE), but **Safari support is the
blocker** in 2026; keep it as a "watch this space" third transport adapter, not v1.

---

## 4. Netcode architecture

### 4.1 Server-authoritative (recommended)

One machine (a friend's "host") runs the authoritative `GameSession`. Clients send
**inputs** (`TicCommand`s), the server simulates, and broadcasts **state snapshots**.
Clients render snapshots (+ predict their own player). This is the
[Gambetta client-server model] and the Source/Quake lineage.

Why this and not the alternatives:
- **Anti-cheat:** clients never assert positions/damage; the server is the single source of
  truth ("never trust the client" — [Gambetta I]). At our scale this alone justifies it.
- **Co-op monster ownership is trivial:** monsters/doors/pickups exist once, on the server.
  No "who simulates the imp" arbitration.
- **Matches our code:** `tic()` is already the authoritative step; we just stop running it
  on clients (except for local prediction).

The cost — naive server-authoritative makes *your own* movement feel laggy (you wait a
round-trip to see yourself move, [Gambetta I]). That is what client-side prediction (§4.3)
fixes.

### 4.2 Why NOT deterministic lockstep / P2P

**Deterministic lockstep** (send only inputs, every peer simulates identically, RTS-style)
is bandwidth-cheap and our `Rng` + fractional-tic functions make it *tempting*. Reject it:
- **Cross-platform floating-point determinism is brutal.** Different CPUs/JS engines/JIT
  produce bit-different float results (transcendentals especially), and lockstep desyncs on
  the first divergent bit ([Gaffer: Floating Point Determinism], [Gaffer: Deterministic
  Lockstep]). Our sim is float-heavy (movement, raycast, trig). Guaranteeing bit-identical
  results across friends' machines would mean fixed-point math everywhere — a huge rewrite.
- **Input-latency model:** lockstep can't simulate tick N until *every* peer's input for N
  arrives, so everyone runs at the speed of the laggiest player ([SnapNet: Lockstep]).
- **No anti-cheat:** every peer has full authority over the shared sim.

**P2P / host-migration** adds NAT-mesh complexity for no benefit at this scale. One friend
hosts; if they drop, the match ends. Fine.

**Snapshot interpolation** (server simulates, clients only interpolate snapshots, never
simulate the shared world) is exactly our model and the right one — it tolerates packet
loss (skip a lost snapshot, interpolate to the next) and needs no client determinism
([Gaffer: Snapshot Interpolation]).

### 4.3 Client-side prediction + server reconciliation (local player)

So the local player feels instant ([Gambetta II]):

1. Client stamps each `TicCommand` with a **monotonically increasing sequence number** and
   sends it to the server.
2. Client **immediately applies** that command to its *own* predicted player locally (run
   the player-movement portion of `tic()` for the local player only).
3. Client keeps a ring buffer of **unacknowledged** commands.
4. Server processes commands, and each snapshot includes, **per player, the seq of the
   last input it consumed** (`lastProcessedInput`).
5. On snapshot receipt the client: sets its player to the **authoritative** state, **drops**
   all buffered commands `<= lastProcessedInput`, then **replays** the still-pending
   commands on top — landing back at a corrected predicted "now."

This requires the local player's movement to be a **pure function reusable on both sides**
(see §5.2). Mispredictions (e.g. you walked into a door the server closed) snap/smoothly
correct on reconciliation. Prediction is **only for the local player's own avatar** —
never for monsters or other players.

### 4.4 Entity interpolation for remote players + monsters

Render *other* entities ~100ms **in the past**, between the two most recent authoritative
snapshots ([Gambetta III]):

- Buffer incoming snapshots with their server timestamps.
- Render at `serverTime - renderDelay`, `renderDelay ≈ 2 × snapshot interval` (e.g. 100ms
  at a 20Hz snapshot rate) so there are always two snapshots to interpolate between.
- Linearly interpolate position + angle between the bracketing snapshots; pick sprite
  rotation frame from the interpolated angle.
- **Do NOT extrapolate/dead-reckon** remote players — DOOM movement is start/stop/turn
  ("dead reckoning essentially useless," [Gambetta III]). Interpolation hides loss; a
  dropped snapshot just means we interpolate toward the next one.

Our renderer already lerps with `alpha` for the local fixed-step; remote-entity
interpolation is a parallel, separate, *network-time* lerp.

### 4.5 Tick & snapshot rates

| Knob | Recommended | Notes |
|------|-------------|-------|
| Client input send rate | 30–60 Hz (1 per local fixed step is fine) | small messages; coalesce if needed |
| Server sim tick | **30 Hz** | run `tic()` at 30Hz on the server; cheap, plenty for a raycaster |
| Server snapshot/broadcast rate | **15–20 Hz** | decoupled from sim; this drives `renderDelay` |
| Client render | display refresh (rAF) | interpolates between snapshots |

Decoupling sim tick from snapshot rate is standard (Colyseus exposes exactly this as
`setSimulationInterval` vs `setPatchRate`; [Colyseus docs]). 20Hz snapshots → ~100ms
interpolation buffer, imperceptible for co-op and acceptable for friend-scale DM.

### 4.6 Snapshot & delta compression

At 2–8 players + shared monsters, naive full-state JSON is *probably* fine to start — but
do these in order of value:

1. **Delta encoding:** send only entities that changed since the client's last acked
   snapshot. This is the single biggest win and what Colyseus's Schema does automatically
   (binary patches of changed fields, [Colyseus docs]). With raw ws you'd hand-roll a
   per-field dirty-flag diff ([Gaffer: Snapshot Compression]).
2. **Binary, not JSON:** pack into an `ArrayBuffer` (typed fields) rather than JSON text.
   Quantize: positions to fixed-point (we're on a 64-mu grid; cm precision is plenty),
   angles to 1 byte (256 brads), health to a byte.
3. **Relevancy:** at this scale, skip interest management. (For larger scale you'd only
   send entities near each client.)
4. **Reliable vs unreliable split** (only matters on WebRTC): snapshots are unreliable
   (skip stale), but events that *must* arrive (you died, you picked up the BFG, level
   exit, frag awarded, chat) go on a reliable channel.

### 4.7 Handling our 35/60Hz fixed step deterministically on the server

- Run the server loop with the **same accumulator pattern** as `game.ts` but headless
  (`setInterval`/`setImmediate` driven; no rAF). Call `session.tic(cmdForThisPlayer)` once
  per player per tick, or fold all players into one `tic()` that iterates the player array.
- Keep `FIXED_STEP`/`TICS_PER_STEP` identical to the client so prediction replay uses the
  same math.
- **Server owns the only `Rng` instance**; reseed per level for reproducible monster
  behavior. Clients never call combat/AI RNG.
- Make `tic()` headless: guard `hud.update()` and `'sfx'` emission behind a
  `presentation` flag that's off on the server (the server emits *gameplay* events —
  damage, death, pickup — which become reliable network messages; clients turn those into
  local SFX).

---

## 5. Retrofitting our engine — concrete plan

The goal: **one sim codebase that runs headless on the server and (for prediction only) on
the client**, with rendering/audio/input strictly client-side.

### 5.1 Split sim from presentation

Today the split is *almost* clean: `tic()` = sim, `renderWorld()` = render. Work:
- Extract the simulation into something that compiles/runs under Node with **no DOM, no
  canvas, no Web Audio, no `window`**. The sim modules (`world`, `combat`, `ai`, `weapons`,
  `items`, `entities`, `core`) are already DOM-free; the coupling is in `game/session.ts`
  (hud + sfx + mouse-yaw) and the service wiring in `game/context.ts`
  (`Canvas2DRenderer`, `AudioManager`, `InputManager`).
- Introduce a **headless `GameContext`** for the server: real `World`/`Rng`/`EventBus`/
  `LevelRuntime`, but **null-object** Renderer/Audio/Input (no-ops). The frozen interfaces
  in `core` make this clean — provide server impls of the same contracts.
- Move the mouse-yaw mutation out of `readCommand()` into `TicCommand.turn` so a command is
  the *complete* input for a tick.

### 5.2 Make local-player movement reusable for prediction

Extract the player-movement portion of `tic()` (turn + thrust + `stepMovement` +
`tryUse` + weapon intent) into a **pure function** `applyPlayerCommand(world, playerId,
cmd, level, T)` that the client can run for its own player during prediction *and* replay,
and the server runs authoritatively. Everything else in `tic()` (AI, projectiles, doors,
items, monster damage) runs **server-only**.

### 5.3 Input → network commands

- `InputManager` already produces edges/held + mouse deltas; `readCommand()` already
  distills them into `TicCommand`. Add: a **sequence number**, and fold mouse-look into
  `turn`. That struct, serialized, *is* the wire input.
- Client loop: each fixed step → build `TicCommand` → (a) predict locally, (b) buffer it,
  (c) send it. No other input touches the network.
- Serialize compactly: the command is tiny (a few floats + a bitfield of the booleans +
  seq). Send the latest N unacked commands each packet for loss resilience (cheap).

### 5.4 Multiple players (the core refactor)

- Replace singular `world.player` with **`world.players: Map<playerId, Player>`** (or a
  swap-pop array keyed by id like monsters). This touches every `world.player` reader:
  combat (`applyDamage` already takes `target: Entity`, fine), items/pickups, weapons,
  AI targeting (`lookForTarget` must consider all players in co-op), camera/render (the
  *local* client picks its own player to render from).
- `updateDoors`/walkover triggers: iterate all players, not one cell.
- `allocId()` runs **server-side only**; spawn of a remote player's avatar on a client is
  driven by snapshots, not local allocation.
- AI targeting in co-op: monsters pick the nearest/visible player; infighting unchanged.

### 5.5 Which modules move/duplicate server-side

| Module | Server | Client | Notes |
|--------|--------|--------|-------|
| `core` (types, rng, math, vec2, events) | ✅ | ✅ | shared; pure |
| `world` (level runtime, doors, collision) | ✅ authoritative | ✅ for prediction collision | server owns door/lift state |
| `entities` (World registry) | ✅ authoritative | ✅ mirror from snapshots | id allocation server-only |
| `combat` (hitscan, projectiles, splash, resolve) | ✅ authoritative + lag-comp | ❌ (no client damage) | client may show *cosmetic* tracer/muzzle predicted |
| `ai` (monster AI) | ✅ **server only** | ❌ | clients never run AI; monsters arrive via snapshots |
| `weapons` (cooldown, ammo, fire dispatch) | ✅ authoritative | ✅ predict view-model/cooldown for feel | ammo is authoritative |
| `items` (pickups, inventory, powerups) | ✅ authoritative | ❌ | pickup = reliable event |
| `render`, `audio`, `input`, `ui` | ❌ | ✅ | strictly client |
| `game/session` | split: headless sim half on server, render half on client | | the seam |

**Who simulates monsters:** the server, always, in both modes. Co-op shares one monster
set; DM may spawn few or none.

### 5.6 Lag compensation for hitscan

Our weapons are hitscan-heavy (pistol/shotgun/chaingun). Implement server-side rewind
([Gambetta IV], Source-style):
- Server keeps a short **ring buffer of recent player positions/angles** (last ~1s of
  ticks).
- When a client fires, its command carries the **client render time** (or the server
  derives it: `now - clientRTT/2 - renderDelay`).
- Server **rewinds** other players to where the shooter *saw* them, runs the existing
  `hitscan(...)`/`autoaimTarget(...)` against those historical positions, applies damage
  via `applyDamage`, then restores present positions.
- Accept the [Gambetta IV] tradeoff: a target can occasionally be hit just after ducking
  behind cover ("it would be much worse to miss an unmissable shot"). Cap rewind to a max
  (e.g. 250ms) so high-latency players can't rewind absurdly far.
- Monsters and projectiles need *no* lag-comp in co-op (they're shared and shown from
  snapshots; players don't need pixel-perfect competitive hits on shared AI).

### 5.7 Refactor checklist (the directive's "what to refactor")

- `src/game/session.ts`: headless-ize `tic()` (presentation flag); fold mouse-yaw into the
  command; extract `applyPlayerCommand`; iterate players for doors/walkover.
- `src/input/*`: add seq number + mouse-into-`turn`; add a serialize/deserialize for
  `TicCommand`.
- `src/combat/*`: add per-pair friendly-fire gating in `applyDamage` (mode rule, §8);
  add the position ring-buffer + rewind wrapper around `hitscan`/`radiusDamage`.
- `src/entities/world.ts` + `src/core/types.ts`: multi-player state (`players` map);
  server-only `allocId`.
- **New** `src/net/` module (client + a sibling Node `server/` package): `NetTransport`
  interface, snapshot encode/decode, command encode/decode, prediction/reconciliation,
  interpolation buffer, the authoritative server loop, and the mode rules.

---

## 6. Representing other players

- **Avatar sprite:** reuse Freedoom's **`PLAY`** sprite set (the marine). The renderer's
  billboard-sprite + 8-rotation system (`render/sprites.ts`, manifest sprite frames with
  `frameLetter + rotation`, ARCHITECTURE.md §4) already does monsters; a remote player is
  just another billboard whose rotation is chosen from `cameraAngle → playerAngle`. Add
  `PLAY` to the extractor roster (`tools/extract-wad/lib/roster.ts`) and the manifest.
  Walk frames (`PLAYA–D`), pain (`PLAYG`), death (`PLAYH–N`) map to a simple anim state
  synced as a small enum in the snapshot.
- **Name tags:** draw a short text label above the avatar's screen-projected top, depth-
  faded like sprites. Names come from a reliable "player joined" message (id → name, color).
- **Animation sync:** don't sync frame indices; sync **intent/state** (moving? firing?
  pain? dead?) + position/angle, and let each client drive the local animation clock from
  that. Cheaper and loss-tolerant.
- **Team color (DM):** Freedoom `PLAY` supports the DOOM green-ramp palette remap; a
  per-player color index in the snapshot lets the renderer remap the green range
  (translation table) so frags are legible.

---

## 7. Game modes

Both modes run the **same authoritative sim**; they differ in a small **rule set**. Model a
`GameMode` abstraction the server room holds:

```
interface GameMode {
  spawnMonsters: boolean              // co-op: from level; DM: few/none
  friendlyFire: boolean               // co-op: false; DM: true
  sharedProgression: boolean          // co-op: exit advances everyone; DM: round/frag-limit
  canDamage(attacker, target): bool   // faction + FF rule
  onDeath(player): 'respawn' | 'spectate' | 'gameover'
  respawnDelay: number                // DM: ~1–2s at a spawn point; co-op: ?
  scoring: 'kills' | 'frags'
  spawnPointsFor(player): SpawnPoint  // co-op: playerStart cluster; DM: arena spawns
}
```

| Aspect | **Co-op** | **Deathmatch** |
|--------|-----------|----------------|
| Friendly fire | OFF (`canDamage` false for player↔player) | ON |
| Monsters | shared level monsters, server-simmed | usually none / few |
| Win/lose | shared exit → next level; team wipe → game over | frag limit or time limit → winner |
| Death | respawn at level start (or co-op respawn rule TBD) | respawn after delay at DM spawn point |
| Spawns | `playerStart` (+ co-op extra starts) | dedicated arena spawn-point list (new level field) |
| Scoring | kills/items/secrets (existing counters) | per-player frag count (new) |
| Player visibility | yes | yes |

Implementation hooks:
- **Friendly fire** lives in `applyDamage` (`src/combat/resolve.ts`) via `Faction` +
  `mode.canDamage`. The faction plumbing already exists (`ownerFaction`/`sourceFaction`).
- **DM spawn points** need a new `MapData` field (`deathmatchStarts: SpawnPoint[]`) and
  extractor support; pick the spawn farthest from other players ("telefrag" the occupant or
  re-pick, classic DOOM behavior).
- **Frag scoring** is server state broadcast in the snapshot; a small scoreboard UI
  (`src/ui/`) renders it. Co-op reuses existing intermission tally.
- Co-op **shared progression**: the exit trigger (already in `LevelRuntime.pendingExit`)
  advances the *room*, loading the next level on the server and re-syncing all clients.

The two modes share ~95% of the sim. Keep the mode object tiny and inject it where rules
branch (damage gate, death handler, spawn selection, win condition) — do **not** fork the
sim.

---

## 8. Anti-cheat via server authority

Server authority is the whole anti-cheat strategy at this scale — no anti-cheat client, no
obfuscation. Principles ([Gambetta I]):

- **Clients send inputs, never state.** A client cannot set its own position, health, ammo,
  or assert a kill. It says "I pressed forward and fired"; the server decides what happened.
- **Validate every command:** clamp `forward/strafe/turn` to legal ranges (no super-speed),
  enforce weapon cooldowns and ammo server-side (reject fire if on cooldown / out of ammo),
  reject impossible movement (server runs collision, so wall-clipping is impossible by
  construction).
- **Hit validation server-side:** lag-comp rewind uses *server-stored* historical positions,
  not client-claimed ones, so aimbot-via-fake-position can't work — the worst a cheater does
  is aim well.
- **Rate-limit** commands per connection (drop floods); **authoritative entity ids** (client
  can't spawn entities).
- Residual risk: a client still sees the full world snapshot, so **wallhack-style
  information cheats** (seeing through walls) remain possible — irrelevant among friends,
  and only fixable with server-side per-client visibility culling (out of scope).

This is "free" once §4.1 is in place; it is a *reason* to choose server-authoritative, not
extra work.

---

## 9. Library recommendations

All are Node.js + browser, TypeScript-friendly, self-hostable.

### 9.1 Colyseus — **primary recommendation**

- **What:** authoritative multiplayer framework. **Rooms** (server-side game-session
  objects with their own state + lifecycle), **matchmaking/lobby**, **automatic binary
  delta state sync** via `@type` Schema, separate `setSimulationInterval` /
  `setPatchRate`, reconnection, client SDKs (we'd use TS). Transport: WebSocket (TCP),
  with uWebSockets.js / Bun / WebTransport transport backends. **No UDP/WebRTC.**
  ([Colyseus docs])
- **Why primary here:** a Colyseus **Room == a co-op/DM match**. It hands us rooms, lobby,
  join/leave, reconnection, and the snapshot-delta serialization (§4.6) for free — the
  bulk of the boilerplate. Same language, self-hosted by IP, authoritative by design.
- **Tradeoffs:** (1) TCP only — HOL blocking under loss (mitigated by scale + delta size;
  upgrade path = leave Colyseus for geckos). (2) Its Schema is a *second* representation of
  state — we'd mirror our struct-of-entities into `@type` schema classes each tick (some
  duplication, but mechanical). (3) Prediction/reconciliation/lag-comp are **still ours to
  build** — no framework does those for you; Colyseus only removes transport + rooms +
  serialization.

### 9.2 geckos.io — **latency upgrade / alternative**

- **What:** "socket.io but WebRTC/UDP." Real-time client/server over **WebRTC DataChannel
  (unreliable UDP)**, Node.js ≥16, ESM, socket.io-like `channel.emit/on`, reliable-message
  option on top. ([geckos README])
- **Why consider:** genuinely lower, spike-resistant latency (no TCP HOL blocking) — the
  *right* transport for a fast FPS.
- **Tradeoffs:** (1) **Deployment pain** — needs a TCP signaling port (`9208`) **plus a
  wide UDP range `1025–65535` forwarded**, and STUN (TURN for hard NATs) ([geckos README]).
  That UDP-range firewall rule is the real cost for self-hosting friends. (2) You build
  rooms/lobby/state-sync yourself (it's a transport, not a framework). (3) The README itself
  says first-time multiplayer devs should start with socket.io-like reliability and only
  reach for geckos once comfortable with UDP/port-forwarding.
- **Use it when:** WebSocket play shows latency spikes you can attribute to HOL blocking.
  Because the netcode sits behind `NetTransport` (§3.3), this is a transport swap.

### 9.3 Socket.IO — simple but suboptimal

- Easiest API, auto-reconnect, rooms, broadcast helpers; **TCP, reliable-ordered only** (no
  unreliable mode). Fine for turn-based / slow games; for a real-time FPS its mandatory
  reliability adds the exact latency we'd want to shed, and it gives no game-state sync
  layer. Geckos deliberately mimics its API as the "next step up." **Not recommended** as
  primary — Colyseus gives more (state sync + rooms) for the same TCP transport.

### 9.4 raw `ws` / uWebSockets.js — max control, most work

- `ws`: minimal WebSocket lib. **uWebSockets.js**: a much faster C++ WebSocket/HTTP server
  (also the optional high-perf transport *inside* Colyseus). Choosing these means **building
  rooms, lobby, matchmaking, serialization, delta encoding yourself** ([Gaffer: Snapshot
  Compression] for the hand-rolled delta approach).
- **Use it when:** you want zero framework magic and full control of the wire format, and
  you're comfortable writing the snapshot/delta layer. Reasonable for a learning-focused
  build; more upfront work than Colyseus for the same TCP transport.

### 9.5 Recommendation matrix

| Priority | Pick |
|----------|------|
| Fastest path to working co-op + DM (recommended) | **Colyseus** (WebSocket) |
| Lowest latency, willing to do ops + plumbing | **geckos.io** (WebRTC/UDP) |
| Total control of wire format, minimal deps | **uWebSockets.js** + custom snapshots |
| Avoid | Socket.IO as the backbone (TCP cost, no state layer) |

---

## 10. Phased implementation plan

Each phase is independently shippable/testable. Build the **netcode behind a transport
interface from day one** so the WebSocket→WebRTC option stays open.

**Phase 0 — Make the sim headless & deterministic (no networking yet).**
- Add a `presentation` flag to `GameSession`; make `hud.update()` + `'sfx'` emission no-ops
  on a headless build. Fold mouse-yaw into `TicCommand.turn` + add a `seq` field.
- Extract `applyPlayerCommand(world, playerId, cmd, level, T)` as a pure function.
- Prove the sim compiles and runs one full level under Node with null Renderer/Audio/Input.
- ✅ *Verify:* a Node script can `tic()` a level to completion deterministically (same
  seed → same end state checksum).

**Phase 1 — Multi-player state, single process.**
- Replace `world.player` with `world.players` map; update all readers; server-only
  `allocId`; iterate players in doors/walkover/AI-targeting.
- Run 2 local "players" in one headless sim driven by two scripted command streams.
- ✅ *Verify:* two players move/collide/shoot monsters in one sim; no `world.player`
  references remain.

**Phase 2 — Transport + authoritative server loop (co-op, no prediction).**
- Add `src/net/` (`NetTransport` iface) + a Node `server/` (Colyseus Room running the
  headless sim at 30Hz). Client sends `TicCommand`s; server broadcasts full snapshots at
  20Hz; client renders remote players from snapshots (interpolated) and its own player
  *also* from snapshots (laggy but correct).
- Add `PLAY` avatar sprite + name tags.
- ✅ *Verify:* two browsers on a LAN join one room, see each other move and fight shared
  monsters. (Movement feels laggy — expected; Phase 3 fixes it.)

**Phase 3 — Client prediction + reconciliation + interpolation polish.**
- Predict the local player via `applyPlayerCommand`; reconcile on snapshot using
  `lastProcessedInput`; tune the remote interpolation buffer (~100ms).
- Delta-encode snapshots (Colyseus Schema does most of this).
- ✅ *Verify:* local movement feels instant; remote players move smoothly; induced 100ms
  latency (devtools throttle) stays playable.

**Phase 4 — Hitscan lag compensation.**
- Server position ring-buffer + rewind around `hitscan`/`autoaimTarget`; cap rewind.
- ✅ *Verify:* shooting a moving remote player registers where the shooter saw them under
  simulated latency.

**Phase 5 — Deathmatch mode + the `GameMode` abstraction.**
- Add `GameMode` (FF gate in `applyDamage`, death→respawn, frag scoring, DM spawn points
  in `MapData` + extractor). Add a mode-select in the lobby/room creation.
- ✅ *Verify:* DM room: friendly fire on, frags counted, respawns work, scoreboard shows;
  co-op room still FF-off with shared progression.

**Phase 6 — Hardening.**
- Reliable channel for must-arrive events (death/pickup/exit/frag/chat); command rate-limit
  + validation/clamping; reconnection; `wss` reverse-proxy deployment doc for self-hosting.
- (Optional) WebRTC transport via geckos.io if latency telemetry warrants it.
- ✅ *Verify:* a friend connects over the internet by IP/host over `wss`, plays a full co-op
  level and a DM round.

---

## 11. Open questions / decisions to confirm

- **Co-op death rule:** respawn at level start, wait-for-revive, or party-wipe = game over?
  (Affects `GameMode.onDeath`.)
- **DM monster policy:** truly none, or a few for item/hazard flavor? (Affects spawn + AI
  load.)
- **Self-signed cert vs Let's Encrypt** for `wss` when hosting on a bare IP — friends must
  trust the cert once either way. A small "connect" UI that takes `host:port` is needed
  regardless.
- **Telefrag on DM spawn** (classic DOOM) vs spawn-point re-pick — pick one.
- **Schema duplication cost** (Colyseus `@type` mirror of our structs) — acceptable, or is
  hand-rolled binary snapshots over uWebSockets.js preferable for control? Revisit after
  Phase 2 once the snapshot size is measurable.

---

## 12. Sources

Netcode theory:
- Gabriel Gambetta, *Fast-Paced Multiplayer* — I: Client-Server + cheating
  <https://gabrielgambetta.com/client-server-game-architecture.html>;
  II: Client-Side Prediction & Server Reconciliation
  <https://gabrielgambetta.com/client-side-prediction-server-reconciliation.html>;
  III: Entity Interpolation
  <https://gabrielgambetta.com/entity-interpolation.html>;
  IV: Lag Compensation
  <https://gabrielgambetta.com/lag-compensation.html>
- Glenn Fiedler (Gaffer On Games): *Snapshot Interpolation*
  <https://gafferongames.com/post/snapshot_interpolation/>; *Deterministic Lockstep*
  <https://gafferongames.com/post/deterministic_lockstep/>; *Floating Point Determinism*
  <https://gafferongames.com/post/floating_point_determinism/>; *Snapshot Compression*
  <https://gafferongames.com/post/snapshot_compression/>
- SnapNet, *Netcode Architectures* — Part 1: Lockstep
  <https://www.snapnet.dev/blog/netcode-architectures-part-1-lockstep/>; Part 3: Snapshot
  Interpolation <https://snapnet.dev/blog/netcode-architectures-part-3-snapshot-interpolation/>
- Valve, *Source Multiplayer Networking* (tickrate, interpolation, lag compensation) —
  <https://developer.valvesoftware.com/wiki/Source_Multiplayer_Networking> *(could not be
  fetched during research — HTTP 403; cited from general knowledge as corroboration of the
  Gambetta lag-comp model, not independently re-verified here.)*

Transport:
- rune.ai, *WebRTC vs WebSockets for multiplayer games*
  <https://developers.rune.ai/blog/webrtc-vs-websockets-for-multiplayer-games>
- WebSocket.org, *WebSocket vs WebRTC* <https://websocket.org/comparisons/webrtc/>
- *DataChannel vs WebTransport vs WebSockets: When to Use Each*
  <https://medium.com/@justin.edgewoods/datachannel-vs-webtransport-vs-websockets-when-to-use-each-63bb932821e5>

Libraries:
- Colyseus docs <https://docs.colyseus.io/>
- geckos.io <https://github.com/geckosio/geckos.io> (README: UDP/WebRTC, deployment ports,
  ICE servers, version/Node requirements)
- Socket.IO <https://socket.io/>; `ws` <https://github.com/websockets/ws>;
  uWebSockets.js <https://github.com/uNetworking/uWebSockets.js>

Codebase (this repo, post-trunk-merge): `src/game/session.ts`, `src/game/game.ts`,
`src/core/{types,rng,constants}.ts`, `src/input/*`, `src/combat/{resolve,hitscan,raycast}.ts`,
`src/ai/monster-ai.ts`, `src/entities/world.ts`, `src/world/level-runtime.ts`,
`docs/ARCHITECTURE.md`, `docs/research/web-arch.md`.
