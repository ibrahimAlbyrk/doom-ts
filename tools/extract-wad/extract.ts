// Freedoom WAD → web assets + manifest (assets.md §3-§5). Headless Node/TS, no
// native deps. Reads freedoom2.wad, applies PLAYPAL[0], and emits public/assets/**
// (RGBA PNG art + WAV sfx + palette.json + THIRD-PARTY license) plus a schema-valid
// public/manifest.json (AssetManifest in src/assets/manifest.ts).
//
// Usage: npm run extract-assets [-- --wad path/to/freedoom2.wad]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type {
  AssetManifest,
  SpriteSet,
  SpriteFrameEntry,
  UiEntry,
  GlyphEntry,
  SoundEntry,
} from '../../src/assets/manifest.ts';
import { WadFile } from './lib/wad.ts';
import { readPalette } from './lib/palette.ts';
import { decodePicture } from './lib/picture.ts';
import { encodePng } from './lib/png.ts';
import {
  readPnames,
  readTextureDefs,
  buildPatchMap,
  compositeTexture,
} from './lib/textures.ts';
import { decodeDmx, encodeWav } from './lib/sound.ts';
import {
  SPRITE_ROSTER,
  REQUIRED_SOUNDS,
  MUSIC_TRACKS,
  isUiLump,
  fontLumpName,
  FONT_FIRST_CODE,
  FONT_LAST_CODE,
} from './lib/roster.ts';
import { extractMusic, MUSIC_RATE } from './lib/music.ts';
import { FREEDOOM_LICENSE } from './lib/license.ts';

const FREEDOOM_VERSION = '0.13.0';

function parseArgs(): { wad: string; musicWad: string } {
  const argv = process.argv.slice(2);
  const arg = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 && argv[i + 1] ? argv[i + 1]! : undefined;
  };
  const wad = arg('--wad') ?? 'tools/extract-wad/.cache/freedoom-0.13.0/freedoom2.wad';
  // ExMy episode music lives in freedoom1.wad — default to its sibling of the art WAD.
  const wadAbs = resolve(process.cwd(), wad);
  const musicWad = arg('--music-wad') ?? wadAbs.replace(/freedoom2\.wad$/i, 'freedoom1.wad');
  return { wad: wadAbs, musicWad: resolve(process.cwd(), musicWad) };
}

let bytesWritten = 0;
function write(path: string, data: Buffer | string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, data);
  bytesWritten += typeof data === 'string' ? Buffer.byteLength(data) : data.length;
}

interface Ctx {
  wad: WadFile;
  pal: Buffer;
  assetsDir: string;
}

// ── Palette ────────────────────────────────────────────────────────────────
function emitPalette(ctx: Ctx): void {
  const triples: Array<[number, number, number]> = [];
  for (let i = 0; i < 256; i++) {
    triples.push([ctx.pal[i * 3]!, ctx.pal[i * 3 + 1]!, ctx.pal[i * 3 + 2]!]);
  }
  write(join(ctx.assetsDir, 'palette.json'), JSON.stringify(triples));
}

// ── Flats (64×64, opaque) ────────────────────────────────────────────────────
function emitFlats(ctx: Ctx): AssetManifest['flats'] {
  const flats: AssetManifest['flats'] = {};
  for (const lump of ctx.wad.between('F_START', 'F_END')) {
    if (lump.size !== 4096) continue; // skip sub-markers + non-standard flats
    const raw = ctx.wad.data(lump);
    const rgba = new Uint8Array(64 * 64 * 4);
    for (let i = 0; i < 4096; i++) {
      const idx = raw[i]!;
      const o = i * 4;
      rgba[o] = ctx.pal[idx * 3]!;
      rgba[o + 1] = ctx.pal[idx * 3 + 1]!;
      rgba[o + 2] = ctx.pal[idx * 3 + 2]!;
      rgba[o + 3] = 255;
    }
    const rel = `flats/${lump.name}.png`;
    write(join(ctx.assetsDir, rel), encodePng(64, 64, rgba));
    flats[lump.name] = { path: rel, w: 64, h: 64 };
  }
  return flats;
}

// ── Wall textures (composited from PNAMES/TEXTURE1) ──────────────────────────
function emitTextures(ctx: Ctx): AssetManifest['textures'] {
  const textures: AssetManifest['textures'] = {};
  const pnames = readPnames(ctx.wad);
  const patchMap = buildPatchMap(ctx.wad);
  for (const def of readTextureDefs(ctx.wad)) {
    if (def.width <= 0 || def.height <= 0) continue;
    const tex = compositeTexture(def, pnames, patchMap, ctx.wad, ctx.pal);
    const rel = `textures/${def.name}.png`;
    write(join(ctx.assetsDir, rel), encodePng(tex.width, tex.height, tex.rgba));
    textures[def.name] = { path: rel, w: tex.width, h: tex.height };
  }
  return textures;
}

