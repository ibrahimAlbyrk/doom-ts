// Sprite + weapon view-model passes — engine.md §4, §10. Billboards: world→camera
// transform, far-to-near sort, per-column z-buffer clip, alpha-test transparency, and
// the screen-space weapon overlay drawn last on top of everything.
import { CELL_SIZE } from '../core';
import type { SpriteInstance, SpriteFrame, ILevelRuntime } from '../core';
import type { Frame } from './frame';
import { lightLevel, shade } from './lighting';

const TEXELS_PER_CELL = CELL_SIZE; // sprite texel height → world height (matches walls)

/**
 * Draw all world sprites, sorted far→near and clipped per column against the wall
 * z-buffer (engine.md §4). Reuses `order` to avoid mutating the caller's array.
 */
export function drawSprites(f: Frame, sprites: SpriteInstance[], order: number[]): void {
  const { back, zBuffer, cam, W, H, brightness, levels, extralight } = f;
  const n = sprites.length;
  if (n === 0) return;

  // Far-to-near order by squared distance (no sqrt needed for ordering).
  order.length = n;
  for (let i = 0; i < n; i++) order[i] = i;
  order.sort((a, b) => {
    const sa = sprites[a]!;
    const sb = sprites[b]!;
    const da = (cam.posX - sa.x) ** 2 + (cam.posY - sa.y) ** 2;
    const db = (cam.posX - sb.x) ** 2 + (cam.posY - sb.y) ** 2;
    return db - da;
  });

  const invDet = 1 / (cam.planeX * cam.dirY - cam.dirX * cam.planeY);
  const eyeZ = f.eyeZ; // absolute bobbed eye height (cell units) — shared with the world cast
  const level = f.level; // per-cell floor heights, same source the raycaster uses
  const half = H / 2;

  for (let s = 0; s < n; s++) {
    const sprite = sprites[order[s]!]!;
    const tex = sprite.frame.texture;
    const SPRW = tex.width;
    const SPRH = tex.height;
    const px = tex.pixels;

    const dx = sprite.x - cam.posX;
    const dy = sprite.y - cam.posY;
    const transformX = invDet * (cam.dirY * dx - cam.dirX * dy);
    const transformY = invDet * (-cam.planeY * dx + cam.planeX * dy); // depth
    if (transformY <= 0.0001) continue; // behind camera

    const screenX = (W / 2) * (1 + transformX / transformY);
    const scale = H / transformY;
    const spriteW = (SPRW / TEXELS_PER_CELL) * scale;
    const spriteH = (SPRH / TEXELS_PER_CELL) * scale;

    // Stand the sprite on ITS OWN cell's floor tier, not the player's: use the same
    // screenY(z) = half + (eyeZ - z)*scale the wall/flat cast uses (raycaster.ts), with
    // z = the sprite cell's floor height. So a thing on a raised ledge draws higher and
    // stays planted on its floor as the player rides a lift or steps up/down. Then apply
    // vMove for floating things on top (engine.md §4.2).
    const spriteFloorZ = level.floorHeightAt(Math.floor(sprite.x), Math.floor(sprite.y)) / CELL_SIZE;
    const floorLine = half + (eyeZ - spriteFloorZ) * scale;
    const vMove = sprite.vMove / transformY;
    const drawBottom = floorLine + vMove;
    const drawTop = drawBottom - spriteH;
    const leftX = screenX - spriteW / 2;

    const startX = leftX < 0 ? 0 : Math.ceil(leftX);
    const endX = Math.min(Math.ceil(leftX + spriteW), W);
    const yStart = drawTop < 0 ? 0 : drawTop | 0;
    const yEnd = drawBottom >= H ? H - 1 : drawBottom | 0;
    if (yEnd < yStart) continue;

    const lvl = sprite.fullbright ? 0 : lightLevel(transformY, sprite.light, extralight, levels);
    const fLight = brightness[lvl]!;

    for (let stripe = startX; stripe < endX; stripe++) {
      if (transformY >= zBuffer[stripe]!) continue; // occluded by a nearer wall
      let texX = (((stripe - leftX) * SPRW) / spriteW) | 0;
      if (texX < 0) texX = 0;
      else if (texX >= SPRW) texX = SPRW - 1;
      if (sprite.frame.mirror) texX = SPRW - 1 - texX;

      for (let y = yStart; y <= yEnd; y++) {
        let texY = (((y - drawTop) * SPRH) / spriteH) | 0;
        if (texY < 0) texY = 0;
        else if (texY >= SPRH) texY = SPRH - 1;
        const color = px[texY * SPRW + texX]!;
        if ((color >>> 24) === 0) continue; // alpha-test cutout (DOOM 1-bit transparency)
        back[y * W + stripe] = shade(color, fLight);
      }
    }
  }
}

