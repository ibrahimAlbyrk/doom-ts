# Canvas 2D Raycaster — Rendering Technique Reference

A DOOM-style first-person renderer built on a vanilla HTML5 **Canvas 2D**
context (no WebGL), TypeScript, targeting a stable **60fps**. The world is a
grid/tile map. This document is the technique reference: the math, the
pseudocode, and the engineering decisions, with citations.

Scope of techniques covered:

1. DDA grid raycasting + perpendicular (fisheye-corrected) wall distance
2. Perspective-correct vertical wall texture mapping
3. Per-pixel floor and ceiling (flat) casting
4. Billboarded sprites: projection, depth sort, per-column z-buffer clipping, transparency
5. Lighting: distance attenuation + per-sector light level, colormap-style banding
6. Performance: typed-array backbuffer, internal resolution + upscale, hot-loop discipline, doors/thin walls, sky
7. Fake variable wall/floor/ceiling heights and doors
8. Fixed-timestep frame loop with interpolated render

> **Note on the engine class.** This is a *grid raycaster* (Wolfenstein-3D
> lineage), not a *BSP renderer* (the actual DOOM lineage). Real DOOM uses a
> BSP tree, segs, and visplanes — not ray-per-column casting. We borrow DOOM's
> *look* (textured flats, diminishing light, sprites, sectors) on top of a
> raycaster's *structure* because the raycaster is dramatically simpler to
> implement correctly and is fast enough on Canvas 2D. Where the two diverge,
> it is called out.

## Primary sources

- **Lode Vandevenne — "Raycasting" tutorial** (the canonical reference for this
  whole document). Four parts:
  - `https://lodev.org/cgtutor/raycasting.html` — DDA, walls, distance
  - `https://lodev.org/cgtutor/raycasting2.html` — textured walls, floor, ceiling
  - `https://lodev.org/cgtutor/raycasting3.html` — sprites + z-buffer
  - `https://lodev.org/cgtutor/raycasting4.html` — performance / optimizations
  All formulas below that match Lode's are noted as **[Lode]**.
- **F. Permadi — "Ray-Casting Tutorial For Game Development"**,
  `https://permadi.com/1996/05/ray-casting-tutorial-table-of-contents/` —
  the older angle-based derivation; good for the projection-plane / fisheye
  intuition and for variable wall heights. Noted **[Permadi]**.
- **Fabien Sanglard — _Game Engine Black Book: DOOM_** (free PDF) and his DOOM
  rendering articles, `https://fabiensanglard.net/doomIphone/doomClassicRenderer.php`
  — colormaps, diminishing light, palette, sector light levels. Noted **[GEBB]**.
- **id Software DOOM source** (`linuxdoom-1.10`, mirrored in Chocolate Doom,
  `https://github.com/id-Software/DOOM`) — `r_main.c` (`scalelight`,
  `zlight`), `r_data.c` (colormaps), `r_things.c` (sprite clipping). Noted **[id]**.
- **DoomWiki — COLORMAP / light levels**, `https://doomwiki.org/wiki/COLORMAP`.
- **3DSage — "Make Your Own Raycaster"** (C tutorial/video series) — a clean
  modern reimplementation; good cross-check for the DDA and sprite math.

---

## 0. Coordinate system & camera model

World units are **map cells**: one tile = 1.0 × 1.0. The camera (player) has a
floating-point position and two vectors **[Lode]**:

```ts
interface Camera {
  posX: number; posY: number;     // player position, in cell units
  dirX: number; dirY: number;     // unit direction the player faces
  planeX: number; planeY: number; // camera plane, perpendicular to dir
}
```

The **camera plane** is perpendicular to `dir`; its length sets the field of
view. For a 2:1 plane-to-dir ratio you get FOV = 2·atan(0.66) ≈ **66°**, the
classic value. Example facing east:

```ts
dir   = (1, 0)
plane = (0, 0.66)   // |plane| / |dir| = 0.66  ->  FOV ≈ 66°
```

Rotating the player rotates **both** `dir` and `plane` by the same angle
(2D rotation matrix), which keeps them perpendicular and keeps FOV constant:

```ts
function rotate(cam: Camera, rad: number): void {
  const c = Math.cos(rad), s = Math.sin(rad);
  const dx = cam.dirX;   cam.dirX   = dx * c - cam.dirY * s;   cam.dirY   = dx * s + cam.dirY * c;
  const px = cam.planeX; cam.planeX = px * c - cam.planeY * s; cam.planeY = px * s + cam.planeY * c;
}
```

Why a plane vector instead of an angle + FOV? It makes the per-column ray a
simple linear interpolation across the plane (no per-column trig), which is the
core speed trick of the modern raycaster **[Lode]**. The older **[Permadi]**
formulation uses an angle per column and must divide out `cos(rayAngle −
playerAngle)` to undo fisheye; the plane formulation gives fisheye correction
"for free" via the perpendicular distance (Section 1).

Let `W`, `H` be the **internal** render width/height (Section 6 for sizing).

---

## 1. DDA grid raycasting + perpendicular distance

