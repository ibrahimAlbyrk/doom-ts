// Player weapon system (doom-design.md §2). Owns the ready/raise/lower/fire state
// machine, ammo spend, weapon switching + auto-switch, and per-weapon dispatch into
// src/combat. The view-model (sprite id + bob) is produced by getView() for the
// frozen RenderScene; key bindings live in input/integration, which drive the
// action API below (startFire/stopFire/fire/switchTo/selectSlot/next/prev/give*).
import type { IWorld, Player, WeaponId, AmmoType, WeaponDef, DamageRoll, Rng } from '../core';
import { HITSCAN_RANGE } from '../core';
import { WEAPONS, WEAPON_PICKUP_AMMO } from '../data';
import { CombatBus, hitscan, fireProjectile as spawnCombatProjectile } from '../combat';
import type { ProjectileSpec } from '../entities';
import {
  WEAPON_CYCLE,
  ownsWeapon,
  hasAmmoFor,
  weaponsInSlot,
  bestDryWeapon,
} from './weapon-order';
import { consumeAmmo, addAmmo, giveBackpack } from './ammo';
import {
  type WeaponView,
  RAISE_TICS,
  LOWER_TICS,
  LOWER_TRAVEL,
  FLASH_TICS,
  FIRE_EXTRALIGHT,
  fireFrame,
  weaponBob,
  bobAmount,
} from './view-model';

type ReadyState = 'raising' | 'ready' | 'lowering';

/** Number of tracer rays the BFG ball sprays from the player on detonation (§2). */
export const BFG_TRACER_COUNT = 40;
/** Per-tracer damage: d8 × 15 = 15–120 (task contract; reuses combat hitscan). */
export const BFG_TRACER_DAMAGE: DamageRoll = { n: 8, m: 15 };
/** BAM spread for the tracer cone — shift 21 ≈ ±45° (a ~90° forward arc). */
export const BFG_TRACER_SPREAD_SHIFT = 21;

// Auto-switch on a fresh ammo pickup only fires while holding one of these weak
// weapons (matches DOOM's P_GiveAmmo behaviour), preferring the best owned upgrade.
const AMMO_PICKUP_UPGRADES: Record<AmmoType, WeaponId[]> = {
  bullets: ['chaingun', 'pistol'],
  shells: ['superShotgun', 'shotgun'],
  rockets: ['rocketLauncher'],
  cells: ['plasmaRifle', 'bfg9000'],
};
const WEAK_WEAPONS: ReadonlySet<WeaponId> = new Set(['fist', 'pistol', 'chainsaw']);

export class WeaponSystem {
  private state: ReadyState = 'ready';
  /** 0 = at ready (top), 1 = fully stowed (bottom). Drives raise/lower travel. */
  private lift = 0;
  private firePressed = false;
  private flashTics = 0;
  private fireAnimTics = 0;
  /** Charge countdown before the BFG ball spawns; 0 = not charging. */
  private bfgChargeTics = 0;
  /** Id of the in-flight BFG ball whose impact triggers the tracer spray. */
  private bfgBallId: number | null = null;
  private readonly unsub: (() => void) | null;

  constructor(
    private readonly world: IWorld,
    private readonly rng: Rng,
    private readonly events?: CombatBus,
  ) {
    // The BFG tracers fire the moment its ball detonates (a combat projectile:impact).
    this.unsub = events
      ? events.on('projectile:impact', (p) => {
          if (this.bfgBallId !== null && p.projectileId === this.bfgBallId) {
            this.bfgBallId = null;
            this.fireBfgTracers();
          }
        })
      : null;
  }

  // ── action API (input/integration drive these) ──────────────────────────────

  /** Trigger pressed: hold-to-fire until stopFire(). */
  startFire(): void {
    this.firePressed = true;
  }

  /** Trigger released. */
  stopFire(): void {
    this.firePressed = false;
  }

  /** Attempt a single shot now. Returns true if a shot went off. */
  fire(): boolean {
    return this.tryFire();
  }

  /** Begin switching to `weapon` (lower current, raise new). No-op if unowned. */
  switchTo(weapon: WeaponId): boolean {
    if (!ownsWeapon(this.player.inventory, weapon)) return false;
    if (weapon === this.player.currentWeapon && this.player.pendingWeapon === null) return false;
    this.player.pendingWeapon = weapon;
    return true;
  }

  /** Select by slot key (1..7); toggles between the two weapons that share a slot. */
  selectSlot(slot: number): boolean {
    const owned = weaponsInSlot(slot).filter((w) => ownsWeapon(this.player.inventory, w));
    if (owned.length === 0) return false;
    const curIdx = owned.indexOf(this.player.currentWeapon);
    const target = curIdx >= 0 && owned.length > 1 ? owned[(curIdx + 1) % owned.length]! : owned[0]!;
    return this.switchTo(target);
  }

