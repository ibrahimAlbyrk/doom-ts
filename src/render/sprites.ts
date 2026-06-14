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
  const eyeAboveFloor = f.eyeAboveFloor; // bobbed eye height → sprites bob with the floor
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

    // Stand the sprite on the floor line at its depth (matches the flat cast), then
    // apply vMove for floating things (engine.md §4.2).
    const floorLine = half + eyeAboveFloor * scale;
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

// A native-pixel weapon blit shrinks to a tiny fraction of the backbuffer at higher
// internal resolutions, so scale the view-model by H / PSPR_VIEW_HEIGHT. The divisor is
// tuned (not the literal 200-tall pspr space) so the gun is noticeably bigger than the
// native blit yet its TOP stays just below the screen center / aim point — the upper
// half stays clear so the player can see enemies. Scaling with H keeps that framing at
// every tier (960×540 → 1.65×, 480×270 → 0.82×, 320×200 → 0.55×).
const PSPR_VIEW_HEIGHT = 326;
function weaponScale(H: number): number {
  return H / PSPR_VIEW_HEIGHT;
}

/**
 * Screen top-left for a bottom-center-anchored view-model frame, plus the bob offset.
 * `anchorBottom` is the play-view bottom (above the status bar), not the screen height.
 * `scale` magnifies the frame; the anchor uses the SCALED size so the gun stays
 * bottom-center and the (200-view-space) bob travel is magnified to match.
 */
function weaponAnchor(
  W: number,
  anchorBottom: number,
  fw: number,
  fh: number,
  bobX: number,
  bobY: number,
  scale: number,
) {
  const dw = fw * scale;
  const dh = fh * scale;
  return { ox: (((W - dw) / 2 + bobX * scale) | 0), oy: ((anchorBottom - dh + bobY * scale) | 0) };
}

/**
 * Alpha-test blit of a view-model frame at (ox,oy), shaded by `fLight`, magnified by
 * `scale` with nearest-neighbor sampling (integer-step the source texel per dest pixel),
 * preserving the 1-bit alpha-test transparency.
 */
function blitViewFrame(
  back: Uint32Array,
  W: number,
  H: number,
  frame: SpriteFrame,
  ox: number,
  oy: number,
  fLight: number,
  scale: number,
): void {
  const tex = frame.texture;
  const fw = tex.width;
  const fh = tex.height;
  const px = tex.pixels;
  const dw = (fw * scale) | 0;
  const dh = (fh * scale) | 0;
  const invScale = 1 / scale;
  for (let dy = 0; dy < dh; dy++) {
    const sy = oy + dy;
    if (sy < 0 || sy >= H) continue;
    const ty = (dy * invScale) | 0;
    const row = ty * fw;
    for (let dx = 0; dx < dw; dx++) {
      const sx = ox + dx;
      if (sx < 0 || sx >= W) continue;
      const tx = (dx * invScale) | 0;
      const color = px[row + tx]!;
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
  const scale = weaponScale(H);
  const { ox, oy } = weaponAnchor(W, anchorBottom, frame.texture.width, frame.texture.height, bobX, bobY, scale);
  const fLight = brightness[lightLevel(0, sectorLight, extralight, levels)]!;
  blitViewFrame(back, W, H, frame, ox, oy, fLight, scale);
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
  const scale = weaponScale(H);
  const base = weaponAnchor(W, anchorBottom, weapon.texture.width, weapon.texture.height, bobX, bobY, scale);
  const ox = base.ox + (((weapon.originX - flash.originX) * scale) | 0);
  const oy = base.oy + (((weapon.originY - flash.originY) * scale) | 0);
  blitViewFrame(back, W, H, flash, ox, oy, 1, scale); // full-bright: muzzle flash ignores sector light
}

/** Sector light at the camera cell — used to light the weapon overlay. */
export function cameraCellLight(level: ILevelRuntime, camX: number, camY: number): number {
  return level.lightAt(Math.floor(camX), Math.floor(camY));
}
