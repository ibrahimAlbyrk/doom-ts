// Authoritative world SNAPSHOT — the wire shape the server broadcasts each network tick
// and the client mirrors into its local world (multiplayer-plan §1 / P2). P2 sends FULL
// (non-delta) snapshots as plain JSON; delta/quantization is P3a ([netcode §4.6]). One
// representation only: these structs are built straight off the sim entities server-side
// and applied straight back client-side, so there is no Colyseus @type Schema to mirror.
//
// Keyed by entity id, never array index (B2): players upsert into world.players; monsters
// / projectiles / pickups are rebuilt each apply (the client never simulates them, it just
// renders the latest authoritative set). Door/lift dynamic state travels as compact arrays
// aligned to the level's door/lift order (both sides load the same MapData).
import type { IWorld, ILevelRuntime, Player, Projectile, MonsterType, MonsterAIState, WeaponId } from '../core';
import type { GameMode } from '../lobby/protocol';
import { createPlayer, createMonster, createPickup } from '../entities';

/** Marine animation intent the avatar renderer turns into a PLAY frame ([netcode §6]):
 *  sync STATE not frame indices, so each client drives its own animation clock. */
export type AvatarState = 'idle' | 'walk' | 'fire' | 'pain' | 'dead';

/** A remote marine as the presenter needs it: a billboard pose (x/y/angle/state) plus the
 *  nametag label/tint. Fed through scene.ts's existing 8-rotation sprite path ([netcode §6]). */
export interface RemoteAvatar {
  id: number;
  x: number;
  y: number;
  angle: number;
  state: AvatarState;
  name: string;
  color: number; // LOBBY_COLORS index
}

export interface PlayerSnap {
  id: number; // authoritative sim id (host-allocated, B3)
  sid: string; // Colyseus sessionId — how a client finds ITSELF in the roster
  name: string; // nametag label (from the lobby roster)
  color: number; // LOBBY_COLORS index (nametag tint)
  x: number;
  y: number;
  angle: number;
  vx: number; // velocity (mu/tic) — the client's reconciliation replays momentum from here (P3a)
  vy: number;
  health: number;
  armor: number;
  weapon: WeaponId; // local first-person gun selection
  state: AvatarState;
  bob: number; // walk-bob phase (local eye/weapon bob)
  seq: number; // last command seq the server applied for this player (P3a)
}

export interface MonsterSnap {
  id: number;
  type: MonsterType;
  x: number;
  y: number;
  angle: number;
  state: MonsterAIState;
  health: number;
}

export interface ProjectileSnap {
  id: number;
  x: number;
  y: number;
  angle: number;
  sprite: string;
}

export interface PickupSnap {
  id: number;
  thingId: number;
  x: number;
  y: number;
}

export interface Snapshot {
  tick: number;
  mode: GameMode;
  players: PlayerSnap[];
  monsters: MonsterSnap[];
  projectiles: ProjectileSnap[];
  pickups: PickupSnap[];
  doors: number[]; // open amount (0..1) per level door, in MapData order
  lifts: number[]; // floor tier (map units) per level lift, in MapData order
}

/** What the server threads in to stamp a snapshot with per-player metadata it owns
 *  (the lobby roster + weapon-fire state) without the snapshot module importing it. */
export interface SnapshotMeta {
  tick: number;
  mode: GameMode;
  isFiring: (id: number) => boolean;
  processedSeq: (id: number) => number;
  metaFor: (id: number) => { sid: string; name: string; color: number };
}

/** Marine intent for the avatar: dead → firing → walking → idle (velocity-thresholded). */
export function avatarStateOf(p: Player, firing: boolean): AvatarState {
  if (p.health <= 0) return 'dead';
  if (firing) return 'fire';
  return Math.hypot(p.velX, p.velY) > 0.1 ? 'walk' : 'idle';
}

