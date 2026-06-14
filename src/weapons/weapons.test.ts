// Runtime harness for src/weapons. Run directly (`npx tsx src/weapons/weapons.test.ts`);
// throws on the first failed assertion (non-zero exit). `tsc` typechecks it. Proves
// the acceptance cases: per-weapon ammo cost + fire/effect for all 9 weapons,
// fire-rate cooldown gating between shots, shotgun pellet count + spread dispersion,
// the BFG spraying 40 tracers on ball detonation, and switching + auto-switch.
import type { WeaponId, AmmoType } from '../core';
import { Rng, EventBus, type GameEventMap } from '../core';
import { WEAPONS } from '../data';
import { World, spawnMonster } from '../entities';
import { CombatBus, updateProjectiles } from '../combat';
import { WeaponSystem, BFG_TRACER_COUNT } from './index';

// ── assert plumbing ───────────────────────────────────────────────────────────
let passed = 0;
function ok(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
  passed++;
  console.log(`  ok  ${msg}`);
}
function must<T>(v: T | null | undefined, msg: string): T {
  if (v === null || v === undefined) throw new Error(`FAIL: ${msg}`);
  return v;
}

interface Rig {
  world: World;
  ws: WeaponSystem;
  combat: CombatBus;
  damaged: number; // count of entity:damaged events
}

/** Fresh world + weapon system with the player wielding `weapon`, ammo topped up. */
function rig(weapon: WeaponId, give: Partial<Record<AmmoType, number>> = {}): Rig {
  const game = new EventBus<GameEventMap>();
  const combat = new CombatBus(game);
  const world = new World();
  world.player.x = 100;
  world.player.y = 100;
  world.player.angle = 0;
  world.player.inventory.weapons[weapon] = true;
  world.player.currentWeapon = weapon;
  for (const [t, n] of Object.entries(give)) world.player.inventory.ammo[t as AmmoType] = n;
  const ws = new WeaponSystem(world, new Rng(0xbeef), combat);
  const r: Rig = { world, ws, combat, damaged: 0 };
  combat.on('entity:damaged', () => r.damaged++);
  return r;
}

const ammoOf = (r: Rig, t: AmmoType): number => r.world.player.inventory.ammo[t];

// ── 1. all 9 weapons fire with the correct ammo cost + an effect ───────────────
function testAllWeaponsFire(): void {
  console.log('all 9 weapons fire (ammo cost + effect)');
  for (const id of Object.keys(WEAPONS) as WeaponId[]) {
    const def = WEAPONS[id];
    const r = rig(id, { bullets: 50, shells: 50, rockets: 50, cells: 300 });
    // A baron 50 mu ahead: inside fist/chainsaw melee range, big enough that every
    // hitscan pellet connects, tanky enough (1000 hp) to survive any single shot.
    must(spawnMonster(r.world, 3003, 150, 100, 0), 'spawn baron target');
    const before = def.ammo ? ammoOf(r, def.ammo) : 0;
    const fired = r.ws.fire();
    ok(fired, `${id}: fire() succeeds`);

    if (def.ammo) {
      const spent = before - ammoOf(r, def.ammo);
      ok(spent === def.ammoPerShot, `${id}: spent ${def.ammoPerShot} ${def.ammo} (got ${spent})`);
    }

    if (def.attack === 'hitscan' || def.attack === 'hitscanMelee') {
      ok(r.damaged > 0, `${id}: hitscan/melee damaged the target`);
    } else if (def.attack === 'projectile') {
      ok(r.world.projectiles.length === 1, `${id}: spawned a projectile`);
    } else if (def.attack === 'projectileSpray') {
      ok(r.world.projectiles.length === 0, `${id}: charging — no ball before the charge elapses`);
      r.ws.update(def.fireTics);
      ok(r.world.projectiles.length === 1, `${id}: ball spawns after the ${def.fireTics}-tic charge`);
    }
  }
}

