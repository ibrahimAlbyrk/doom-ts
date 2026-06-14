// Shade colormaps — engine.md §5.1. Precompute [levels][256] tables of pre-darkened
// packed colors from the 256-entry palette so the hot loop is one array read.
// This one is implemented (pure, cheap); the raycaster passes are stubs.

/** palette[i] = packed little-endian ABGR (0xAABBGGRR). Returns `levels` darker maps. */
export function buildColormaps(palette: Uint32Array, levels: number): Uint32Array[] {
  const maps: Uint32Array[] = [];
  for (let l = 0; l < levels; l++) {
    const f = 1 - l / (levels - 1); // 1.0 bright .. 0.0 black
    const m = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      const c = palette[i] ?? 0;
      const r = (c & 0xff) * f;
      const g = ((c >> 8) & 0xff) * f;
      const b = ((c >> 16) & 0xff) * f;
      m[i] = (0xff << 24) | (b << 16) | (g << 8) | r;
    }
    maps.push(m);
  }
  return maps;
}
