// Shared UI rendering primitives. Decoded assets arrive as `Texture` (packed
// little-endian ABGR / 0xAABBGGRR, engine.md §6.1) which is byte-identical to a
// canvas ImageData RGBA buffer — so a Texture wraps straight into a drawable canvas
// with no per-pixel work. Every UI screen draws through this module: status-bar
// graphics, mugshot faces, key icons, and the STCFN bitmap font ("hud" glyph set).
import type { IAssetStore, Texture } from '../core';

/** The HUD/menu bitmap font key (STCFN033-095: uppercase, digits, punctuation). */
export const HUD_FONT = 'hud';
/** Advance for the absent space glyph (manifest fonts.hud.space). */
const SPACE_ADVANCE = 4;
/** Default tracking (px between glyphs at scale 1). */
const DEFAULT_TRACKING = 1;
/** Nominal glyph cell height — used by screens to lay out lines. */
export const FONT_LINE_HEIGHT = 8;

/** Wrap a decoded Texture's RGBA buffer into a drawable canvas (zero pixel copy). */
function textureToCanvas(tex: Texture): HTMLCanvasElement | null {
  const canvas = document.createElement('canvas');
  canvas.width = tex.width;
  canvas.height = tex.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const image = ctx.createImageData(tex.width, tex.height);
  image.data.set(new Uint8Array(tex.pixels.buffer, tex.pixels.byteOffset, tex.width * tex.height * 4));
  ctx.putImageData(image, 0, 0);
  return canvas;
}

/** Lazily converts decoded Textures into drawable canvases, memoized by asset id. */
export class TextureCache {
  private readonly cache = new Map<string, HTMLCanvasElement | null>();
  constructor(private readonly assets: IAssetStore) {}

  /** The drawable canvas for asset `id`, or null when the asset is absent. */
  image(id: string): HTMLCanvasElement | null {
    const hit = this.cache.get(id);
    if (hit !== undefined) return hit;
    const tex = this.assets.getTexture(id);
    const img = tex ? textureToCanvas(tex) : null;
    this.cache.set(id, img);
    return img;
  }

  /** Draw graphic `id` at (x,y) top-left; returns its width (0 if absent). */
  draw(ctx: CanvasRenderingContext2D, id: string, x: number, y: number): number {
    const img = this.image(id);
    if (!img) return 0;
    ctx.drawImage(img, x, y);
    return img.width;
  }
}

export type TextAlign = 'left' | 'center' | 'right';

export interface TextStyle {
  /** Integer pixel scale (keep imageSmoothingEnabled=false for crisp glyphs). */
  scale?: number;
  /** Extra px between glyphs at scale 1. */
  tracking?: number;
  align?: TextAlign;
}

/** Width in px of `text` rendered in `font` at the given style. */
export function measureText(cache: TextureCache, font: string, text: string, style: TextStyle = {}): number {
  const scale = style.scale ?? 1;
  const tracking = style.tracking ?? DEFAULT_TRACKING;
  let w = 0;
  for (const ch of text.toUpperCase()) {
    if (ch === ' ') {
      w += SPACE_ADVANCE + tracking;
      continue;
    }
    const img = cache.image(`${font}#${ch.charCodeAt(0)}`);
    w += (img ? img.width : SPACE_ADVANCE) + tracking;
  }
  return Math.max(0, w - tracking) * scale;
}

/** Draw uppercase bitmap text (the font has no lowercase). Returns advance width. */
export function drawText(
  ctx: CanvasRenderingContext2D,
  cache: TextureCache,
  font: string,
  text: string,
  x: number,
  y: number,
  style: TextStyle = {},
): number {
  const scale = style.scale ?? 1;
  const tracking = style.tracking ?? DEFAULT_TRACKING;
  const align = style.align ?? 'left';
  let cx = x;
  if (align !== 'left') {
    const w = measureText(cache, font, text, style);
    cx = align === 'center' ? Math.round(x - w / 2) : Math.round(x - w);
  }
  const startX = cx;
  for (const ch of text.toUpperCase()) {
    if (ch === ' ') {
      cx += (SPACE_ADVANCE + tracking) * scale;
      continue;
    }
    const img = cache.image(`${font}#${ch.charCodeAt(0)}`);
    if (img) {
      ctx.drawImage(img, cx, y, img.width * scale, img.height * scale);
      cx += (img.width + tracking) * scale;
    } else {
      cx += (SPACE_ADVANCE + tracking) * scale;
    }
  }
  return cx - startX;
}