// ── 2. ammo consumption per shot (the multi-cost cases) ────────────────────────
function testAmmoPerShot(): void {
  console.log('ammo consumed per shot');
  const ssg = rig('superShotgun', { shells: 8 });
  ssg.ws.fire();
  ok(ammoOf(ssg, 'shells') === 6, `super shotgun spends 2 shells/shot (8 → ${ammoOf(ssg, 'shells')})`);

  const bfg = rig('bfg9000', { cells: 100 });
  bfg.ws.fire();
  ok(ammoOf(bfg, 'cells') === 60, `BFG spends 40 cells up front (100 → ${ammoOf(bfg, 'cells')})`);

  const fist = rig('fist');
  const ok2 = fist.ws.fire();
  ok(ok2 && ammoOf(fist, 'bullets') === 50, 'fist costs no ammo');
}

// ── 3. fire-rate gating between shots ──────────────────────────────────────────
function testFireRateGating(): void {
  console.log('fire-rate cooldown gating');
  const r = rig('pistol', { bullets: 50 });
  const period = WEAPONS.pistol.fireTics; // 14
  ok(r.ws.fire() && ammoOf(r, 'bullets') === 49, 'first shot fires (50 → 49)');
  ok(!r.ws.fire() && ammoOf(r, 'bullets') === 49, 'immediate re-fire is blocked by cooldown (still 49)');
  r.ws.update(period - 1);
  ok(!r.ws.fire() && ammoOf(r, 'bullets') === 49, `still blocked 1 tic before cooldown ends (still 49)`);
  r.ws.update(1);
  ok(r.ws.fire() && ammoOf(r, 'bullets') === 48, `fires again once ${period}-tic cooldown elapses (49 → 48)`);
}

// ── 4. shotgun pellet count + spread dispersion ────────────────────────────────
function testShotgunPellets(): void {
  console.log('shotgun pellet count + spread');
  // Point-blank against a baron (radius 24, 40 mu ahead): the spread cone is far
  // narrower than the target's angular size, so every pellet connects and the
  // entity:damaged count == pellet count.
  const close = rig('shotgun', { shells: 8 });
  must(spawnMonster(close.world, 3003, 140, 100, 0), 'spawn baron');
  close.ws.fire();
  ok(close.damaged === WEAPONS.shotgun.pellets, `7 pellets all connect point-blank (${close.damaged} hits)`);

  const ssgClose = rig('superShotgun', { shells: 8 });
  must(spawnMonster(ssgClose.world, 3003, 140, 100, 0), 'spawn baron');
  ssgClose.ws.fire();
  ok(ssgClose.damaged === WEAPONS.superShotgun.pellets, `super shotgun fires 20 pellets (${ssgClose.damaged} hits)`);

  // Pistol is a single pellet → exactly one hit on the same target.
  const pistol = rig('pistol', { bullets: 50 });
  must(spawnMonster(pistol.world, 3003, 140, 100, 0), 'spawn baron');
  pistol.ws.fire();
  ok(pistol.damaged === 1, `pistol fires a single pellet (${pistol.damaged} hit)`);

  // At range against a small target (zombieman, radius 20) the horizontal spread
  // disperses the 7 pellets so not all of them land → 0 < hits < 7.
  const far = rig('shotgun', { shells: 8 });
  must(spawnMonster(far.world, 3004, 700, 100, 0), 'spawn distant zombieman'); // 600 mu ahead
  far.ws.fire();
  ok(far.damaged > 0 && far.damaged < WEAPONS.shotgun.pellets, `spread disperses pellets at range (${far.damaged}/7 hit)`);
}

