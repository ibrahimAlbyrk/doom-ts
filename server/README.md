# server/ — authoritative simulation host (placeholder)

This directory is the home of the **future Node multiplayer server**. In P0 it holds a
single thing: `headless-sim.ts`, a smoke runner that proves the shared simulation
(`src/`) runs under Node with **no renderer/audio/input/DOM**. That headless property is
the whole point of the P0 foundation — the server will run the *same* `GameSession` the
browser runs, just authoritatively for all players.

## What's here now (P0)

- **`headless-sim.ts`** — boots a `GameSession` with a DOM-free `SimContext` + null
  services, drives a scripted command stream through one level, and prints a
  deterministic end-state checksum (same seed → same checksum).
  Run it: `npm run sim:headless`.

## How the shared sim stays headless

The sim is type-checked **without `lib.dom`** by `tsconfig.sim.json`
(`npm run typecheck:sim`). If anyone imports a browser type (canvas/document/window) into
the shared sim, that check fails. The split that made this possible:

- `src/core` carries only DOM-free contracts (entity structs, `MapData`, `SimContext`,
  render *data* shapes). The `Renderer` service interface moved to `src/render`, and
  `GameContext`/`IGameState` moved to `src/game/types.ts` (both client-only).
- `src/game/session.ts` (`GameSession`) is the headless, deterministic sim driven by a
  serializable `TicCommand`. All presentation lives in `src/game/client.ts` (`GameClient`).

## What lands here later (see docs/multiplayer-plan.md)

- **P2** — the Colyseus server: one `Room == one match` wrapping a headless `GameSession`,
  ticking at 30 Hz, broadcasting snapshots; clients connect via a `RemoteSession`
  (`src/session/remote-session.ts`) implementing the same `Session` interface offline play
  uses. The `SessionTransport` interface there is the exact seam Colyseus fills.
- **P3b** — the lobby/room system (host, join-by-code, ready-up, host config).
- **P6** — deploy (Caddy + `wss` + sslip.io, per docs/research/multiplayer-deploy.md).

A future package layout (`@doom/server` importing `@doom/shared`) is optional; today the
server just imports the shared sim from `../src` directly, which keeps single-player and
the build simple. See docs/multiplayer-plan.md §2.
