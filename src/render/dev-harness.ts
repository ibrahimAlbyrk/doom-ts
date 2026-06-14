// ============================================================================
// THROWAWAY DEV-HARNESS — NOT imported by src/main.ts, NOT in the production build.
// Stands up the Canvas2DRenderer against a hand-built ILevelRuntime + sprite list so
// a room can be verified in a real browser before Freedoom assets / src/game land.
// Open at: http://localhost:5173/src/render/dev-harness.html  (vite dev)
// Move: W/S forward/back, A/D strafe, ←/→ turn.
// ============================================================================
import type {
  Camera,
  ILevelRuntime,
  MapData,
  RenderConfig,
  SpriteInstance,
  SpriteFrame,
  Texture,
} from '../core';
import {
  CELL_SIZE,
  COLORMAP_LEVELS,
  FOV_PLANE_RATIO,
  INTERNAL_WIDTH_DEFAULT,
  INTERNAL_HEIGHT_DEFAULT,
} from '../core';
import { Canvas2DRenderer } from './renderer';
import { makeFallbackSpriteFrame } from './textures';

// ── A small test map: solid border, a 2×2 pillar, a sky strip, a taller far region ──
function buildMap(): MapData {
  const width = 12;
  const height = 12;
  const idx = (x: number, y: number) => y * width + x;
  const n = width * height;
  const walls = new Array<number>(n).fill(0);
  const floors = new Array<number>(n).fill(0);
  const ceilings = new Array<number>(n).fill(1);
  const floorHeights = new Array<number>(n).fill(0);
  const ceilHeights = new Array<number>(n).fill(128);
  const light = new Array<number>(n).fill(200);

  for (let x = 0; x < width; x++) {
    walls[idx(x, 0)] = 1;
    walls[idx(x, height - 1)] = 1;
  }
  for (let y = 0; y < height; y++) {
    walls[idx(0, y)] = 1;
    walls[idx(width - 1, y)] = 1;
  }
  // Central pillar (for sprite depth-clip).
  for (const [px, py] of [[5, 5], [6, 5], [5, 6], [6, 6]] as const) walls[idx(px, py)] = 2;
  // Sky over the far-right interior strip.
  for (let y = 1; y < height - 1; y++) {
    for (let x = 8; x < width - 1; x++) ceilings[idx(x, y)] = -1;
  }
  // Taller ceiling + dimmer light in the far half (variable height + lighting).
  for (let y = 1; y < height - 1; y++) {
    for (let x = 7; x < width - 1; x++) {
      ceilHeights[idx(x, y)] = 224;
      light[idx(x, y)] = 130;
    }
  }

  return {
    id: 'DEVROOM',
    name: 'Render Harness',
    width,
    height,
    cellSize: CELL_SIZE,
    walls,
    floors,
    ceilings,
    floorHeights,
    ceilHeights,
    light,
    wallTextures: ['WALL_BRICK', 'WALL_PILLAR'],
    flatTextures: ['FLOOR_TILE', 'CEIL_PANEL'],
    sky: 'SKY_DEV',
    doors: [],
    lifts: [],
    teleporters: [],
    exits: [],
    secretSectors: [],
    things: [],
    playerStart: { x: 0, y: 0, angle: 0 },
    par: 0,
  };
}

class HarnessLevel implements ILevelRuntime {
  constructor(readonly data: MapData) {}
  private i(cx: number, cy: number): number {
    return cy * this.data.width + cx;
  }
  private oob(cx: number, cy: number): boolean {
    return cx < 0 || cy < 0 || cx >= this.data.width || cy >= this.data.height;
  }
  isSolid(cx: number, cy: number): boolean {
    if (this.oob(cx, cy)) return true;
    return (this.data.walls[this.i(cx, cy)] ?? 0) > 0;
  }
  wallTextureAt(cx: number, cy: number): string | null {
    if (this.oob(cx, cy)) return null;
    const id = this.data.walls[this.i(cx, cy)] ?? 0;
    return id > 0 ? this.data.wallTextures[id - 1] ?? null : null;
  }
  floorTextureAt(cx: number, cy: number): string {
    if (this.oob(cx, cy)) return this.data.flatTextures[0] ?? 'FLOOR_TILE';
    return this.data.flatTextures[this.data.floors[this.i(cx, cy)] ?? 0] ?? 'FLOOR_TILE';
  }
  ceilTextureAt(cx: number, cy: number): string | null {
    if (this.oob(cx, cy)) return null;
    const id = this.data.ceilings[this.i(cx, cy)] ?? 0;
    return id < 0 ? null : this.data.flatTextures[id] ?? 'CEIL_PANEL';
  }
  floorHeightAt(cx: number, cy: number): number {
    if (this.oob(cx, cy)) return 0;
    return this.data.floorHeights[this.i(cx, cy)] ?? 0;
  }
  ceilHeightAt(cx: number, cy: number): number {
    if (this.oob(cx, cy)) return 128;
    return this.data.ceilHeights[this.i(cx, cy)] ?? 128;
  }
  lightAt(cx: number, cy: number): number {
    if (this.oob(cx, cy)) return 160;
    return this.data.light[this.i(cx, cy)] ?? 160;
  }
  doorOpenAt(): number {
    return 1; // no doors in the harness
  }
}

