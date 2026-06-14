// Procedural fallback textures — graceful degradation so the engine is verifiable
// before real Freedoom assets land (task requirement). A missing wall/flat key renders
// a per-key checkerboard; a missing sprite renders a transparent-bordered diamond so
// alpha-test + depth-clip are still exercised. All output is packed little-endian ABGR.
import type { Texture, SpriteFrame } from '../core';

const OPAQUE = 0xff000000;

function pack(r: number, g: number, b: number): number {
  return (OPAQUE | (b << 16) | (g << 8) | r) >>> 0;
}

/** Cheap deterministic string hash → 32-bit, for a stable per-key hue. */
function hashKey(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function hueToRgb(h: number, s: number, v: number): [number, number, number] {
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  let r = 0,
    g = 0,
    b = 0;
  switch (i % 6) {
    case 0: r = v; g = t; b = p; break;
    case 1: r = q; g = v; b = p; break;
    case 2: r = p; g = v; b = t; break;
    case 3: r = p; g = q; b = v; break;
    case 4: r = t; g = p; b = v; break;
    default: r = v; g = p; b = q; break;
  }
  return [(r * 255) | 0, (g * 255) | 0, (b * 255) | 0];
}

/** 64×64 checkerboard tinted by `key` — the "missing texture" placeholder. */
export function makeCheckerTexture(key: string, size = 64): Texture {
  const hue = (hashKey(key) % 360) / 360;
  const [r, g, b] = hueToRgb(hue, 0.55, 0.85);
  const light = pack(r, g, b);
  const dark = pack((r * 0.45) | 0, (g * 0.45) | 0, (b * 0.45) | 0);
  const pixels = new Uint32Array(size * size);
  const block = size >> 3; // 8×8 checker
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const on = (((x / block) | 0) + ((y / block) | 0)) & 1;
      pixels[y * size + x] = on ? light : dark;
    }
  }
  return { width: size, height: size, pixels };
}

/** Vertical gradient sky — the "missing sky" placeholder (reads as sky, not checker). */
export function makeSkyFallback(width = 256, height = 128): Texture {
  const pixels = new Uint32Array(width * height);
  for (let y = 0; y < height; y++) {
    const t = y / (height - 1); // 0 top .. 1 horizon
    const r = (40 + t * 80) | 0;
    const g = (45 + t * 95) | 0;
    const b = (90 + t * 120) | 0;
    const c = pack(r, g, b);
    const row = y * width;
    for (let x = 0; x < width; x++) pixels[row + x] = c;
  }
  return { width, height, pixels };
}

/** Opaque diamond on a transparent field — the "missing sprite" placeholder. */
export function makeFallbackSpriteFrame(key = 'SPRITE', size = 64): SpriteFrame {
  const hue = (hashKey(key) % 360) / 360;
  const [r, g, b] = hueToRgb(hue, 0.7, 0.95);
  const body = pack(r, g, b);
  const edge = pack(255, 255, 255);
  const pixels = new Uint32Array(size * size); // alpha 0 = transparent everywhere
  const c = (size - 1) / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.abs(x - c) / c + Math.abs(y - c) / c; // diamond metric
      if (d <= 1) pixels[y * size + x] = d > 0.85 ? edge : body;
    }
  }
  return {
    texture: { width: size, height: size, pixels },
    originX: c,
    originY: size - 1,
    mirror: false,
  };
}