// ── 5. BFG fires 40 tracers on detonation ──────────────────────────────────────
function testBfgTracers(): void {
  console.log('BFG 40-tracer spray');
  // Direct: fireBfgTracers reports 40 rays and shreds a point-blank target.
  const direct = rig('bfg9000', { cells: 40 });
  must(spawnMonster(direct.world, 7, 200, 100, 0), 'spawn spider (radius 128)'); // wide → many rays land
  const count = direct.ws.fireBfgTracers();
  ok(count === BFG_TRACER_COUNT, `fireBfgTracers() fires ${BFG_TRACER_COUNT} rays (got ${count})`);
  ok(direct.damaged >= 20 && direct.damaged <= BFG_TRACER_COUNT, `tracers hit the target (${direct.damaged} ray hits)`);

  // Full pipeline: charge → ball spawns → ball detonates on a target → tracers fire.
  const r = rig('bfg9000', { cells: 40 });
  const baron = must(spawnMonster(r.world, 3003, 400, 100, 0), 'spawn baron (ball impact target)'); // 1000 hp
  let impacts = 0;
  r.combat.on('projectile:impact', () => impacts++);
  ok(r.ws.fire(), 'BFG fires (begins charge)');
  r.ws.update(WEAPONS.bfg9000.fireTics); // finish the 30-tic charge → ball spawns
  ok(r.world.projectiles.length === 1, 'BFG ball is in flight after the charge');
  const rng = new Rng(7);
  for (let i = 0; i < 200 && r.world.projectiles.length > 0; i++) updateProjectiles(r.world, rng, r.combat, 1);
  ok(impacts === 1, 'the BFG ball detonated once');
  // One damage event from the ball's direct hit + many more from the tracer spray.
  ok(r.damaged > 1, `detonation triggered the tracer spray (${r.damaged} damage events ≫ 1)`);
  ok(baron.health < 1000, `target took ball + tracer damage (hp ${baron.health})`);
}

// ── 6. switching: next / prev / slot ───────────────────────────────────────────
function testSwitching(): void {
  console.log('weapon switching (slot / next / prev)');
  const r = rig('pistol', { shells: 8, bullets: 50 });
  const inv = r.world.player.inventory;
  inv.weapons.shotgun = true;
  inv.weapons.chaingun = true;

  ok(r.ws.switchTo('shotgun') && r.world.player.pendingWeapon === 'shotgun', 'switchTo queues the pending weapon');
  // Drive the lower→raise animation to completion; current becomes the pending one.
  for (let i = 0; i < 64 && r.world.player.currentWeapon !== 'shotgun'; i++) r.ws.update(1);
  ok(r.world.player.currentWeapon === 'shotgun' && r.world.player.pendingWeapon === null, 'switch completes after lower+raise');

  ok(!r.ws.switchTo('plasmaRifle'), 'cannot switch to an unowned weapon');

  // Slot 1 toggles fist↔chainsaw only if both owned; here only fist → selects fist.
  ok(r.ws.selectSlot(1) && r.world.player.pendingWeapon === 'fist', 'selectSlot(1) selects the fist');
}

// ── 7. auto-switch on dry, on ammo pickup, and on weapon pickup ────────────────
function testAutoSwitch(): void {
  console.log('auto-switch (dry / ammo pickup / weapon pickup)');
  // Dry: last shell fired with the shotgun → fall back to the best owned weapon.
  const dry = rig('shotgun', { shells: 1, bullets: 50 });
  dry.ws.fire();
  ok(ammoOf(dry, 'shells') === 0 && dry.world.player.pendingWeapon === 'pistol', 'out-of-ammo shotgun auto-switches to pistol');

  // Ammo pickup while holding a weak weapon and owning a better user of that ammo.
  const pick = rig('pistol', { bullets: 50, shells: 0 });
  pick.world.player.inventory.weapons.shotgun = true;
  const added = pick.ws.giveAmmo('shells', 4);
  ok(added === 4 && pick.world.player.pendingWeapon === 'shotgun', 'picking up shells (had 0) auto-switches pistol → shotgun');

  // Backpack raises the max and tops up; clamp respects the (raised) cap.
  const bp = rig('pistol', { bullets: 200 });
  ok(bp.ws.giveBackpack() && bp.world.player.inventory.ammoMax.bullets === 400, 'backpack doubles bullet max to 400');
  ok(ammoOf(bp, 'bullets') === 210, 'backpack grants +10 bullets over the old normal max (200 → 210)');

  // Weapon pickup: newly acquired → bundled ammo + auto-switch.
  const wp = rig('pistol', { bullets: 50 });
  const isNew = wp.ws.giveWeapon('chaingun');
  ok(isNew && wp.world.player.pendingWeapon === 'chaingun', 'new weapon pickup auto-switches to it');
  ok(ammoOf(wp, 'bullets') === 70, 'chaingun pickup grants +20 bullets (50 → 70)');
  ok(!wp.ws.giveWeapon('chaingun'), 'picking up an owned weapon again returns false');
}

