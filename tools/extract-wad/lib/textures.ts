// PNAMES + TEXTURE1 → composited wall textures (assets.md §3.6). A texture is a
// recipe: patches blitted onto a transparent canvas at given offsets.
import type { WadFile, Lump } from './wad.ts';
import type { Palette } from './palette.ts';
import { decodePicture } from './picture.ts';

export interface TexturePatchRef {
  originX: number;
  originY: number;
  patchIndex: number; // into PNAMES
}

export interface TextureDef {
  name: string;
  width: number;
  height: number;
  patches: TexturePatchRef[];
}

export function readPnames(wad: WadFile): string[] {
  const d = wad.lump('PNAMES');
  if (!d) throw new Error('PNAMES lump not found');
  const count = d.readInt32LE(0);
  const names: string[] = [];
  for (let i = 0; i < count; i++) {
    const o = 4 + i * 8;
    names.push(d.toString('ascii', o, o + 8).replace(/\0.*$/, '').toUpperCase());
  }
  return names;
}

/** Read TEXTURE1 (and TEXTURE2 if present) into texture definitions. */
export function readTextureDefs(wad: WadFile): TextureDef[] {
  const defs: TextureDef[] = [];
  for (const lumpName of ['TEXTURE1', 'TEXTURE2']) {
    const d = wad.lump(lumpName);
    if (!d) continue;
    const num = d.readInt32LE(0);
    for (let i = 0; i < num; i++) {
      const recOff = d.readInt32LE(4 + i * 4);
      const name = d.toString('ascii', recOff, recOff + 8).replace(/\0.*$/, '').toUpperCase();
      const width = d.readInt16LE(recOff + 12);
      const height = d.readInt16LE(recOff + 14);
      const patchCount = d.readInt16LE(recOff + 20);
      const patches: TexturePatchRef[] = [];
      for (let p = 0; p < patchCount; p++) {
        const po = recOff + 22 + p * 10;
        patches.push({
          originX: d.readInt16LE(po),
          originY: d.readInt16LE(po + 2),
          patchIndex: d.readInt16LE(po + 4),
        });
      }
      defs.push({ name, width, height, patches });
    }
  }
  return defs;
}

/** Map every wall-patch name (P_ namespace) to its lump for fast lookup. */
export function buildPatchMap(wad: WadFile): Map<string, Lump> {
  const map = new Map<string, Lump>();
  for (const l of wad.between('P_START', 'P_END')) {
    if (l.size > 0 && !map.has(l.name)) map.set(l.name, l);
  }
  return map;
}

export interface CompositedTexture {
  width: number;
  height: number;
  rgba: Uint8Array;
}

export function compositeTexture(
  def: TextureDef,
  pnames: string[],
  patchMap: Map<string, Lump>,
  wad: WadFile,
  pal: Palette,
): CompositedTexture {
  const rgba = new Uint8Array(def.width * def.height * 4); // transparent base
  for (const ref of def.patches) {
    const pname = pnames[ref.patchIndex];
    if (!pname) continue;
    const lump = patchMap.get(pname);
    const patchData = lump ? wad.data(lump) : wad.lump(pname);
    if (!patchData) continue;
    let pic;
    try {
      pic = decodePicture(patchData, pal);
    } catch {
      continue;
    }
    for (let y = 0; y < pic.height; y++) {
      const dy = ref.originY + y;
      if (dy < 0 || dy >= def.height) continue;
      for (let x = 0; x < pic.width; x++) {
        const so = (y * pic.width + x) * 4;
        if (pic.rgba[so + 3] === 0) continue;
        const dx = ref.originX + x;
        if (dx < 0 || dx >= def.width) continue;
        const dstOff = (dy * def.width + dx) * 4;
        rgba[dstOff] = pic.rgba[so]!;
        rgba[dstOff + 1] = pic.rgba[so + 1]!;
        rgba[dstOff + 2] = pic.rgba[so + 2]!;
        rgba[dstOff + 3] = 255;
      }
    }
  }
  return { width: def.width, height: def.height, rgba };
}