/** Build the authoritative snapshot from the live world + level (server-side). */
export function buildSnapshot(world: IWorld, level: ILevelRuntime, m: SnapshotMeta): Snapshot {
  const players: PlayerSnap[] = [];
  for (const p of world.players.values()) {
    const meta = m.metaFor(p.id);
    players.push({
      id: p.id,
      sid: meta.sid,
      name: meta.name,
      color: meta.color,
      x: p.x,
      y: p.y,
      angle: p.angle,
      vx: p.velX,
      vy: p.velY,
      health: p.health,
      armor: p.armor.points,
      weapon: p.currentWeapon,
      state: avatarStateOf(p, m.isFiring(p.id)),
      bob: p.bob,
      seq: m.processedSeq(p.id),
    });
  }

  const monsters: MonsterSnap[] = world.monsters.map((mo) => ({
    id: mo.id,
    type: mo.type,
    x: mo.x,
    y: mo.y,
    angle: mo.angle,
    state: mo.state,
    health: mo.health,
  }));

  const projectiles: ProjectileSnap[] = world.projectiles.map((pr) => ({
    id: pr.id,
    x: pr.x,
    y: pr.y,
    angle: pr.angle,
    sprite: pr.sprite,
  }));

  const pickups: PickupSnap[] = world.pickups.map((pk) => ({
    id: pk.id,
    thingId: pk.thingId,
    x: pk.x,
    y: pk.y,
  }));

  return {
    tick: m.tick,
    mode: m.mode,
    players,
    monsters,
    projectiles,
    pickups,
    doors: level.data.doors.map((_d, i) => doorOpen(level, i)),
    lifts: level.data.lifts.map((_l, i) => liftHeight(level, i)),
  };
}

/** Mirror a snapshot into the client's local world + level (raw apply, P2). The local
 *  player id is preserved so the presenter's point-of-view never gets pruned. */
export function applySnapshot(world: IWorld, level: ILevelRuntime, snap: Snapshot): void {
  const seen = new Set<number>();
  for (const ps of snap.players) {
    seen.add(ps.id);
    let p = world.players.get(ps.id);
    if (!p) {
      p = createPlayer(ps.id, ps.x, ps.y, ps.angle);
      world.players.set(ps.id, p);
    }
    p.x = ps.x;
    p.y = ps.y;
    p.angle = ps.angle;
    p.health = ps.health;
    p.armor.points = ps.armor;
    p.currentWeapon = ps.weapon;
    p.bob = ps.bob;
    p.active = ps.health > 0;
    p.velX = ps.vx;
    p.velY = ps.vy;
  }
  for (const id of [...world.players.keys()]) {
    if (!seen.has(id) && id !== world.localPlayerId) world.players.delete(id);
  }

  world.monsters.length = 0;
  for (const ms of snap.monsters) {
    const mo = createMonster(ms.id, ms.type, ms.x, ms.y, ms.angle);
    mo.state = ms.state;
    mo.health = ms.health;
    world.monsters.push(mo);
  }

  world.projectiles.length = 0;
  for (const pr of snap.projectiles) {
    world.projectiles.push(projectileFromSnap(pr.id, pr.x, pr.y, pr.angle, pr.sprite));
  }

  world.pickups.length = 0;
  for (const pk of snap.pickups) {
    const pickup = createPickup(pk.id, pk.thingId, pk.x, pk.y);
    if (pickup) world.pickups.push(pickup);
  }

  applyLevelDynamics(level, snap);
}

/** Door open amounts + lift floor tiers are dynamic level state the renderer reads, so
 *  mirror them onto the locally-loaded LevelRuntime by index (same MapData both sides). */
function applyLevelDynamics(level: ILevelRuntime, snap: Snapshot): void {
  const doors = doorRuntimes(level);
  if (doors) snap.doors.forEach((open, i) => doors[i] && (doors[i]!.open = open));
  const lifts = liftRuntimes(level);
  if (lifts) snap.lifts.forEach((h, i) => lifts[i] && (lifts[i]!.height = h));
}

// LevelRuntime carries `doors`/`lifts` runtime arrays; reach them through a structural
// view so this module needs no concrete-class import (keeps the ILevelRuntime contract).
interface DoorRT {
  open: number;
}
interface LiftRT {
  height: number;
}
function doorRuntimes(level: ILevelRuntime): DoorRT[] | undefined {
  return (level as unknown as { doors?: DoorRT[] }).doors;
}
function liftRuntimes(level: ILevelRuntime): LiftRT[] | undefined {
  return (level as unknown as { lifts?: LiftRT[] }).lifts;
}
function doorOpen(level: ILevelRuntime, i: number): number {
  return doorRuntimes(level)?.[i]?.open ?? 1;
}
function liftHeight(level: ILevelRuntime, i: number): number {
  return liftRuntimes(level)?.[i]?.height ?? 0;
}

