// CoopMode — the co-op rule set (multiplayer-plan §4, D3=respawn). Friendly fire OFF, the
// level's monsters shared and server-simmed, deaths RESPAWN the marine after a short delay
// with a fresh loadout (the match never stalls on a dead player), and a level exit advances
// the WHOLE party to the next level (shared progression) until the episode ends → victory.
import { SECONDS_PER_TIC } from '../../src/core';
import { coopSpawnPoint } from '../../src/levels';
import type { GameMode, LevelOutcome, ModeContext, SpawnPose } from './game-mode';

/** Delay before a dead co-op marine pops back in (DOOM-ish; long enough to read the death,
 *  short enough that the match keeps flowing). Counted in doom-tics, the unit update() gets. */
const RESPAWN_DELAY_TICS = 1.5 / SECONDS_PER_TIC;

export class CoopMode implements GameMode {
  readonly id = 'coop' as const;
  readonly friendlyFire = false;
  readonly monstersEnabled = true;

  /** playerId → doom-tics until respawn. Present only while a marine is waiting to respawn. */
  private readonly respawnAt = new Map<number, number>();

  spawnPoint(ctx: ModeContext, playerIndex: number): SpawnPose {
    // Sim ids are assigned 0..N-1 in roster order, so a player's id IS its spawn-ring index.
    return coopSpawnPoint(ctx.level, playerIndex);
  }

  onLevelStart(ctx: ModeContext): void {
    this.respawnAt.clear();
    // A marine that reached the exit dead is revived so the new level starts everyone alive
    // (living marines keep their loadout across levels — loadLevel already repositioned them).
    for (const p of ctx.world.players.values()) {
      if (p.health <= 0) ctx.sim.respawnPlayer(p.id, this.spawnPoint(ctx, p.id));
    }
  }

  update(ctx: ModeContext, tics: number): boolean {
    // Schedule a respawn for any marine that died since last step.
    for (const p of ctx.world.players.values()) {
      if (p.health <= 0 && !this.respawnAt.has(p.id)) this.respawnAt.set(p.id, RESPAWN_DELAY_TICS);
    }
    // Count the timers down; respawn at a co-op spawn point when one elapses. A marine that
    // disconnected mid-wait is gone from world.players — drop its timer, never re-add it.
    for (const [id, left] of [...this.respawnAt]) {
      const remaining = left - tics;
      if (remaining <= 0) {
        this.respawnAt.delete(id);
        if (ctx.world.players.has(id)) ctx.sim.respawnPlayer(id, this.spawnPoint(ctx, id));
      } else {
        this.respawnAt.set(id, remaining);
      }
    }
    return false; // co-op never ends on a tick — it ends via onLevelExit (episode complete)
  }

  onLevelExit(ctx: ModeContext): LevelOutcome {
    return ctx.sim.peekNextLevelId() ? 'advance' : 'victory';
  }
}
