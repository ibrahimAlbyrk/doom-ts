// WAD container reader (assets.md §3.1-§3.2). Reads the header + directory and
// walks lumps in order so marker namespaces (S_/F_/P_) can be tracked.
import { readFileSync } from 'node:fs';

export interface Lump {
  name: string;
  offset: number;
  size: number;
  index: number;
}

export class WadFile {
  readonly buf: Buffer;
  readonly lumps: Lump[] = [];
  private readonly firstByName = new Map<string, number>();

  constructor(path: string) {
    this.buf = readFileSync(path);
    const magic = this.buf.toString('ascii', 0, 4);
    if (magic !== 'IWAD' && magic !== 'PWAD') {
      throw new Error(`Not a WAD (magic="${magic}") at ${path}`);
    }
    const numLumps = this.buf.readInt32LE(4);
    const dirOffset = this.buf.readInt32LE(8);
    for (let i = 0; i < numLumps; i++) {
      const o = dirOffset + i * 16;
      const offset = this.buf.readInt32LE(o);
      const size = this.buf.readInt32LE(o + 4);
      const name = this.buf
        .toString('ascii', o + 8, o + 16)
        .replace(/\0.*$/, '')
        .toUpperCase();
      this.lumps.push({ name, offset, size, index: i });
      if (!this.firstByName.has(name)) this.firstByName.set(name, i);
    }
  }

  data(lump: Lump): Buffer {
    return this.buf.subarray(lump.offset, lump.offset + lump.size);
  }

  /** First lump with this name, or null. */
  lump(name: string): Buffer | null {
    const i = this.firstByName.get(name.toUpperCase());
    if (i === undefined) return null;
    const l = this.lumps[i]!;
    return this.buf.subarray(l.offset, l.offset + l.size);
  }

  has(name: string): boolean {
    return this.firstByName.has(name.toUpperCase());
  }

  /** Non-marker lumps strictly between the start and end markers, in order. */
  between(startMarker: string, endMarker: string): Lump[] {
    const out: Lump[] = [];
    let inside = false;
    for (const l of this.lumps) {
      if (l.name === startMarker) {
        inside = true;
        continue;
      }
      if (l.name === endMarker) {
        inside = false;
        continue;
      }
      if (inside) out.push(l);
    }
    return out;
  }
}