// ── Sprites (roster prefixes; preserve offsets + mirror packed lumps) ────────
function emitSprites(ctx: Ctx): { sprites: AssetManifest['sprites']; missing: string[] } {
  const sprites: AssetManifest['sprites'] = {};
  const missing: string[] = [];
  const spriteLumps = ctx.wad.between('S_START', 'S_END').filter((l) => l.size > 0);

  for (const { prefix, entity } of SPRITE_ROSTER) {
    const lumps = spriteLumps.filter(
      (l) => l.name.slice(0, 4) === prefix && (l.name.length === 6 || l.name.length === 8),
    );
    if (lumps.length === 0) {
      missing.push(prefix);
      continue;
    }
    const frames: Record<string, SpriteFrameEntry> = {};
    for (const lump of lumps) {
      const pic = decodePicture(ctx.wad.data(lump), ctx.pal);
      const rel = `sprites/${prefix}/${lump.name}.png`;
      write(join(ctx.assetsDir, rel), encodePng(pic.width, pic.height, pic.rgba));
      const origin: [number, number] = [pic.left, pic.top];
      const base = {
        path: rel,
        w: pic.width,
        h: pic.height,
        origin,
      };
      // chars: NNNN F R [F2 R2] — 8-char lumps pack a mirrored second view.
      frames[`${lump.name[4]}${lump.name[5]}`] = { ...base, mirror: false };
      if (lump.name.length === 8) {
        frames[`${lump.name[6]}${lump.name[7]}`] = { ...base, mirror: true };
      }
    }
    const set: SpriteSet = { entity, frames };
    sprites[prefix] = set;
  }
  return { sprites, missing };
}

// ── Status-bar / HUD graphics ────────────────────────────────────────────────
function emitUi(ctx: Ctx): AssetManifest['ui'] {
  const ui: AssetManifest['ui'] = {};
  // restrict to global-namespace lumps (outside sprite/flat/patch markers)
  const sprite = new Set(ctx.wad.between('S_START', 'S_END').map((l) => l.name));
  const flat = new Set(ctx.wad.between('F_START', 'F_END').map((l) => l.name));
  const patch = new Set(ctx.wad.between('P_START', 'P_END').map((l) => l.name));
  for (const lump of ctx.wad.lumps) {
    if (lump.size === 0 || !isUiLump(lump.name)) continue;
    if (sprite.has(lump.name) || flat.has(lump.name) || patch.has(lump.name)) continue;
    let pic;
    try {
      pic = decodePicture(ctx.wad.data(lump), ctx.pal);
    } catch {
      continue;
    }
    const rel = `ui/${lump.name}.png`;
    write(join(ctx.assetsDir, rel), encodePng(pic.width, pic.height, pic.rgba));
    const entry: UiEntry = { path: rel, w: pic.width, h: pic.height, origin: [pic.left, pic.top] };
    ui[lump.name] = entry;
  }
  return ui;
}

// ── STCFN HUD font ───────────────────────────────────────────────────────────
function emitFont(ctx: Ctx): AssetManifest['fonts'] {
  const glyphs: Record<string, GlyphEntry> = {};
  for (let code = FONT_FIRST_CODE; code <= FONT_LAST_CODE; code++) {
    const data = ctx.wad.lump(fontLumpName(code));
    if (!data) continue;
    const pic = decodePicture(data, ctx.pal);
    const rel = `fonts/STCFN/${String(code).padStart(3, '0')}.png`;
    write(join(ctx.assetsDir, rel), encodePng(pic.width, pic.height, pic.rgba));
    glyphs[String(code)] = { path: rel, w: pic.width, h: pic.height };
  }
  return {
    hud: {
      lumpRange: `${fontLumpName(FONT_FIRST_CODE)}-${fontLumpName(FONT_LAST_CODE)}`,
      space: 4,
      glyphs,
    },
  };
}

// ── Sounds (all digital DS* lumps) ───────────────────────────────────────────
function emitSounds(ctx: Ctx): { sounds: AssetManifest['sounds']; missing: string[] } {
  const sounds: AssetManifest['sounds'] = {};
  for (const lump of ctx.wad.lumps) {
    if (!lump.name.startsWith('DS') || lump.size < 8) continue;
    const dmx = decodeDmx(ctx.wad.data(lump));
    if (!dmx) continue; // PC-speaker / non-digital → skip
    const rel = `audio/sfx/${lump.name}.wav`;
    write(join(ctx.assetsDir, rel), encodeWav(dmx.rate, dmx.samples));
    const entry: SoundEntry = { path: rel, rate: dmx.rate, channels: 1, format: 'wav' };
    sounds[lump.name] = entry;
  }
  const missing = REQUIRED_SOUNDS.filter((s) => !(s in sounds));
  return { sounds, missing };
}

