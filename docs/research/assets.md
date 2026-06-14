# Freedoom Asset Acquisition & Extraction Plan

Plan for pulling Freedoom art + audio into a Canvas 2D / TypeScript web game as
web-friendly assets (RGBA PNG, WAV/OGG) driven by a JSON manifest.

**Headline**

- Freedoom 0.13.0 (released 2024-01-29) ships everything we need — wall textures,
  flats, enemy/weapon/item sprites, status-bar/UI graphics, fonts, and SFX — inside
  `freedoom1.wad` / `freedoom2.wad`, under a permissive BSD-style license.
- We extract once with a small custom Node/TypeScript WAD reader that applies the
  PLAYPAL palette, emits RGBA PNGs (structural transparency from the picture format)
  and WAV/OGG audio, and writes a single JSON manifest the runtime consumes.

**Licensing verdict:** Redistributable — **YES**. License: **Modified/3-clause BSD**
("BSD New"). We may ship the converted assets inside our web build provided we
reproduce the copyright notice, the list of conditions, and the warranty disclaimer
in our distribution (a `CREDITS`/`LICENSE` page or about screen), and do not use the
Freedoom name/contributor names to endorse our product. See §2.

**Recommended extraction tool:** a **custom Node/TypeScript WAD reader** (lump layer
seeded from an existing JS/TS parser such as `jsdoom` or `wad-js`, PNG encoding via
`pngjs`/`sharp`). Rationale in §4 — it is the only option that produces *exactly* our
manifest schema + correct sprite-offset/transparency handling in one headless pass on
macOS, with no native build step. SLADE/DeuTex are kept as cross-check tools.

---

## 1. Obtaining Freedoom

**Current release:** Freedoom **0.13.0**, tag `v0.13.0`, published **2024-01-29**
(verified via the GitHub releases API; the `published_at` field is
`2024-01-29T23:32:37Z`).

**Official download sources (use these, not mirrors):**

- Project download page: <https://freedoom.github.io/download.html>
- GitHub release (signatures + checksums attached): <https://github.com/freedoom/freedoom/releases>
- Doom Wiki overview: <https://doomwiki.org/wiki/Freedoom>

**Release artifacts (0.13.0):**

| Download | Contains | Use for us |
|---|---|---|
| `freedoom-0.13.0.zip` | `freedoom1.wad` + `freedoom2.wad` | **Primary** — all art + audio |
| `freedm-0.13.0.zip` | `freedm.wad` (deathmatch, no monsters) | Not needed |
| `freedoom-0.13.0-CHECKSUM` | SHA hashes | Verify download |
| `*.zip.sig` | GPG detached signatures | Verify authenticity |

**The two IWADs** (both are standalone "IWAD" replacements; lump *names* match
commercial Doom so engines run unmodified, but every pixel/sample is original
Freedoom content):

- `freedoom1.wad` — "Phase 1", compatible with **The Ultimate Doom** (4 episodes,
  ExMy maps). Uses the Doom 1 monster/asset subset.
- `freedoom2.wad` — "Phase 2", compatible with **Doom II** (MAP01–MAP32). Superset of
  the bestiary (adds Doom II monsters: revenant, mancubus, arch-vile, etc.).

> Recommendation: extract from **`freedoom2.wad`** as the primary source — it contains
> the complete sprite/sound set (Doom II superset). Pull anything Phase-1-only from
> `freedoom1.wad` if a lump is missing.

**Acquisition (manual, out of scope for this task — do NOT run here):**

```sh
# Verify, then unzip — small text/zip only, NOT performed in the research task.
curl -LO https://github.com/freedoom/freedoom/releases/download/v0.13.0/freedoom-0.13.0.zip
shasum -a 256 -c freedoom-0.13.0-CHECKSUM   # after fetching the CHECKSUM file
unzip freedoom-0.13.0.zip                    # -> freedoom1.wad, freedoom2.wad
```

---

## 2. Licensing — exact terms & redistribution verdict

Freedoom is licensed under a **modified (3-clause) BSD license**. The license file is
`COPYING.adoc` in the project repo:
<https://github.com/freedoom/freedoom/blob/master/COPYING.adoc> (Doom Wiki also
records Freedoom's license as a BSD variant: <https://doomwiki.org/wiki/Freedoom>).

