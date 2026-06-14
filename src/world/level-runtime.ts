// LevelRuntime — implements the ILevelRuntime contract (src/core) and owns the
// loaded level's MUTABLE state: per-door open amounts + phase, per-lift floor
// tier + phase, and once-trigger bookkeeping. Grid accessors are cheap reads;
// the door/lift state machines that mutate this state live in src/world/doors.
// (x,y) are cell coordinates throughout.
import type { ILevelRuntime, MapData, DoorSpec, LiftSpec, ExitKind } from '../core';

export type DoorPhase = 'closed' | 'opening' | 'open' | 'closing';

export interface DoorRuntime {
  spec: DoorSpec;
  phase: DoorPhase;
  open: number; // 0 = closed .. 1 = fully open
  waitTimer: number; // tics left in the open phase before auto-close
}

export type LiftPhase = 'top' | 'lowering' | 'bottom' | 'raising';

export interface LiftRuntime {
  spec: LiftSpec;
  cells: number[]; // cell indices this lift spans
  phase: LiftPhase;
  height: number; // current floor tier (map units)
  waitTimer: number; // tics left at the bottom before raising
}

export class LevelRuntime implements ILevelRuntime {
  readonly data: MapData;
  readonly doors: DoorRuntime[];
  readonly lifts: LiftRuntime[];
  /** Set by a walkover exit trigger; the game reads + clears it. */
  pendingExit: ExitKind | null = null;

  private readonly doorByCell = new Map<number, DoorRuntime>();
  private readonly liftByCell = new Map<number, LiftRuntime>();
  private readonly fired = new Set<string>(); // once-triggers already consumed
  private readonly walkoverOccupancy = new Map<number, Set<string>>(); // entityId → walkover keys it currently stands on

  constructor(data: MapData) {
    this.data = data;
    this.doors = data.doors.map((spec) => ({ spec, phase: 'closed' as DoorPhase, open: 0, waitTimer: 0 }));
    for (const d of this.doors) this.doorByCell.set(this.idx(d.spec.x, d.spec.y), d);

    this.lifts = data.lifts.map((spec) => ({
      spec,
      cells: spec.cells.map((c) => this.idx(c.x, c.y)),
      phase: 'top' as LiftPhase,
      height: spec.highHeight,
      waitTimer: 0,
    }));
    for (const l of this.lifts) for (const cell of l.cells) this.liftByCell.set(cell, l);
  }

  private idx(cx: number, cy: number): number {
    return cy * this.data.width + cx;
  }

  private inBounds(cx: number, cy: number): boolean {
    return cx >= 0 && cy >= 0 && cx < this.data.width && cy < this.data.height;
  }

  isSolid(cx: number, cy: number): boolean {
    if (!this.inBounds(cx, cy)) return true;
    const door = this.doorByCell.get(this.idx(cx, cy));
    if (door) return door.open < 1; // door cell blocks until fully open
    return (this.data.walls[this.idx(cx, cy)] ?? 0) !== 0;
  }

  wallTextureAt(cx: number, cy: number): string | null {
    if (!this.inBounds(cx, cy)) return null;
    const wall = this.data.walls[this.idx(cx, cy)] ?? 0;
    return wall > 0 ? (this.data.wallTextures[wall - 1] ?? null) : null;
  }

  floorTextureAt(cx: number, cy: number): string {
    const id = this.inBounds(cx, cy) ? (this.data.floors[this.idx(cx, cy)] ?? 0) : 0;
    return this.data.flatTextures[id] ?? '';
  }

  ceilTextureAt(cx: number, cy: number): string | null {
    if (!this.inBounds(cx, cy)) return null;
    const id = this.data.ceilings[this.idx(cx, cy)] ?? -1;
    return id < 0 ? null : (this.data.flatTextures[id] ?? null);
  }

  floorHeightAt(cx: number, cy: number): number {
    if (!this.inBounds(cx, cy)) return 0;
    const lift = this.liftByCell.get(this.idx(cx, cy));
    if (lift) return lift.height; // animated tier overrides the static layer
    return this.data.floorHeights[this.idx(cx, cy)] ?? 0;
  }

  ceilHeightAt(cx: number, cy: number): number {
    return this.inBounds(cx, cy) ? (this.data.ceilHeights[this.idx(cx, cy)] ?? 0) : 0;
  }

  lightAt(cx: number, cy: number): number {
    return this.inBounds(cx, cy) ? (this.data.light[this.idx(cx, cy)] ?? 0) : 0;
  }

  doorOpenAt(cx: number, cy: number): number {
    const door = this.doorByCell.get(this.idx(cx, cy));
    return door ? door.open : 1; // non-door cells read as fully open
  }

  isDoor(cx: number, cy: number): boolean {
    return this.doorByCell.has(this.idx(cx, cy));
  }

  doorAt(cx: number, cy: number): DoorRuntime | undefined {
    return this.doorByCell.get(this.idx(cx, cy));
  }

  liftAt(cx: number, cy: number): LiftRuntime | undefined {
    return this.liftByCell.get(this.idx(cx, cy));
  }

  hasFired(kind: string, i: number): boolean {
    return this.fired.has(`${kind}:${i}`);
  }

  markFired(kind: string, i: number): void {
    this.fired.add(`${kind}:${i}`);
  }

  /** Edge-detect walkover triggers. Given the keys an entity's body overlaps this
   *  tic, record them and return only the ones it just *entered*, so a body parked
   *  on a repeatable trigger fires once per crossing — not every tic (otherwise a
   *  lift re-triggers each frame it rests on `top` and cycles forever). */
  walkoverEntries(entityId: number, currentKeys: readonly string[]): Set<string> {
    const prev = this.walkoverOccupancy.get(entityId);
    const entered = new Set<string>();
    for (const k of currentKeys) if (!prev?.has(k)) entered.add(k);
    this.walkoverOccupancy.set(entityId, new Set(currentKeys));
    return entered;
  }
}
