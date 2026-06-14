// Unified per-column world cast — engine.md §1–3, §6.5, §7. One DDA walk per screen
// column draws each cell's floor and ceiling flats at THAT cell's own height (§7.2
// variable heights) with a vertical clip frontier, then the wall slice where the ray
// stops. Because floors/ceilings and walls share the same horizon (H/2) and eye height
// (eyeZ), every wall bottom meets the floor that leads up to it — no gap when the eye
// sits on a raised or sunken tier. Partially-open doors don't stop the walk: the panel
// hangs from the top and the cast continues THROUGH the opening so the room behind
// renders progressively (engine.md §6.4) instead of leaving a void.
import { CELL_SIZE } from '../core';
import type { ILevelRuntime } from '../core';
import type { Frame } from './frame';
import { lightLevel, shade, SIDE_SHADE } from './lighting';

const MAX_DDA_STEPS = 256; // guard against an unbounded ray in an unsealed map
const SEAM_EPS = 1e-4; // a real floor/ceiling tier difference (heights are discrete)
const SEAM_NEIGHBORS: ReadonlyArray<readonly [number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1]];

/** A door cell is see-through (don't stop the cast) only while it is mid-open. */
function isOpeningDoor(open: number, solid: boolean): boolean {
  return solid && open > 0 && open < 1;
}

/**
 * Cast one column per screen x. Walk the grid near→far: paint the current cell's floor
 * (lower half) and ceiling (upper half) out to its far edge, advancing per-side clip
 * frontiers so nearer surfaces occlude farther ones; stop at the first view-blocking
 * cell and paint its wall slice into the remaining band. Doors mid-open paint their
 * hanging panel but keep walking so the geometry behind shows through the gap.
 */
