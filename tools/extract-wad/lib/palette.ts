// PLAYPAL palette 0 (assets.md §3.3). 256 RGB triples = 768 bytes. Index 0 is
// pure black, NOT a transparency key — transparency comes from the picture format.
import type { WadFile } from './wad.ts';

/** 256*3 bytes: [r,g,b] per palette index. */
export type Palette = Buffer;

export function readPalette(wad: WadFile): Palette {
  const data = wad.lump('PLAYPAL');
  if (!data) throw new Error('PLAYPAL lump not found');
  if (data.length < 768) throw new Error(`PLAYPAL too small: ${data.length}`);
  return data.subarray(0, 768);
}
