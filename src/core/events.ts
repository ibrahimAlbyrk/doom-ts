// FROZEN CONTRACT — a tiny typed pub/sub bus.
// Modules emit gameplay events; UI/audio/stats subscribe. Payloads are typed by
// GameEventMap so `emit`/`on` are checked at the call site.
import type { Faction, WeaponId, MonsterType, KeyColor, PowerupKind } from './enums';

// A `type` (not `interface`) so it satisfies the EventBus `Record<string, unknown>`
// constraint — interfaces lack the implicit index signature type aliases get.
export type GameEventMap = {
  'player:damaged': { amount: number; sourceFaction: Faction; remainingHealth: number };
  'player:died': Record<string, never>;
  'player:healthChanged': { health: number };
  'weapon:fired': { weapon: WeaponId };
  'weapon:switched': { weapon: WeaponId };
  'weapon:pickedUp': { weapon: WeaponId };
  'monster:spawned': { id: number; type: MonsterType };
  'monster:died': { id: number; type: MonsterType };
  'pickup:collected': { thingId: number };
  'key:collected': { color: KeyColor };
  'powerup:started': { kind: PowerupKind };
  'powerup:expired': { kind: PowerupKind };
  'door:used': { x: number; y: number; locked: boolean };
  'secret:found': { sector: number };
  'level:exit': { secret: boolean };
  /** Generic positioned sound request — world/AI emit it so audio stays decoupled. */
  'sfx': { sound: string; x: number; y: number };
};

export type EventHandler<T> = (payload: T) => void;

export class EventBus<M extends Record<string, unknown>> {
  private handlers = new Map<keyof M, Set<EventHandler<unknown>>>();

  on<K extends keyof M>(type: K, handler: EventHandler<M[K]>): () => void {
    let set = this.handlers.get(type);
    if (!set) {
      set = new Set();
      this.handlers.set(type, set);
    }
    set.add(handler as EventHandler<unknown>);
    return () => this.off(type, handler);
  }

  off<K extends keyof M>(type: K, handler: EventHandler<M[K]>): void {
    this.handlers.get(type)?.delete(handler as EventHandler<unknown>);
  }

  emit<K extends keyof M>(type: K, payload: M[K]): void {
    const set = this.handlers.get(type);
    if (!set) return;
    for (const handler of set) (handler as EventHandler<M[K]>)(payload);
  }

  clear(): void {
    this.handlers.clear();
  }
}
