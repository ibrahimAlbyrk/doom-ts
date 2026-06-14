// Event → sound mapping. Subscribes to the frozen core EventBus<GameEventMap> and the
// combat CombatBus and plays the right DS* lump for each gameplay event. Monster sounds
// resolve through EnemyDef.sounds (src/data); weapon fire through WeaponDef.fireSound.
//
// Positional events with no coordinates in their payload (monster pain/death carry only
// an entity id) use an optional EntityLocator so integration can supply live positions
// without coupling src/audio to the entity store; without one those play flat (centred).
//
// Death is taken from combat's entity:death (monster only) — NOT the frozen monster:died
// it fires alongside — so a single death never double-plays. Player death/pain come from
// the frozen player:* events.
import type { EventBus, GameEventMap, MonsterType, WeaponId } from '../core';
import { WEAPONS, ENEMIES } from '../data';
import type { CombatBus } from '../combat';
import type { AudioManager } from './audio-manager';

/** Resolve an entity id to a world position, for positioning id-only events. */
export type EntityLocator = (id: number) => { x: number; y: number } | undefined;

// Higher survives voice-pool contention. The player's own actions sit on top.
const PRIORITY = {
  weapon: 100,
  playerDeath: 95,
  playerPain: 90,
  monsterDeath: 75,
  impact: 65,
  monsterPain: 55,
  pickup: 45,
  world: 40, // doors/lifts/teleport + monster sight/active ambience
} as const;

const PLAYER_PAIN = 'DSPLPAIN';
const PLAYER_DEATH = 'DSPLDETH';
const ITEM_PICKUP = 'DSITEMUP';
const POWERUP_PICKUP = 'DSGETPOW';
const EXPLOSION = 'DSBAREXP'; // splash impact (rocket / barrel)
const FIREBALL_IMPACT = 'DSFIRXPL'; // non-splash projectile poof

export class GameSoundEvents {
  private readonly unsubs: Array<() => void> = [];
  private variantSeq = 0; // rotates multi-sample monster sounds deterministically

  constructor(
    private readonly audio: AudioManager,
    private readonly locate: EntityLocator | null = null,
  ) {}

  /** Subscribe to the core game bus (player / weapon / pickup / powerup events). */
  bindGame(bus: EventBus<GameEventMap>): void {
    this.unsubs.push(
      bus.on('weapon:fired', ({ weapon }) => this.audio.play(this.fireSound(weapon), { priority: PRIORITY.weapon })),
      bus.on('player:damaged', () => this.audio.play(PLAYER_PAIN, { priority: PRIORITY.playerPain })),
      bus.on('player:died', () => this.audio.play(PLAYER_DEATH, { priority: PRIORITY.playerDeath })),
      bus.on('pickup:collected', () => this.audio.play(ITEM_PICKUP, { priority: PRIORITY.pickup })),
      bus.on('powerup:started', () => this.audio.play(POWERUP_PICKUP, { priority: PRIORITY.pickup })),
      // Generic positioned sound (doors/lifts/teleport/monster sight+active). The
      // emitter already carries world coords, so no EntityLocator lookup is needed.
      bus.on('sfx', ({ sound, x, y }) => this.audio.play(sound, { x, y, priority: PRIORITY.world })),
    );
  }

  /** Subscribe to the combat bus (monster pain/death, projectile impacts). */
  bindCombat(bus: CombatBus): void {
    this.unsubs.push(
      bus.on('entity:pain', ({ id, monsterType }) => {
        const sound = this.monsterSound(monsterType, 'pain');
        if (sound) this.playAt(sound, id, PRIORITY.monsterPain);
      }),
      bus.on('entity:death', ({ id, faction, monsterType }) => {
        if (faction !== 'monster') return; // player death handled by player:died
        const sound = this.monsterSound(monsterType, 'death');
        if (sound) this.playAt(sound, id, PRIORITY.monsterDeath);
      }),
      bus.on('projectile:impact', ({ x, y, splashRadius }) => {
        const sound = splashRadius > 0 ? EXPLOSION : FIREBALL_IMPACT;
        this.audio.play(sound, { x, y, priority: PRIORITY.impact });
      }),
    );
  }

  /** Drop every subscription (call on level teardown). */
  unbindAll(): void {
    for (const off of this.unsubs) off();
    this.unsubs.length = 0;
  }

  private fireSound(weapon: WeaponId): string {
    return WEAPONS[weapon].fireSound;
  }

  /** Pick the pain lump or rotate through the death lumps for a monster type. */
  private monsterSound(type: MonsterType | null, kind: 'pain' | 'death'): string | undefined {
    if (!type) return undefined;
    const sounds = ENEMIES[type].sounds;
    if (kind === 'pain') return sounds.pain;
    const deaths = sounds.death;
    if (!deaths || deaths.length === 0) return undefined;
    return deaths[this.variantSeq++ % deaths.length];
  }

  private playAt(sound: string, id: number, priority: number): void {
    const pos = this.locate?.(id);
    if (pos) this.audio.play(sound, { x: pos.x, y: pos.y, priority });
    else this.audio.play(sound, { priority });
  }
}
