// Compact level-authoring DSL → frozen MapData (src/core). A level is described as
// an ASCII floor plan plus a per-character legend (wall/floor/ceiling/light/height);
// doors, lifts, teleporters, exits, secrets and things are declared in CELL
// coordinates. compile() resolves texture/flat names into the indexed grid layers
// the MapData schema requires and converts cell coords → map-unit centres.
//
// Authoring in cells keeps geometry axis-aligned (one char = one 64mu cell) and
// readable; the loader + engine never see the DSL, only the emitted MapData.
import { CELL_SIZE, DEFAULT_SECTOR_LIGHT } from '../core';
import type {
  MapData,
  DoorSpec,
  LiftSpec,
  TeleporterSpec,
  ExitSpec,
  ThingSpec,
  TriggerSpec,
  DoorKind,
  ExitKind,
  KeyColor,
  TriggerKind,
} from '../core';

/** Per-cell style. `wall` truthy makes the cell solid; floor/ceil are flat names. */
export interface CellDef {
  wall?: string;
  floor?: string;
  ceil?: string | null; // null = open sky
  floorH?: number; // floor tier (map units)
  ceilH?: number; // ceiling tier (map units)
  light?: number; // sector light 0..255
}

/** Inclusive rectangular override applied after the ASCII pass (no wall changes). */
export interface PaintRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  floor?: string;
  ceil?: string | null;
  floorH?: number;
  ceilH?: number;
  light?: number;
}

export interface TrigDef {
  kind: TriggerKind;
  x: number;
  y: number;
  once?: boolean;
  tag?: number;
}

export interface DoorDef {
  x: number;
  y: number;
  texture: string;
  kind?: DoorKind;
  key?: KeyColor;
  speed?: number;
  waitTics?: number;
}

export interface LiftDef {
  cells: Array<{ x: number; y: number }>;
  low: number;
  high: number;
  speed?: number;
  waitTics?: number;
  trigger: TrigDef;
}

/** Teleporter destination is given in CELL coords; compile() centres it in mu. */
export interface TeleDef {
  trigger: TrigDef;
  destX: number;
  destY: number;
  destAngle: number; // degrees
}

export interface ExitDef {
  kind?: ExitKind;
  trigger: TrigDef;
}

/** A thing placed in CELL coords; compile() centres it in map units. */
export interface ThingDef {
  id: number; // DoomEd id
  x: number;
  y: number;
  angle?: number; // degrees (default 0)
  skill?: number; // MTF bitmask 1|2|4 (default 7 = all skills)
}

export interface StartDef {
  x: number;
  y: number;
  angle: number; // degrees
}

export interface Blueprint {
  id: string;
  name: string;
  par: number;
  sky: string;
  music?: string;
  base: CellDef; // applied to every cell before the legend override
  legend: Record<string, CellDef>; // char → overrides
  rows: string[]; // floor plan; rows must be equal length
  paint?: PaintRect[];
  doors?: DoorDef[];
  lifts?: LiftDef[];
  teleporters?: TeleDef[];
  exits?: ExitDef[];
  secrets?: Array<{ x: number; y: number }>;
  things?: ThingDef[];
  start: StartDef;
}

const DOOR_SPEED = 0.04; // open fraction per tic (~25 tics to open)
const DOOR_WAIT = 150; // tics open before auto-close (~4.3 s)
const LIFT_SPEED = 4; // map units per tic
const LIFT_WAIT = 105; // tics at the bottom (~3 s)

/** Centre of a cell in map units. */
function centre(cell: number, cellSize: number): number {
  return cell * cellSize + cellSize / 2;
}

/** Enumerate every cell in an inclusive rectangle — handy for lift spans + secrets. */
export function cells(x0: number, y0: number, x1: number, y1: number): Array<{ x: number; y: number }> {
  const out: Array<{ x: number; y: number }> = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) out.push({ x, y });
  return out;
}

class TextureTable {
  readonly names: string[] = [];
  private readonly index = new Map<string, number>();
  /** Returns a 1-based wall id (0 means "no wall"). */
  wallId(name: string): number {
    return this.intern(name) + 1;
  }
  /** Returns a 0-based flat id (floors/ceilings index directly). */
  flatId(name: string): number {
    return this.intern(name);
  }
  private intern(name: string): number {
    const existing = this.index.get(name);
    if (existing !== undefined) return existing;
    const id = this.names.length;
    this.index.set(name, id);
    this.names.push(name);
    return id;
  }
}

function trigger(t: TrigDef): TriggerSpec {
  return { kind: t.kind, x: t.x, y: t.y, once: t.once ?? true, tag: t.tag };
}