For each screen column `x ∈ [0, W)`, build the ray direction by interpolating
across the camera plane **[Lode]**:

```ts
const cameraX = (2 * x) / W - 1;          // -1 (left) .. +1 (right)
const rayDirX = cam.dirX + cam.planeX * cameraX;
const rayDirY = cam.dirY + cam.planeY * cameraX;
```

Walk the grid with **DDA (Digital Differential Analysis)** — step exactly one
cell boundary at a time, always advancing to the nearest gridline. `deltaDist`
is the ray length to cross one full cell in X or in Y:

```ts
// Length the ray travels to cross one grid unit in X / Y.
// abs(1/rayDir) is the simplified form of sqrt(1 + (rayDirY/rayDirX)^2).
const deltaDistX = rayDirX === 0 ? Infinity : Math.abs(1 / rayDirX);
const deltaDistY = rayDirY === 0 ? Infinity : Math.abs(1 / rayDirY);

let mapX = Math.floor(cam.posX);
let mapY = Math.floor(cam.posY);

let stepX: number, stepY: number;
let sideDistX: number, sideDistY: number;

if (rayDirX < 0) { stepX = -1; sideDistX = (cam.posX - mapX) * deltaDistX; }
else            { stepX =  1; sideDistX = (mapX + 1 - cam.posX) * deltaDistX; }
if (rayDirY < 0) { stepY = -1; sideDistY = (cam.posY - mapY) * deltaDistY; }
else            { stepY =  1; sideDistY = (mapY + 1 - cam.posY) * deltaDistY; }

let side = 0;        // 0 = hit a vertical (NS) wall face, 1 = horizontal (EW)
let hit = 0;
while (hit === 0) {
  if (sideDistX < sideDistY) { sideDistX += deltaDistX; mapX += stepX; side = 0; }
  else                       { sideDistY += deltaDistY; mapY += stepY; side = 1; }
  if (map[mapY][mapX] > 0) hit = 1;     // non-zero cell = solid wall
}
```

DDA is preferred over fixed-step sampling because it visits **every** cell the
ray passes through with no overshoot and no missed thin walls, in O(cells
crossed) **[Lode]**.

### Perpendicular wall distance (fisheye correction)

Do **not** use the Euclidean ray length — that produces a fisheye bulge. Use
the distance projected onto the camera direction, i.e. the perpendicular
distance to the camera *plane* **[Lode]**:

```ts
// At the moment of the hit, sideDist already overshot by one deltaDist.
const perpWallDist = side === 0
  ? (sideDistX - deltaDistX)
  : (sideDistY - deltaDistY);
```

Equivalently `perpWallDist = (mapX − posX + (1 − stepX)/2) / rayDirX` for
`side 0`. Because `rayDir = dir + plane·cameraX`, dividing by it implicitly
projects onto `dir`, removing the `cos(θ)` term that **[Permadi]** removes
explicitly. **This single value drives wall height, texture scale, floor-cast
horizon, sprite depth, and the lighting falloff** — get it right.

### Projecting the wall slice

```ts
const lineHeight = Math.floor(H / perpWallDist);   // taller when nearer
let drawStart = Math.floor(-lineHeight / 2 + H / 2);
let drawEnd   = Math.floor( lineHeight / 2 + H / 2);
const yTop = Math.max(drawStart, 0);
const yBot = Math.min(drawEnd, H - 1);
```

`H / perpWallDist` assumes a wall exactly 1.0 unit tall whose center sits on the
horizon (mid-screen). Variable heights (Section 7) generalize this.

Store the depth for sprite clipping later:

```ts
zBuffer[x] = perpWallDist;
```

---

## 2. Perspective-correct wall texture mapping

Find **where** on the wall the ray hit (the horizontal texture coordinate),
then step **down** the column linearly in texture space **[Lode]**.

```ts
// Exact world coordinate of the hit along the wall face.
let wallX = side === 0
  ? cam.posY + perpWallDist * rayDirY
  : cam.posX + perpWallDist * rayDirX;
wallX -= Math.floor(wallX);                 // fractional part [0,1) = U coord

let texX = Math.floor(wallX * TEX);          // TEX = texture width (e.g. 64)
// Mirror so textures aren't flipped on the opposite faces:
if (side === 0 && rayDirX > 0) texX = TEX - texX - 1;
if (side === 1 && rayDirY < 0) texX = TEX - texX - 1;
```

The vertical mapping is the perspective-correct part. The wall slice on screen
is `lineHeight` px tall but maps to `TEX` texels; the texel step per screen row
is constant for a vertical wall (vertical lines stay vertical under this
projection), so we can step linearly — no per-pixel divide **[Lode]**:

```ts
const step = TEX / lineHeight;                       // texels per screen pixel
// Texture position at the first *visible* pixel (handles off-screen top clip).
let texPos = (yTop - H / 2 + lineHeight / 2) * step;

for (let y = yTop; y <= yBot; y++) {
  const texY = (texPos & (TEX - 1));                 // & wrap needs power-of-2 TEX
  texPos += step;
  let color = texture[texY * TEX + texX];            // flat Uint32 texture
  color = shade(color, perpWallDist, sectorLight);   // Section 5
  // darken EW faces slightly for cheap fake directional light:
  if (side === 1) color = halfBright(color);
  backbuffer[y * W + x] = color;
}
```

