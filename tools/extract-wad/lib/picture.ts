// Doom picture (patch) format decoder (assets.md §3.5). Sprites, wall patches,
// UI graphics and font glyphs all use it. Pixels not covered by a post stay fully
// transparent (alpha 0) — no colour-keying. Handles the tall-patch relative-delta
// edge case defensively (post topdelta <= previous => cumulative).
import type { Palette } from './palette.ts';

export interface DecodedPicture {
  width: number;
  height: number;
  left: number; // leftoffset (draw hotspot X)
  top: number; // topoffset (draw hotspot Y)
  rgba: Uint8Array; // width*height*4, RGBA
}

export function decodePicture(data: Buffer, pal: Palette): DecodedPicture {
  const width = data.readInt16LE(0);
  const height = data.readInt16LE(2);
  const left = data.readInt16LE(4);
  const top = data.readInt16LE(6);

  if (width <= 0 || height <= 0 || width > 4096 || height > 4096) {
    throw new Error(`Bad picture dimensions ${width}x${height}`);
  }

  const rgba = new Uint8Array(width * height * 4); // alpha defaults to 0
  for (let x = 0; x < width; x++) {
    let colOff = data.readUInt32LE(8 + x * 4);
    let lastRow = -1;
    while (colOff < data.length) {
      const topdelta = data.readUInt8(colOff);
      if (topdelta === 0xff) break;
      const len = data.readUInt8(colOff + 1);
      const rowStart = topdelta <= lastRow ? lastRow + topdelta : topdelta;
      lastRow = rowStart + len;
      colOff += 3; // skip topdelta, length, and the leading pad byte
      for (let i = 0; i < len; i++) {
        const palIdx = data.readUInt8(colOff + i);
        const y = rowStart + i;
        if (y >= 0 && y < height) {
          const o = (y * width + x) * 4;
          rgba[o] = pal[palIdx * 3]!;
          rgba[o + 1] = pal[palIdx * 3 + 1]!;
          rgba[o + 2] = pal[palIdx * 3 + 2]!;
          rgba[o + 3] = 255;
        }
      }
      colOff += len + 1; // skip pixels + trailing pad byte
    }
  }

  return { width, height, left, top, rgba };
}
