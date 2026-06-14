// LevelRuntime — implements the ILevelRuntime contract (src/core). Holds the loaded
// MapData plus dynamic state (door open amounts). Grid accessors are wired (cheap
// reads); door animation is driven by src/world/doors. (x,y) are cell coordinates.
import type { ILevelRuntime, MapData } from '../core';

export class LevelRuntime implements ILevelRuntime {
  readonly data: MapData;
  private readonly doorCells: Set<number>;
  private readonly doorOpen: Map<number, number>; // cell index → 0 (closed) .. 1 (open)

  constructor(data: MapData) {
    this.data = data;
    this.doorCells = new Set(data.doors.map((d) => this.idx(d.x, d.y)));
    this.doorOpen = new Map();
    for (const cell of this.doorCells) this.doorOpen.set(cell, 0);
  }

  private idx(cx: number, cy: number): number {
    return cy * this.data.width + cx;
  }

  private inBounds(cx: number, cy: number): boolean {
    return cx >= 0 && cy >= 0 && cx < this.data.width && cy < this.data.height;
  }

  isSolid(cx: number, cy: number): boolean {
    if (!this.inBounds(cx, cy)) return true;
    const wall = this.data.walls[this.idx(cx, cy)] ?? 0;
    if (wall === 0) return false;
    if (this.doorCells.has(this.idx(cx, cy))) return this.doorOpenAt(cx, cy) < 1;
    return true;
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
    return this.inBounds(cx, cy) ? (this.data.floorHeights[this.idx(cx, cy)] ?? 0) : 0;
  }

  ceilHeightAt(cx: number, cy: number): number {
    return this.inBounds(cx, cy) ? (this.data.ceilHeights[this.idx(cx, cy)] ?? 0) : 0;
  }

  lightAt(cx: number, cy: number): number {
    return this.inBounds(cx, cy) ? (this.data.light[this.idx(cx, cy)] ?? 0) : 0;
  }

  doorOpenAt(cx: number, cy: number): number {
    return this.doorOpen.get(this.idx(cx, cy)) ?? 1;
  }

  /** Set a door's open amount (called by the door animation system). */
  setDoorOpen(cx: number, cy: number, amount: number): void {
    if (this.doorCells.has(this.idx(cx, cy))) this.doorOpen.set(this.idx(cx, cy), amount);
  }

  isDoor(cx: number, cy: number): boolean {
    return this.doorCells.has(this.idx(cx, cy));
  }
}