// ── 8. view-model feeds RenderScene (sprite id + bob) ──────────────────────────
function testViewModel(): void {
  console.log('view-model state for RenderScene');
  const r = rig('pistol', { bullets: 50 });
  const ready = r.ws.getView();
  ok(ready.sprite === WEAPONS.pistol.viewSprite && ready.frame === 'A', 'ready view uses the gun lump, frame A');
  ok(ready.bobX === 0 && ready.bobY === 0 && ready.extralight === 0, 'ready view has no bob/flash at bob phase 0');

  r.ws.fire();
  const firing = r.ws.getView();
  ok(firing.frame !== 'A', 'firing advances the gun frame');
  ok(firing.flashSprite === WEAPONS.pistol.flashSprite && firing.extralight > 0, 'firing shows the muzzle flash + extralight');

  // A queued switch lowers the gun → bobY climbs toward the stow travel.
  r.ws.update(WEAPONS.pistol.fireTics); // let the fire animation finish → back to ready
  r.world.player.inventory.weapons.shotgun = true;
  r.ws.switchTo('shotgun');
  for (let i = 0; i < 6; i++) r.ws.update(1); // ready → lowering, then advance the stow travel
  ok(r.ws.getView().bobY > 0, 'lowering the gun raises bobY (stow travel)');
}

// ── 9. every weapon shows a fire effect while firing (flash OR bright fire frame) ─
function testFireEffectAllWeapons(): void {
  console.log('every weapon shows a fire effect while firing');
  const FLASH_LUMPS: Partial<Record<WeaponId, string>> = {
    pistol: 'PISF',
    chaingun: 'CHGF',
    rocketLauncher: 'MISF',
    plasmaRifle: 'PLSF',
    bfg9000: 'BFGF',
  };
  for (const id of Object.keys(WEAPONS) as WeaponId[]) {
    const def = WEAPONS[id];
    const r = rig(id, { bullets: 50, shells: 50, rockets: 50, cells: 300 });
    ok(r.ws.fire(), `${id}: fire() succeeds`);
    const v = r.ws.getView();

    // While firing, the view must carry a full-bright overlay so the discharge is visible.
    ok(v.flashSprite !== '', `${id}: firing exposes a fire-effect overlay (flashSprite set)`);

    const expectedFlash = FLASH_LUMPS[id];
    if (expectedFlash !== undefined) {
      // Flash-bearing weapon: overlays its muzzle-flash sprite + bumps extralight.
      ok(def.flashSprite === expectedFlash, `${id}: data declares the ${expectedFlash} muzzle flash`);
      ok(v.flashSprite === expectedFlash, `${id}: view overlays the ${expectedFlash} muzzle flash`);
      ok(v.extralight > 0, `${id}: muzzle flash bumps extralight (${v.extralight})`);
    } else {
      // Flash-less weapon: re-draws its own fire frame bright (no separate flash lump).
      ok(def.flashSprite === '', `${id}: data declares no muzzle-flash lump`);
      ok(v.flashSprite === def.viewSprite, `${id}: view re-draws its own ${def.viewSprite} frame bright`);
      ok(v.flashFrame === v.frame && v.frame !== 'A', `${id}: bright overlay tracks the fire frame (${v.frame})`);
    }
  }
}

// ── run ────────────────────────────────────────────────────────────────────────
testAllWeaponsFire();
testAmmoPerShot();
testFireRateGating();
testShotgunPellets();
testBfgTracers();
testSwitching();
testAutoSwitch();
testViewModel();
testFireEffectAllWeapons();
console.log(`\nAll ${passed} weapon assertions passed.`);
