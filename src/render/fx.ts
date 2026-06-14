// Full-screen post-process: the DOOM palette tint composited over the final world
// frame (doom-design §5). The game derives the ScreenTint from damage events + active
// powerup timers; this pass just composites it onto the truecolor back buffer in RGB
// space (back is packed little-endian ABGR, like every other render pass).
import type { ScreenTint } from '../core';

/**
 * Composite a full-screen tint over the back buffer in place. Three modes cover all of
 * §5's effects:
 *  - 'blend'  : out = src·(1−a) + color·a   (red damage flash, gold pickup, berserk red,
 *               green radiation suit)
 *  - 'invert' : out = invert(src) blended with color·a   (invulnerability "god" palette)
 *  - 'bright' : out = src + (color − src)·a   (light-amp / infrared full-bright wash)
 * A 'blend' tint with a ≤ 0 is a no-op (the renderer also skips undefined tints).
 */
export function compositeTint(back: Uint32Array, W: number, H: number, tint: ScreenTint): void {
  const mode = tint.mode ?? 'blend';
  const a = Math.max(0, Math.min(1, tint.a));
  if (mode === 'blend' && a === 0) return;

  const tr = tint.r & 0xff;
  const tg = tint.g & 0xff;
  const tb = tint.b & 0xff;
  const inv = 1 - a;
  const n = W * H;

  for (let i = 0; i < n; i++) {
    const c = back[i]!;
    let r = c & 0xff;
    let g = (c >> 8) & 0xff;
    let b = (c >> 16) & 0xff;

    if (mode === 'invert') {
      r = 255 - r;
      g = 255 - g;
      b = 255 - b;
    }

    if (mode === 'bright') {
      // Lerp toward the (bright) target color.
      r = (r + (tr - r) * a) | 0;
      g = (g + (tg - g) * a) | 0;
      b = (b + (tb - b) * a) | 0;
    } else {
      // 'blend' and the post-invert wash both alpha-blend the color over.
      r = (r * inv + tr * a) | 0;
      g = (g * inv + tg * a) | 0;
      b = (b * inv + tb * a) | 0;
    }

    back[i] = (0xff000000 | (b << 16) | (g << 8) | r) >>> 0;
  }
}
