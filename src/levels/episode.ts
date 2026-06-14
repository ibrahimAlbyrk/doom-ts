// Episode definition + progression. One full episode of authored levels (3–5 main
// maps, doom-design.md §7). Per-level metadata (name, par, sky, music) is read off
// the compiled MapData so the episode list never drifts from the level data. Exit
// wiring is linear: each normal exit advances to the next level; the final level's
// exit ends the episode (victory).
import type { MapData } from '../core';
import { EPISODE1_MAPS, MAPS_BY_ID } from './maps';

export interface EpisodeLevel {
  id: string; // "E1M1"
  name: string; // display name ("Landing Bay")
  par: number; // par time (seconds)
  sky: string; // sky texture key
  music?: string; // music id (optional — no music lumps in the current asset manifest)
}

export interface Episode {
  id: string;
  name: string;
  levels: EpisodeLevel[]; // ordered main progression
}

function toEpisodeLevel(m: MapData): EpisodeLevel {
  return { id: m.id, name: m.name, par: m.par, sky: m.sky, music: m.music };
}

export const EPISODE1: Episode = {
  id: 'E1',
  name: 'Knee-Deep in the Dead',
  levels: EPISODE1_MAPS.map(toEpisodeLevel),
};

/** The next level id after `currentId`, or null at the episode end (→ victory). */
export function nextLevelId(episode: Episode, currentId: string): string | null {
  const i = episode.levels.findIndex((l) => l.id === currentId);
  if (i === -1 || i + 1 >= episode.levels.length) return null;
  return episode.levels[i + 1]!.id;
}

/** True when `currentId` is the episode's final level (its exit triggers victory). */
export function isFinalLevel(episode: Episode, currentId: string): boolean {
  return episode.levels.length > 0 && episode.levels[episode.levels.length - 1]!.id === currentId;
}

/** Compiled MapData for a level id, or undefined if the id isn't in this episode. */
export function mapDataFor(id: string): MapData | undefined {
  return MAPS_BY_ID.get(id);
}