Key points:

- `texPos` is seeded from `yTop` (the clipped top), so columns taller than the
  screen still sample the correct sub-range — never clamp the *texture*
  coordinate, clamp the *screen loop* **[Lode]**.
- `& (TEX - 1)` only works when `TEX` is a power of two (32/64/128). Keep all
  textures power-of-two and you avoid a modulo in the hottest loop in the
  engine.
- The `side === 1` half-bright is the classic Wolfenstein/DOOM trick: faces
  perpendicular to one axis are dimmed a fixed amount so corners read clearly
  without real normals.

---

## 3. Floor and ceiling casting (flats)

Walls are cast per **column**; floors/ceilings are most efficiently cast per
**row**, because every pixel in a screen row is the same distance from the
camera and therefore shares one set of step deltas **[Lode]**.

### The row-distance formula

For a screen row `y` **below** the horizon, the ground distance is:

```
rowDistance = posZ / (y − H/2)
```

where `posZ = H/2` for a camera at standard eye height with the horizon at
mid-screen. Derivation: a floor point at world distance `d` projects to screen
row `H/2 + posZ/d`; invert for `d`. **[Lode]**

```ts
// Leftmost (x=0) and rightmost (x=W) ray directions — constant per frame.
const rayDirX0 = cam.dirX - cam.planeX, rayDirY0 = cam.dirY - cam.planeY;
const rayDirX1 = cam.dirX + cam.planeX, rayDirY1 = cam.dirY + cam.planeY;
const posZ = 0.5 * H;                                  // eye height * projection

for (let y = Math.floor(H / 2) + 1; y < H; y++) {
  const p = y - H / 2;                                  // rows below horizon
  const rowDistance = posZ / p;

  // World-space step between adjacent floor pixels in this row.
  const stepX = (rowDistance * (rayDirX1 - rayDirX0)) / W;
  const stepY = (rowDistance * (rayDirY1 - rayDirY0)) / W;

  // World coordinate of the leftmost floor pixel in this row.
  let floorX = cam.posX + rowDistance * rayDirX0;
  let floorY = cam.posY + rowDistance * rayDirY0;

  const yCeil = H - y - 1;                              // mirror row for ceiling

  for (let x = 0; x < W; x++) {
    const cellX = floorX | 0, cellY = floorY | 0;
    const tx = ((floorX - cellX) * FTEX) & (FTEX - 1);
    const ty = ((floorY - cellY) * FTEX) & (FTEX - 1);
    floorX += stepX; floorY += stepY;

    const lightF = shadeByDist(rowDistance, sectorLightAt(cellX, cellY));
    backbuffer[y * W + x]     = shade(floorTex[ty * FTEX + tx], rowDistance, lightF);     // floor
    backbuffer[yCeil * W + x] = shade(ceilTex[ty * FTEX + tx],  rowDistance, lightF);     // ceiling
  }
}
```

Notes:

- Floor and ceiling are **mirror images across the horizon** for a centered
  camera, so one loop fills both rows (`y` and `H − y − 1`). If floor and
  ceiling heights differ (Section 7) you split this into two passes with
  different `posZ`.
