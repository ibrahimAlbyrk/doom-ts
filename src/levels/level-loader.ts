// Level loading — STUB. Pulls a MapData from the asset store (loaded from JSON by the
// asset loader), validates the grid-layer lengths, and builds a LevelRuntime with the
// player + things spawned. Schema in docs/ARCHITECTURE.md.
import type { IAssetStore, IWorld, MapData, SkillId } from '../core';
import { LevelRuntime } from '../world';

/** Build a runtime level and populate the world for `mapId` at the given skill. */
export function loadLevel(_assets: IAssetStore, _world: IWorld, _mapId: string, _skill: SkillId): LevelRuntime {
  throw new Error('NotImplemented: loadLevel');
}

/** Validate a parsed map: layer arrays are width*height, ids in range, has a start. */
export function validateMap(_data: MapData): string[] {
  throw new Error('NotImplemented: validateMap');
}
