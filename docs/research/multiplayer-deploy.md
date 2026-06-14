# Multiplayer Deploy & Hosting — DOOM-TS Online

> Scope: **server structure, repo layout, building & serving, hosting on the user's
> own server, lobbies/rooms, ops/security, and a concrete deploy runbook.**
> Netcode/architecture (tick model, snapshots, prediction, reconciliation, co-op
> vs PvP rules) lives in the companion doc `multiplayer-netcode.md` — this doc does
> **not** duplicate it; it references it where the two meet (e.g. "the sim tick").
> Research-only. No implementation. Citations at the bottom of each section.

The user's stated goal (memory `online-multiplayer-plan`): after single-player is done,
take the game online, host it on **their own server**, friends **join by IP**, with two
modes (co-op no-friendly-fire + PvP deathmatch). This doc is the build/host/deploy
reference for that phase.

---

## 0. TL;DR — recommended approach

- **Repo:** convert the current single-package repo into an **npm-workspaces monorepo** with
  three packages: `shared` (the deterministic sim — moved from `src/world`, `src/combat`,
  `src/ai`, `src/core`, `src/data`), `client` (the existing Vite app), `server` (the
  authoritative Node game server). Client and server both `import` from `shared`, so the
  exact same TypeScript world/combat/AI runs on both sides. (§1, §2)
- **Realtime transport:** start with the **`ws`** library (de-facto standard, raw WebSocket,
  zero abstraction over your own protocol). Consider **`uWebSockets.js`** only if you ever
  outgrow `ws` on a single box; consider **Colyseus** if you'd rather adopt a batteries-included
  rooms/lobby/matchmaking framework instead of hand-rolling §4. (§3, §4)
- **Serving:** build the Vite client to **static files**, run the **Node WS server** as a
  long-lived process, and put **Caddy** in front as a reverse proxy that (a) serves the static
  client and (b) proxies `wss://` → the Node WS port, with **automatic HTTPS**. (§3, §5)
- **Host:** a **Hetzner Cloud CX23** (~€3.99/mo, 2 vCPU / 4 GB / 40 GB / 20 TB) is the
  recommended box for a friends-only deployment — cheapest credible VPS with huge bundled
  transfer. DigitalOcean is the alternative if you want its broader managed ecosystem. (§5)
- **"Join by IP":** works, but the cleanest path is a **free hostname that maps to your IP**
  (`<IP>.sslip.io` or DuckDNS) so Caddy can get a **real TLS cert** and the browser allows
  `wss://`. Raw `http://<ip>` + `ws://<ip>` works too but only as long as the page is plain
  HTTP (no TLS) — modern browsers block `ws://` from an `https://` page. (§5, §6)
- **Process mgmt:** **systemd** unit for the Node server (simple, boots with the box). Use
  **pm2** instead if you want zero-downtime reloads/clustering. (§7)
- **Security:** non-root user, SSH keys only, UFW allowing 22/80/443, fail2ban, unattended
  upgrades, a per-room player cap. (§8)

---

## 1. Server structure — an authoritative Node game server sharing sim code

### 1.1 What "authoritative" means for hosting (1-paragraph bridge to netcode doc)

The server owns the truth: it runs the same fixed-timestep sim the single-player game runs
today (the SP loop is the 35 Hz / fixed-timestep accumulator described in
`web-arch.md §2` and `ARCHITECTURE.md`), advances the world from **player inputs**, and
broadcasts authoritative state to clients. Clients render and predict; they never decide
outcomes. The deploy consequence is what this doc cares about: **there is a long-lived Node
process that must stay up, hold per-room state in memory, and accept WebSocket connections** —
everything below is about running and reaching that process. The *contents* of the messages
and the tick/snapshot/reconciliation design are the netcode doc's job.

### 1.2 Why the sim must be shared, not reimplemented

The single biggest win of TypeScript end-to-end is that the **authoritative simulation is the
existing `src/world` + `src/combat` + `src/ai` + `src/core` code, compiled for Node instead of
the browser**. The client runs it for prediction; the server runs it as the authority. If the
two ever diverge (e.g. a reimplemented server in another language), you get desync bugs that are
brutal to debug. So the deploy-relevant requirement is a **repo layout where one copy of the sim
is imported by both client and server**. (See §2.)

Constraints the sim already satisfies that make this clean:
- **Deterministic-friendly:** seeded RNG (`core/rng.ts`), fixed timestep, struct-of-entities,
  map units integer-ish grid (`CELL_SIZE = 64`). Determinism is a netcode concern, but the
  *code organization* that enables it is a deploy concern.
- **No DOM in the sim:** `src/world`, `src/combat`, `src/ai`, `src/core`, `src/data` must not
  import `DOM`/`Canvas`/Web Audio. Rendering (`src/render`), audio (`src/audio`), input
  (`src/input`), and UI (`src/ui`) stay **client-only**. The `core` barrel mixes some browser
  types today (`render.ts`, `audio.ts`, `input.ts` live in `core`) — see §2.3 for the split
  needed so `shared` compiles under Node without `lib.dom`.

### 1.3 Transport: WebSocket (recommended) vs WebRTC