**Verbatim license text (`COPYING.adoc`):**

```
Copyright © 2001-2024
Contributors to the Freedoom project.  All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are
met:

  * Redistributions of source code must retain the above copyright
    notice, this list of conditions and the following disclaimer.
  * Redistributions in binary form must reproduce the above copyright
    notice, this list of conditions and the following disclaimer in the
    documentation and/or other materials provided with the distribution.
  * Neither the name of the Freedoom project nor the names of its
    contributors may be used to endorse or promote products derived from
    this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS “AS
IS” AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED
TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A
PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT OWNER
OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL,
EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO,
PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR
PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF
LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING
NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

For a list of contributors to the Freedoom project, see the file
CREDITS.
```

**Can we redistribute the extracted/converted assets inside our web build? — YES.**

- The license permits "Redistribution and use in source and binary forms, **with or
  without modification**" — converting paletted lumps to PNG/OGG is a permitted
  modification, and bundling them in our web build is a permitted binary
  redistribution.
- This single license covers **all** Freedoom-authored content in the WADs (graphics,
  sprites, flats, textures, sounds, music, fonts) — Freedoom's purpose is to be a
  fully free, redistributable replacement for Doom's proprietary IWAD data. There is
  **no** separate or more-restrictive license carved out for sounds/music/fonts in
  `COPYING.adoc`.

**Obligations we must satisfy in the web build (the "binary form" clause):**

1. Reproduce the copyright notice + the three conditions + the "AS IS" disclaimer in
   our "documentation and/or other materials provided with the distribution." For a
   web game that means a shipped `CREDITS`/`LICENSE` file or an in-game About/Credits
   screen that contains the text quoted above.
2. Carry/attribute the contributor list — include or link the upstream `CREDITS` file.
3. Do **not** use "Freedoom" or contributor names to endorse/promote our game
   (3rd clause). Stating factually that art derives from Freedoom is fine; implying
   Freedoom endorses us is not.

There is **no copyleft / share-alike** obligation (BSD, not GPL): our game code and
non-Freedoom assets are unaffected, and we are not required to open-source our build.

> Compliance is cheap: ship one `THIRD-PARTY/freedoom-LICENSE.txt` containing the
> verbatim block above + the CREDITS list, and surface it from an in-game credits
> screen. Add it to the extraction output (see manifest `attribution` field, §5).

---

## 3. WAD internal structure relevant to extraction

Primary reference: Doom Wiki **WAD** page <https://doomwiki.org/wiki/WAD>.

### 3.1 Container & directory

A WAD is `Where's All the Data` — a flat archive. Layout:

- **Header (12 bytes):** `IWAD` magic (4 bytes ASCII) + `int32` lump count +
  `int32` directory offset. (Freedoom IWADs are `IWAD`, not `PWAD`.)
- **Lump data:** raw bytes for each lump, back to back.
- **Directory:** `numLumps` entries × 16 bytes: `int32` file offset, `int32` size,
  8-byte name (ASCII, NUL-padded, case-insensitive, may be < 8 chars).

All multi-byte integers are **little-endian**. Lump order matters — namespaces are
delimited by zero-length **marker lumps**, so the extractor must walk the directory in
order and track the current namespace.

### 3.2 Marker namespaces (zero-length delimiter lumps)

| Markers | Namespace | Notes |
|---|---|---|
| `S_START` … `S_END` | Sprites | Picture-format frames |
| `F_START` … `F_END` | Flats | 64×64 raw paletted; sub-markers `F1_/F2_` |
| `P_START` … `P_END` | Wall patches | Picture-format; sub-markers `P1_/P2_/P3_` |
| (no markers) | Global lumps | `PLAYPAL`, `COLORMAP`, `PNAMES`, `TEXTURE1/2`, `STBAR`, `STF*`, `STCFN*`, `DS*`, `D_*` |

### 3.3 PLAYPAL — palette (the color key for everything)

Ref: <https://doomwiki.org/wiki/PLAYPAL>. 14 palettes packed back-to-back; each is
256 RGB triples = **768 bytes**, total 10752 bytes. Palette **0** is the base
display palette; palettes 1–13 are runtime tints (pain red, item pickup, radiation
suit, invulnerability) we do **not** need for asset export. We only read palette 0:
index → `(R,G,B)` lookup table.

