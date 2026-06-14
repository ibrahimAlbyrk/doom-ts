// Diminishing light + sector light, banded into discrete levels (engine.md §5).
// Textures here are truecolor RGBA (ARCHITECTURE §4), so we shade in RGB space with
// a banded brightness factor (engine.md §5.2) rather than the paletted colormap LUT
// (§5.1, kept in colormap.ts for a future paletted path). Banding hard — not a smooth
// gradient — is the signature DOOM look.

/** Distance darkening per cell of perpendicular distance. Tuned for cell-space depth. */
export const LIGHT_SCALE = 1.6;
/** Fixed dim applied to E/W wall faces for cheap corner definition (engine.md §2). */
export const SIDE_SHADE = 0.72;

/** brightness[level] = 1.0 (bright) .. 0.0 (black); discrete = banded falloff. */
export function buildBrightness(levels: number): Float64Array {
  const b = new Float64Array(levels);
  const last = levels - 1 || 1;
  for (let l = 0; l < levels; l++) b[l] = 1 - l / last;
  return b;
}

/** Pick a light band from perpendicular distance (cells) + sector light (0..255). */
export function lightLevel(
  dist: number,
  sectorLight: number,
  extralight: number,
  levels: number,
): number {
  const base = ((255 - sectorLight) / 255) * (levels - 1); // dim sectors start darker
  let lvl = (base + LIGHT_SCALE * dist - extralight) | 0; // farther = darker
  if (lvl < 0) lvl = 0;
  else if (lvl >= levels) lvl = levels - 1;
  return lvl;
}

/** Multiply a packed ABGR color by a brightness factor; forces opaque alpha. */
export function shade(color: number, f: number): number {
  const r = ((color & 0xff) * f) | 0;
  const g = (((color >> 8) & 0xff) * f) | 0;
  const b = (((color >> 16) & 0xff) * f) | 0;
  return (0xff000000 | (b << 16) | (g << 8) | r) >>> 0;
}