/**
 * Screen top-left for a bottom-center-anchored view-model frame, plus the bob offset.
 * `anchorBottom` is the play-view bottom (above the status bar), not the screen height.
 */
function weaponAnchor(W: number, anchorBottom: number, fw: number, fh: number, bobX: number, bobY: number) {
  return { ox: (((W - fw) / 2 + bobX) | 0), oy: ((anchorBottom - fh + bobY) | 0) };
}

/** Alpha-test blit of a view-model frame at (ox,oy), shaded by `fLight`. */
function blitViewFrame(
  back: Uint32Array,
  W: number,
  H: number,
  frame: SpriteFrame,
  ox: number,
  oy: number,
  fLight: number,
): void {
  const tex = frame.texture;
  const fw = tex.width;
  const fh = tex.height;
  const px = tex.pixels;
  for (let y = 0; y < fh; y++) {
    const sy = oy + y;
    if (sy < 0 || sy >= H) continue;
    for (let x = 0; x < fw; x++) {
      const sx = ox + x;
      if (sx < 0 || sx >= W) continue;
      const color = px[y * fw + x]!;
      if ((color >>> 24) === 0) continue;
      back[sy * W + sx] = shade(color, fLight);
    }
  }
}

/**
 * Composite the first-person weapon frame last, in screen space, anchored to the
 * bottom-center and lit by the current sector light + extralight (engine.md §10).
 * `bobX`/`bobY` are screen-space offsets (0 when no bob data is threaded in).
 */
export function drawWeapon(
  back: Uint32Array,
  W: number,
  H: number,
  anchorBottom: number,
  frame: SpriteFrame,
  brightness: Float64Array,
  levels: number,
  sectorLight: number,
  extralight: number,
  bobX: number,
  bobY: number,
): void {
  const { ox, oy } = weaponAnchor(W, anchorBottom, frame.texture.width, frame.texture.height, bobX, bobY);
  const fLight = brightness[lightLevel(0, sectorLight, extralight, levels)]!;
  blitViewFrame(back, W, H, frame, ox, oy, fLight);
}

/**
 * Composite the muzzle-flash frame OVER the weapon, full-bright (doom-design §5). The
 * flash is positioned by the difference between its and the weapon's picture hotspots
 * (originX/originY) so it lands at the barrel exactly as DOOM overlays the flash psprite,
 * and rides the same bob. Both share the weapon's bottom-center anchor.
 */
export function drawViewFlash(
  back: Uint32Array,
  W: number,
  H: number,
  anchorBottom: number,
  weapon: SpriteFrame,
  flash: SpriteFrame,
  bobX: number,
  bobY: number,
): void {
  const base = weaponAnchor(W, anchorBottom, weapon.texture.width, weapon.texture.height, bobX, bobY);
  const ox = base.ox + ((weapon.originX - flash.originX) | 0);
  const oy = base.oy + ((weapon.originY - flash.originY) | 0);
  blitViewFrame(back, W, H, flash, ox, oy, 1); // full-bright: muzzle flash ignores sector light
}

/** Sector light at the camera cell — used to light the weapon overlay. */
export function cameraCellLight(level: ILevelRuntime, camX: number, camY: number): number {
  return level.lightAt(Math.floor(camX), Math.floor(camY));
}
