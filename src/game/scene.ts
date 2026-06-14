// Per-frame RenderScene assembly: turns the live entity world into the cell-space
// camera + billboard list the frozen renderer consumes (engine.md §4/§9). The
// renderer ignores alpha/bob, so this stays a straight snapshot of world state.
import { CELL_SIZE, VIEW_HEIGHT } from '../core';
import type {
  RenderScene,
  SpriteInstance,
  SpriteFrame,
  IAssetStore,
  IWorld,
  ILevelRuntime,
  Monster,
  EnemyDef,
} from '../core';
import { ENEMIES, ITEMS_BY_ID, DEATH_FRAMES } from '../data';
import { bobAmount, viewBob, type WeaponView } from '../weapons';
import type { AvatarState, RemoteAvatar } from '../session/snapshot';

const DEG45 = Math.PI / 4;
const WALK_FRAMES = ['A', 'B', 'C', 'D'] as const;
const ANIM_TICS_PER_WALK = 4; // tics each walk frame holds

/** Freedoom PLAY (marine) sprite prefix — reused for every remote co-op player. */
const PLAYER_SPRITE = 'PLAY';

/** Map a remote marine's synced intent to a PLAY frame letter: walk PLAYA–D (client clock),
 *  fire PLAYE, pain PLAYG, death PLAYH (downed). pickFrame degrades any gap gracefully. */
function playerFrameLetter(state: AvatarState, animTic: number): string {
  switch (state) {
    case 'walk':
      return WALK_FRAMES[Math.floor(animTic / ANIM_TICS_PER_WALK) % 4]!;
    case 'fire':
      return 'E';
    case 'pain':
      return 'G';
    case 'dead':
      return 'H';
    case 'idle':
    default:
      return 'A';
  }
}
// Spread a monster's death frames across this window, matching the AI settle time
// (ai DEATH_SETTLE_TICS) so the animation lands on the final corpse as it goes 'dead'.
const DEATH_ANIM_TICS = 20;

function cellLight(level: ILevelRuntime, x: number, y: number): number {
  return level.lightAt(Math.floor(x / CELL_SIZE), Math.floor(y / CELL_SIZE));
}

/** DOOM 8-way sprite rotation (1..8) for `thing` viewed from (vx,vy):
 *  rot = ((angleToThing − thing.angle + 202.5°) / 45°) mod 8, +1. */
function rotationFor(vx: number, vy: number, thing: { x: number; y: number; angle: number }): number {
  const toThing = Math.atan2(thing.y - vy, thing.x - vx);
  let diff = toThing - thing.angle + 4.5 * DEG45;
  diff %= Math.PI * 2;
  if (diff < 0) diff += Math.PI * 2;
  return (Math.floor(diff / DEG45) % 8) + 1;
}

/** Resolve a sprite frame, degrading gracefully so something always draws:
 *  exact rotation → angle-independent (0) → the same lookups on the 'A' frame. */
function pickFrame(
  assets: IAssetStore,
  prefix: string,
  frame: string,
  rotation: number,
): SpriteFrame | undefined {
  return (
    assets.getSprite(prefix, frame, rotation) ??
    assets.getSprite(prefix, frame, 0) ??
    assets.getSprite(prefix, 'A', rotation) ??
    assets.getSprite(prefix, 'A', 0)
  );
}

function monsterFrameLetter(m: Monster, def: EnemyDef, assets: IAssetStore, animTic: number): string {
  switch (m.state) {
    case 'chase':
      return WALK_FRAMES[Math.floor(animTic / ANIM_TICS_PER_WALK) % 4]!;
    case 'melee':
    case 'missile':
      return 'F';
    case 'pain':
      return 'G';
    case 'death':
    case 'gib':
    case 'dead':
      return corpseFrameLetter(m, def, assets);
    default:
      return 'A';
  }
}

/**
 * Pick the frame for a dying/dead monster from its own death sequence (or x-death if
 * it was gibbed), looked up at rotation 0. The sequence is animated across the settle
 * window while dying, then the final flat corpse frame is held once dead. Only frames
 * that actually exist are returned, so a corpse can never fall back to the standing 'A'.
 */
