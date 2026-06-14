// LocalSession — OFFLINE single-player. Owns an in-process authoritative GameSession
// and drives it directly: every `tic()` runs the full sim locally, so the entire
// single-player game (move/shoot/AI/doors/lifts/items/intermission) works with NO
// server. This is the default session the client boots with. See multiplayer-plan §0.1.
import type { SimContext, SkillId, ILevelRuntime, MapData, IWorld } from '../core';
import type { CombatBus } from '../combat';
import type { WeaponView } from '../weapons';
import { GameSession, type TicCommand, type TicResult } from '../game/session';
import type { Session, SimStats } from './session';

export class LocalSession implements Session {
  /** The in-process authoritative simulation — the SAME class the server runs headless. */
  readonly sim: GameSession;

  constructor(ctx: SimContext) {
    // presentation: true → the sim emits cosmetic SFX events so local audio plays
    // exactly as it does today. (The headless server runs the same sim with false.)
    this.sim = new GameSession(ctx, { presentation: true });
  }

  get world(): IWorld {
    return this.sim.world;
  }
  get currentLevel(): ILevelRuntime | null {
    return this.sim.currentLevel;
  }
  get currentLevelData(): MapData | null {
    return this.sim.currentLevelData;
  }
  get levelActive(): boolean {
    return this.sim.levelActive;
  }
  get combat(): CombatBus | null {
    return this.sim.combat;
  }
  get processedSeq(): number {
    return this.sim.processedSeq;
  }

  getWeaponView(): WeaponView | null {
    return this.sim.getWeaponView();
  }
  stats(): SimStats {
    return this.sim.stats();
  }

  startNewGame(skill: SkillId): void {
    this.sim.startNewGame(skill);
  }
  startLevel(mapId: string): void {
    this.sim.startLevel(mapId);
  }
  tic(cmd: TicCommand): TicResult {
    return this.sim.tic(cmd);
  }
  teardownLevel(): void {
    this.sim.teardownLevel();
  }
  advanceAfterIntermission(): 'next' | 'victory' {
    return this.sim.advanceAfterIntermission();
  }
  peekNextLevelId(): string | null {
    return this.sim.peekNextLevelId();
  }
}
