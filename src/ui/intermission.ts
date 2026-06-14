// Intermission / tally screen — STUB. Kills%, Items%, Secret%, Time vs Par with the
// finished/entering map banner (doom-design.md §7).
import type { GameContext } from '../core';

export interface LevelTally {
  kills: number;
  totalKills: number;
  items: number;
  totalItems: number;
  secrets: number;
  totalSecrets: number;
  timeSeconds: number;
  parSeconds: number;
}

export function drawIntermission(_ctx: CanvasRenderingContext2D, _game: GameContext, _tally: LevelTally): void {
  throw new Error('NotImplemented: drawIntermission (doom-design §7)');
}
