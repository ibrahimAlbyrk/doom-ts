// Persistence for rebindable controls. The active map is the DOOM defaults with any
// user overrides layered on top, saved to localStorage so rebinds survive a reload.
// Defaults always fill any missing/invalid action, so a partial or corrupt save can
// never strip a control — today's behaviour is preserved when nothing is stored.
import type { Action, Bindings } from '../core';
import { DEFAULT_BINDINGS } from '../core';

const STORAGE_KEY = 'doom-ts.bindings';

/** Persisted overrides merged over `base` (defaults). Returns `base` unchanged when
 *  storage is empty/unavailable/corrupt. */
export function loadBindings(base: Bindings = DEFAULT_BINDINGS): Bindings {
  const merged: Bindings = { ...base };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return merged;
    const saved = JSON.parse(raw) as Partial<Record<Action, unknown>>;
    for (const action of Object.keys(merged) as Action[]) {
      const v = saved[action];
      if (typeof v === 'string' && v) merged[action] = v;
    }
  } catch {
    // corrupt JSON or storage blocked (private mode) → fall back to base
  }
  return merged;
}

/** Persist the full binding map. No-op when storage is unavailable. */
export function saveBindings(bindings: Bindings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(bindings));
  } catch {
    // storage unavailable → silently skip; in-memory bindings still apply this session
  }
}