/** A crude screen-space weapon barrel so the overlay is visibly distinct. */
function makeWeaponFrame(): SpriteFrame {
  const w = 80;
  const h = 60;
  const px = new Uint32Array(w * h);
  const pack = (r: number, g: number, b: number) =>
    (0xff000000 | (b << 16) | (g << 8) | r) >>> 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const inBarrel = x > w / 2 - 8 && x < w / 2 + 8 && y > 6;
      const inBody = x > w / 2 - 20 && x < w / 2 + 20 && y > h - 22;
      if (inBarrel || inBody) {
        const shade = inBarrel ? 90 : 60;
        px[y * w + x] = pack(shade, shade, shade + 10);
      }
    }
  }
  return { texture: { width: w, height: h, pixels: px } as Texture, originX: w / 2, originY: h, mirror: false };
}

function cameraFromAngle(posX: number, posY: number, angle: number): Camera {
  const dirX = Math.cos(angle);
  const dirY = Math.sin(angle);
  return {
    posX,
    posY,
    dirX,
    dirY,
    planeX: -dirY * FOV_PLANE_RATIO,
    planeY: dirX * FOV_PLANE_RATIO,
  };
}

function main(): void {
  const canvas = document.getElementById('screen');
  if (!(canvas instanceof HTMLCanvasElement)) throw new Error('harness: no <canvas id="screen">');

  const config: RenderConfig = {
    internalWidth: INTERNAL_WIDTH_DEFAULT,
    internalHeight: INTERNAL_HEIGHT_DEFAULT,
    fovRatio: FOV_PLANE_RATIO,
    colormapLevels: COLORMAP_LEVELS,
  };

  const renderer = new Canvas2DRenderer();
  renderer.init(canvas, config);
  // No asset store bound on purpose → every texture uses the procedural fallback.

  const level = new HarnessLevel(buildMap());

  // Two billboard sprites: one beyond the pillar (depth-clipped), one in the open.
  const spriteFrame = makeFallbackSpriteFrame('IMP', 56);
  const sprites: SpriteInstance[] = [
    { x: 8.5, y: 8.5, frame: spriteFrame, light: 130, fullbright: false, vMove: 0 },
    { x: 3.5, y: 7.0, frame: makeFallbackSpriteFrame('BALL', 40), light: 200, fullbright: true, vMove: -20 },
  ];
  const weapon = makeWeaponFrame();

  let angle = Math.PI / 4;
  let px = 2.5;
  let py = 2.5;
  const keys = new Set<string>();
  addEventListener('keydown', (e) => keys.add(e.key.toLowerCase()));
  addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));

  function move(dt: number): void {
    const speed = 3 * dt;
    const turn = 2 * dt;
    if (keys.has('arrowleft')) angle -= turn;
    if (keys.has('arrowright')) angle += turn;
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    let nx = px;
    let ny = py;
    if (keys.has('w')) { nx += dx * speed; ny += dy * speed; }
    if (keys.has('s')) { nx -= dx * speed; ny -= dy * speed; }
    if (keys.has('a')) { nx += dy * speed; ny -= dx * speed; }
    if (keys.has('d')) { nx -= dy * speed; ny += dx * speed; }
    if (!level.isSolid(Math.floor(nx), Math.floor(py))) px = nx;
    if (!level.isSolid(Math.floor(px), Math.floor(ny))) py = ny;
  }

  let last = performance.now();
  function frame(now: number): void {
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    move(dt);
    const cam = cameraFromAngle(px, py, angle);
    renderer.render(
      { camera: cam, level, sprites, viewWeapon: weapon, extralight: 0 },
      0,
    );
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // Expose for headless screenshot / smoke checks.
  (window as unknown as { __harness: unknown }).__harness = { renderer, level };
}

main();
