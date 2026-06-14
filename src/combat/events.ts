// Combat event surface. The frozen core GameEventMap (src/core/events.ts) only
// carries player:damaged / player:died / player:healthChanged / monster:died /
// monster:spawned — it has NO event for "a monster took damage" (infighting),
// "an entity flinched" (pain), or "a projectile impacted". Those combat events
// can't be added without editing the frozen contract, so combat broadcasts them
// on its own typed bus (reusing the core EventBus class). CombatBus also forwards
// the frozen subset onto the core game bus so existing subscribers keep working.
//
// FROZEN-CORE GAP (reported to integration): fold these four event types into
// GameEventMap and this combat bus collapses into ctx.events.
import { EventBus } from '../core';
import type { GameEventMap, Faction, MonsterType } from '../core';

export type CombatEventMap = {
  /** Any entity lost health. `amount` is health actually lost (post-armor). The
   *  source fields let AI implement infighting (re-target on cross-faction hits). */
  'entity:damaged': {
    targetId: number;
    targetFaction: Faction;
    monsterType: MonsterType | null;
    amount: number;
    sourceId: number;
    sourceFaction: Faction;
    remainingHealth: number;
  };
  /** A monster passed its pain-chance roll and flinched (state set to 'pain'). */
  'entity:pain': {
    id: number;
    faction: Faction;
    monsterType: MonsterType | null;
    sourceId: number;
  };
  /** An entity's health reached 0. For monsters this fires alongside the frozen
   *  monster:died; `gibbed` marks overkill (health < -spawnHealth). */
  'entity:death': {
    id: number;
    faction: Faction;
    monsterType: MonsterType | null;
    sourceId: number;
    sourceFaction: Faction;
    gibbed: boolean;
  };
  /** A projectile hit a wall or entity and was removed. */
  'projectile:impact': {
    projectileId: number;
    x: number;
    y: number;
    targetId: number | null; // null = hit a wall
    splashRadius: number;
  };
};

export type CombatEventBus = EventBus<CombatEventMap>;

export type CombatEventHandler<K extends keyof CombatEventMap> = (payload: CombatEventMap[K]) => void;

/** Bundles the combat-only event bus with the (optional) frozen core game bus.
 *  Construct once at level start: `new CombatBus(ctx.events)`. Combat resolution
 *  takes it as its `events` argument; AI/weapons/UI subscribe via `.on(...)`. */
export class CombatBus {
  readonly combat: CombatEventBus = new EventBus<CombatEventMap>();

  constructor(private readonly game: EventBus<GameEventMap> | null = null) {}

  on<K extends keyof CombatEventMap>(type: K, handler: CombatEventHandler<K>): () => void {
    return this.combat.on(type, handler);
  }

  emit<K extends keyof CombatEventMap>(type: K, payload: CombatEventMap[K]): void {
    this.combat.emit(type, payload);
  }

  /** Forward a frozen game event onto the core bus (no-op when none is wired). */
  emitGame<K extends keyof GameEventMap>(type: K, payload: GameEventMap[K]): void {
    this.game?.emit(type, payload);
  }
}
