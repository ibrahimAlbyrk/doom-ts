# tools/extract-wad — Freedoom WAD → web assets extractor (PLACEHOLDER)

Owned by the **asset worker**. This is a stub; the real extractor is built per
`docs/research/assets.md` §3–§5.

## What it does (when implemented)

A headless Node/TypeScript tool that reads `freedoom2.wad` (Freedoom 0.13.0) and emits
web-ready assets + a single `public/manifest.json` matching the schema in
`src/assets/manifest.ts`:

1. Parse the WAD header + directory; track `S_/F_/P_` marker namespaces.
2. Load `PLAYPAL[0]` → 256-entry RGB palette.
3. Flats (`F_*`) → 64×64 RGBA PNG.
4. `PNAMES` + `TEXTURE1` + patches → composited wall-texture PNGs.
5. Sprites (`S_*`) → RGBA PNG with picture-header `leftoffset/topoffset`; expand
   packed 8-char lumps into two mirrored frames.
6. Status-bar/HUD (`STBAR`, `STF*`, `STT*`, `STARMS`, `STKEYS*`) → PNG.
7. Fonts `STCFN033..095` → per-glyph PNG + width.
8. Sounds `DS*` (DMX) → trim 16-byte pads → WAV/OGG.
9. Write `manifest.json` + `THIRD-PARTY/freedoom-LICENSE.txt` (verbatim BSD block + CREDITS).

## Inputs / outputs

- Input: `freedoom2.wad` (download per assets.md §1 — **not committed**, see `.gitignore`).
- Output: `public/assets/**` + `public/manifest.json` (both gitignored; generated).

## Run

```sh
npm run extract-assets -- --wad path/to/freedoom2.wad
```

## Licensing obligation

Freedoom is BSD-3-Clause. The build MUST reproduce the copyright notice, the three
conditions, and the AS-IS disclaimer (already surfaced in the in-game About/Credits
screen — see `src/ui/credits.ts`). Do not imply Freedoom endorsement.