// ── Music (D_* MIDI/MUS lumps → looping WAV + index) ─────────────────────────
// Rendered offline by the oscillator synth (lib/synth.ts). Emits a self-describing
// index.json the runtime AudioManager reads — kept separate from manifest.json so the
// frozen AssetManifest schema (which types music as OGG-only) is untouched.
function emitMusic(ctx: Ctx, musicWadPath: string): { count: number; missing: string[] } {
  // Episode music (D_E1Mx) is in freedoom1.wad; fall back to the art WAD if it has them.
  const sourceWad =
    existsSync(musicWadPath) && new WadFile(musicWadPath).has(MUSIC_TRACKS[0]!)
      ? new WadFile(musicWadPath)
      : ctx.wad;
  const { tracks, missing } = extractMusic(sourceWad, MUSIC_TRACKS);

  const index: { rate: number; tracks: Record<string, { path: string; durationSec: number }> } = {
    rate: MUSIC_RATE,
    tracks: {},
  };
  for (const t of tracks) {
    const rel = `audio/music/${t.id}.wav`;
    write(join(ctx.assetsDir, rel), t.wav);
    index.tracks[t.id] = { path: rel, durationSec: Math.round(t.durationSec * 100) / 100 };
  }
  write(join(ctx.assetsDir, 'audio/music/index.json'), JSON.stringify(index, null, 2));
  return { count: tracks.length, missing };
}

// ── Attribution (BSD notice + CREDITS) ───────────────────────────────────────
function emitAttribution(ctx: Ctx, wadPath: string): string {
  const rel = 'THIRD-PARTY/freedoom-LICENSE.txt';
  const creditsPath = join(dirname(wadPath), 'CREDITS.txt');
  let credits = '';
  if (existsSync(creditsPath)) {
    credits = '\n\n' + '='.repeat(72) + '\nFreedoom CREDITS\n' + '='.repeat(72) + '\n\n' +
      readFileSync(creditsPath, 'utf8');
  }
  write(join(ctx.assetsDir, rel), FREEDOOM_LICENSE + credits);
  return rel;
}

function main(): void {
  const { wad: wadPath, musicWad: musicWadPath } = parseArgs();
  if (!existsSync(wadPath)) {
    throw new Error(
      `freedoom2.wad not found at ${wadPath}. Download Freedoom 0.13.0 ` +
        `(see tools/extract-wad/README.md) or pass --wad <path>.`,
    );
  }
  const wad = new WadFile(wadPath);
  const pal = readPalette(wad);
  const assetsDir = resolve(process.cwd(), 'public/assets');
  const ctx: Ctx = { wad, pal, assetsDir };

  console.log(`Extracting ${wadPath} (${wad.lumps.length} lumps)`);
  emitPalette(ctx);
  const attribution = emitAttribution(ctx, wadPath);
  const flats = emitFlats(ctx);
  const textures = emitTextures(ctx);
  const { sprites, missing: missingSprites } = emitSprites(ctx);
  const ui = emitUi(ctx);
  const fonts = emitFont(ctx);
  const { sounds, missing: missingSounds } = emitSounds(ctx);
  const music = emitMusic(ctx, musicWadPath);

  const manifest: AssetManifest = {
    meta: {
      source: 'freedoom2.wad',
      freedoomVersion: FREEDOOM_VERSION,
      license: 'BSD-3-Clause (modified BSD)',
      attribution,
      palette: 'PLAYPAL[0]',
    },
    textures,
    flats,
    sprites,
    ui,
    fonts,
    sounds,
    music: {},
  };

  const manifestPath = resolve(process.cwd(), 'public/manifest.json');
  write(manifestPath, JSON.stringify(manifest, null, 2));

  // ── Summary ────────────────────────────────────────────────────────────
  const frameCount = Object.values(sprites).reduce((n, s) => n + Object.keys(s.frames).length, 0);
  const glyphCount = Object.keys(fonts.hud!.glyphs).length;
  console.log('\n── Extraction summary ──');
  console.log(`textures:    ${Object.keys(textures).length}`);
  console.log(`flats:       ${Object.keys(flats).length}`);
  console.log(`sprite sets: ${Object.keys(sprites).length} (${frameCount} frames)`);
  console.log(`ui graphics: ${Object.keys(ui).length}`);
  console.log(`font glyphs: ${glyphCount}`);
  console.log(`sounds:      ${Object.keys(sounds).length} (wav)`);
  console.log(`music:       ${music.count}/${MUSIC_TRACKS.length} tracks (wav @ ${MUSIC_RATE}Hz)`);
  console.log(`total size:  ${(bytesWritten / 1024 / 1024).toFixed(2)} MiB`);
  console.log(`manifest:    ${manifestPath}`);
  if (missingSprites.length) console.log(`MISSING sprite prefixes: ${missingSprites.join(', ')}`);
  if (missingSounds.length) console.log(`MISSING required sounds: ${missingSounds.join(', ')}`);
  if (music.missing.length) console.log(`MISSING music tracks: ${music.missing.join(', ')}`);
  console.log('\nsprite prefix → entity:');
  for (const { prefix, entity } of SPRITE_ROSTER) {
    const set = sprites[prefix];
    console.log(`  ${prefix} → ${entity}${set ? ` (${Object.keys(set.frames).length} frames)` : ' [MISSING]'}`);
  }
}

main();