> Note: index 0 in PLAYPAL is **pure black `#000000`** — it is *not* a transparent
> color key. Treating "color index 0" or "black" as transparent is wrong and will
> punch holes in legitimately-black art. Transparency comes from the picture format's
> post structure (§3.5), not from a palette index.

### 3.4 COLORMAP — light shading (not needed for static export)

Ref: <https://doomwiki.org/wiki/COLORMAP>. 34 maps × 256 bytes: 32 light levels +
invulnerability + an all-black row. Each byte remaps a palette index to a darker
index for software-renderer light diminishing. **We skip it for asset extraction** —
a Canvas 2D game does its own lighting/tinting at runtime. Documented here only so the
extractor knows to ignore it.

### 3.5 Picture (patch) format — sprites, wall patches, UI graphics, fonts

Ref: <https://doomwiki.org/wiki/Picture_format>. Used by sprites, wall patches,
status-bar graphics, and font chars. Layout:

- **Header (8 bytes):** `int16` width, `int16` height, `int16` leftoffset,
  `int16` topoffset. The offsets are the sprite's hotspot (origin) used for in-world
  alignment — **we must preserve these in the manifest** (§5), they are essential for
  drawing sprites/weapons at the right screen position.
- **Column array:** `width` × `int32` offsets, each pointing to that column's posts.
- **Posts (per column):** repeated `{ int16... }` — actually `uint8 topdelta`,
  `uint8 length`, 1 pad byte, `length` palette-index bytes, 1 pad byte — until a
  `topdelta == 0xFF` terminator. **Pixels not covered by any post are transparent.**

**Transparency handling (the correct way):** allocate a width×height RGBA buffer
initialized to `alpha = 0`; for each post write `RGB = PLAYPAL0[index], alpha = 255`.
Uncovered runs stay fully transparent. This yields proper cut-out PNGs for sprites and
masked textures with **no color-keying** and no black-halo artifacts. (Tall-patch /
`topdelta` >254 edge case exists for sprites ≥256px tall; Freedoom sprites are short
enough that the classic relative-delta reading is safe, but the reader should handle
it defensively.)

### 3.6 PNAMES + TEXTURE1/TEXTURE2 — composited wall textures

Refs: <https://doomwiki.org/wiki/PNAMES>,
<https://doomwiki.org/wiki/TEXTURE1_and_TEXTURE2>.

Wall textures are **not stored as images** — they are recipes that composite one or
more patches onto a canvas.

- **PNAMES:** `int32` count, then count × 8-byte patch names. Index → patch lump name.
- **TEXTURE1** (and TEXTURE2 if present): `int32` numTextures, then numTextures ×
  `int32` offsets to map-texture records. Each record:
  - 8-byte name, `int32` masked(flags), `int16` width, `int16` height,
    `int32` columndirectory(obsolete), `int16` patchCount, then patchCount × patch
    refs: `int16` originX, `int16` originY, `int16` patchIndex (→ PNAMES),
    `int16` stepDir(unused), `int16` colormap(unused).

**Compositing:** make a `width × height` RGBA canvas (alpha 0), and for each patch ref
draw `PNAMES[patchIndex]` (decoded via §3.5) at `(originX, originY)`. Most wall
textures fully cover the canvas (opaque); some (grates, switches, midtextures) leave
gaps → correctly transparent in the PNG.

### 3.7 Flats — floor/ceiling textures

Ref: <https://doomwiki.org/wiki/Flat>. Between `F_START`/`F_END`. Raw **64×64**
(4096 bytes), row-major, one palette index per byte, **no header, no transparency,
fully opaque**. Convert directly via PLAYPAL0 → RGBA (alpha always 255). (Some
animated/larger flats exist but standard Freedoom flats are 64×64.)

### 3.8 Sprites + naming / rotation convention

Ref: <https://doomwiki.org/wiki/Sprite>. Between `S_START`/`S_END`, picture format.
Lump name encodes **frame** and **rotation**:

