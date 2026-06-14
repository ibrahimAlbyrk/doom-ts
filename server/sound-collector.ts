// ServerSoundCollector — the authority's side of networked SFX (multiplayer-plan §4). It is
// the server mirror of the client's GameSoundEvents: instead of PLAYING sounds it RECORDS
// each as a positional NetSound (resolved DOOM lump + world origin + voice priority), which
// MatchRoom attaches to the snapshot. Every client then plays them relative to its own marine,
// so co-op gunfire, monsters, pickups, doors/lifts and impacts are heard — and spatialised —
// on all clients. Sources:
//   • core 'sfx'         → monster sight/active/attack, door open/close, switch/lift (positional already)
//   • core 'weapon:fired'→ the firing marine's gunshot, positioned via the sim's active player
//   • combat entity:*    → monster pain/death + player pain/death (located by entity id)
//   • combat projectile:impact → rocket/barrel explosion or fireball poof
//   • pickup diff        → an item leaving the world = collected → a pickup blip at its spot
import type { EventBus, GameEventMap, IWorld, MonsterType } from '../src/core';
import type { CombatBus } from '../src/combat';
import { WEAPONS, ENEMIES, ITEMS_BY_ID } from '../src/data';
import type { NetSound } from '../src/session/snapshot';

const PLAYER_PAIN = 'DSPLPAIN';
const PLAYER_DEATH = 'DSPLDETH';
const ITEM_PICKUP = 'DSITEMUP';
const POWERUP_PICKUP = 'DSGETPOW';
const EXPLOSION = 'DSBAREXP'; // splash impact (rocket / barrel)
const FIREBALL_IMPACT = 'DSFIRXPL'; // non-splash projectile poof

// Voice-pool priority per source (mirrors GameSoundEvents): the player's own actions on top.
const PRIORITY = {
  weapon: 100,
  playerDeath: 95,
  playerPain: 90,
  monsterDeath: 75,
  impact: 65,
  monsterPain: 55,
  pickup: 45,
  world: 40, // doors/lifts/teleport + monster sight/active
} as const;

/** A position resolver for the firing marine — the sim exposes its active player while a
 *  weapon:fired event is being dispatched, so a gunshot is placed at the shooter. */
export type FiringPos = () => { x: number; y: number } | null;

export class ServerSoundCollector {
  private buf: NetSound[] = [];
  private variantSeq = 0; // rotates multi-sample monster death lumps deterministically
  private readonly gameUnsubs: Array<() => void> = [];
  private combatUnsubs: Array<() => void> = [];
  /** Last-seen pickups (id → spot) so a disappearance = a collection → a positioned blip. */
  private prevPickups = new Map<number, { x: number; y: number; thingId: number }>();

  constructor(
    private readonly world: IWorld,
    private readonly firingPos: FiringPos,
  ) {}

  /** Subscribe to the match-long core bus (weapon fire + the generic positioned 'sfx'). */
  bindGame(bus: EventBus<GameEventMap>): void {
    this.gameUnsubs.push(
      bus.on('weapon:fired', ({ weapon }) => {
        const p = this.firingPos();
        if (p) this.add(WEAPONS[weapon].fireSound, p.x, p.y, PRIORITY.weapon);
      }),
      bus.on('sfx', ({ sound, x, y }) => this.add(sound, x, y, PRIORITY.world)),
    );
  }

  /** (Re)bind to the current level's combat bus — call again after a level advance, since
   *  the bus is rebuilt per level. Drops the previous level's combat subscriptions first. */
  bindCombat(bus: CombatBus): void {
    this.unbindCombat();
    this.combatUnsubs = [
      bus.on('entity:damaged', ({ targetId, targetFaction }) => {
        if (targetFaction !== 'player') return; // monster pain comes from entity:pain
        const pos = this.locate(targetId);
        if (pos) this.add(PLAYER_PAIN, pos.x, pos.y, PRIORITY.playerPain);
      }),
      bus.on('entity:pain', ({ id, monsterType }) => {
        const sound = this.monsterSound(monsterType, 'pain');
        const pos = this.locate(id);
        if (sound && pos) this.add(sound, pos.x, pos.y, PRIORITY.monsterPain);
      }),
      bus.on('entity:death', ({ id, faction, monsterType }) => {
        const pos = this.locate(id);
        if (!pos) return;
        if (faction === 'player') {
          this.add(PLAYER_DEATH, pos.x, pos.y, PRIORITY.playerDeath);
        } else {
          const sound = this.monsterSound(monsterType, 'death');
          if (sound) this.add(sound, pos.x, pos.y, PRIORITY.monsterDeath);
        }
      }),
      bus.on('projectile:impact', ({ x, y, splashRadius }) => {
        this.add(splashRadius > 0 ? EXPLOSION : FIREBALL_IMPACT, x, y, PRIORITY.impact);
      }),
    ];
  }

  /** Diff the pickup set: an item present last step and gone now was collected — emit a blip
   *  at its last position. Pickups don't respawn in co-op, so a disappearance is a collection.
   *  Call once per sim step. */
  notePickups(): void {
    const present = new Set<number>();
    for (const pk of this.world.pickups) present.add(pk.id);
    for (const [id, info] of this.prevPickups) {
      if (!present.has(id)) this.add(this.pickupSound(info.thingId), info.x, info.y, PRIORITY.pickup);
    }
    this.snapshotPickups();
  }

  /** Re-baseline the pickup set without emitting (after a level loads, so the previous
   *  level's pickups don't read as a flood of collections). */
  resetPickups(): void {
    this.snapshotPickups();
  }

  /** Hand the accumulated sounds to the snapshot and start a fresh batch. */
  flush(): NetSound[] {
    if (this.buf.length === 0) return [];
    const out = this.buf;
    this.buf = [];
    return out;
  }

  /** Drop every subscription (call at match teardown). */
  dispose(): void {
    this.unbindCombat();
    for (const off of this.gameUnsubs) off();
    this.gameUnsubs.length = 0;
  }

  // ── internals ────────────────────────────────────────────────────────────────

  private unbindCombat(): void {
    for (const off of this.combatUnsubs) off();
    this.combatUnsubs = [];
  }

  private snapshotPickups(): void {
    this.prevPickups.clear();
    for (const pk of this.world.pickups) this.prevPickups.set(pk.id, { x: pk.x, y: pk.y, thingId: pk.thingId });
  }

  private add(sound: string, x: number, y: number, priority: number): void {
    // Cap a single broadcast's batch so a burst can't bloat the snapshot.
    if (this.buf.length < 64) this.buf.push({ sound, x, y, priority });
  }

  private pickupSound(thingId: number): string {
    return ITEMS_BY_ID.get(thingId)?.kind === 'powerup' ? POWERUP_PICKUP : ITEM_PICKUP;
  }

  private monsterSound(type: MonsterType | null, kind: 'pain' | 'death'): string | undefined {
    if (!type) return undefined;
    const sounds = ENEMIES[type].sounds;
    if (kind === 'pain') return sounds.pain;
    const deaths = sounds.death;
    if (!deaths || deaths.length === 0) return undefined;
    return deaths[this.variantSeq++ % deaths.length];
  }

  private locate(id: number): { x: number; y: number } | undefined {
    return (
      this.world.players.get(id) ??
      this.world.monsters.find((e) => e.id === id) ??
      this.world.projectiles.find((e) => e.id === id) ??
      this.world.pickups.find((e) => e.id === id)
    );
  }
}
