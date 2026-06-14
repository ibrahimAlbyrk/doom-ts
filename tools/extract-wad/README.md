# tools/extract-wad — Freedoom WAD → web assets extractor

Owned by the **asset worker**. A headless Node/TypeScript tool (no native deps —
PNG via Node's built-in `zlib`, WAV written directly) that reads `freedoom2.wad`
(Freedoom 0.13.0) and emits `public/assets/**` + `public/manifest.json` matching the
frozen schema in `src/assets/manifest.ts`. Pipeline per `docs/research/assets.md`
§3–§5.

## Layout

```
extract.ts            orchestrator (entry; `npm run extract-assets`)
verify-manifest.ts    headless check: loads the manifest via the real AssetLoader,
                      validates schema + file existence + src/data roster coverage
lib/
  wad.ts        WAD header/directory reader + S_/F_/P_ marker namespaces
  palette.ts    PLAYPAL[0] → 256 RGB triples
  picture.ts    Doom picture (patch) format → RGBA (transparency from posts)
  png.ts        minimal RGBA PNG encoder (zlib, zero deps)
  textures.ts   PNAMES + TEXTURE1 → composited wall textures
  sound.ts      DMX (DS*) → trimmed 16-bit PCM WAV
  roster.ts     sprite-prefix → entity map (derived from src/data) + UI/font/sound sets
  license.ts    verbatim BSD-3-Clause notice + AS-IS disclaimer (bundled for Credits)
```

## What it emits

1. `palette.json` — PLAYPAL[0] as 256 `[r,g,b]` triples (loaded into the store as the
   renderer's colormap palette).
2. `flats/*.png` — 64×64 opaque floors/ceilings.
3. `textures/*.png` — composited wall textures (PNAMES/TEXTURE1 patches, transparency
   preserved).
4. `sprites/<PREFIX>/*.png` — every frame for each roster prefix, RGBA with baked
   transparency; picture `leftoffset/topoffset` preserved as the manifest `origin`.
   8-char packed lumps (e.g. `TROOA2A8`) emit **two** frame entries from one PNG — the
   second `mirror: true` (renderer flips at draw time, `origin[0]' = w − origin[0]`).
5. `ui/*.png` — status bar, player face (STF*), digits (STT*/STYS*/STG*), keys.
6. `fonts/STCFN/NNN.png` — HUD font glyphs (ASCII 33–95), per-glyph width.
7. `audio/sfx/*.wav` — all digital DS* sounds (DMX format 3 → 16-bit PCM WAV; the 16+16
   sample-byte padding is trimmed). PC-speaker `DP*` lumps are skipped.
8. `THIRD-PARTY/freedoom-LICENSE.txt` — verbatim BSD notice + AS-IS disclaimer +
   upstream CREDITS (referenced by `manifest.meta.attribution`).
9. `public/manifest.json` — the single `AssetManifest` the runtime loads at boot.

## Inputs

`freedoom2.wad` from Freedoom 0.13.0 (BSD-3-Clause free content — extracting and
bundling is the sanctioned use). **Not committed** (`*.wad` is gitignored; the download
cache lives in `.cache/`, also gitignored).

```sh
# Download once into the gitignored cache (the default --wad path):
mkdir -p tools/extract-wad/.cache && cd tools/extract-wad/.cache
curl -LO https://github.com/freedoom/freedoom/releases/download/v0.13.0/freedoom-0.13.0.zip
unzip freedoom-0.13.0.zip   # → freedoom-0.13.0/freedoom2.wad
```

## Run

```sh
npm run extract-assets                  # uses tools/extract-wad/.cache/freedoom-0.13.0/freedoom2.wad
npm run extract-assets -- --wad /path/to/freedoom2.wad

# Validate the emitted manifest (schema + files + roster) via the real loader:
node --experimental-strip-types tools/extract-wad/verify-manifest.ts
```

## Licensing obligation

Freedoom is BSD-3-Clause. The build MUST reproduce the copyright notice, the three
conditions, and the AS-IS disclaimer — emitted to
`public/assets/THIRD-PARTY/freedoom-LICENSE.txt` and surfaced in the in-game
About/Credits screen (`src/ui/credits.ts`). Do not imply Freedoom endorsement.
