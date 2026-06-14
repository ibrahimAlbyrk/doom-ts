// Runtime harness for src/items. Run directly (`npx tsx src/items/items.test.ts`);
// throws on the first failed assertion (non-zero exit). `tsc` typechecks it. Proves
// the acceptance cases: health/armor caps (bonus to 200, medikit not consumed at
// full), armor tier upgrade-only rule, ammo doubling with backpack, the skill ammo
// multiplier, a powerup timer counting down + expiring, weapon-pickup auto-switch,
// keys recorded, and overlap collect/remove.
import type { SkillId, KeyColor, PowerupKind, ItemDef } from '../core';
import { Rng, EventBus, type GameEventMap, ARMOR_GREEN_FACTOR, ARMOR_BLUE_FACTOR } from '../core';
import { ITEMS, POWERUPS } from '../data';
import { World, spawnPickup } from '../entities';
import { CombatBus } from '../combat';
import { WeaponSystem } from '../weapons';
import { applyItem, updateItems, startPowerup, updatePowerups, type PickupContext } from './index';

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

const ITEM_BY_ID = new Map(ITEMS.map((it) => [it.id, it]));
const item = (id: string): ItemDef => must(ITEM_BY_ID.get(id), `item def ${id}`);

interface Rig {
  world: World;
  ctx: PickupContext;
  collected: number[];
  keys: KeyColor[];
  started: PowerupKind[];
  expired: PowerupKind[];
}

function rig(skill: SkillId = 3): Rig {
  const game = new EventBus<GameEventMap>();
  const combat = new CombatBus(game);
  const world = new World();
  world.player.x = 100;
  world.player.y = 100;
  const ws = new WeaponSystem(world, new Rng(0x1234), combat);
  const r: Rig = { world, ctx: { world, weapons: ws, skill, events: game }, collected: [], keys: [], started: [], expired: [] };
  game.on('pickup:collected', (p) => r.collected.push(p.thingId));
  game.on('key:collected', (p) => r.keys.push(p.color));
  game.on('powerup:started', (p) => r.started.push(p.kind));
  game.on('powerup:expired', (p) => r.expired.push(p.kind));
  return r;
}

// ── 1. health caps + medikit-at-full rule ──────────────────────────────────────
function testHealth(): void {
  console.log('health caps');
  const r = rig();
  r.world.player.health = 199;
  ok(applyItem(r.ctx, item('healthBonus'), r.world.player) && r.world.player.health === 200, 'health bonus +1 climbs past 100 to the 200 cap');
  ok(applyItem(r.ctx, item('healthBonus'), r.world.player) && r.world.player.health === 200, 'health bonus is still consumed at the 200 cap');

  r.world.player.health = 100;
  ok(!applyItem(r.ctx, item('medikit'), r.world.player) && r.world.player.health === 100, 'medikit not consumed at full health (100)');
  r.world.player.health = 80;
  ok(applyItem(r.ctx, item('medikit'), r.world.player) && r.world.player.health === 100, 'medikit +25 clamps to the soft cap 100');
  r.world.player.health = 95;
  ok(applyItem(r.ctx, item('stimpack'), r.world.player) && r.world.player.health === 100, 'stimpack +10 clamps to 100');

  r.world.player.health = 100;
  ok(applyItem(r.ctx, item('soulsphere'), r.world.player) && r.world.player.health === 200, 'soulsphere +100 reaches the 200 cap');

  const m = rig();
  m.world.player.health = 50;
  ok(applyItem(m.ctx, item('megasphere'), m.world.player), 'megasphere is collected');
  ok(m.world.player.health === 200 && m.world.player.armor.points === 200 && m.world.player.armor.factor === ARMOR_BLUE_FACTOR, 'megasphere sets health 200 + blue armor 200');
}

// ── 2. armor caps + upgrade-only tier rule ──────────────────────────────────────
function testArmor(): void {
  console.log('armor caps + upgrade-only rule');
  const r = rig();
  ok(applyItem(r.ctx, item('greenArmor'), r.world.player) && r.world.player.armor.points === 100 && r.world.player.armor.factor === ARMOR_GREEN_FACTOR, 'green armor → 100 @ 1/3');
  ok(applyItem(r.ctx, item('armorBonus'), r.world.player) && r.world.player.armor.points === 101, 'armor bonus +1 over green');
  ok(applyItem(r.ctx, item('blueArmor'), r.world.player) && r.world.player.armor.points === 200 && r.world.player.armor.factor === ARMOR_BLUE_FACTOR, 'blue armor upgrades → 200 @ 1/2');
  ok(!applyItem(r.ctx, item('greenArmor'), r.world.player) && r.world.player.armor.points === 200 && r.world.player.armor.factor === ARMOR_BLUE_FACTOR, 'lesser green armor over blue is not picked up (no downgrade)');

  const b = rig();
  ok(applyItem(b.ctx, item('armorBonus'), b.world.player) && b.world.player.armor.points === 1 && b.world.player.armor.factor === ARMOR_GREEN_FACTOR, 'armor bonus with no armor defaults to green absorption');
}