export function castWorld(f: Frame): void {
  const { back, zBuffer, cam, level, W, H, brightness, levels, extralight, eyeZ } = f;
  const half = H / 2;
  const sky = f.skyTex;
  const skyW = sky.width;
  const skyH = sky.height;
  const skyPix = sky.pixels;

  for (let x = 0; x < W; x++) {
    const cameraX = (2 * x) / W - 1;
    const rayDirX = cam.dirX + cam.planeX * cameraX;
    const rayDirY = cam.dirY + cam.planeY * cameraX;

    const deltaDistX = rayDirX === 0 ? Infinity : Math.abs(1 / rayDirX);
    const deltaDistY = rayDirY === 0 ? Infinity : Math.abs(1 / rayDirY);

    let mapX = Math.floor(cam.posX);
    let mapY = Math.floor(cam.posY);

    let stepX: number, stepY: number, sideDistX: number, sideDistY: number;
    if (rayDirX < 0) { stepX = -1; sideDistX = (cam.posX - mapX) * deltaDistX; }
    else { stepX = 1; sideDistX = (mapX + 1 - cam.posX) * deltaDistX; }
    if (rayDirY < 0) { stepY = -1; sideDistY = (cam.posY - mapY) * deltaDistY; }
    else { stepY = 1; sideDistY = (mapY + 1 - cam.posY) * deltaDistY; }

    const skyX = f.skyColumn[x]!;

    // Vertical clip frontiers: floor fills upward from the bottom, ceiling downward from
    // the top. Rows >= floorClip and rows < ceilClip are already painted this column.
    let floorClip = H;
    let ceilClip = 0;
    zBuffer[x] = Infinity; // open void until a wall stops the column

    let steps = 0;
    while (steps++ < MAX_DDA_STEPS && ceilClip < floorClip) {
      // Distance to the far edge of the CURRENT cell (mapX,mapY), and the next cell.
      let side: number, nextX = mapX, nextY = mapY;
      let dist: number;
      if (sideDistX < sideDistY) { dist = sideDistX; sideDistX += deltaDistX; nextX = mapX + stepX; side = 0; }
      else { dist = sideDistY; sideDistY += deltaDistY; nextY = mapY + stepY; side = 1; }
      if (dist < 1e-4) dist = 1e-4;

      // ── Floor of the current cell, out to its far edge (engine.md §3, §7.2) ──────
      const fh = level.floorHeightAt(mapX, mapY) / CELL_SIZE;
      const eyeAboveFloor = eyeZ - fh;
      if (eyeAboveFloor > 0) {
        const yEdge = half + (eyeAboveFloor * H) / dist;
        let yTopI = yEdge | 0;
        if (yTopI <= half) yTopI = half + 1; // floor stays strictly below the horizon
        if (yTopI < floorClip) {
          const ftex = f.resolve(level.floorTextureAt(mapX, mapY));
          const tw = ftex.width;
          const th = ftex.height;
          const tpx = ftex.pixels;
          const sectorLight = level.lightAt(mapX, mapY);
          const posZ = eyeAboveFloor * H;
          for (let y = floorClip - 1; y >= yTopI; y--) {
            const rowDistance = posZ / (y - half);
            const wx = cam.posX + rowDistance * rayDirX;
            const wy = cam.posY + rowDistance * rayDirY;
            const tx = (((wx - (wx | 0)) * tw) & (tw - 1));
            const ty = (((wy - (wy | 0)) * th) & (th - 1));
            const lvl = lightLevel(rowDistance, sectorLight, extralight, levels);
            back[y * W + x] = shade(tpx[ty * tw + tx]!, brightness[lvl]!);
          }
          floorClip = yTopI;
        }
      }

      // ── Ceiling of the current cell, out to its far edge (sky-aware) ────────────
      const ch = level.ceilHeightAt(mapX, mapY) / CELL_SIZE;
      const ceilAboveEye = ch - eyeZ;
      if (ceilAboveEye > 0) {
        let yEdge = half - (ceilAboveEye * H) / dist;
        let yBot = yEdge > half ? half : yEdge; // never cross below the horizon
        let yBotI = yBot | 0;
        if (yBotI > ceilClip) {
          const key = level.ceilTextureAt(mapX, mapY);
          if (key === null) {
            for (let y = ceilClip; y < yBotI; y++) {
              let syi = ((y * skyH) / half) | 0;
              if (syi >= skyH) syi = skyH - 1;
              back[y * W + x] = skyPix[syi * skyW + skyX]!;
            }
          } else {
            const ctex = f.resolve(key);
            const tw = ctex.width;
            const th = ctex.height;
            const tpx = ctex.pixels;
            const sectorLight = level.lightAt(mapX, mapY);
            const posZ = ceilAboveEye * H;
            for (let y = ceilClip; y < yBotI; y++) {
              const rowDistance = posZ / (half - y);
              const wx = cam.posX + rowDistance * rayDirX;
              const wy = cam.posY + rowDistance * rayDirY;
              const tx = (((wx - (wx | 0)) * tw) & (tw - 1));
              const ty = (((wy - (wy | 0)) * th) & (th - 1));
              const lvl = lightLevel(rowDistance, sectorLight, extralight, levels);
              back[y * W + x] = shade(tpx[ty * tw + tx]!, brightness[lvl]!);
            }
          }
          ceilClip = yBotI;
        }
      }

      // ── The boundary cell: wall, closed door, or a door to cast through ──────────
      const open = level.doorOpenAt(nextX, nextY);
      const solid = level.isSolid(nextX, nextY);
      if (solid && !isOpeningDoor(open, solid)) {
        paintWallSlice(f, x, nextX, nextY, dist, side, eyeZ, half, ceilClip, floorClip, 1);
        zBuffer[x] = dist;
        break;
      }
      if (isOpeningDoor(open, solid)) {
        // Hang the panel from the top of the opening; keep the gap below it for the
        // geometry behind the door. visFrac shrinks to 0 as the door fully opens.
        const drawBot = paintWallSlice(f, x, nextX, nextY, dist, side, eyeZ, half, ceilClip, floorClip, 1 - open);
        if (drawBot > ceilClip) ceilClip = drawBot;
      } else {
        // ── Height seams across a passable boundary (engine.md §7.3) ──────────────
        // The DDA keeps walking into open cells, so a floor that RISES (a step/ledge/
        // lift) or a ceiling that DROPS at this edge leaves a vertical gap the flats
        // can't fill. Paint the textured riser face there and advance the matching
        // clip frontier so the next cell's flat resumes above/below it — otherwise the
        // raised tier shows through to void and things on it appear to float.
        const fhB = level.floorHeightAt(nextX, nextY) / CELL_SIZE;
        if (fhB > fh + SEAM_EPS) {
          const key = seamTexKey(level, nextX, nextY, level.floorTextureAt(nextX, nextY));
          const r = paintSeamStrip(f, x, dist, side, rayDirX, rayDirY, fhB, fh, key, level.lightAt(nextX, nextY), ceilClip, floorClip);
          if (r.top < floorClip) floorClip = r.top;
        }
        const chB = level.ceilHeightAt(nextX, nextY) / CELL_SIZE;
        if (chB < ch - SEAM_EPS) {
          const flat = level.ceilTextureAt(nextX, nextY) ?? level.floorTextureAt(nextX, nextY);
          const key = seamTexKey(level, nextX, nextY, flat);
          const r = paintSeamStrip(f, x, dist, side, rayDirX, rayDirY, ch, chB, key, level.lightAt(nextX, nextY), ceilClip, floorClip);
          if (r.bot > ceilClip) ceilClip = r.bot;
        }
      }

      mapX = nextX;
      mapY = nextY;
    }
  }
}