  nextWeapon(): boolean {
    return this.cycle(1);
  }

  prevWeapon(): boolean {
    return this.cycle(-1);
  }

  // ── pickup hooks (integration calls these from the pickup system) ────────────

  /** Grant a weapon (and its first-pickup ammo, §4). Auto-switches to it when newly
   *  acquired. Returns true if this was the first time it was picked up. */
  giveWeapon(weapon: WeaponId, autoSwitch = true): boolean {
    const inv = this.player.inventory;
    const isNew = !ownsWeapon(inv, weapon);
    inv.weapons[weapon] = true;
    if (isNew) {
      const def = WEAPONS[weapon];
      const grant = WEAPON_PICKUP_AMMO[weapon];
      if (def.ammo !== null && grant) addAmmo(inv, def.ammo, grant);
      this.events?.emitGame('weapon:pickedUp', { weapon });
      if (autoSwitch) this.switchTo(weapon);
    }
    return isNew;
  }

  /** Grant ammo (clamped to max). Auto-switches off a weak weapon when picking up an
   *  ammo type you had none of (DOOM P_GiveAmmo). Returns the amount actually added. */
  giveAmmo(type: AmmoType, amount: number): number {
    const inv = this.player.inventory;
    const had = inv.ammo[type];
    const added = addAmmo(inv, type, amount);
    if (had === 0 && added > 0) this.autoSwitchOnAmmoPickup(type);
    return added;
  }

  /** Grant a backpack: doubles maxes once and tops up one small pickup of each ammo. */
  giveBackpack(): boolean {
    return giveBackpack(this.player.inventory);
  }

  // ── per-tick + view-model ────────────────────────────────────────────────────

  /** Advance cooldown + raise/lower/fire animation by `tics` and refire if held. */
  update(tics = 1): void {
    const p = this.player;
    p.weaponCooldown = Math.max(0, p.weaponCooldown - tics);
    this.flashTics = Math.max(0, this.flashTics - tics);
    this.fireAnimTics = Math.max(0, this.fireAnimTics - tics);

    if (this.bfgChargeTics > 0) {
      this.bfgChargeTics = Math.max(0, this.bfgChargeTics - tics);
      if (this.bfgChargeTics === 0) this.spawnBfgBall();
    }

    switch (this.state) {
      case 'lowering':
        this.lift = Math.min(1, this.lift + tics / LOWER_TICS);
        if (this.lift >= 1) {
          p.currentWeapon = p.pendingWeapon ?? p.currentWeapon;
          p.pendingWeapon = null;
          this.events?.emitGame('weapon:switched', { weapon: p.currentWeapon });
          this.state = 'raising';
        }
        break;
      case 'raising':
        this.lift = Math.max(0, this.lift - tics / RAISE_TICS);
        if (this.lift <= 0) {
          this.lift = 0;
          this.state = 'ready';
        }
        break;
      case 'ready':
        if (this.fireAnimTics === 0 && this.bfgChargeTics === 0) {
          if (p.pendingWeapon !== null && p.pendingWeapon !== p.currentWeapon) {
            this.state = 'lowering';
          } else if (this.firePressed) {
            this.tryFire();
          }
        }
        break;
    }
  }

  /** Screen-space view-model for this frame (RenderScene weapon + bob inputs). */
  getView(): WeaponView {
    const p = this.player;
    const def = WEAPONS[p.currentWeapon];
    const firing = this.fireAnimTics > 0;
    const flashing = this.flashTics > 0 && def.flashSprite !== '';
    // DOOM A_WeaponReady: gun rides the player's bob amplitude on the shared walk phase
    // (p.bob, advanced from the level clock by the session). 0 amplitude at rest → no bob.
    const bob = weaponBob(p.bob, bobAmount(p.velX, p.velY));
    return {
      sprite: def.viewSprite,
      frame: firing ? fireFrame(def.fireTics, this.fireAnimTics) : 'A',
      flashSprite: flashing ? def.flashSprite : '',
      flashFrame: flashing ? 'A' : '',
      bobX: bob.x,
      bobY: this.lift * LOWER_TRAVEL + bob.y,
      extralight: flashing ? FIRE_EXTRALIGHT : 0,
    };
  }

  /** Spray the BFG tracer rays from the player toward facing. Returns the ray count. */
  fireBfgTracers(): number {
    const p = this.player;
    for (let i = 0; i < BFG_TRACER_COUNT; i++) {
      hitscan(
        this.world,
        p.x,
        p.y,
        p.angle,
        HITSCAN_RANGE,
        BFG_TRACER_DAMAGE,
        BFG_TRACER_SPREAD_SHIFT,
        1,
        false,
        p.id,
        'player',
        this.rng,
        this.events,
      );
    }
    return BFG_TRACER_COUNT;
  }

