// Ammo table — docs/research/doom-design.md §4.
import type { AmmoDef, AmmoType } from '../core';

export const AMMO: Record<AmmoType, AmmoDef> = {
  bullets: { type: 'bullets', name: 'Bullets', normalMax: 200, backpackMax: 400, smallPickup: 10, boxPickup: 50 },
  shells: { type: 'shells', name: 'Shells', normalMax: 50, backpackMax: 100, smallPickup: 4, boxPickup: 20 },
  rockets: { type: 'rockets', name: 'Rockets', normalMax: 50, backpackMax: 100, smallPickup: 1, boxPickup: 5 },
  cells: { type: 'cells', name: 'Cells', normalMax: 300, backpackMax: 600, smallPickup: 20, boxPickup: 100 },
};
