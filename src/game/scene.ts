// Per-frame RenderScene assembly: turns the live entity world into the cell-space
// camera + billboard list the frozen renderer consumes (engine.md §4/§9). The
// renderer ignores alpha/bob, so this stays a straight snapshot of world state.
import { CELL_SIZE } from '../core';
import type {
  RenderScene,
  SpriteInstance,
  SpriteFrame,
  IAssetStore,
  IWorld,
  ILevelRuntime,
  Monster,
} from '../core';
import { ENEMIES, ITEMS_BY_ID } from '../data';
import type { WeaponView } from '../weapons';

const DEG45 = Math.PI / 4;
const WALK_FRAMES = ['A', 'B', 'C', 'D'] as const;
const DEATH_FRAMES = ['H', 'I', 'J', 'K', 'L', 'M', 'N'] as const;
const ANIM_TICS_PER_WALK = 4; // tics each walk frame holds

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

function monsterFrameLetter(m: Monster, animTic: number): string {
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
      return DEATH_FRAMES[Math.min(DEATH_FRAMES.length - 1, Math.floor(m.stateTimer / 5))]!;
    case 'dead':
      return DEATH_FRAMES[DEATH_FRAMES.length - 1]!;
    default:
      return 'A';
  }
}

/** Build the full RenderScene for this frame from the world + weapon view. */
export function buildRenderScene(
  world: IWorld,
  level: ILevelRuntime,
  assets: IAssetStore,
  view: WeaponView,
  animTic: number,
  fovRatio: number,
): RenderScene {
  const p = world.player;
  const dirX = Math.cos(p.angle);
  const dirY = Math.sin(p.angle);

  const sprites: SpriteInstance[] = [];

  for (const m of world.monsters) {
    const def = ENEMIES[m.type];
    const frame = pickFrame(assets, def.sprite, monsterFrameLetter(m, animTic), rotationFor(p.x, p.y, m));
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
    extralight: view.extralight,
    bobX: view.bobX,
    bobY: view.bobY,
  };
}