- This **overdraws** behind walls (we fill the whole lower/upper half, then
  walls paint over). That is fine and is what Lode's reference does; the
  alternative (cast floor only below each wall's `drawEnd`) saves fill but
  complicates the loop. On Canvas, full-screen flat fill at 320×200 is cheap;
  measure before optimizing.
- `shadeByDist` here uses `rowDistance` (a perpendicular ground distance), which
  is already fisheye-free, so floor lighting matches wall lighting at the same
  depth.

> **Alternative — per-column floor cast.** Lode's first method casts floor
> *underneath each wall column* using `currentDist = posZ / (y − H/2)` and a
> `weight = currentDist / perpWallDist` lerp from the wall-base world point to
> the player. The per-row method above is faster (constant steps, no per-pixel
> lerp setup) and is the recommended one.

---

## 4. Sprites — billboards, sorting, clipping, transparency

Sprites (enemies, items, decorations) are **billboards**: flat textures always
facing the camera, projected like a wall but positioned at an arbitrary world
point and depth-tested per column against the wall z-buffer **[Lode]**.

### 4.1 Sort far-to-near

Paint distant sprites first so nearer ones overdraw them (painter's order).
Sort by **squared** distance — no `sqrt` needed for ordering:

```ts
sprites.sort((a, b) => {
  const da = (cam.posX - a.x) ** 2 + (cam.posY - a.y) ** 2;
  const db = (cam.posX - b.x) ** 2 + (cam.posY - b.y) ** 2;
  return db - da;                                       // far first
});
```

### 4.2 World → camera space → screen

Transform the sprite into camera space using the **inverse** of the
`[plane | dir]` matrix. `transformY` is the perpendicular depth (the sprite's
"perpWallDist"); `transformX` is the lateral offset **[Lode]**:

```ts
const sx = sprite.x - cam.posX;
const sy = sprite.y - cam.posY;

// invDet of the camera matrix [planeX dirX; planeY dirY]
const invDet = 1 / (cam.planeX * cam.dirY - cam.dirX * cam.planeY);
const transformX = invDet * ( cam.dirY * sx - cam.dirX * sy);
const transformY = invDet * (-cam.planeY * sx + cam.planeX * sy);   // depth
if (transformY <= 0) continue;                          // behind camera

const spriteScreenX = Math.floor((W / 2) * (1 + transformX / transformY));

// Optional vertical shift (floating items, eye height): vMoveScreen in px.
const vMoveScreen = Math.floor(sprite.vMove / transformY);

const spriteHeight = Math.abs(Math.floor(H / transformY)) * sprite.scaleY;
let drawStartY = Math.floor(-spriteHeight / 2 + H / 2 + vMoveScreen);
let drawEndY   = Math.floor( spriteHeight / 2 + H / 2 + vMoveScreen);

const spriteWidth = Math.abs(Math.floor(H / transformY)) * sprite.scaleX;
let drawStartX = Math.floor(-spriteWidth / 2 + spriteScreenX);
let drawEndX   = Math.floor( spriteWidth / 2 + spriteScreenX);
```

### 4.3 Per-column z-buffer clip + transparency

For each sprite column `stripe`, compute its texture X, then depth-test against
`zBuffer[stripe]` (the wall distance for that column). Draw the column only
where the sprite is **nearer** than the wall — this clips sprites correctly
behind walls and lets them be partially occluded by a doorframe edge **[Lode]**:

```ts
for (let stripe = Math.max(drawStartX, 0); stripe < Math.min(drawEndX, W); stripe++) {
  // Depth test: skip columns hidden behind a wall.
  if (transformY >= zBuffer[stripe]) continue;

  const texX = Math.floor(((stripe - (-spriteWidth / 2 + spriteScreenX)) * SPR) / spriteWidth);

  const yStart = Math.max(drawStartY, 0);
  const yEnd   = Math.min(drawEndY, H - 1);
  for (let y = yStart; y <= yEnd; y++) {
    // Map screen y back to sprite texture v (the 256-fixed-point form from Lode).
    const d = (y - vMoveScreen) * 256 - H * 128 + spriteHeight * 128;
    const texY = Math.floor((d * SPR) / spriteHeight) >> 8;

    const color = spriteTex[texY * SPR + texX];
    if ((color & 0x00ffffff) === 0) continue;           // colorkey: 0x000000 = transparent
    // (or, with an alpha channel: if ((color >>> 24) === 0) continue;)

    backbuffer[y * W + stripe] = shade(color, transformY, sectorLightAtSprite);
  }
}
```

Transparency options, in order of preference for Canvas:

1. **Alpha test** — store sprites as RGBA, skip any texel with `alpha === 0`.
   Cleanest; one compare. (No alpha *blending* — billboards are 1-bit cutout,
   exactly like DOOM patches.)
2. **Colorkey** — reserve one color (DOOM used palette index 0 / cyan in some
   tools) as "transparent" and compare against it. Use when textures are
   paletted.

Do **not** alpha-blend translucent sprites in the hot loop unless you must
(DOOM's only translucent things are a couple of "fuzz"/spectre effects, handled
specially). Per-pixel blending is several times slower than a compare-and-skip.

> Because sprites are clipped *per column* by the wall z-buffer but **not** by
> each other's depth at the pixel level, the far-to-near sort (4.1) is what
> resolves sprite-vs-sprite overlap. Two interpenetrating sprites at nearly
> equal depth can flicker; this is a known raycaster limitation and is
> acceptable for DOOM-style gameplay.

---

## 5. Lighting — diminishing light + sector light levels

DOOM's lighting is **not** a smooth multiply. It is a stack of precomputed
**colormaps**: 34 tables (`NUMCOLORMAPS = 32` light levels + fullbright +
invuln), each a 256-byte palette remap that maps every palette index to a
darker index. The renderer never multiplies RGB at runtime — it just picks a
colormap row and indexes through it **[GEBB][id][DoomWiki]**.

Two inputs choose the row:

1. **Sector light level** (`0..255`) — a static per-sector brightness, set by
   the map. Brighter sectors start from a brighter colormap.
2. **Distance / diminishing light** — farther pixels use a darker colormap.
   DOOM precomputes `scalelight[LIGHTLEVELS][MAXLIGHTSCALE]` and
   `zlight[...][MAXLIGHTZ]`, indexing by `lightlevel` and by `1/dist`-ish
   scale **[id, `r_main.c`]**.

The combined index in DOOM (simplified):

```
lightnum = (sectorLight >> LIGHTSEGSHIFT) + extralight        // sector + weapon flash
index    = clamp(lightnum_scaled - distanceTerm, 0, NUMCOLORMAPS-1)
colormap = colormaps[index]                                   // 256-entry LUT
pixel    = colormap[ texture[texel] ]
```

### 5.1 Faithful-and-fast approach on Canvas: precomputed shade LUTs

Replicate the colormap idea exactly. Keep a **256-color palette** and a
`[LEVELS][256]` table of pre-darkened **packed Uint32** colors. Then shading is
one array read, zero arithmetic, in the hot loop — this is both authentic *and*
the fastest option.

```ts
const LEVELS = 32;                                   // DOOM's NUMCOLORMAPS
// colormap[level][paletteIndex] = packed ABGR Uint32, darker as level grows.
const colormap: Uint32Array[] = buildColormaps(palette, LEVELS);

function buildColormaps(pal: Uint32Array, levels: number): Uint32Array[] {
  const maps: Uint32Array[] = [];
  for (let l = 0; l < levels; l++) {
    const f = 1 - l / (levels - 1);                  // 1.0 (bright) .. 0.0 (black)
    const m = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      const c = pal[i];
      const r = (c & 0xff) * f, g = ((c >> 8) & 0xff) * f, b = ((c >> 16) & 0xff) * f;
      m[i] = (255 << 24) | (b << 16) | (g << 8) | r; // ABGR, little-endian
    }
    maps.push(m);
  }
  return maps;
}
```

Picking the level per pixel (the diminishing-light curve):

```ts
const LIGHT_SCALE = 8;          // tune: larger = light reaches farther
function lightLevelFor(dist: number, sectorLight: number): number {
  // sectorLight 0..255 -> base brightness; distance darkens.
  const base = (255 - sectorLight) / 255 * (LEVELS - 1);  // dim sectors start darker
  const distTerm = LIGHT_SCALE * dist;                    // farther = darker
  let lvl = (base + distTerm) | 0;
  if (lvl < 0) lvl = 0; else if (lvl >= LEVELS) lvl = LEVELS - 1;
  return lvl;
}

// Hot loop becomes: backbuffer[i] = colormap[lvl][texelIndex];
```

With this scheme, **textures store palette indices** (`Uint8`), not RGB, and
the shade is folded into the colormap lookup — identical structure to DOOM.

### 5.2 Pragmatic RGB approach (truecolor textures)

If you keep RGBA textures (simpler asset pipeline), quantize a brightness factor
into `LEVELS` bands so you still get DOOM's *banded* look rather than a smooth
gradient, and precompute the multiply-free path where you can:

```ts
function shade(color: number, dist: number, sectorLight: number): number {
  const lvl = lightLevelFor(dist, sectorLight);     // 0..LEVELS-1
  const f = brightnessOfLevel[lvl];                 // precomputed 1.0..0.0, banded
  const r = (color & 0xff) * f, g = ((color >> 8) & 0xff) * f, b = ((color >> 16) & 0xff) * f;
  return (color & 0xff000000) | (b << 16) | (g << 8) | r;
}
```

To make it *read* like DOOM specifically:

- **Band hard, don't gradient.** 16–32 discrete steps. Smooth falloff looks
  modern/soft; DOOM's stepped colormap is the signature.
- **Darken toward black**, and optionally tint the darkest few bands slightly
  toward the palette's deep blue/brown rather than pure black for that murky
  feel.
- **Half-bright EW walls** (Section 2) plus diminishing light gives the corner
  definition DOOM has without normals.
- **Fullbright pixels:** certain texels (lamps, projectiles, the muzzle flash)
  ignore lighting — reserve `level 0` / a fullbright flag for them.
- **`extralight`:** weapon fire briefly raises whole-scene brightness — subtract
  a few from every `lvl` for 1–2 frames after a shot.

---

## 6. Performance

The renderer is per-pixel and runs every frame, so the budget is tight: at
60fps you have **~16.6ms**. Two rules dominate everything else: **write to a
typed-array backbuffer**, and **keep internal resolution small and upscale**.

### 6.1 Typed-array backbuffer + single `putImageData`

Never call `fillRect`/`getImageData` per pixel. Allocate one `ImageData`, view
its buffer as `Uint32Array`, write packed pixels, blit once **[Lode]**:

```ts
const image = ctx.createImageData(W, H);
const buf8  = image.data;                       // Uint8ClampedArray RGBA
const backbuffer = new Uint32Array(buf8.buffer);// 32-bit view, same memory

// ... fill backbuffer[y*W + x] = packed color ...

ctx.putImageData(image, 0, 0);                  // one DMA-ish blit per frame
```

**Packing (little-endian, i.e. every browser on x86/ARM):** the Uint32 layout
is `0xAABBGGRR`, so pack as `(a<<24)|(b<<16)|(g<<8)|r`. Writing one Uint32 is
~4× cheaper than four `Uint8ClampedArray` stores and skips clamping.

### 6.2 Internal render resolution + nearest-neighbor upscale

Render into a **small** offscreen buffer, then upscale to the display canvas
with smoothing **off**. This is the single biggest 60fps lever — pixel cost
scales with `W×H`, and it *gives you the authentic chunky DOOM look for free*.

```ts
// Offscreen at internal res; main canvas at display res.
const internal = new OffscreenCanvas(W, H);     // or a hidden <canvas>
const ictx = internal.getContext('2d')!;
ictx.putImageData(image, 0, 0);

const dctx = displayCanvas.getContext('2d')!;
dctx.imageSmoothingEnabled = false;             // nearest-neighbor = crisp pixels
dctx.drawImage(internal, 0, 0, W, H, 0, 0, displayCanvas.width, displayCanvas.height);
```

Or skip the second canvas entirely: set the canvas **attribute** size to `W×H`,
its **CSS** size to the display size, and `image-rendering: pixelated;` —
the browser upscales with nearest-neighbor on the GPU at no JS cost.

```css
canvas { image-rendering: pixelated; width: 100vw; height: 100vh; }
```

**Recommended internal resolution (see headline):** render at **480×270**
(16:9, ~130k px — keeps per-pixel floor/ceiling under budget at 60fps with room
to spare) and upscale **×4 → 1920×1080** with nearest-neighbor. For maximum
authenticity drop to **320×200** (4:3, DOOM's native, ~64k px) and integer-scale
to taste. Use 480×270 as the default; expose it as a setting.

Pixel-cost reference (full floor+ceiling+walls, single pass each):

| Internal | Pixels  | Relative cost | Notes |
|----------|---------|---------------|-------|
| 320×200  | 64,000  | 1.0×          | DOOM-native, max chunk, most headroom |
| 480×270  | 129,600 | 2.0×          | **recommended** — 16:9, still easy 60fps |
| 640×360  | 230,400 | 3.6×          | heavier; fine on desktop, watch mobile |
| 640×400  | 256,000 | 4.0×          | upper bound before floor-cast hurts |

### 6.3 Hot-loop discipline (avoid per-pixel call overhead)

The inner loops run millions of times per frame; function-call and property-
access overhead dominates if you let it **[Lode]**:

- **Inline the texel fetch and shade** in the wall/floor loops. A `shade()`
  *call* per pixel is fine in dev but inline (or use the colormap LUT, which is
  a single array read) for shipping. With colormaps the inner loop is literally
  `backbuffer[i] = map[tex[ti]]` — no call.
- **Hoist everything loop-invariant.** Cache `cam.dirX`, texture base offsets,
  `map[mayY]` row references, `texture` array refs into locals before the loop.
  Repeated `cam.posX` / `obj.prop` reads cost more than locals in V8.
- **Power-of-two textures + `& (TEX-1)`** instead of `%` for wrap.
- **`x | 0` / `>> 8`** for truncation/fixed-point instead of `Math.floor` in the
  hottest loops (Math.floor is a call; `| 0` is an op). `Math.floor` is fine
  outside per-pixel loops.
- **No allocations inside the frame.** Reuse the `ImageData`, the z-buffer
  (`Float64Array(W)`), and sprite scratch arrays. GC pauses blow the 16.6ms
  budget. Preallocate, never `new` per frame.
- **One backbuffer write per pixel.** Order passes floor/ceiling → walls →
  sprites so each pixel is written by the last (nearest) thing; avoid redundant
  rewrites where cheap.
- **`const`/monomorphic types.** Keep arrays monomorphic (`Uint32Array`,
  `Float64Array`) so the JIT stays on the fast path; don't mix types in a typed
  slot.

### 6.4 Doors and thin walls

A door/thin wall lives **inside** a cell rather than on its boundary, so the
plain DDA (which only tests cell entry) needs an extra sub-cell hit test:

- **Recessed door (sliding):** mark the cell as a door type. When DDA enters a
  door cell, advance the ray to the cell's **midline** (add `0.5 *
  deltaDist*` along the stepping axis) and test whether the ray's lateral
  coordinate at that depth is past the door's current open offset. Animate the
  door by sliding the texture's U coordinate (or the wall's lateral extent)
  from `1.0` (closed) to `0.0` (open) over time. **[Lode raycasting4]** covers
  the recessed/offset thin-wall case.
- **Thin wall on a face:** same idea with the offset set to render the wall
  flush to one side of the cell instead of centered.
- **Depth bookkeeping:** the door's `perpWallDist` must use the *recessed*
  distance (deeper than the cell boundary) so floor cast, lighting, and the
  sprite z-buffer line up with where the door visibly is.

Keep doors and thin walls to a *separate, simpler code path* tested only when
the cell flags say so — don't burden the common solid-wall DDA with it.

### 6.5 Sky rendering

The sky is **not** floor/ceiling cast and is **not** distance-lit. When a column
would show ceiling but the sector is `sky`-flagged (or the ray escaped the map),
draw a sky column indexed by **view angle**, so the sky scrolls with turning but
not with movement (it's "infinitely far") **[GEBB][id]**:

```ts
// columnAngle increases across the screen; map to sky texture X.
const angle = Math.atan2(rayDirY, rayDirX);          // or derive from cameraX + facing
const skyX = (((angle / (2 * Math.PI)) * SKY_W) | 0) & (SKY_W - 1);
for (let y = 0; y < horizon; y++) {
  backbuffer[y * W + x] = skyTex[((y * SKY_H / horizon) | 0) * SKY_W + skyX];
}
```

DOOM's sky is a single tall texture wrapped horizontally over a fixed vertical
band; it does not tilt with pitch (there's no real pitch in DOOM — see 7.3).
Skip lighting entirely for sky pixels.

---

## 7. Faking variable heights, floors/ceilings, and doors

A grid raycaster is single-height by default (every wall 1.0 tall, one floor,
one ceiling). DOOM's sectors have arbitrary floor/ceiling heights. You can fake
a lot of it; here's what's feasible, cheapest first.

### 7.1 Taller / shorter walls (cheap)

Scale the projected slice by a per-cell wall height `wh`, and anchor it to the
floor instead of the screen center **[Permadi]**:

```ts
const sliceH = Math.floor((H / perpWallDist) * wh);      // wh = cell wall height
// Anchor bottom at the floor line, grow upward:
const floorLine = Math.floor(H / 2 + (H / 2) / perpWallDist); // where 1.0 floor meets wall
drawEnd   = floorLine;
drawStart = floorLine - sliceH;
```

This gives raised blocks, low barriers, and stair-step façades using the same
single DDA hit — you only changed the vertical projection.

### 7.2 Different floor & ceiling heights per region (medium)

Split the flat cast (Section 3) into **two passes** with different `posZ`:

- **Floor pass:** `posZ_floor = (H/2) * (eyeHeight − floorHeight)` → moving the
  floor down/up shifts the row-distance horizon for the lower half.
- **Ceiling pass:** `posZ_ceil = (H/2) * (ceilHeight − eyeHeight)` → independent
  ceiling horizon for the upper half.

Per-cell `floorHeight`/`ceilHeight` looked up via `sectorAt(cellX, cellY)`
during the row loop lets adjacent areas have different floor/ceiling levels.
This is a believable fake; it is **not** true sloped/stacked geometry.

### 7.3 Multi-level / stacked walls (advanced, "raycaster with heights")

For true DOOM-like varying heights where you see **over** a low wall to a
**taller** wall behind it, don't stop DDA at the first hit. Continue stepping,
and for each cell with a height, draw its wall slice while tracking a **vertical
clip range** per column (the lowest ceiling and highest floor drawn so far),
painting only the still-visible band. This is the classic "raycasting with
variable wall heights" extension (Ken Silverman / Permadi's height section /
several 3DSage follow-ups) **[Permadi]**:

```
for each column x:
  yTopClip = 0; yBotClip = H;                  // visible band
  walk DDA, for each solid cell hit (near -> far):
    project this cell's wall slice (using its floorH/ceilH)
    clamp the slice to [yTopClip, yBotClip]
    draw the clamped slice; fill its floor/ceiling flats within the band
    shrink [yTopClip, yBotClip] by what this slice covered
    stop when the band is empty
```

This is materially more complex and slower (multiple slices per column) — adopt
it only if over-the-wall sightlines are a real design requirement. For most
DOOM-*style* projects, 7.1 + 7.2 deliver the look at a fraction of the cost.

**Pitch / looking up-down:** raycasters can't truly pitch. Fake it by shifting
the horizon (`H/2` term) up/down by a pixel offset (`pitchOffset`) in the wall
projection and the floor `posZ` term. It shears rather than rotates the view but
reads fine for small angles — the same trick DOOM's "look up/down" used.

### 7.4 Doors — see Section 6.4

Doors are the most-wanted "thin wall." The recessed-cell + sliding-offset
approach there is the standard feasible technique on a grid raycaster.

---

## 8. Frame loop — fixed-timestep update + interpolated render

Decouple simulation from rendering so physics is deterministic and frame-rate
independent, and rendering stays smooth even when update and refresh rates
differ. This is the canonical **"Fix Your Timestep"** loop (Glenn Fiedler,
`https://gafferongames.com/post/fix_your_timestep/`):

```ts
const DT = 1000 / 60;                 // fixed sim step: 16.666ms
let accumulator = 0;
let prev = performance.now();
let prevState = snapshot();           // for interpolation

function frame(now: number): void {
  let frameTime = now - prev;
  prev = now;
  if (frameTime > 250) frameTime = 250;   // clamp the "spiral of death" after a stall
  accumulator += frameTime;

  while (accumulator >= DT) {
    prevState = snapshot();               // keep last state for lerp
    update(DT / 1000);                    // advance sim by exactly DT (seconds)
    accumulator -= DT;
  }

  const alpha = accumulator / DT;         // 0..1 leftover fraction
  render(lerpState(prevState, currentState(), alpha));   // interpolate for smoothness

  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
```

Key points:

- **`update(dt)` takes a fixed `dt`** every call. Movement is
  `pos += velocity * dt`; never `pos += velocity` per frame, or speed becomes
  frame-rate dependent.
- **Accumulator** runs as many fixed steps as fit; leftover time (`alpha`)
  drives **interpolation** of the *render* between the previous and current
  sim states — eliminates stutter when refresh ≠ 60Hz (e.g. 144Hz monitors).
- For a raycaster, the cheap-and-sufficient version interpolates just the
  **camera** (pos/dir/plane) and sprite positions between `prevState` and
  `currentState` by `alpha`; the heavy per-pixel work runs once per displayed
  frame.
- **Clamp `frameTime`** (e.g. ≤250ms) so an alt-tab/GC stall doesn't trigger a
  catch-up avalanche of update steps.
- Drive everything off `requestAnimationFrame`'s timestamp; never trust a fixed
  16ms assumption.

---

## 9. Suggested render order (per frame)

```
1. update sim (fixed-step loop, Section 8)
2. clear/overwrite is implicit — every pixel gets written:
3. floor + ceiling cast        (Section 3)   -> fills top & bottom halves
4. wall cast per column        (Sections 1-2) -> overwrites where walls are, sets zBuffer[x]
5. sprite pass (sorted)        (Section 4)    -> z-tested against zBuffer, transparency
6. weapon view-model overlay   (Section 10)   -> drawn last, on top, screen-space
7. putImageData -> upscale blit (Section 6)
8. HUD/UI in a separate canvas layer (DOM/2D), not in the pixel buffer
```

Walls after flats means no explicit clear is needed for the play area. The
weapon and HUD are screen-space and ignore the world z-buffer entirely.

---

## 10. First-person weapon view-model overlay

The weapon is a screen-space sprite drawn **after** the world, on top of
everything, unaffected by world depth — exactly DOOM's `R_DrawPlayerSprites`
**[id, `r_things.c`]**:

- Composite it into the **same backbuffer** before `putImageData` (so it gets
  the chunky upscale and can be tinted by `extralight`/muzzle flash for
  consistency), **or** draw it as a separate `drawImage` layer on the display
  canvas after the blit (simpler, allows sub-pixel positioning — but then it
  won't match the internal pixel grid). Prefer compositing into the backbuffer
  for a unified look.
- **Bob:** offset the weapon's screen X/Y by a sine of accumulated walk
  distance — `bobX = cos(t)*A`, `bobY = abs(sin(t))*A` — classic DOOM weapon
  bob. Drive `t` from movement, interpolate with `alpha` (Section 8).
- **Lighting:** apply the *current scene* light level / `extralight` to the
  weapon so it darkens in dark rooms and flares when firing.
- **Animation:** simple frame swap (raise/lower/fire frames); transparency via
  the same alpha/colorkey test as sprites (Section 4.3).

```ts
function drawWeapon(backbuffer: Uint32Array, frame: SpriteFrame, light: number): void {
  const ox = (W - frame.w) / 2 + bobX | 0;
  const oy = (H - frame.h)     + bobY | 0;     // anchored to screen bottom
  for (let y = 0; y < frame.h; y++) {
    for (let x = 0; x < frame.w; x++) {
      const c = frame.px[y * frame.w + x];
      if ((c >>> 24) === 0) continue;          // transparent
      backbuffer[(oy + y) * W + (ox + x)] = shade(c, 0, light);
    }
  }
}
```

---

## 11. Putting the numbers together — recommended baseline

- **Internal render resolution: 480×270**, nearest-neighbor **×4 → 1920×1080**.
  (Fallback for max authenticity: **320×200**, integer-scaled.)
- FOV plane ratio **0.66** (≈66°).
- Lighting: **32-level colormap** banding; paletted textures + colormap LUT for
  the fast path.
- Textures: **power-of-two** (64×64 walls/flats), packed **Uint32** or **Uint8
  paletted**.
- Backbuffer: one `ImageData` + `Uint32Array` view, single `putImageData`.
- Sim: **fixed 60Hz** update, **interpolated** render, `frameTime` clamped 250ms.
- Order: flats → walls (+zBuffer) → sprites (z-tested) → weapon → blit.

These choices keep per-frame pixel work near DOOM's own (~130k px) while leaving
ample headroom in the 16.6ms budget for the sim, sprites, and doors at 60fps.

---

## 12. Citation index

| Technique | Source |
|-----------|--------|
| DDA, perpWallDist / fisheye, plane-vector camera | Lode Vandevenne, raycasting.html |
| Textured walls (texX/texY stepping), floor & ceiling cast | Lode, raycasting2.html |
| Sprites: transform, sort, z-buffer clip, transparency | Lode, raycasting3.html |
| Backbuffer, optimizations, thin walls/doors | Lode, raycasting4.html |
| Angle-based derivation, fisheye intuition, variable heights | F. Permadi, ray-casting tutorial |
| Colormaps, diminishing/sector light, palette, sky | Sanglard, _Game Engine Black Book: DOOM_; id DOOM source (`r_main.c`, `r_data.c`, `r_things.c`); DoomWiki COLORMAP |
| Fixed-timestep + interpolation frame loop | Glenn Fiedler, "Fix Your Timestep" |
| Modern raycaster cross-check (DDA, sprites) | 3DSage, "Make Your Own Raycaster" |
