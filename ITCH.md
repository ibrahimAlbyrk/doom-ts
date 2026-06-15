# Publishing the DOOM client to itch.io

This repo can produce a static, browser-playable client that talks to the live
VPS multiplayer server. Single Player works fully offline; MULTIPLAYER connects
to the VPS automatically.

## 1. Build the upload zip

```sh
npm install            # first time only
npm run extract-assets # first time only — extracts Freedoom into public/assets
npm run build:itch     # builds dist/ with the VPS server URL baked in
```

`build:itch` runs `VITE_MP_SERVER_URL=wss://185.249.197.74.sslip.io vite build`.
The result is in `dist/` with `index.html` at the root.

Zip the **contents** of `dist/` (so `index.html` is at the zip root, not nested):

```sh
cd dist && zip -rq ../doom-itch.zip . && cd ..
```

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
re-run `npm run build:itch`, re-zip `dist/`, and re-upload the new zip to itch.io.