  /** Detach the projectile:impact subscription (call at level teardown). */
  dispose(): void {
    this.unsub?.();
  }

  // ── internals ────────────────────────────────────────────────────────────────

  private get player(): Player {
    return this.world.player;
  }

  private cycle(dir: 1 | -1): boolean {
    const inv = this.player.inventory;
    const owned = WEAPON_CYCLE.filter((w) => ownsWeapon(inv, w));
    if (owned.length <= 1) return false;
    const base = this.player.pendingWeapon ?? this.player.currentWeapon;
    const idx = owned.indexOf(base);
    const next = owned[(idx + dir + owned.length) % owned.length]!;
    return this.switchTo(next);
  }

  /** Ready to act this tic (ignores ammo — that's handled in tryFire). */
  private canAct(): boolean {
    const p = this.player;
    return (
      this.state === 'ready' &&
      this.lift === 0 &&
      this.fireAnimTics === 0 &&
      this.bfgChargeTics === 0 &&
      p.weaponCooldown <= 0 &&
      !(p.pendingWeapon !== null && p.pendingWeapon !== p.currentWeapon)
    );
  }

  private tryFire(): boolean {
    if (!this.canAct()) return false;
    const weapon = this.player.currentWeapon;
    if (!hasAmmoFor(this.player.inventory, weapon)) {
      this.autoSwitchOnDry();
      return false;
    }
    this.doFire(WEAPONS[weapon]);
    return true;
  }

  private doFire(def: WeaponDef): void {
    const inv = this.player.inventory;
    consumeAmmo(inv, def.id);
    this.player.weaponCooldown = def.fireTics;
    this.fireAnimTics = def.fireTics;
    if (def.flashSprite !== '') this.flashTics = FLASH_TICS;

    this.dispatch(def);
    this.events?.emitGame('weapon:fired', { weapon: def.id });

    // DOOM checks ammo after firing and switches off a now-empty weapon (P_CheckAmmo).
    if (def.attack !== 'projectileSpray' && !hasAmmoFor(inv, def.id)) this.autoSwitchOnDry();
  }

  private dispatch(def: WeaponDef): void {
    switch (def.attack) {
      case 'hitscanMelee':
        this.fireMelee(def);
        break;
      case 'hitscan':
        this.fireHitscan(def);
        break;
      case 'projectile':
        this.fireProjectile(def);
        break;
      case 'projectileSpray':
        // BFG: 30-tic charge (ammo already spent), then the ball spawns in update().
        this.bfgChargeTics = def.fireTics;
        break;
    }
  }

  private fireMelee(def: WeaponDef): void {
    const p = this.player;
    let roll = def.damage;
    if (def.id === 'fist' && def.berserkMultiplier !== undefined && p.powerups.berserk != null) {
      roll = { n: def.damage.n, m: def.damage.m * def.berserkMultiplier };
    }
    hitscan(this.world, p.x, p.y, p.angle, def.rangeMu, roll, 0, 1, true, p.id, 'player', this.rng, this.events);
  }

  private fireHitscan(def: WeaponDef): void {
    const p = this.player;
    hitscan(
      this.world,
      p.x,
      p.y,
      p.angle,
      def.rangeMu,
      def.damage,
      def.spreadShift,
      def.pellets,
      def.firstShotAccurate,
      p.id,
      'player',
      this.rng,
      this.events,
    );
  }

  private fireProjectile(def: WeaponDef): void {
    const p = this.player;
    const spec: ProjectileSpec = {
      damage: def.damage,
      speed: def.projectileSpeed,
      sprite: def.projectileSprite,
      splashRadius: def.splashRadius,
    };
    spawnCombatProjectile(this.world, p, 'player', p.angle, spec);
  }

  private spawnBfgBall(): void {
    const def = WEAPONS.bfg9000;
    const spec: ProjectileSpec = {
      damage: def.damage,
      speed: def.projectileSpeed,
      sprite: def.projectileSprite,
      splashRadius: 0,
    };
    const ball = spawnCombatProjectile(this.world, this.player, 'player', this.player.angle, spec);
    this.bfgBallId = ball.id;
  }

  private autoSwitchOnDry(): void {
    const next = bestDryWeapon(this.player.inventory);
    if (next !== this.player.currentWeapon) this.switchTo(next);
  }

  private autoSwitchOnAmmoPickup(type: AmmoType): void {
    if (!WEAK_WEAPONS.has(this.player.currentWeapon)) return;
    const inv = this.player.inventory;
    for (const w of AMMO_PICKUP_UPGRADES[type]) {
      if (ownsWeapon(inv, w) && w !== this.player.currentWeapon) {
        this.switchTo(w);
        return;
      }
    }
  }
}