- **WebSocket (TCP)** — recommended default. One server process, one listening port, trivial
  to reverse-proxy and TLS-terminate, works through any NAT/firewall the way HTTP does, and is
  what every "host on a VPS" guide assumes. Head-of-line blocking under packet loss is the
  classic downside for twitch games, but for a friends-only DOOM-pace co-op/deathmatch over
  decent connections it's the pragmatic choice and by far the easiest to deploy.
- **WebRTC DataChannel (UDP, unreliable mode)** — lower latency, no HOL blocking, but needs a
  **signaling server** (you'd run that over WebSocket anyway) **and** STUN/TURN for NAT
  traversal; TURN relay you'd have to host too. Much more moving parts to deploy. Treat as a
  future optimization, not v1. The netcode doc owns the latency tradeoff analysis; from a
  *hosting* standpoint WebRTC roughly triples the things you must run and open.

**Recommendation:** WebSocket for v1. Keep the message layer transport-agnostic enough that a
future WebRTC swap doesn't rewrite game logic, but don't build WebRTC infra now.

Sources: [web-arch.md §2 (loop)], [ARCHITECTURE.md], [MDN: Writing WebSocket client applications](https://developer.mozilla.org/en-US/docs/Web/API/WebSockets_API/Writing_WebSocket_client_applications), [DCHost: How WebSockets and real-time apps work](https://www.dchost.com/blog/en/how-websockets-and-real-time-apps-really-work/)

---

## 2. Repo layout — npm workspaces monorepo

### 2.1 Recommended layout

Convert the single package into a workspaces monorepo. Minimal, no extra tooling beyond npm:

```
doom-ts/                      # repo root
├── package.json             # { "private": true, "workspaces": ["packages/*"] }
├── tsconfig.base.json       # shared strict compiler options (today's tsconfig)
├── packages/
│   ├── shared/              # THE SIM — runs on Node AND in the browser
│   │   ├── package.json     # "name": "@doom/shared", "type": "module"
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── core/        # moved from src/core (the DOM-free parts — see §2.3)
│   │       ├── data/        # moved from src/data
│   │       ├── world/       # moved from src/world
│   │       ├── combat/      # moved from src/combat
│   │       ├── ai/          # moved from src/ai
│   │       ├── entities/    # moved from src/entities
│   │       └── net/         # NEW: shared message types/schemas (client+server agree)
│   ├── client/              # the existing Vite app
│   │   ├── package.json     # deps: "@doom/shared": "*", vite
│   │   ├── vite.config.ts   # today's config (base './', COOP/COEP, etc.)
│   │   ├── index.html
│   │   └── src/             # render/, audio/, input/, ui/, game/, main.ts
│   └── server/              # authoritative Node game server
│       ├── package.json     # deps: "@doom/shared": "*", "ws"
│       ├── tsconfig.json
│       └── src/
│           ├── index.ts     # boot: http + ws listen
│           ├── room.ts      # one game instance = one room (holds a sim)
│           ├── lobby.ts     # room registry / create-join (see §4)
│           └── net/         # server-side socket handling
```

How the sharing works mechanically:
- Root `package.json` has `"workspaces": ["packages/*"]`. `npm install` at the root symlinks
  `@doom/shared` into both `client/node_modules` and `server/node_modules`, so
  `import { World } from '@doom/shared'` resolves in both. ([npm workspaces], [vite-monorepo example])
- **Vite** consumes `@doom/shared` like any dependency; in dev it can compile the TS in-place
  (no separate build step needed for the client), and `vite build` bundles `shared` into the
  client output. ([Vite + workspaces guide])
- **Server** runs `shared` under Node. Either compile with `tsc` to `dist/` and `node dist/index.js`,
  or run directly with **`tsx`** (already a devDependency here) for dev: `tsx packages/server/src/index.ts`.
- **TypeScript project references** (`shared` referenced by `client` and `server`) give
  incremental builds and correct cross-package type-checking. ([Nx: TS packages in monorepos])

### 2.2 Why npm workspaces (not pnpm/turbo/nx)

The repo already uses npm + a lockfile and a tiny toolchain (tsx, typescript, vite). npm
workspaces ship with npm, add **zero** new top-level tools, and do exactly what's needed:
symlink local packages so imports resolve. pnpm/turbo/nx add caching and orchestration that a
3-package friends-game repo does not need yet. Keep it boring. ([npm workspaces], [johnh.co: npm workspaces])

### 2.3 The one real refactor: split DOM types out of `core`

`ARCHITECTURE.md` lists `src/core` as the frozen root, but it currently bundles browser-facing
interface files (`render.ts` = Renderer/Camera/Texture, `audio.ts` = Audio, `input.ts` =
Input/Bindings) alongside the pure sim types. For `shared` to compile under Node **without**
`"lib": ["DOM"]`, the sim must not transitively import DOM types. Two options:

- **(A, recommended)** Keep `render.ts`/`audio.ts`/`input.ts` interfaces in the **client**
  package; `shared/core` keeps only the DOM-free contracts (`types.ts`, `vec2.ts`, `math.ts`,
  `rng.ts`, `events.ts`, `enums.ts`, `constants.ts`, `defs.ts`, `MapData`, `IWorld`,
  `ILevelRuntime`, `IGameState`). The sim already only needs those.
- **(B)** Keep them in `shared` but ensure they're **type-only** and that `shared`'s tsconfig
  uses `"lib": ["ES2022"]` only — risky because any value-level DOM use breaks the Node build.

This is a **contract change** to `ARCHITECTURE.md` decision #5/frozen-core, so it must be raised
there before the online phase starts — flagging it here so it isn't a surprise. Net effect:
`shared` builds clean under both `lib: ["ES2022"]` (server) and `lib: ["ES2022","DOM"]` (client).

Sources: [npm workspaces docs](https://docs.npmjs.com/cli/v10/using-npm/workspaces), [enZane/monorepo-vite-example](https://github.com/enZane/monorepo-vite-example), [adiun/vite-monorepo](https://github.com/adiun/vite-monorepo), [Vite + pnpm/TS monorepo guide](https://vedanshmehra.hashnode.dev/setting-up-a-monorepo-with-vite-typescript-and-pnpm-workspaces), [Nx: managing TS packages in monorepos](https://nx.dev/blog/managing-ts-packages-in-monorepos), [ARCHITECTURE.md], [web-arch.md §1]

---

## 3. WebSocket server library — `ws` vs `uWebSockets.js` vs Socket.IO vs Colyseus

| Option | What it is | Rooms/lobby built-in? | Perf | Fit for this project |
|--------|-----------|----------------------|------|----------------------|
| **`ws`** | Minimal, correct, raw WebSocket protocol. Node de-facto standard (~80M wk dl). | No — you write §4 yourself. | Good; fine for a single friends-game box. | **Recommended v1.** You already control the binary/JSON protocol via `shared/net`; `ws` just moves bytes. |
| **`uWebSockets.js`** | C++ bindings; 5–10× throughput vs `ws`, more concurrent conns, less CPU/RAM. | No. | Highest. | Overkill for friends-only; reach for it only if one box stops coping. Native compile adds deploy friction. |
| **Socket.IO** | High-level: rooms, namespaces, auto-reconnect, HTTP long-poll fallback. | Yes (rooms, broadcast). | Lower (wraps `ws`, adds framing). | Tempting for the rooms feature, but its framing/reconnect model fights a custom authoritative tick loop; you'd fight its abstractions. |
| **Colyseus** | Full authoritative-multiplayer **framework**: Room lifecycle, matchmaking, **built-in LobbyRoom**, state sync. | Yes — `LobbyRoom`, matchmaking, reconnection. | Scales 10→10k+ CCU w/ Redis. | Viable **alternative architecture**: adopt Colyseus's Room/Lobby instead of hand-rolling §4. Tradeoff: its state-sync model partly overlaps the netcode doc's custom plan — choose one, don't run both. |

**Recommendation:** **`ws`** for the transport + hand-rolled rooms/lobby (§4), because the sim
and snapshot format are already yours and `ws` adds nothing to argue with. **If** you'd rather
not build lobby/matchmaking/reconnection yourself, **Colyseus** is the credible
batteries-included path — but that's a netcode-doc-level decision (it dictates the sync model),
so coordinate the two docs before committing.

Sources: [PkgPulse: Socket.IO vs ws vs uWebSockets.js 2026](https://www.pkgpulse.com/guides/socketio-vs-ws-vs-uwebsockets-websocket-servers-nodejs-2026), [PkgPulse: best WebSocket libraries 2026](https://www.pkgpulse.com/guides/best-websocket-libraries-nodejs-2026), [Colyseus docs](https://docs.colyseus.io/), [Colyseus LobbyRoom](https://docs.colyseus.io/room/built-in/lobby), [Colyseus GitHub](https://github.com/colyseus/colyseus)

---

## 4. Lobbies & rooms — create/join, modes, friends-matchmaking-lite

Goal from memory: friends create/join a game, pick **co-op (no FF)** or **PvP deathmatch**, max
N players. This is "matchmaking-lite" — no skill ranking, no global queue, just rooms.

### 4.1 Model

```
Server process
 └─ Lobby (in-memory registry: Map<roomCode, Room>)
     └─ Room
         ├─ code: "QUAKE" (short, shareable)        // 4–6 chars, ambiguity-free alphabet
         ├─ mode: "coop" | "deathmatch"
         ├─ maxPlayers: e.g. 4 (coop) / 8 (dm)
         ├─ map / episode selection
         ├─ players: Map<playerId, Connection>
         ├─ sim: World (the authoritative @doom/shared sim, ticking at 35 Hz)
         └─ status: "lobby" | "in-game" | "ended"
```

- **One Room = one sim instance = one game.** The server can hold many rooms; each ticks
  independently. For a friends deployment, a handful of rooms on one box is plenty.
- Rooms live in **memory only** (no DB needed for friends-only). A Room is created on demand,
  disposed when empty (with a short grace period so a reconnecting player isn't dropped).

### 4.2 Create / join flows

1. **Create:** client → `POST /api/rooms` (or a WS "create" message) with `{mode, maxPlayers, map}`.
   Server generates a unique `roomCode`, makes the Room, returns the code. Host shares the code.
2. **Join by code:** client connects WS with `?room=QUAKE&name=...`; server validates the code,
   checks `players.size < maxPlayers` and `status==="lobby"`, adds the player, broadcasts the
   updated lobby roster. Rejects with a clear reason (full / not found / already started).
3. **Join by IP only (no code):** if you want "just give friends the IP," support a **default
   room** — first connection to a bare IP auto-creates/joins room `"DEFAULT"`. Friends literally
   open `http://<ip>/` and they're in the same game. Simplest possible UX; lose multi-room.
4. **Lobby list (optional):** a `GET /api/rooms` returning open rooms lets a friend pick from a
   list instead of typing a code. This is exactly what Colyseus's `LobbyRoom` automates if you
   go that route. ([Colyseus LobbyRoom])
5. **Start:** host presses "start"; server flips `status` to `in-game`, spawns players into the
   sim, begins broadcasting snapshots (netcode doc).

### 4.3 Modes at the lobby layer (rules belong to netcode doc)

The lobby only needs to **carry the mode flag** into the Room and into sim config:
- **co-op:** friendly-fire OFF (combat resolution ignores player-vs-player damage), shared
  monster world, shared progression.
- **deathmatch:** friendly-fire ON among all, no monsters (or optional), respawns, frag count.

The lobby's job is selection + capacity + lifecycle; *how* FF-off or frag-scoring works is
implemented in `shared/combat` and documented in `multiplayer-netcode.md`.

### 4.4 Player caps (sizing)

Authoritative DOOM-style sim is cheap (grid raycaster, hundreds of entities). For a friends box,
cap **co-op at ~4** and **deathmatch at ~8** per room to start; the constraint is bandwidth
(snapshot size × players × tickrate), not CPU — see §9. Make the cap a per-room config so you
can raise it after measuring.

Sources: [Colyseus rooms/matchmaking](https://docs.colyseus.io/), [Colyseus LobbyRoom](https://docs.colyseus.io/room/built-in/lobby), [online-multiplayer-plan memory]

---

## 5. Serving client + server together

### 5.1 The two artifacts

1. **Static client** — `vite build` → `packages/client/dist/` (HTML + JS + assets). Pure static
   files; any web server can serve them.
2. **Realtime server** — the long-lived Node `ws` process listening on a port (e.g. `:8080`).

### 5.2 Recommended topology: Caddy in front of both

Run **one Caddy** as the public entrypoint on ports 80/443. Caddy:
- serves the static client from `dist/`,
- reverse-proxies the WebSocket path (e.g. `/ws`) to the Node process on `:8080`,
- obtains and auto-renews TLS certs (Let's Encrypt/ZeroSSL) with **zero config**.

Minimal `Caddyfile`:

```
your-host.example {          # a hostname (real domain, or <ip>.sslip.io — see §6)
    encode zstd gzip
    handle /ws* {
        reverse_proxy localhost:8080      # WebSocket upgrade handled automatically
    }
    handle {
        root * /var/www/doom/dist
        try_files {path} /index.html
        file_server
    }
}
```

Caddy proxies WebSockets transparently — it performs the HTTP `Upgrade` and tunnels the
connection; no special `Connection`/`Upgrade` header config needed (unlike hand-written nginx
blocks). ([Caddy reverse_proxy docs], [Caddy WebSocket community thread])

The client then connects to `wss://your-host.example/ws` (note `wss` + same host → no CORS, no
mixed-content). In dev it's `ws://localhost:8080`.

### 5.3 Alternatives to Caddy

- **nginx + certbot** — works, but you must hand-write the `proxy_set_header Upgrade/Connection`
  block and run certbot/cron for renewals. More steps, more footguns. Use it if you already know
  nginx. ([MassiveGRID: Node+PM2+nginx], [Panelica: nginx+pm2+ssl])
- **Node serves static itself** (no proxy) — the Node process serves `dist/` *and* the WS on one
  port. Fewer moving parts, but then **you** own TLS in Node (load cert files, renew them), which
  is the annoying part Caddy exists to remove. Fine for plain-HTTP raw-IP testing (§6), not great
  for TLS.
- **Two origins** (static host like Netlify/Pages for the client + VPS for WS) — works, but then
  it's not "their own server" for the whole thing and you must handle cross-origin WS. Against the
  user's stated "host on my own server" goal; skip.

**Recommendation:** Caddy reverse-proxy in front of a Node `ws` server. One box, automatic HTTPS,
WebSocket-native.

### 5.4 Ports summary

| Port | Who | Exposed publicly? |
|------|-----|-------------------|
| 22 | SSH | yes (key-only) |
| 80 | Caddy (HTTP → redirects to 443 + ACME challenge) | yes |
| 443 | Caddy (HTTPS + `wss://`) | yes |
| 8080 | Node `ws` server | **no** — localhost only, behind Caddy |

Only 22/80/443 face the internet. The game port (8080) is never opened in the firewall; Caddy
reaches it over localhost. (If you skip Caddy and expose Node directly for raw-IP HTTP testing,
you'd open 8080 instead — see §6.2.)

### 5.5 Note on the existing COOP/COEP headers

`vite.config.ts` sets `Cross-Origin-Opener-Policy: same-origin` and
`Cross-Origin-Embedder-Policy: require-corp` (for SharedArrayBuffer/AudioWorklet). Those are
**dev-server** headers; in production **Caddy must send the same headers** for the cross-origin
isolation to hold. Add to the `handle` block:

```
header {
    Cross-Origin-Opener-Policy "same-origin"
    Cross-Origin-Embedder-Policy "require-corp"
}
```

COEP `require-corp` governs **subresources** (scripts, images, audio), **not** the WebSocket
connection itself — WS is exempt from CORP — so it won't block `wss://`. But every static asset
the page loads must be same-origin or carry CORP headers, which they are when served from your
own Caddy. Worth verifying after deploy that the game still boots with isolation on.

Sources: [Caddy](https://caddyserver.com/), [Caddy reverse_proxy directive](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy), [Caddy reverse-proxy quickstart](https://caddyserver.com/docs/quick-starts/reverse-proxy), [MassiveGRID: deploy Node w/ PM2+nginx](https://massivegrid.com/blog/deploy-nodejs-pm2-nginx-ubuntu-vps/), [vite.config.ts]

---

## 6. Hosting on the user's own server + how "join by IP" actually works

### 6.1 Two meanings of "their own server"

1. **A VPS they rent and control** (Hetzner/DigitalOcean/etc.) — has a clean **public IPv4**,
   no NAT, no ISP interference. **Strongly recommended.**
2. **A box in their home** (old PC, NUC, Raspberry Pi) — behind their router's NAT, possibly
   behind ISP **CGNAT**, with a **dynamic** public IP. Doable but fiddly (§6.4).

### 6.2 VPS recommendation

| Provider / plan | Specs | ~Price (2026) | Notes |
|-----------------|-------|---------------|-------|
| **Hetzner CX23** | 2 vCPU / 4 GB / 40 GB / **20 TB** | **€3.99/mo** | Cheapest credible box; huge bundled transfer; EU/US regions. **Recommended.** |
| Hetzner CPX22 | 2 vCPU(AMD) / 4 GB / 40 GB / 20 TB | €7.99 (~$9.49)/mo | More CPU headroom. |
| DigitalOcean Basic Droplet | 1 vCPU / 1 GB / ~25 GB / 1 TB | $4/mo (entry) | Pricier per spec; broader managed ecosystem + great docs. |
| DigitalOcean 2vCPU/4GB | 2 vCPU / 4 GB | ~$24/mo | ~2.5× Hetzner for similar specs. |

For a friends-only DOOM server, **any** of the ~€4–5/mo tiers is ample (the sim is light; the
load is a few WS connections). Pick **Hetzner CX23** for price + bandwidth; pick **DigitalOcean**
if the user values its tutorials/managed add-ons. Either gives a public IPv4 you can hand to
friends.

OS: **Ubuntu LTS** (24.04/26.04) — every guide below assumes it.

Sources: [Better Stack: DigitalOcean vs Hetzner 2026](https://betterstack.com/community/guides/web-servers/digitalocean-vs-hetzner/), [Hetzner pricing 2026](https://bestusavps.com/reviews/hetzner/), [ObjectWire: Hetzner vs DO 2026](https://www.objectwire.org/define/hetzner-cloud-vs-digitalocean)

### 6.3 How "join by IP" works in practice + when you need a domain/TLS

The crux: **a browser won't open `ws://` (insecure WebSocket) from an `https://` page**
(mixed-content), and modern browsers increasingly restrict insecure WS generally. The **only**
place plain `ws://` is reliably allowed is `localhost`/`127.0.0.1`. So:

| You serve the page as… | WS scheme the page may use | Browser allows? |
|------------------------|----------------------------|-----------------|
| `http://<ip>/` (no TLS) | `ws://<ip>:port` | ✅ Yes — both insecure, no mixed content. Simplest "raw IP" path. |
| `https://<host>/` (TLS) | `wss://<host>/ws` | ✅ Yes — both secure. **Recommended.** |
| `https://<host>/` (TLS) | `ws://<ip>:port` (insecure) | ❌ **Blocked** (mixed content). |
| `http://<ip>/` | `wss://<ip>/ws` | ⚠️ Needs a cert valid for the IP — see below; usually impractical for a bare IP. |

So there are two clean shapes:

- **A. Raw IP, plain HTTP (zero certs, quickest):** serve client over `http://<ip>/`, connect
  `ws://<ip>:port`. Friends type `http://<your-ip>` in the browser. **Works today, no domain, no
  TLS.** Downsides: not encrypted; some browsers warn; you can't use features that require a
  secure context (SharedArrayBuffer/cross-origin isolation — which this project's COOP/COEP setup
  wants). Fine for a first playtest, weak for "real."
- **B. Hostname + TLS, `wss://` (recommended):** you don't need to *buy* a domain — a free
  **wildcard-DNS-for-IP** service gives you one instantly:
  - **`<dashed-ip>.sslip.io`** or **`<ip>.nip.io`** resolve to that IP with no signup, and Caddy
    can get a real Let's Encrypt cert for that hostname via HTTP-01. e.g. `203-0-113-5.sslip.io`.
    ([sslip.io], [nip.io])
  - **DuckDNS** gives a free stable `name.duckdns.org` you point at your IP (and it can track a
    changing home IP — §6.4).
  - As of 2025, **Let's Encrypt can also issue certs for bare public IPs** (short-lived, ~6-day,
    auto-renewed via ACME) — so `https://<ip>` is becoming possible without any hostname, though
    sslip.io/DuckDNS + Caddy is the more battle-tested path. ([Let's Encrypt IP certs])

  With B, Caddy auto-provisions the cert, friends open `https://<dashed-ip>.sslip.io/`, the page
  connects `wss://<dashed-ip>.sslip.io/ws`, everything is encrypted and secure-context-clean.

**Recommendation:** Use **B** (sslip.io/DuckDNS hostname + Caddy auto-TLS). It's the same effort
as A once Caddy is installed, and it unlocks `wss://` + secure context (which the project's
COOP/COEP config wants). Keep **A** in your pocket as the 5-minute "does it even connect" test.

Sources: [WebSocket.org: wss vs ws](https://websocket.org/reference/wss-vs-ws/), [MDN: secure contexts](https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Secure_Contexts), [MDN: WebSocket client apps](https://developer.mozilla.org/en-US/docs/Web/API/WebSockets_API/Writing_WebSocket_client_applications), [sslip.io](https://sslip.io/), [nip.io](https://nip.io/), [Let's Encrypt IP-SSL](https://freemindtronic.com/lets-encrypt-ip-ssl-no-domain/)

### 6.4 Home-hosting caveats (if not a VPS)

If hosting from home instead of a VPS:
- **Port forwarding:** forward router ports 80/443 (or your game port) to the box's reserved LAN
  IP, TCP. The box also needs a **reserved/static LAN IP** (DHCP reservation). ([portforward.com])
- **CGNAT killer:** many ISPs put you behind **carrier-grade NAT**, so you have **no reachable
  public IP** and port-forwarding can't help. Test: does your router's WAN IP equal
  `whatismyip`? If not (or it's a `100.64.x.x` address), you're CGNATed. Then you must either ask
  the ISP for a public IP or use a **tunnel** (Cloudflare Tunnel / localtonet / Tailscale Funnel)
  that gives a public URL without port-forwarding. ([localtonet], [port-forward NAT basics])
- **Dynamic IP:** home IPs change; use **DuckDNS** (a tiny cron updates the record) so friends
  use a stable hostname. ([DuckDNS via dynamic DNS])
- **Verdict:** for "friends join reliably," a **€4 VPS removes every one of these problems**
  (clean public IP, no NAT/CGNAT, stable IP). Recommend the VPS unless the user specifically
  wants home-hosting.

Sources: [portforward.com game servers](https://portforward.com/game-servers/), [Localtonet: host a game server at home](https://localtonet.com/blog/host-game-server-at-home-play-with-friends), [DEV: NAT & port forwarding](https://dev.to/godofgeeks/nat-and-port-forwarding-3jpn)

---

## 7. Process management — keep the Node server alive

Two good options; pick one.

### 7.1 systemd (recommended for simplicity)

Lightweight, no extra dependency, integrates with OS boot, restarts on crash. `/etc/systemd/system/doom.service`:

```ini
[Unit]
Description=DOOM-TS game server
After=network.target

[Service]
Type=simple
User=doom
WorkingDirectory=/opt/doom/packages/server
ExecStart=/usr/bin/node dist/index.js
Environment=NODE_ENV=production PORT=8080
Restart=always
RestartSec=2

[Install]
WantedBy=multi-user.target
```

`sudo systemctl enable --now doom` → runs now and on every boot; `journalctl -u doom -f` for logs.

### 7.2 pm2 (if you want zero-downtime reloads / clustering)

`pm2` gives `pm2 reload` (zero-downtime), built-in monitoring, log rotation, and `pm2 startup`
to survive reboots. Useful if you redeploy often. Note: **a single authoritative game server
holds room state in memory**, so **don't cluster it across workers** (each worker would have its
own rooms and WS connections aren't shared) unless you add Redis-backed shared state — out of
scope for friends-only. Run it as a single instance.

```
pm2 start dist/index.js --name doom
pm2 save && pm2 startup        # persist across reboot
```

**Recommendation:** **systemd** for a set-and-forget friends box. **pm2** if the user expects to
iterate/redeploy frequently and wants reloads without dropping connections.

Sources: [MassiveGRID: Node + PM2 + nginx](https://massivegrid.com/blog/deploy-nodejs-pm2-nginx-ubuntu-vps/), [USAVPS: deploy Node w/ PM2 (2026)](https://usavps.com/post/deploy-nodejs-app-usa-vps-pm2-nginxl-zero-downtime-deploy-scripts-rollback-strategies-and-environment-secrets-management/), [Panelica: Node+nginx+PM2+SSL](https://panelica.com/blog/deploy-nodejs-on-a-vps-nginx-pm2-ssl-and-production-best-practices)

### 7.3 Docker (optional)

A `Dockerfile` (build → `node dist/index.js`) + `docker compose` with Caddy as a second service
is a clean, reproducible alternative. Adds container overhead/learning but makes "rebuild and
redeploy" one command and isolates Node from the host. Optional; systemd is simpler for one box.

---

## 8. Ops & security for a small friends-only deployment

Baseline hardening (Ubuntu), in order, before exposing the game:

1. **Non-root user** for the app: `adduser doom`; run the service as `doom` (see §7 unit). Never
   run Node as root.
2. **SSH keys only:** copy your key (`ssh-copy-id`), then in `/etc/ssh/sshd_config` set
   `PasswordAuthentication no` and `PermitRootLogin no`. Prefer **Ed25519** keys. Restart sshd.
3. **UFW firewall:** default-deny inbound, allow only what's needed:
   ```
   sudo ufw default deny incoming
   sudo ufw default allow outgoing
   sudo ufw allow 22/tcp        # SSH (consider limiting to your IP)
   sudo ufw allow 80/tcp        # HTTP (ACME + redirect)
   sudo ufw allow 443/tcp       # HTTPS + wss
   sudo ufw enable
   ```
   **Do not** open 8080 — Caddy reaches Node over localhost. (Only open the game port if you run
   the §6.3-A raw-IP/plain-HTTP path without Caddy.)
4. **fail2ban** for SSH brute-force protection; **unattended-upgrades** for automatic security
   patches.
5. **App-level limits (DoS hygiene for a public WS):**
   - per-room **max players** enforced server-side (§4.4);
   - cap total concurrent connections and **connections per IP**;
   - **validate every inbound message** against the `shared/net` schema; drop malformed/oversized
     frames (set `maxPayload` on the `ws` server);
   - rate-limit room creation and input messages; ignore inputs for players not in a room;
   - because the server is **authoritative**, a hacked client can't cheat the sim — but it can
     spam, so input validation + rate limits are the real defense.
6. **Don't trust the client:** all game decisions on the server (this is the netcode doc's
   thesis; the ops consequence is you never need to "secure" client logic — you ignore it).
7. **Backups:** for friends-only with in-memory rooms there's little persistent state; back up
   the deploy config (Caddyfile, systemd unit, `.env`) in the repo, not the box.

Sources: [MassiveGRID: Ubuntu VPS hardening](https://massivegrid.com/blog/ubuntu-vps-security-hardening-guide/), [DigitalOcean: UFW on Ubuntu](https://www.digitalocean.com/community/tutorials/how-to-set-up-a-firewall-with-ufw-on-ubuntu), [HostMyCode: VPS hardening 2026](https://www.hostmycode.com/tutorials/vps-hardening-tutorial-2026-secure-ubuntu-ssh-keys-ufw-updates-safe-defaults-hosting), [DigitalOcean: app server on Ubuntu 24.04](https://www.digitalocean.com/community/tutorials/set-up-configure-application-server-ubuntu-24-04)

---

## 9. Scaling notes (small)

For a friends-only game, scaling is mostly **bandwidth**, not CPU:
- The sim is cheap; one CX23 vCPU runs many rooms.
- Bandwidth ≈ `snapshotBytes × players × tickrate × players` (each player receives state about
  the others). At 35 Hz with a handful of players and a compact snapshot (the netcode doc's job
  to keep it small via delta-compression), a single box is far under the 20 TB Hetzner allowance.
- **Vertical first:** if you ever need more, a bigger single instance keeps the in-memory room
  model intact (no cross-process state).
- **Horizontal** (multiple server processes/boxes, a gateway that routes a room code to the box
  hosting it, Redis for shared presence) is how frameworks like Colyseus scale to 10k+ CCU — far
  beyond "friends," documented here only so the path is known. Don't build it for v1.
- **Tickrate/snapshot tuning** is the real lever and lives in `multiplayer-netcode.md`.

Sources: [Colyseus scalability](https://colyseus.io/), [DCHost: WebSockets real-time](https://www.dchost.com/blog/en/how-websockets-and-real-time-apps-really-work/)

---

## 10. DEPLOY RUNBOOK — exact steps

Assumes: monorepo from §2 exists; you've rented an **Ubuntu LTS** VPS (Hetzner CX23) and have its
**public IP** (call it `203.0.113.5`). Replace IPs/names with yours. Two variants: **B (TLS,
recommended)** and a **quick A (raw IP, no TLS)** for a first smoke test.

### Phase 0 — Build the client + server (locally or on the box)

```bash
# at repo root
npm install                       # links @doom/shared into client + server
npm run -w @doom/client build     # → packages/client/dist/  (static)
npm run -w @doom/server build     # → packages/server/dist/  (tsc; or run with tsx)
```

### Phase 1 — Provision the box

```bash
ssh root@203.0.113.5
adduser doom && usermod -aG sudo doom
# copy your SSH key to the doom user, then log back in as doom
# harden SSH (§8 step 2), then:
sudo apt update && sudo apt -y upgrade
sudo apt -y install ufw fail2ban
# Node LTS (via NodeSource or nvm):
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt -y install nodejs
node -v        # confirm 22.x
```

### Phase 2 — Firewall

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
sudo ufw status            # verify
```

### Phase 3 — Ship the code

```bash
# from your machine — copy the repo (or git clone on the box):
rsync -avz --exclude node_modules ./ doom@203.0.113.5:/opt/doom/
ssh doom@203.0.113.5
cd /opt/doom && npm install
npm run -w @doom/client build      # if not built locally
npm run -w @doom/server build
sudo mkdir -p /var/www/doom && sudo cp -r packages/client/dist /var/www/doom/
```

### Phase 4 — Run the game server (systemd)

```bash
sudo tee /etc/systemd/system/doom.service >/dev/null <<'EOF'
[Unit]
Description=DOOM-TS game server
After=network.target
[Service]
Type=simple
User=doom
WorkingDirectory=/opt/doom/packages/server
ExecStart=/usr/bin/node dist/index.js
Environment=NODE_ENV=production PORT=8080
Restart=always
RestartSec=2
[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload
sudo systemctl enable --now doom
journalctl -u doom -f       # confirm "listening on :8080"
```

### Phase 5 — Reverse proxy + TLS (variant B, recommended)

```bash
# install Caddy (official apt repo)
sudo apt -y install debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt -y install caddy

# pick a hostname that maps to your IP for free:  203-0-113-5.sslip.io
sudo tee /etc/caddy/Caddyfile >/dev/null <<'EOF'
203-0-113-5.sslip.io {
    encode zstd gzip
    header {
        Cross-Origin-Opener-Policy "same-origin"
        Cross-Origin-Embedder-Policy "require-corp"
    }
    handle /ws* {
        reverse_proxy localhost:8080
    }
    handle {
        root * /var/www/doom/dist
        try_files {path} /index.html
        file_server
    }
}
EOF
sudo systemctl reload caddy
# Caddy now auto-fetches a Let's Encrypt cert for 203-0-113-5.sslip.io
```

Client must connect to `wss://203-0-113-5.sslip.io/ws` in production (derive from
`window.location`: `const ws = new WebSocket((location.protocol==='https:'?'wss':'ws')+'://'+location.host+'/ws')`).

### Phase 5-alt — Quick raw-IP smoke test (variant A, no TLS)

Skip Caddy. Have Node serve `dist/` itself and the WS on the same port, OR open the game port and
serve client over plain HTTP:

```bash
sudo ufw allow 8080/tcp           # only for this quick test
# Node serves http://203.0.113.5:8080/  and  ws://203.0.113.5:8080/ws
```

Friends open `http://203.0.113.5:8080/`. Page is plain HTTP so `ws://` is allowed. **No
encryption, no secure context** — use only to confirm connectivity, then switch to B and
`sudo ufw delete allow 8080/tcp`.

### Phase 6 — Friends connect

- **Variant B:** send them `https://203-0-113-5.sslip.io/` → they land in the client → enter a
  room code (or auto-join the default room) → play.
- **Variant A:** send them `http://203.0.113.5:8080/`.
- Co-op vs deathmatch is chosen in the lobby UI (§4); the host creates the room and shares the
  code (or everyone hits the same URL for the default room).

### Phase 7 — Redeploy later

```bash
cd /opt/doom && git pull
npm install
npm run -w @doom/client build && sudo cp -r packages/client/dist /var/www/doom/
npm run -w @doom/server build
sudo systemctl restart doom        # (or `pm2 reload doom` for zero-downtime)
```

---

## 11. Open questions / couldn't-fully-verify

- **Let's Encrypt bare-IP certs** are new (2025) and short-lived (~6 days); the more proven path
  for this use case is **sslip.io/DuckDNS hostname + Caddy**, so the runbook uses that. If the
  user insists on a literal `https://<ip>` with no hostname, re-verify ACME IP-cert support in
  the chosen ACME client at implementation time.
- **Exact Hetzner/DO prices** drift; figures here are 2026 snapshots (Hetzner had an April 2026
  adjustment). Re-check the pricing pages before purchase.
- **`ws` vs Colyseus** is the one decision that couples to the netcode doc (Colyseus dictates the
  state-sync model). Resolve it jointly with `multiplayer-netcode.md` before coding.
- The **`core` DOM-split** (§2.3) is a change to the frozen `ARCHITECTURE.md` contract — must be
  ratified there, not decided in this doc.
- All hosting/library facts here are from web sources (cited inline); the project-specific claims
  (sim folders, 35 Hz loop, COOP/COEP) are from the repo (`ARCHITECTURE.md`, `web-arch.md`,
  `vite.config.ts`).

---

### Consolidated sources

Repo: `ARCHITECTURE.md`, `docs/research/web-arch.md`, `vite.config.ts`, `package.json`; memory `online-multiplayer-plan`.
Web (accessed 2026-06): Hetzner/DO pricing — Better Stack, ObjectWire, bestusavps; Node deploy/PM2/systemd — MassiveGRID, USAVPS, Panelica; Caddy — caddyserver.com docs + community; WebSocket security/wss — WebSocket.org, MDN; libraries — PkgPulse, Colyseus docs/GitHub; monorepo — npm docs, Nx, enZane/adiun examples; IP/TLS — sslip.io, nip.io, Let's Encrypt IP-SSL; home hosting — portforward.com, localtonet; hardening — DigitalOcean, HostMyCode. Full URLs are inline per section.
