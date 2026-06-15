# Publishing the DOOM client to itch.io

This repo can produce a static, browser-playable client that talks to the live
VPS multiplayer server. Single Player works fully offline; MULTIPLAYER connects
to the VPS automatically.

## 1. Build the upload zip

```sh
npm install            # first time only
npm run extract-assets # first time only — extracts Freedoom into public/assets
npm run build:itch     # self-contained dist/index.html + doom-itch.zip (VPS URL baked in)
```

`build:itch` bakes `VITE_MP_SERVER_URL=wss://185.249.197.74.sslip.io`, **embeds every
asset as a `data:` URL and inlines the JS** into a single self-contained
`dist/index.html`, then zips it to `doom-itch.zip` (index.html at the zip root).

Why self-contained: itch.io serves HTML games in a `sandbox="allow-scripts"` iframe, so
the document origin is **"null"**. From an opaque origin every `fetch()` (and even the
module-script load) is cross-origin and needs CORS headers the static host does not send
— so a normal build is blocked. The itch build performs **zero network asset fetches**
(everything is inlined), so it loads from the sandbox with no CORS dependency. The
multiplayer WebSocket is unaffected (WebSockets are not CORS-preflighted).

Nothing else to do — `doom-itch.zip` is ready to upload. (To re-zip an existing `dist/`
without rebuilding: `npm run zip:itch`.)

## 2. Upload to itch.io

1. itch.io → **Create new project** (or edit an existing one).
2. **Kind of project:** HTML.
3. Under *Uploads*, upload `doom-itch.zip`.
4. Tick **This file will be played in the browser**.
5. Set **Embed / viewport size** (e.g. `1280 x 720`) and enable
   **Fullscreen button**.
6. SharedArrayBuffer / "click to activate COOP+COEP" is **NOT needed** — the
   game does not use SharedArrayBuffer.
7. **Save** (and set the page to Public when ready).

## 3. Playing with friends

Friends open the itch.io page →
**MULTIPLAYER → JOIN → pick a room from the live list**. The client connects to
the VPS automatically (`wss://185.249.197.74.sslip.io`). **Single Player** works
offline with no server.

## Caveat — server URL is baked at build time

The VPS address is compiled into the build. If the server address ever changes,
re-run `npm run build:itch` (it re-zips automatically) and re-upload the new zip.

## Caveat — no music in the itch build

The embedded build ships textures, sprites, UI/fonts and **sound effects**, but **not the
per-level music** (the extractor emits ~38 MB of uncompressed-WAV tracks; inlining them
would roughly quadruple the bundle). Music is silently skipped in this build — no fetch,
no error. The default same-origin build still streams music normally.
