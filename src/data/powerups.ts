// Powerup table — docs/research/doom-design.md §5. durationTics in tics
// (seconds × 35); -1 = rest of level.
import type { PowerupDef, PowerupKind } from '../core';

export const POWERUPS: Record<PowerupKind, PowerupDef> = {
  berserk: { kind: 'berserk', thingId: 2023, name: 'Berserk Pack', durationTics: -1 },
  invulnerability: { kind: 'invulnerability', thingId: 2022, name: 'Invulnerability', durationTics: 1050 }, // 30 s
  radSuit: { kind: 'radSuit', thingId: 2025, name: 'Radiation Suit', durationTics: 2100 }, // 60 s
  invisibility: { kind: 'invisibility', thingId: 2024, name: 'Partial Invisibility', durationTics: 2100 }, // 60 s
  lightVisor: { kind: 'lightVisor', thingId: 2045, name: 'Light Amplification Visor', durationTics: 4200 }, // 120 s
  computerMap: { kind: 'computerMap', thingId: 2026, name: 'Computer Area Map', durationTics: -1 },
};