// ── 3. ammo: skill multiplier + backpack doubling ───────────────────────────────
function testAmmo(): void {
  console.log('ammo doubling + skill multiplier');
  const r = rig();
  r.world.player.inventory.ammo.bullets = 200; // at the normal max
  ok(applyItem(r.ctx, item('backpack'), r.world.player), 'backpack is collected');
  ok(r.world.player.inventory.ammoMax.bullets === 400, 'backpack doubles the bullet max to 400');
  ok(r.world.player.inventory.ammo.bullets === 210, 'backpack tops up +10 bullets over the old max (200 → 210)');
  ok(applyItem(r.ctx, item('boxBullets'), r.world.player) && r.world.player.inventory.ammo.bullets === 260, 'box of bullets (+50) clamps under the raised max');

  r.world.player.inventory.ammo.bullets = 400;
  ok(!applyItem(r.ctx, item('clip'), r.world.player), 'a clip at the (raised) max is not picked up');

  const s = rig(1); // I'm Too Young To Die → ammoMultiplier 2
  s.world.player.inventory.ammo.bullets = 0;
  ok(applyItem(s.ctx, item('clip'), s.world.player) && s.world.player.inventory.ammo.bullets === 20, 'skill-1 doubles a 10-round clip to 20');
}

// ── 4. weapon pickup auto-switches + grants ammo ────────────────────────────────
function testWeapon(): void {
  console.log('weapon pickup auto-switch');
  const r = rig();
  r.world.player.inventory.ammo.shells = 0;
  ok(applyItem(r.ctx, item('pickupShotgun'), r.world.player), 'shotgun pickup collected');
  ok(r.world.player.inventory.weapons.shotgun === true, 'shotgun added to inventory');
  ok(r.world.player.pendingWeapon === 'shotgun', 'new weapon auto-switches (pendingWeapon = shotgun)');
  ok(r.world.player.inventory.ammo.shells === 8, 'shotgun pickup grants its 8 first-pickup shells');
}

// ── 5. powerup timers: berserk permanence + invuln expiry ───────────────────────
function testPowerups(): void {
  console.log('powerup timers');
  const r = rig();
  r.world.player.health = 40;
  startPowerup(r.world.player, 'berserk', r.ctx.events);
  ok(r.world.player.health === 100 && r.world.player.powerups.berserk === -1, 'berserk heals to 100 and enables the fist berserk flag');
  updatePowerups(r.world.player, 5000, r.ctx.events);
  ok(r.world.player.powerups.berserk === -1, 'berserk is level-permanent (never counts down)');

  ok(applyItem(r.ctx, item('invulnerability'), r.world.player), 'invulnerability collected');
  const dur = POWERUPS.invulnerability.durationTics;
  ok(r.world.player.powerups.invulnerability === dur && r.started.includes('invulnerability'), 'invuln timer armed + powerup:started emitted');
  updatePowerups(r.world.player, dur - 1, r.ctx.events);
  ok(r.world.player.powerups.invulnerability === 1, 'invuln counts down to 1 tic remaining');
  updatePowerups(r.world.player, 1, r.ctx.events);
  ok(r.world.player.powerups.invulnerability === undefined && r.expired.includes('invulnerability'), 'invuln expires (flag cleared) + powerup:expired emitted');
}

// ── 6. keys recorded + event ────────────────────────────────────────────────────
function testKeys(): void {
  console.log('keys');
  const r = rig();
  ok(applyItem(r.ctx, item('blueCard'), r.world.player) && r.world.player.inventory.keys.blue.card, 'blue keycard recorded');
  ok(applyItem(r.ctx, item('redSkull'), r.world.player) && r.world.player.inventory.keys.red.skull, 'red skull key recorded');
  ok(r.keys.includes('blue') && r.keys.includes('red'), 'key:collected emitted for each');
}

// ── 7. overlap collect/remove via the per-tic update ────────────────────────────
function testOverlap(): void {
  console.log('overlap detection + per-tic update');
  const r = rig();
  r.world.player.inventory.ammo.bullets = 0;
  const near = must(spawnPickup(r.world, 2007, 110, 100), 'spawn near clip'); // |dx|=10 < 36
  const far = must(spawnPickup(r.world, 2007, 400, 400), 'spawn far clip');
  updateItems(r.ctx, 1);
  ok(r.world.pickups.length === 1 && r.world.pickups[0]!.id === far.id, 'overlapping clip collected, distant clip remains');
  ok(r.world.player.inventory.ammo.bullets === 10, 'collected clip granted 10 bullets');
  ok(r.collected.includes(near.thingId), 'pickup:collected emitted with the thing id');
}

// ── run ─────────────────────────────────────────────────────────────────────────
testHealth();
testArmor();
testAmmo();
testWeapon();
testPowerups();
testKeys();
testOverlap();
console.log(`\nAll ${passed} item assertions passed.`);