/**
 * Paint a vertical wall (or door-panel) slice for the cell at (cx,cy) hit at `dist`,
 * clipped to the current [ceilTop, floorBot) band. `visFrac` is the visible top
 * fraction of the slice (1 for a solid wall; 1-openAmount for a rising door panel).
 * Returns the integer screen row of the slice bottom (drawBot) — the panel's lower
 * edge, used by the caller to advance the ceiling clip for the opening below it.
 */
function paintWallSlice(
  f: Frame,
  x: number,
  cx: number,
  cy: number,
  dist: number,
  side: number,
  eyeZ: number,
  half: number,
  ceilTop: number,
  floorBot: number,
  visFrac: number,
): number {
  const { back, cam, level, W, H, brightness, levels, extralight } = f;
  const fz = level.floorHeightAt(cx, cy) / CELL_SIZE;
  const cz = level.ceilHeightAt(cx, cy) / CELL_SIZE;
  const invD = H / dist;
  const wallTop = half + (eyeZ - cz) * invD;
  const wallBot = half + (eyeZ - fz) * invD;
  const drawBot = wallTop + visFrac * (wallBot - wallTop);

  const tex = f.resolve(level.wallTextureAt(cx, cy) ?? '');
  const TEX = tex.width;
  const texH = tex.height;
  const texPixels = tex.pixels;

  const cameraX = (2 * x) / W - 1;
  const rayDirX = cam.dirX + cam.planeX * cameraX;
  const rayDirY = cam.dirY + cam.planeY * cameraX;
  let wallX = side === 0 ? cam.posY + dist * rayDirY : cam.posX + dist * rayDirX;
  wallX -= Math.floor(wallX);
  let texX = (wallX * TEX) | 0;
  if (side === 0 && rayDirX > 0) texX = TEX - texX - 1;
  if (side === 1 && rayDirY < 0) texX = TEX - texX - 1;
  if (texX < 0) texX = 0;
  else if (texX >= TEX) texX = TEX - 1;

  const fullH = wallBot - wallTop;
  const texSpan = (cz - fz) * texH;
  const step = fullH > 0 ? texSpan / fullH : 0;

  // Fill the still-open band so nearer surfaces keep their pixels and no sliver is left
  // black: a solid wall covers it all (texPos keeps the texture anchored to wallTop); a
  // door panel only hangs from the top down to drawBot, leaving the opening below it.
  let yTop = ceilTop < 0 ? 0 : ceilTop;
  let yBot = visFrac >= 1 || drawBot >= floorBot ? floorBot - 1 : drawBot | 0;
  if (yBot > H - 1) yBot = H - 1;

  const sectorLight = level.lightAt(cx, cy);
  const distLvl = lightLevel(dist, sectorLight, extralight, levels);
  let f0 = brightness[distLvl]!;
  if (side === 1) f0 *= SIDE_SHADE;

  let texPos = (yTop - wallTop) * step;
  for (let y = yTop; y <= yBot; y++) {
    let ty = texPos | 0;
    ty %= texH;
    if (ty < 0) ty += texH;
    texPos += step;
    back[y * W + x] = shade(texPixels[ty * TEX + texX]!, f0);
  }
  return (drawBot | 0) < ceilTop ? ceilTop : drawBot | 0;
}