// ── entity interpolation (client, P3a [netcode §4.4]) ──────────────────────────────
// Remotes are rendered ~one snapshot-interval in the past, lerped between the two
// bracketing snapshots, so other marines / monsters / projectiles glide instead of
// teleporting at the snapshot rate. The LOCAL player is never interpolated — client-side
// prediction owns it (RemoteSession).

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Shortest-arc angular lerp (radians) so a remote never spins the long way at the 2π seam. */
function lerpAngle(a: number, b: number, t: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

/** The fixed projectile struct fields a snapshot doesn't carry (client never simulates
 *  projectiles — they only need a position + sprite to draw). */
function projectileFromSnap(id: number, x: number, y: number, angle: number, sprite: string): Projectile {
  return {
    id, x, y, angle,
    radius: 6, active: true, velX: 0, velY: 0,
    damage: { n: 0, m: 0 }, speed: 0, ownerId: -1, ownerFaction: 'neutral', splashRadius: 0,
    sprite,
  };
}

/**
 * Write the REMOTE world (everyone but `localId`) into the client world/level, interpolated
 * between snapshots `a` (older) and `b` (newer) at factor `t`∈[0,1]. The local player is
 * skipped (prediction owns it). Monsters/projectiles are rebuilt from the bracket; pickups
 * (static) and door/lift tiers come from / lerp toward `b`. Entities present only in `b`
 * (just spawned) hold at `b`; entities gone from `b` are removed. `avatarMeta` is refreshed
 * from `b` so nametags/anim-intent track the newest authoritative state.
 */
export function interpolateRemotes(
  world: IWorld,
  level: ILevelRuntime,
  a: Snapshot,
  b: Snapshot,
  t: number,
  localId: number,
  avatarMeta: Map<number, { state: AvatarState; name: string; color: number }>,
): void {
  const aPlayers = new Map(a.players.map((p) => [p.id, p]));
  const seen = new Set<number>();
  for (const pb of b.players) {
    if (pb.id === localId) continue;
    seen.add(pb.id);
    avatarMeta.set(pb.id, { state: pb.state, name: pb.name, color: pb.color });
    let p = world.players.get(pb.id);
    if (!p) {
      p = createPlayer(pb.id, pb.x, pb.y, pb.angle);
      world.players.set(pb.id, p);
    }
    const pa = aPlayers.get(pb.id) ?? pb; // just spawned → no older sample, hold at b
    p.x = lerp(pa.x, pb.x, t);
    p.y = lerp(pa.y, pb.y, t);
    p.angle = lerpAngle(pa.angle, pb.angle, t);
    p.health = pb.health;
    p.currentWeapon = pb.weapon;
    p.bob = pb.bob;
    p.active = pb.health > 0;
  }
  for (const id of [...world.players.keys()]) {
    if (id !== localId && !seen.has(id)) world.players.delete(id);
  }

  const aMon = new Map(a.monsters.map((m) => [m.id, m]));
  world.monsters.length = 0;
  for (const mb of b.monsters) {
    const ma = aMon.get(mb.id) ?? mb;
    const mo = createMonster(mb.id, mb.type, lerp(ma.x, mb.x, t), lerp(ma.y, mb.y, t), lerpAngle(ma.angle, mb.angle, t));
    mo.state = mb.state;
    mo.health = mb.health;
    world.monsters.push(mo);
  }

  const aProj = new Map(a.projectiles.map((p) => [p.id, p]));
  world.projectiles.length = 0;
  for (const pb of b.projectiles) {
    const pa = aProj.get(pb.id) ?? pb;
    world.projectiles.push(projectileFromSnap(pb.id, lerp(pa.x, pb.x, t), lerp(pa.y, pb.y, t), lerpAngle(pa.angle, pb.angle, t), pb.sprite));
  }

  world.pickups.length = 0;
  for (const pk of b.pickups) {
    const pickup = createPickup(pk.id, pk.thingId, pk.x, pk.y);
    if (pickup) world.pickups.push(pickup);
  }

  const doors = doorRuntimes(level);
  if (doors) b.doors.forEach((open, i) => { if (doors[i]) doors[i]!.open = lerp(a.doors[i] ?? open, open, t); });
  const lifts = liftRuntimes(level);
  if (lifts) b.lifts.forEach((h, i) => { if (lifts[i]) lifts[i]!.height = lerp(a.lifts[i] ?? h, h, t); });
}
