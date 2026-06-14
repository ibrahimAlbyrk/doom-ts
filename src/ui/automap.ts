// DOOM-style automap overlay — green vector lines on black, drawn top-down from the
// level's grid geometry. The game owns the loop and the toggle (conventionally Tab,
// the `automap` action); it just calls drawAutomap() when the map is active. We never
// mutate game state here — read geometry from MapData, read the player for the arrow.
import type { MapData, Player, ILevelRuntime, IWorld, Monster, KeyColor } from '../core';
import { ITEMS_BY_ID } from '../data';

/** Anything the game can hand us to find the current level's geometry. */
export type AutomapSource = MapData | ILevelRuntime | IWorld;

export interface AutomapOptions {
  /** Map-units per screen pixel. Omit to auto-fit the whole map to (w,h). */
  scale?: number;
  /** Draw live monsters as dots (seen/alive). Needs `monsters` to be passed. */
  monsters?: Monster[];
  /** Fill the background black first (default true). Pass false to overlay. */
  fillBackground?: boolean;
}

const COLOR = {
  wall: '#00cc33',
  door: '#00e0e0',
  exit: '#ffffff',
  player: '#ffffff',
  monster: '#cc3333',
  background: '#000000',
} as const;

const KEY_COLOR: Record<KeyColor, string> = {
  blue: '#4060ff',
  yellow: '#ffe23a',
  red: '#ff3030',
};

/** Resolve the geometry source to the underlying MapData (or null if no level). */
function resolveMap(src: AutomapSource): MapData | null {
  if ('walls' in src) return src;
  if ('data' in src && src.data) return src.data;
  if ('level' in src) return src.level?.data ?? null;
  return null;
}

/**
 * Draw the current level top-down: wall outlines, the player as a direction arrow,
 * and markers for doors/keys/exits (plus optional monster dots). The view is
 * player-centred (classic DOOM follow mode); pass opts.scale to override the fit.
 */
export function drawAutomap(
  ctx: CanvasRenderingContext2D,
  source: AutomapSource,
  player: Player,
  w: number,
  h: number,
  opts?: AutomapOptions,
): void {
  if (opts?.fillBackground !== false) {
    ctx.fillStyle = COLOR.background;
    ctx.fillRect(0, 0, w, h);
  }

  const map = resolveMap(source);
  if (!map) return;

  const cs = map.cellSize;
  const scale = opts?.scale ?? Math.min(w / (map.width * cs), h / (map.height * cs)) * 0.9;
  // Player-centred world→screen transform (no axis flip: world y matches grid rows,
  // so the player's (cos,sin) heading lines up with the walls without a sign juggle).
  const tx = (wx: number): number => (wx - player.x) * scale + w / 2;
  const ty = (wy: number): number => (wy - player.y) * scale + h / 2;

  ctx.imageSmoothingEnabled = false;
  drawWalls(ctx, map, scale, player, w, h);
  drawDoors(ctx, map, tx, ty, cs, scale);
  drawExits(ctx, map, tx, ty, cs, scale);
  drawKeys(ctx, map, tx, ty);
  if (opts?.monsters) drawMonsters(ctx, opts.monsters, tx, ty);
  drawPlayerArrow(ctx, player, scale, w, h);
}

/** Outline every solid cell's edges that border a non-solid (or off-grid) cell. */
function drawWalls(
  ctx: CanvasRenderingContext2D,
  map: MapData,
  scale: number,
  player: Player,
  w: number,
  h: number,
): void {
  const cs = map.cellSize;
  const solid = (x: number, y: number): boolean =>
    x >= 0 && y >= 0 && x < map.width && y < map.height && map.walls[y * map.width + x] !== 0;
  const tx = (wx: number): number => (wx - player.x) * scale + w / 2;
  const ty = (wy: number): number => (wy - player.y) * scale + h / 2;

  ctx.strokeStyle = COLOR.wall;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      if (!solid(x, y)) continue;
      const left = x * cs;
      const right = (x + 1) * cs;
      const top = y * cs;
      const bot = (y + 1) * cs;
      if (!solid(x, y - 1)) edge(ctx, tx(left), ty(top), tx(right), ty(top));
      if (!solid(x, y + 1)) edge(ctx, tx(left), ty(bot), tx(right), ty(bot));
      if (!solid(x - 1, y)) edge(ctx, tx(left), ty(top), tx(left), ty(bot));
      if (!solid(x + 1, y)) edge(ctx, tx(right), ty(top), tx(right), ty(bot));
    }
  }
  ctx.stroke();
}