/**
 * Texture key for a floor/ceiling step face at a passable boundary. The grid stores no
 * per-edge "lower/upper" texture (MapData has only wall + flat ids), so prefer the
 * stepped cell's own wall texture, then a neighbouring solid wall's (the wall the step
 * abuts), and finally the supplied flat (the tier's own floor/ceiling) so the riser is
 * always a solid surface rather than void.
 */
function seamTexKey(level: ILevelRuntime, cx: number, cy: number, flatFallback: string): string {
  const own = level.wallTextureAt(cx, cy);
  if (own) return own;
  for (const [dx, dy] of SEAM_NEIGHBORS) {
    const adj = level.wallTextureAt(cx + dx, cy + dy);
    if (adj) return adj;
  }
  return flatFallback;
}

/**
 * Paint one vertical textured strip for a floor/ceiling height seam hit at `dist`,
 * mapping world-z [zBot, zTop] (zTop is the higher edge → nearer the top of the screen)
 * across the texture with the SAME texX / distance-and-side lighting math as full walls.
 * Clipped to the still-open band [bandTop, bandBot). Returns the integer rows actually
 * covered so the caller advances its clip frontier (floor seam → strip top; ceiling
 * seam → strip bottom).
 */
function paintSeamStrip(
  f: Frame,
  x: number,
  dist: number,
  side: number,
  rayDirX: number,
  rayDirY: number,
  zTop: number,
  zBot: number,
  texKey: string,
  sectorLight: number,
  bandTop: number,
  bandBot: number,
): { top: number; bot: number } {
  const { back, cam, W, H, brightness, levels, extralight, eyeZ } = f;
  const half = H / 2;
  const invD = H / dist;
  const rowTop = half + (eyeZ - zTop) * invD; // higher tier → smaller (upper) row
  const rowBot = half + (eyeZ - zBot) * invD;

  let yTop = rowTop | 0;
  if (yTop < bandTop) yTop = bandTop;
  if (yTop < 0) yTop = 0;
  let yBot = rowBot | 0;
  if (yBot > bandBot) yBot = bandBot; // bottom is exclusive — stop at the frontier
  if (yBot > H) yBot = H;
  if (yTop >= yBot) return { top: yTop, bot: yBot };

  const tex = f.resolve(texKey);
  const TEX = tex.width;
  const texH = tex.height;
  const texPixels = tex.pixels;

  let wallX = side === 0 ? cam.posY + dist * rayDirY : cam.posX + dist * rayDirX;
  wallX -= Math.floor(wallX);
  let texX = (wallX * TEX) | 0;
  if (side === 0 && rayDirX > 0) texX = TEX - texX - 1;
  if (side === 1 && rayDirY < 0) texX = TEX - texX - 1;
  if (texX < 0) texX = 0;
  else if (texX >= TEX) texX = TEX - 1;

  const texSpan = (zTop - zBot) * texH; // 1 cell unit of world height = one texture tile
  const screenSpan = rowBot - rowTop;
  const step = screenSpan > 0 ? texSpan / screenSpan : 0;
  let texPos = (yTop - rowTop) * step; // top-pegged at the higher tier

  const distLvl = lightLevel(dist, sectorLight, extralight, levels);
  let f0 = brightness[distLvl]!;
  if (side === 1) f0 *= SIDE_SHADE;

  for (let y = yTop; y < yBot; y++) {
    let ty = texPos | 0;
    ty %= texH;
    if (ty < 0) ty += texH;
    texPos += step;
    back[y * W + x] = shade(texPixels[ty * TEX + texX]!, f0);
  }
  return { top: yTop, bot: yBot };
}