```
NNNN  F  R   [ F2 R2 ]
│     │  │     └──┴── optional 2nd view packed in same lump (mirror image)
│     │  └────────── rotation digit
│     └───────────── frame letter
└─────────────────── 4-char sprite name (entity prefix)
```

- **Name (4 chars):** the entity, e.g. `TROO` (imp), `POSS` (zombieman), `SHOT`
  (shotgun pickup). Same prefixes as commercial Doom (§6).
- **Frame letter:** `A`, `B`, `C`, … animation frame (sequence of an animation/state).
- **Rotation digit:**
  - `0` = single rotation used for **all** viewing angles (rotationally symmetric
    items/pickups, e.g. `MEDIA0`, `BON1A0`).
  - `1`–`8` = the eight 45° view angles. `1` = front (facing the viewer), increasing
    clockwise (so `5` = rear). Renderer picks the rotation from the angle between the
    camera and the sprite.
- **Packed mirror (8-char lumps):** e.g. `SARGB3B7` means "this lump is frame `B`
  rotation `3`, **and** its horizontal mirror is frame `B` rotation `7`." Saves space
  for left/right-symmetric views. The extractor must emit **two** manifest frame
  entries from one such lump — the second flipped horizontally (and its leftoffset
  mirrored as `width - leftoffset`).

Example decode: `TROOA1` = imp, frame A, rotation 1 (front). `TROOA2A8` = imp frame A
rotation 2, plus mirror → rotation 8.

### 3.9 Sounds — `DS*` DMX lumps

Refs: <https://doomwiki.org/wiki/Sound>,
<https://doomwiki.org/wiki/DMX_(sound_library)>. Sound effects are lumps named
`DS` + effect (e.g. `DSPISTOL`, `DSSHOTGN`, `DSDSHTGN`). DMX digitized-sound format:

- **Header (8 bytes):** `uint16` format (`= 3` for digital), `uint16` sample rate
  (usually **11025 Hz**), `uint32` sample count.
- **Samples:** unsigned **8-bit mono PCM**, one byte per sample. The first 16 and last
  16 sample bytes are **padding** (duplicate of the first/last real sample) and should
  be trimmed.

Convert: read rate + count → wrap the (trimmed) 8-bit unsigned PCM in a WAV container,
or transcode to OGG (smaller, broadly supported in browsers). `DP*` lumps are PC-
speaker sounds (format 0) — **skip** them.

### 3.10 Music — `D_*` MUS lumps (optional)

Ref: <https://doomwiki.org/wiki/MUS>. Music lumps (e.g. `D_RUNNIN`, `D_E1M1`) are in
the MIDI-like **MUS** format. Web playback path: `MUS → MID` (e.g. `mus2mid`) →
render to OGG with a soundfont (e.g. `fluidsynth`), or play via a JS MIDI synth. This
is heavier and **optional** per scope — defer unless we want background music; SFX
(§3.9) are the priority.

### 3.11 Status-bar / HUD graphics

Refs: <https://doomwiki.org/wiki/STBAR>, <https://doomwiki.org/wiki/Status_bar>. All
picture format:

- `STBAR` — status-bar background (320×32).
- `STF*` faces — the player face animation: `STFST**` (front, by health band &
  direction), `STFGOD0` (god mode), `STFDEAD0` (dead), `STFEVL0` (evil grin),
  `STFOUCH0`/`STFKILL0` (pain), `STFTL*/STFTR*` (turn). Naming `STFSTxy`: `x` health
  band, `y` look direction.
- `STTNUM0`–`STTNUM9`, `STTMINUS`, `STTPRCNT` — big red status-bar digits / `-` / `%`.
- `STYSNUM0`–`9` — small yellow digits; `STGNUM*` — gray digits.
- `STARMS` — the "arms" panel background; `STKEYS*` — key indicator icons.

### 3.12 Fonts

Ref: <https://doomwiki.org/wiki/STCFN>. The HUD/console message font is one picture
lump per ASCII code: **`STCFN033`–`STCFN095`** (`'!'`=33 … `'_'`=95; space=032 is
absent → render as fixed gap). Variable width — each lump's width gives the glyph
advance. Doom's large menu/title text is pre-rendered art (`M_*`) rather than a
generic font; the big numeric font is the `STTNUM*`/`WINUM*` digit set. For in-game
text rendering, **`STCFN*` is the font to extract**.

