// Episode definition + progression. Scope = one full episode of 3–5 levels
// (doom-design.md §7). Models Episode 1 "Knee-Deep in the Dead": 5 main maps + 1
// secret map reached via a secret exit in E1M3. Map JSON lives in public/assets/maps.
export interface EpisodeLevel {
  id: string; // "E1M1"
  name: string;
  mapFile: string; // path under public/
  par: number; // par time (seconds)
  secretExitTo?: string; // level id reached via the secret exit
}

export interface Episode {
  id: string;
  name: string;
  levels: EpisodeLevel[]; // ordered main progression
  secretLevels: EpisodeLevel[];
}

export const EPISODE1: Episode = {
  id: 'E1',
  name: 'Knee-Deep in the Dead',
  levels: [
    { id: 'E1M1', name: 'Hangar', mapFile: 'assets/maps/e1m1.json', par: 30 },
    { id: 'E1M2', name: 'Nuclear Plant', mapFile: 'assets/maps/e1m2.json', par: 75 },
    { id: 'E1M3', name: 'Toxin Refinery', mapFile: 'assets/maps/e1m3.json', par: 120, secretExitTo: 'E1M9' },
    { id: 'E1M4', name: 'Command Control', mapFile: 'assets/maps/e1m4.json', par: 90 },
    { id: 'E1M5', name: 'Phobos Anomaly', mapFile: 'assets/maps/e1m5.json', par: 165 },
  ],
  secretLevels: [{ id: 'E1M9', name: 'Military Base', mapFile: 'assets/maps/e1m9.json', par: 180 }],
};

/** The next level id after `currentId`, or null at the episode end. */
export function nextLevelId(episode: Episode, currentId: string): string | null {
  const i = episode.levels.findIndex((l) => l.id === currentId);
  if (i === -1 || i + 1 >= episode.levels.length) return null;
  return episode.levels[i + 1]!.id;
}
