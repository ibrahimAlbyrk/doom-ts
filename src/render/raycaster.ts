// Wall + flat casting — engine.md §1–3, §6.5, §7. DDA grid raycaster with
// perpendicular (fisheye-free) distance, perspective-correct vertical texture mapping,
// generalized variable-height wall projection (§7.1), two-pass floor/ceiling with
// independent posZ (§7.2), and per-pixel sky.
import { CELL_SIZE } from '../core';
import type { Frame } from './frame';
import { lightLevel, shade, SIDE_SHADE } from './lighting';

const MAX_DDA_STEPS = 256; // guard against an unbounded ray in an unsealed map

/**
 * Cast one column per screen x: DDA → perpWallDist → variable-height textured wall
 * slice → zBuffer[x]. Also overwrites the ceiling band with sky where the wall cell's
 * ceiling is sky. Walls run after the flat cast, so they paint over it (engine.md §9).
 */
export function castWalls(f: Frame): void {
  const { back, zBuffer, cam, level, W, H, brightness, levels, extralight, eyeZ } = f;
  const half = H / 2;

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

    let side = 0;
    let hit = false;
    let steps = 0;
    while (steps++ < MAX_DDA_STEPS) {
      if (sideDistX < sideDistY) { sideDistX += deltaDistX; mapX += stepX; side = 0; }
      else { sideDistY += deltaDistY; mapY += stepY; side = 1; }
      if (level.isSolid(mapX, mapY)) { hit = true; break; }
    }

    if (!hit) {
      zBuffer[x] = Infinity; // open void: leave the cast floor/ceiling/sky in place
      continue;
    }

    const perpWallDist =
      side === 0 ? sideDistX - deltaDistX : sideDistY - deltaDistY;
    const dist = perpWallDist > 1e-4 ? perpWallDist : 1e-4;
    zBuffer[x] = dist;

    // Wall vertical extent from this cell's floor/ceiling tiers (cell units).
    const fz = level.floorHeightAt(mapX, mapY) / CELL_SIZE;
    const cz = level.ceilHeightAt(mapX, mapY) / CELL_SIZE;
    const invD = H / dist;
    const wallTop = half + (eyeZ - cz) * invD;
    const wallBot = half + (eyeZ - fz) * invD;

    // Door panel (engine.md §6.4, simplified): a partially-open door hangs from the
    // top; openAmt 1 = non-door/fully-open → full slice.
    const openAmt = level.doorOpenAt(mapX, mapY);
    const visFrac = openAmt < 1 ? 1 - openAmt : 1;
    const drawBot = wallTop + visFrac * (wallBot - wallTop);

    const tex = f.resolve(level.wallTextureAt(mapX, mapY) ?? '');
    const TEX = tex.width;
    const texPixels = tex.pixels;

    // Horizontal texture coordinate of the hit (engine.md §2).
    let wallX = side === 0 ? cam.posY + dist * rayDirY : cam.posX + dist * rayDirX;
    wallX -= Math.floor(wallX);
    let texX = (wallX * TEX) | 0;
    if (side === 0 && rayDirX > 0) texX = TEX - texX - 1;
    if (side === 1 && rayDirY < 0) texX = TEX - texX - 1;
    if (texX < 0) texX = 0;
    else if (texX >= TEX) texX = TEX - 1;
    const texColBase = texX; // column index; row added below

    // Vertical texel step: tile one texture per 1.0 cell of wall height.
    const fullH = wallBot - wallTop;
    const texSpan = (cz - fz) * tex.height;
    const step = fullH > 0 ? texSpan / fullH : 0;

    const yTop = wallTop < 0 ? 0 : wallTop | 0;
    const yBot = drawBot >= H ? H - 1 : drawBot | 0;
    let texPos = (yTop - wallTop) * step;

    const sectorLight = level.lightAt(mapX, mapY);
    const distLvl = lightLevel(dist, sectorLight, extralight, levels);
    let f0 = brightness[distLvl]!;
    if (side === 1) f0 *= SIDE_SHADE;
    const texH = tex.height;

    for (let y = yTop; y <= yBot; y++) {
      let ty = texPos | 0;
      ty %= texH;
      if (ty < 0) ty += texH;
      texPos += step;
      back[y * W + x] = shade(texPixels[ty * TEX + texColBase]!, f0);
    }

    // Sky fills the ceiling band when the wall cell's ceiling is sky.
    if (level.ceilTextureAt(mapX, mapY) === null) {
      fillSkyColumn(f, x, yTop);
    }
  }
}