/** Compile a Blueprint into a frozen-schema MapData. Throws on a ragged grid or an
 *  unknown legend character so authoring mistakes surface at module load. */
export function compile(bp: Blueprint): MapData {
  const cellSize = CELL_SIZE;
  const height = bp.rows.length;
  const width = bp.rows[0]?.length ?? 0;
  if (width === 0 || height === 0) throw new Error(`${bp.id}: empty grid`);

  const n = width * height;
  const walls = new Array<number>(n).fill(0);
  const floors = new Array<number>(n).fill(0);
  const ceilings = new Array<number>(n).fill(0);
  const floorHeights = new Array<number>(n).fill(0);
  const ceilHeights = new Array<number>(n).fill(0);
  const light = new Array<number>(n).fill(0);

  const wallTex = new TextureTable();
  const flatTex = new TextureTable();

  for (let y = 0; y < height; y++) {
    const row = bp.rows[y]!;
    if (row.length !== width) throw new Error(`${bp.id}: row ${y} width ${row.length} ≠ ${width}`);
    for (let x = 0; x < width; x++) {
      const ch = row[x]!;
      const over = bp.legend[ch];
      if (!over) throw new Error(`${bp.id}: no legend for '${ch}' at (${x},${y})`);
      const def: CellDef = { ...bp.base, ...over };
      const idx = y * width + x;
      if (def.wall) walls[idx] = wallTex.wallId(def.wall);
      floors[idx] = flatTex.flatId(def.floor ?? 'FLAT5_4');
      ceilings[idx] = def.ceil === null ? -1 : flatTex.flatId(def.ceil ?? 'CEIL1_1');
      floorHeights[idx] = def.floorH ?? 0;
      ceilHeights[idx] = def.ceilH ?? 128;
      light[idx] = def.light ?? DEFAULT_SECTOR_LIGHT;
    }
  }

  for (const r of bp.paint ?? []) {
    for (let y = r.y0; y <= r.y1; y++) {
      for (let x = r.x0; x <= r.x1; x++) {
        const idx = y * width + x;
        if (r.floor !== undefined) floors[idx] = flatTex.flatId(r.floor);
        if (r.ceil !== undefined) ceilings[idx] = r.ceil === null ? -1 : flatTex.flatId(r.ceil);
        if (r.floorH !== undefined) floorHeights[idx] = r.floorH;
        if (r.ceilH !== undefined) ceilHeights[idx] = r.ceilH;
        if (r.light !== undefined) light[idx] = r.light;
      }
    }
  }

  const doors: DoorSpec[] = (bp.doors ?? []).map((d) => {
    walls[d.y * width + d.x] = wallTex.wallId(d.texture); // door face renders as a wall
    return {
      x: d.x,
      y: d.y,
      kind: d.kind ?? 'normal',
      key: d.key,
      speed: d.speed ?? DOOR_SPEED,
      waitTics: d.waitTics ?? DOOR_WAIT,
      texture: d.texture,
    };
  });

  const lifts: LiftSpec[] = (bp.lifts ?? []).map((l) => ({
    cells: l.cells,
    lowHeight: l.low,
    highHeight: l.high,
    speed: l.speed ?? LIFT_SPEED,
    waitTics: l.waitTics ?? LIFT_WAIT,
    trigger: trigger(l.trigger),
  }));

  const teleporters: TeleporterSpec[] = (bp.teleporters ?? []).map((t) => ({
    trigger: trigger(t.trigger),
    destX: centre(t.destX, cellSize),
    destY: centre(t.destY, cellSize),
    destAngle: t.destAngle,
  }));

  const exits: ExitSpec[] = (bp.exits ?? []).map((e) => ({
    kind: e.kind ?? 'normal',
    trigger: trigger(e.trigger),
  }));

  const secretSectors = (bp.secrets ?? []).map((s) => s.y * width + s.x);

  const things: ThingSpec[] = (bp.things ?? []).map((t) => ({
    id: t.id,
    x: centre(t.x, cellSize),
    y: centre(t.y, cellSize),
    angle: t.angle ?? 0,
    skill: t.skill ?? 7,
  }));

  return {
    id: bp.id,
    name: bp.name,
    width,
    height,
    cellSize,
    walls,
    floors,
    ceilings,
    floorHeights,
    ceilHeights,
    light,
    wallTextures: wallTex.names,
    flatTextures: flatTex.names,
    sky: bp.sky,
    doors,
    lifts,
    teleporters,
    exits,
    secretSectors,
    things,
    playerStart: { x: centre(bp.start.x, cellSize), y: centre(bp.start.y, cellSize), angle: bp.start.angle },
    par: bp.par,
    music: bp.music,
  };
}
