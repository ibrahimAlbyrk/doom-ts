// Persistence for the internal render resolution. The chosen tier is saved to
// localStorage so it survives a reload; an empty/corrupt/unknown save falls back to
// the default (crispest) tier. Mirrors the bindings-store pattern (src/input).
import { RESOLUTION_TIERS, INTERNAL_WIDTH_DEFAULT, INTERNAL_HEIGHT_DEFAULT } from '../core';

const STORAGE_KEY = 'doom-ts.resolution';

export interface Resolution {
  width: number;
  height: number;
}

const DEFAULT: Resolution = { width: INTERNAL_WIDTH_DEFAULT, height: INTERNAL_HEIGHT_DEFAULT };

/** Saved resolution if it matches a known tier, else the default tier. */
export function loadResolution(): Resolution {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT };
    const saved = JSON.parse(raw) as { width?: unknown; height?: unknown };
    const tier = RESOLUTION_TIERS.find((t) => t.width === saved.width && t.height === saved.height);
    if (tier) return { width: tier.width, height: tier.height };
  } catch {
    // corrupt JSON or storage blocked (private mode) → fall back to default
  }
  return { ...DEFAULT };
}

/** Persist the chosen resolution. No-op when storage is unavailable. */
export function saveResolution(res: Resolution): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ width: res.width, height: res.height }));
  } catch {
    // storage unavailable → silently skip; in-memory config still applies this session
  }
}
