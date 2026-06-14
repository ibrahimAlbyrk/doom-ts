// Authored episode maps — compiled MapData (frozen schema). The episode + loader
// import from here; integration can register these into the asset store via
// IAssetStore.addMap(id, data) or hand them straight to loadLevel(world, data, skill).
import type { MapData } from '../../core';
import { E1M1 } from './e1m1';
import { E1M2 } from './e1m2';
import { E1M3 } from './e1m3';
import { E1M4 } from './e1m4';

/** Ordered main progression for Episode 1. */
export const EPISODE1_MAPS: MapData[] = [E1M1, E1M2, E1M3, E1M4];

/** Lookup compiled MapData by id ("E1M1"). */
export const MAPS_BY_ID: ReadonlyMap<string, MapData> = new Map(EPISODE1_MAPS.map((m) => [m.id, m]));

export { E1M1, E1M2, E1M3, E1M4 };