/** Write the sky into rows [0, yEnd) of column x (engine.md §6.5; no lighting). */
function fillSkyColumn(f: Frame, x: number, yEnd: number): void {
  const { back, W, H, skyTex, skyColumn } = f;
  const sky = skyTex.pixels;
  const skyW = skyTex.width;
  const skyH = skyTex.height;
  const sx = skyColumn[x]!;
  const half = H / 2;
  const end = yEnd > half ? (half | 0) : yEnd;
  for (let y = 0; y < end; y++) {
    let syi = ((y * skyH) / half) | 0;
    if (syi >= skyH) syi = skyH - 1;
    back[y * W + x] = sky[syi * skyW + sx]!;
  }
}

/**
 * Per-row floor + ceiling flats (engine.md §3). Two passes with independent posZ
 * (§7.2): floor keyed to the player's floor tier, ceiling to the player's ceiling tier.
 * Per-pixel texture + light come from the actual cell; sky is drawn where a ceiling
 * cell is sky-flagged.
 */
export function castFloorCeiling(f: Frame): void {
  const { back, cam, level, W, H, brightness, levels, extralight } = f;
  const halfF = Math.floor(H / 2);

  const rayDirX0 = cam.dirX - cam.planeX;
  const rayDirY0 = cam.dirY - cam.planeY;
  const rayDirX1 = cam.dirX + cam.planeX;
  const rayDirY1 = cam.dirY + cam.planeY;
  const dRayX = (rayDirX1 - rayDirX0) / W;
  const dRayY = (rayDirY1 - rayDirY0) / W;

  // ── Floor pass (lower half) ──────────────────────────────────────────────
  for (let y = halfF + 1; y < H; y++) {
    const p = y - H / 2;
    const rowDistance = f.posZFloor / p;
    const stepX = rowDistance * dRayX;
    const stepY = rowDistance * dRayY;
    let floorX = cam.posX + rowDistance * rayDirX0;
    let floorY = cam.posY + rowDistance * rayDirY0;
    const rowBase = y * W;

    let lastCX = -2147483648;
    let lastCY = -2147483648;
    let tex = f.resolve('');
    let texPixels = tex.pixels;
    let fLight = 1;

    for (let x = 0; x < W; x++) {
      const cellX = floorX | 0;
      const cellY = floorY | 0;
      if (cellX !== lastCX || cellY !== lastCY) {
        lastCX = cellX;
        lastCY = cellY;
        tex = f.resolve(level.floorTextureAt(cellX, cellY));
        texPixels = tex.pixels;
        const lvl = lightLevel(rowDistance, level.lightAt(cellX, cellY), extralight, levels);
        fLight = brightness[lvl]!;
      }
      const tw = tex.width;
      const th = tex.height;
      const tx = ((floorX - cellX) * tw) & (tw - 1);
      const ty = ((floorY - cellY) * th) & (th - 1);
      floorX += stepX;
      floorY += stepY;
      back[rowBase + x] = shade(texPixels[ty * tw + tx]!, fLight);
    }
  }

  // ── Ceiling pass (upper half) ────────────────────────────────────────────
  for (let y = 0; y < halfF; y++) {
    const p = H / 2 - y;
    const rowDistance = f.posZCeil / p;
    const stepX = rowDistance * dRayX;
    const stepY = rowDistance * dRayY;
    let ceilX = cam.posX + rowDistance * rayDirX0;
    let ceilY = cam.posY + rowDistance * rayDirY0;
    const rowBase = y * W;

    let lastCX = -2147483648;
    let lastCY = -2147483648;
    let isSky = false;
    let tex = f.resolve('');
    let texPixels = tex.pixels;
    let fLight = 1;

    for (let x = 0; x < W; x++) {
      const cellX = ceilX | 0;
      const cellY = ceilY | 0;
      if (cellX !== lastCX || cellY !== lastCY) {
        lastCX = cellX;
        lastCY = cellY;
        const key = level.ceilTextureAt(cellX, cellY);
        isSky = key === null;
        if (key !== null) {
          tex = f.resolve(key);
          texPixels = tex.pixels;
          const lvl = lightLevel(rowDistance, level.lightAt(cellX, cellY), extralight, levels);
          fLight = brightness[lvl]!;
        }
      }
      if (isSky) {
        const sky = f.skyTex;
        let syi = ((y * sky.height) / halfF) | 0;
        if (syi >= sky.height) syi = sky.height - 1;
        back[rowBase + x] = sky.pixels[syi * sky.width + f.skyColumn[x]!]!;
        ceilX += stepX;
        ceilY += stepY;
        continue;
      }
      const tw = tex.width;
      const th = tex.height;
      const tx = ((ceilX - cellX) * tw) & (tw - 1);
      const ty = ((ceilY - cellY) * th) & (th - 1);
      ceilX += stepX;
      ceilY += stepY;
      back[rowBase + x] = shade(texPixels[ty * tw + tx]!, fLight);
    }
  }
}