---

## 4. Extraction pipeline (headless, macOS)

### 4.1 Tool comparison

| Option | Headless on macOS | PNG + correct transparency | Captures sprite offsets | Emits our JSON manifest | Install pain |
|---|---|---|---|---|---|
| **Custom Node/TS reader** | ✅ pure JS, CI-friendly | ✅ full control (post→alpha) | ✅ from picture header | ✅ native — single pass | none (`npm i`) |
| DeuTex CLI | ✅ scriptable | ✅ PNG/PPM, palette-aware | partial (offsets to side files) | ❌ writes per-lump files only | builds from source (autotools) |
| SLADE | ⚠️ GUI-first; limited batch | ✅ via GUI/scripting | ✅ in editor | ❌ no manifest export | brew/app, GUI |
| `jsdoom` / `wad-js` as-is | ✅ JS/TS | ✅ has picture+palette decode | ✅ exposes offsets | ❌ no built-in manifest | none |

### 4.2 Recommendation — custom Node/TypeScript WAD reader

Build a small TS extractor (`tools/extract-wad/`) that runs under Node on macOS,
headless, in CI. **Why it wins:**

1. **Single source of truth for the manifest.** Only a custom reader produces *exactly*
   the schema in §5 (sprite sets grouped by frame+rotation, per-frame offsets, audio
   metadata) in one pass. DeuTex/SLADE dump loose files we'd have to re-scan and
   re-interpret anyway.
2. **Correct transparency + offsets.** We decode posts → RGBA alpha ourselves (§3.5)
   and read leftoffset/topoffset straight from the picture header into the manifest —
   no lossy round-trip, no color-keying guesswork, correct mirror handling for packed
   8-char sprite lumps.
3. **Zero native build.** Pure JS/TS (`pngjs` or `sharp` for PNG, optional `ffmpeg`
   spawn for OGG). No autotools/Homebrew GUI dependency; reproducible on macOS + CI.