function edge(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number): void {
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
}

type Proj = (v: number) => number;

/** Door cells: cyan, or the required key colour when the door is locked. */
function drawDoors(ctx: CanvasRenderingContext2D, map: MapData, tx: Proj, ty: Proj, cs: number, scale: number): void {
  const side = cs * scale;
  for (const d of map.doors) {
    ctx.strokeStyle = d.kind === 'locked' && d.key ? KEY_COLOR[d.key] : COLOR.door;
    ctx.lineWidth = 1;
    ctx.strokeRect(tx(d.x * cs), ty(d.y * cs), side, side);
  }
}

/** Exit triggers: a white box at the trigger cell. */
function drawExits(ctx: CanvasRenderingContext2D, map: MapData, tx: Proj, ty: Proj, cs: number, scale: number): void {
  const side = cs * scale;
  ctx.strokeStyle = COLOR.exit;
  ctx.lineWidth = 1;
  for (const ex of map.exits) {
    const t = ex.trigger;
    ctx.strokeRect(tx(t.x * cs), ty(t.y * cs), side, side);
  }
}

/** Key things: a small diamond in the key colour at the thing's position. */
function drawKeys(ctx: CanvasRenderingContext2D, map: MapData, tx: Proj, ty: Proj): void {
  for (const thing of map.things) {
    const def = ITEMS_BY_ID.get(thing.id);
    if (!def || def.kind !== 'key' || !def.keyColor) continue;
    diamond(ctx, tx(thing.x), ty(thing.y), 4, KEY_COLOR[def.keyColor]);
  }
}

function drawMonsters(ctx: CanvasRenderingContext2D, monsters: Monster[], tx: Proj, ty: Proj): void {
  ctx.fillStyle = COLOR.monster;
  for (const m of monsters) {
    if (!m.active) continue;
    ctx.fillRect(tx(m.x) - 1, ty(m.y) - 1, 3, 3);
  }
}

/** Player as a filled direction arrow at screen centre, pointing along player.angle. */
function drawPlayerArrow(
  ctx: CanvasRenderingContext2D,
  player: Player,
  scale: number,
  w: number,
  h: number,
): void {
  const cx = w / 2;
  const cy = h / 2;
  const len = Math.max(6, player.radius * scale * 1.5);
  const ca = Math.cos(player.angle);
  const sa = Math.sin(player.angle);
  const tip = { x: cx + ca * len, y: cy + sa * len };
  // Two barbs swept back from the tip (±150° from the heading).
  const back = 2.62;
  const bl = { x: cx + Math.cos(player.angle + back) * len * 0.7, y: cy + Math.sin(player.angle + back) * len * 0.7 };
  const br = { x: cx + Math.cos(player.angle - back) * len * 0.7, y: cy + Math.sin(player.angle - back) * len * 0.7 };
  ctx.strokeStyle = COLOR.player;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(bl.x, bl.y);
  ctx.lineTo(tip.x, tip.y);
  ctx.lineTo(br.x, br.y);
  ctx.stroke();
}

function diamond(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string): void {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x, y - r);
  ctx.lineTo(x + r, y);
  ctx.lineTo(x, y + r);
  ctx.lineTo(x - r, y);
  ctx.closePath();
  ctx.fill();
}