function corpseFrameLetter(m: Monster, def: EnemyDef, assets: IAssetStore): string {
  const seqs = DEATH_FRAMES[def.type];
  const gibbed = m.state === 'gib' || (m.state === 'dead' && m.health < -def.health);
  const seq = gibbed && seqs.gib ? seqs.gib : seqs.death;
  const target =
    m.state === 'dead'
      ? seq.length - 1
      : Math.min(seq.length - 1, Math.floor((m.stateTimer / DEATH_ANIM_TICS) * seq.length));
  // Hold the last frame that has a real sprite; never degrade to the upright 'A'.
  for (let i = target; i >= 0; i--) {
    if (assets.getSprite(def.sprite, seq[i]!, 0)) return seq[i]!;
  }
  return seq[seq.length - 1]!; // asset-verified data — unreachable fallback, still a corpse
}

/** Build the full RenderScene for this frame from the world + weapon view. */
export function buildRenderScene(
  world: IWorld,
  level: ILevelRuntime,
  assets: IAssetStore,
  view: WeaponView,
  animTic: number,
  fovRatio: number,
  playViewHeight?: number,
  viewFloorOffset = 0,
  remotePlayers: readonly RemoteAvatar[] = [],
): RenderScene {
  const p = world.player;
  const dirX = Math.cos(p.angle);
  const dirY = Math.sin(p.angle);
  // DOOM P_CalcHeight eye bob: viewz = floorz + VIEW_HEIGHT + bob, on the same phase
  // (p.bob) as the weapon bob so the view and gun ride one wave; settles at rest.
  // viewFloorOffset (smoothViewFloorZ − actual floor tier) eases tier changes so the
  // renderer's eyeZ glides instead of snapping; the bob rides on top of that base.
  const viewZ = VIEW_HEIGHT + viewBob(p.bob, bobAmount(p.velX, p.velY)) + viewFloorOffset;

  const sprites: SpriteInstance[] = [];

  for (const m of world.monsters) {
    const def = ENEMIES[m.type];
    const frame = pickFrame(assets, def.sprite, monsterFrameLetter(m, def, assets, animTic), rotationFor(p.x, p.y, m));
    if (!frame) continue;
    sprites.push({
      x: m.x / CELL_SIZE,
      y: m.y / CELL_SIZE,
      frame,
      light: cellLight(level, m.x, m.y),
      fullbright: false,
      vMove: 0,
    });
  }

  // Other co-op marines: billboards in the same 8-rotation sprite system the monsters
  // use (engine.md §4), facing chosen from camera→player angle, frame from synced intent.
  for (const rp of remotePlayers) {
    const frame = pickFrame(assets, PLAYER_SPRITE, playerFrameLetter(rp.state, animTic), rotationFor(p.x, p.y, rp));
    if (!frame) continue;
    sprites.push({
      x: rp.x / CELL_SIZE,
      y: rp.y / CELL_SIZE,
      frame,
      light: cellLight(level, rp.x, rp.y),
      fullbright: false,
      vMove: 0,
    });
  }

  for (const pr of world.projectiles) {
    const frame = pickFrame(assets, pr.sprite, 'A', 0);
    if (!frame) continue;
    sprites.push({ x: pr.x / CELL_SIZE, y: pr.y / CELL_SIZE, frame, light: 255, fullbright: true, vMove: 0 });
  }

  for (const pk of world.pickups) {
    const def = ITEMS_BY_ID.get(pk.thingId);
    if (!def) continue;
    const frame = pickFrame(assets, def.sprite, 'A', 0);
    if (!frame) continue;
    sprites.push({
      x: pk.x / CELL_SIZE,
      y: pk.y / CELL_SIZE,
      frame,
      light: cellLight(level, pk.x, pk.y),
      fullbright: false,
      vMove: 0,
    });
  }

  const viewWeapon = view.sprite ? (assets.getSprite(view.sprite, view.frame, 0) ?? null) : null;
  const viewFlash = view.flashSprite ? (assets.getSprite(view.flashSprite, view.flashFrame, 0) ?? null) : null;

  return {
    camera: {
      posX: p.x / CELL_SIZE,
      posY: p.y / CELL_SIZE,
      dirX,
      dirY,
      planeX: -dirY * fovRatio,
      planeY: dirX * fovRatio,
    },
    level,
    sprites,
    viewWeapon,
    viewFlash,
    extralight: view.extralight,
    bobX: view.bobX,
    bobY: view.bobY,
    viewZ,
    playViewHeight,
  };
}