4. **Reuse, don't reinvent the parser.** Seed the lump-directory + picture-decode layer
   from an existing MIT-ish TS/JS parser — `jsdoom`
   (<https://github.com/pineapplemachine/jsdoom>) or `wad-js`
   (<https://github.com/jmickle66666666/wad-js>) — and add our compositing + manifest
   layer on top. (`node-wad` and `doom-wad` on npm are lighter alternatives for the
   raw directory layer.)

**Cross-check tools (not the pipeline, but keep installed):** **SLADE**
(<https://slade.mancubus.net>, <https://doomwiki.org/wiki/SLADE>) for *visually*
verifying a lump renders identically to our PNG; **DeuTex**
(<https://github.com/Doom-Utils/deutex>, <https://doomwiki.org/wiki/DeuTex>) for a
second-opinion batch dump (`deutex -extract`) when a decode looks wrong.

### 4.3 Pipeline steps

```
1. Read header + directory  → ordered lump list (offset, size, name).      verify: lumpCount matches header
2. Track namespaces while walking (S_/F_/P_ markers).                       verify: every sprite seen inside S_START..S_END
3. Load PLAYPAL, build palette[0] = 256× [r,g,b].                           verify: 768-byte slice, index0 == (0,0,0)
4. Flats (F_*)   → 64×64 RGBA PNG, alpha 255.                               verify: 4096-byte input
5. Patches+PNAMES+TEXTURE1 → composite RGBA PNG per texture (alpha 0 base). verify: patchIndex < PNAMES.count
6. Sprites (S_*) → decode picture → RGBA PNG; record W,H,leftoffset,topoff; verify: round-trip a known sprite vs SLADE
                   expand packed 8-char lumps into 2 frames (mirror).
7. Status-bar/UI (STBAR, STF*, STT*, STARMS, STKEYS*) → RGBA PNG.           verify: STBAR is 320×32
8. Fonts STCFN033..095 → per-glyph PNG + width.                            verify: 63 glyph lumps present
9. Sounds DS* → trim 16-byte pads → WAV (u8 mono @ rate); optional OGG.     verify: header format == 3
10. (optional) Music D_* → MUS→MID→OGG.                                     deferred
11. Write assets/manifest.json (§5) + copy THIRD-PARTY license/CREDITS.     verify: every PNG/audio path resolves
```

Output tree:

```
assets/
  textures/  STARTAN3.png …
  flats/     FLOOR4_8.png …
  sprites/   TROO/ TROOA1.png TROOA2A8.png(→A2 + A8 mirror) …
  ui/        STBAR.png  STFST00.png  STTNUM0.png …
  fonts/     STCFN/ 033.png 034.png …
  audio/     sfx/ DSPISTOL.wav|ogg …
  manifest.json
  THIRD-PARTY/freedoom-LICENSE.txt   # verbatim §2 block + CREDITS
```

---

## 5. JSON asset-manifest schema

Single `manifest.json` the rendering/audio layer loads at boot. Coordinates are in
source pixels; `origin` = picture leftoffset/topoffset (the draw hotspot).

```jsonc
{
  "meta": {
    "source": "freedoom2.wad",
    "freedoomVersion": "0.13.0",
    "license": "BSD-3-Clause (modified BSD)",
    "attribution": "THIRD-PARTY/freedoom-LICENSE.txt",
    "palette": "PLAYPAL[0]"
  },

  "textures": {                       // composited wall textures (§3.6)
    "STARTAN3": { "path": "textures/STARTAN3.png", "w": 128, "h": 128 }
  },

  "flats": {                          // 64×64 floors/ceilings (§3.7)
    "FLOOR4_8": { "path": "flats/FLOOR4_8.png", "w": 64, "h": 64 }
  },

  "sprites": {                        // grouped by 4-char entity prefix (§3.8)
    "TROO": {
      "entity": "imp",
      "frames": {
        // key = frameLetter + rotation; origin = [leftoffset, topoffset]
        "A1": { "path": "sprites/TROO/TROOA1.png", "w": 41, "h": 56, "origin": [20, 53], "mirror": false },
        "A2": { "path": "sprites/TROO/TROOA2A8.png", "w": 44, "h": 55, "origin": [22, 53], "mirror": false },
        "A8": { "path": "sprites/TROO/TROOA2A8.png", "w": 44, "h": 55, "origin": [22, 53], "mirror": true }
      }
    }
  },

  "ui": {                             // status bar / HUD graphics (§3.11)
    "STBAR":   { "path": "ui/STBAR.png",   "w": 320, "h": 32, "origin": [0, 0] },
    "STFST00": { "path": "ui/STFST00.png", "w": 24,  "h": 29, "origin": [12, 28] },
    "STTNUM0": { "path": "ui/STTNUM0.png", "w": 14,  "h": 16, "origin": [0, 0] }
  },

  "fonts": {                          // STCFN HUD font (§3.12)
    "hud": {
      "lumpRange": "STCFN033-STCFN095",
      "space": 4,
      "glyphs": {
        "33": { "path": "fonts/STCFN/033.png", "w": 9, "h": 16 }
      }
    }
  },

  "sounds": {                         // SFX (§3.9)
    "DSPISTOL": { "path": "audio/sfx/DSPISTOL.ogg", "rate": 11025, "channels": 1, "format": "ogg" }
  },

  "music": {}                         // optional (§3.10), empty for v1
}
```

Notes for downstream code:

- To draw a sprite at world position, blit its PNG with top-left at
  `(screenX - origin[0], screenY - origin[1])`; if `mirror`, flip horizontally and use
  `origin[0]' = w - origin[0]`.
- `sprites[X].frames` keys are `frame+rotation`; the renderer chooses rotation `1..8`
  from the camera-to-entity angle, or uses `0` when present (angle-independent).
- All PNGs are RGBA; transparency is already baked (no runtime color-keying).

---

## 6. Sprite-prefix → entity mapping

Freedoom keeps Doom's lump names for engine compatibility, so these prefixes match the
Doom Wiki sprite tables (<https://doomwiki.org/wiki/Sprite>) — only the artwork differs.
Pull the ones our game actually uses.

### Monsters

| Prefix | Doom entity | Freedoom counterpart | In WAD |
|---|---|---|---|
| `PLAY` | Player | Player marine | both |
| `POSS` | Zombieman | Zombie / former human | both |
| `SPOS` | Shotgun guy | Shotgun zombie | both |
| `CPOS` | Heavy weapon (chaingunner) | Chaingunner | freedoom2 |
| `TROO` | Imp | Imp-equivalent | both |
| `SARG` | Demon / Spectre | Demon (Spectre = translucent SARG) | both |
| `HEAD` | Cacodemon | Cacodemon-equivalent | both |
| `SKUL` | Lost soul | Lost soul-equivalent | both |
| `BOS2` | Hell knight | Hell knight | freedoom2 |
| `BOSS` | Baron of Hell | Baron-equivalent | both |
| `PAIN` | Pain elemental | Pain elemental | freedoom2 |
| `FATT` | Mancubus | Mancubus | freedoom2 |
| `SKEL` | Revenant | Revenant | freedoom2 |
| `VILE` | Arch-vile | Arch-vile | freedoom2 |
| `BSPI` | Arachnotron | Arachnotron | freedoom2 |
| `SPID` | Spider Mastermind | Spider boss | freedoom2 |
| `CYBR` | Cyberdemon | Cyberdemon | both (D1 E2 boss) |

### Weapons — first-person view (`*G` gun, `*F` muzzle flash)

| Prefix | Weapon |
|---|---|
| `PUNG` | Fist / punch |
| `SAWG` | Chainsaw |
| `PISG` / `PISF` | Pistol / flash |
| `SHTG` / (`SHT2`) | Shotgun / super shotgun (SSG = `SHT2`, freedoom2) |
| `CHGG` | Chaingun |
| `MISG` / `MISF` | Rocket launcher / flash |
| `PLSG` / `PLSF` | Plasma rifle / flash |
| `BFGG` / `BFGF` | BFG9000 / flash |

### Weapon pickups (world sprites) & projectiles

| Prefix | Item / projectile |
|---|---|
| `CSAW` | Chainsaw pickup |
| `SHOT` | Shotgun pickup |
| `SGN2` | Super shotgun pickup (freedoom2) |
| `MGUN` | Chaingun pickup |
| `LAUN` | Rocket launcher pickup |
| `PLAS` | Plasma rifle pickup |
| `BFUG` | BFG9000 pickup |
| `MISL` | Rocket projectile / explosion |
| `PLSS` / `PLSE` | Plasma bolt / impact |
| `BFS1` / `BFE1` / `BFE2` | BFG ball / impact |
| `BAL1` | Imp fireball |
| `BAL7` | Baron/Hell-knight fireball |
| `APLS` / `APBX` | Arachnotron plasma / impact |
| `MANF` | Mancubus fireball |
| `BAL2` | Caco/baron variant ball |

### Items / pickups

| Prefix | Item |
|---|---|
| `BON1` | Health bonus (potion) |
| `BON2` | Armor bonus (helmet) |
| `STIM` | Stimpack |
| `MEDI` | Medikit |
| `SOUL` | Soulsphere |
| `MEGA` | Megasphere (freedoom2) |
| `ARM1` | Green armor |
| `ARM2` | Blue (mega) armor |
| `PINV` | Invulnerability |
| `PINS` | Blursphere (partial invisibility) |
| `PMAP` | Computer area map |
| `PVIS` | Light-amp visor |
| `SUIT` | Radiation suit |
| `PSTR` / `PSTF`* | Berserk pack (`*` see wiki) |

### Ammo

| Prefix | Ammo |
|---|---|
| `CLIP` | Ammo clip |
| `AMMO` | Box of bullets |
| `SHEL` | Shotgun shells |
| `SBOX` | Box of shells |
| `ROCK` | Single rocket |
| `BROK` | Box of rockets |
| `CELL` | Energy cell |
| `CELP` | Energy cell pack |
| `BPAK` | Backpack |

### Keys & misc

| Prefix | Item |
|---|---|
| `BKEY` / `RKEY` / `YKEY` | Blue / red / yellow keycards |
| `BSKU` / `RSKU` / `YSKU` | Blue / red / yellow skull keys |
| `BAR1` / `BEXP` | Exploding barrel / explosion |
| `TLMP` `TLP2` `COLU` `CAND` `CBRA` | Decorations (lamps, column, candle/candelabra) |

### Common SFX lumps (subset)

| Lump | Use |
|---|---|
| `DSPISTOL` | Pistol fire |
| `DSSHOTGN` / `DSDSHTGN` | Shotgun / super shotgun fire |
| `DSPLASMA` / `DSBFG` | Plasma / BFG fire |
| `DSRLAUNC` / `DSRXPLOD` | Rocket launch / explosion |
| `DSPUNCH` / `DSSAWUP`…`DSSAWHIT` | Fist / chainsaw |
| `DSITEMUP` / `DSWPNUP` | Item / weapon pickup |
| `DSDOROPN` / `DSDORCLS` | Door open / close |
| `DSSWTCHN` / `DSSWTCHX` | Switch on / off |
| `DSPLPAIN` / `DSPLDETH` | Player pain / death |
| `DSPOSIT1-3` / `DSBGSIT1-2` | Zombie / imp sight |
| `DSBAREXP` | Barrel explosion |
| `DSTELEPT` | Teleport |

---

## 7. Compliance checklist & open questions

**Before shipping the web build:**

- [ ] Bundle `THIRD-PARTY/freedoom-LICENSE.txt` = verbatim §2 license block + upstream
      `CREDITS` list.
- [ ] Surface it from an in-game Credits/About screen (satisfies the "binary form …
      documentation/other materials" clause).
- [ ] Do not imply Freedoom endorsement (3rd clause).
- [ ] Record source WAD + Freedoom version in `manifest.meta` (provenance).

**Open questions for the team:**

- Music: in scope for v1? If yes, decide MUS→OGG (pre-render, larger download) vs. JS
  MIDI synth at runtime.
- PNG-vs-atlas: ship per-sprite PNGs (simple) or pack into texture atlases (fewer HTTP
  requests, better Canvas draw perf)? The manifest schema supports adding `atlas`/
  `rect` fields later without breaking consumers.
- Audio format: WAV (zero deps, larger) vs. OGG (needs an `ffmpeg`/encoder step). OGG
  recommended for web payload size.

---

## Sources

- Freedoom downloads — <https://freedoom.github.io/download.html>
- Freedoom releases (0.13.0, 2024-01-29) — <https://github.com/freedoom/freedoom/releases>
- Freedoom license `COPYING.adoc` — <https://github.com/freedoom/freedoom/blob/master/COPYING.adoc>
- Doom Wiki: Freedoom — <https://doomwiki.org/wiki/Freedoom>
- Doom Wiki: WAD — <https://doomwiki.org/wiki/WAD>
- Doom Wiki: PLAYPAL — <https://doomwiki.org/wiki/PLAYPAL>
- Doom Wiki: COLORMAP — <https://doomwiki.org/wiki/COLORMAP>
- Doom Wiki: Picture format — <https://doomwiki.org/wiki/Picture_format>
- Doom Wiki: PNAMES — <https://doomwiki.org/wiki/PNAMES>
- Doom Wiki: TEXTURE1/TEXTURE2 — <https://doomwiki.org/wiki/TEXTURE1_and_TEXTURE2>
- Doom Wiki: Flat — <https://doomwiki.org/wiki/Flat>
- Doom Wiki: Sprite — <https://doomwiki.org/wiki/Sprite>
- Doom Wiki: Sound — <https://doomwiki.org/wiki/Sound>
- Doom Wiki: DMX (sound library) — <https://doomwiki.org/wiki/DMX_(sound_library)>
- Doom Wiki: MUS — <https://doomwiki.org/wiki/MUS>
- Doom Wiki: STBAR / Status bar — <https://doomwiki.org/wiki/STBAR>, <https://doomwiki.org/wiki/Status_bar>
- Doom Wiki: STCFN font — <https://doomwiki.org/wiki/STCFN>
- DeuTex — <https://github.com/Doom-Utils/deutex>, <https://doomwiki.org/wiki/DeuTex>
- SLADE — <https://slade.mancubus.net>, <https://doomwiki.org/wiki/SLADE>
- jsdoom (TS WAD tools) — <https://github.com/pineapplemachine/jsdoom>
- wad-js — <https://github.com/jmickle66666666/wad-js>
