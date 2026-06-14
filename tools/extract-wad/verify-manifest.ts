// Quick headless check: loads public/manifest.json THROUGH the real AssetLoader
// (proving the src/assets loader runs in Node), then validates the manifest against
// the frozen schema, confirms every referenced asset file exists, and checks the
// src/data entity roster is fully covered.
//
// Usage: node --experimental-strip-types tools/extract-wad/verify-manifest.ts
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { SPRITE_ROSTER, REQUIRED_SOUNDS } from './lib/roster.ts';

// The real src/assets loader uses TS parameter properties, which Node's strip-only
// mode rejects, so bundle it with esbuild (a Vite dependency) and import the result.
// This runs the actual AssetLoader.loadManifest in Node — not a re-implementation.
async function loadRealAssetModule(): Promise<{ AssetStore: new () => unknown; AssetLoader: new (...a: unknown[]) => { loadManifest(u: string): Promise<unknown> } }> {
  const esbuild = await import('esbuild');
  const result = await esbuild.build({
    entryPoints: [resolve(process.cwd(), 'src/assets/index.ts')],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
  });
  const out = join(tmpdir(), `assets-bundle-${process.pid}.mjs`);
  writeFileSync(out, result.outputFiles[0]!.text);
  return import(pathToFileURL(out).href) as never;
}

const PUBLIC = resolve(process.cwd(), 'public');
const ASSETS = join(PUBLIC, 'assets');
const MANIFEST = join(PUBLIC, 'manifest.json');

const errors: string[] = [];
function check(cond: boolean, msg: string): void {
  if (!cond) errors.push(msg);
}

function assetPath(rel: string): string {
  return join(ASSETS, rel);
}

function fileExists(rel: string, label: string): void {
  check(existsSync(assetPath(rel)), `missing file for ${label}: ${rel}`);
}

// Shim fetch so the browser-oriented loader can read the manifest in Node.
(globalThis as unknown as { fetch: unknown }).fetch = async (u: unknown) => ({
  ok: true,
  status: 200,
  async json() {
    return JSON.parse(readFileSync(MANIFEST, 'utf8'));
  },
});

async function main(): Promise<void> {
  if (!existsSync(MANIFEST)) {
    console.error(`manifest not found at ${MANIFEST} — run \`npm run extract-assets\` first.`);
    process.exit(1);
  }

  const { AssetStore, AssetLoader } = await loadRealAssetModule();
  const store = new AssetStore();
  const loader = new AssetLoader(store, {});
  const m = await loader.loadManifest('/manifest.json') as any;

  // ── meta ──────────────────────────────────────────────────────────────
  check(m.meta.source === 'freedoom2.wad', 'meta.source != freedoom2.wad');
  check(m.meta.freedoomVersion === '0.13.0', 'meta.freedoomVersion != 0.13.0');
  check(typeof m.meta.license === 'string' && m.meta.license.includes('BSD'), 'meta.license bad');
  check(typeof m.meta.attribution === 'string', 'meta.attribution missing');
  fileExists(m.meta.attribution, 'attribution');
  check(existsSync(assetPath('palette.json')), 'palette.json missing');
  const pal = JSON.parse(readFileSync(assetPath('palette.json'), 'utf8'));
  check(Array.isArray(pal) && pal.length === 256, `palette.json should have 256 entries, got ${pal.length}`);

  // ── textures / flats ──────────────────────────────────────────────────
  for (const [id, e] of Object.entries(m.textures)) {
    check(e.w > 0 && e.h > 0, `texture ${id} bad dims`);
    fileExists(e.path, `texture ${id}`);
  }
  for (const [id, e] of Object.entries(m.flats)) {
    check(e.w === 64 && e.h === 64, `flat ${id} not 64x64`);
    fileExists(e.path, `flat ${id}`);
  }

  // ── sprites (per-frame offsets + mirror) ────────────────────────────────
  let frameCount = 0;
  for (const [prefix, set] of Object.entries(m.sprites)) {
    check(typeof set.entity === 'string' && set.entity.length > 0, `sprite ${prefix} no entity`);
    check(Object.keys(set.frames).length > 0, `sprite ${prefix} has no frames`);
    for (const [key, f] of Object.entries(set.frames)) {
      frameCount++;
      check(Array.isArray(f.origin) && f.origin.length === 2, `frame ${prefix}${key} bad origin`);
      check(typeof f.mirror === 'boolean', `frame ${prefix}${key} bad mirror`);
      check(f.w > 0 && f.h > 0, `frame ${prefix}${key} bad dims`);
      fileExists(f.path, `frame ${prefix}${key}`);
    }
  }

  // ── ui / fonts ──────────────────────────────────────────────────────────
  for (const [id, e] of Object.entries(m.ui)) {
    check(Array.isArray(e.origin) && e.origin.length === 2, `ui ${id} bad origin`);
    fileExists(e.path, `ui ${id}`);
  }
  let glyphCount = 0;
  for (const [fontKey, font] of Object.entries(m.fonts)) {
    check(typeof font.lumpRange === 'string', `font ${fontKey} no lumpRange`);
    check(typeof font.space === 'number', `font ${fontKey} no space`);
    for (const [code, g] of Object.entries(font.glyphs)) {
      glyphCount++;
      fileExists(g.path, `glyph ${fontKey}#${code}`);
    }
  }

  // ── sounds ──────────────────────────────────────────────────────────────
  for (const [id, s] of Object.entries(m.sounds)) {
    check(s.format === 'wav' || s.format === 'ogg', `sound ${id} bad format`);
    check(s.channels === 1, `sound ${id} not mono`);
    fileExists(s.path, `sound ${id}`);
  }

  // ── roster coverage (src/data) ──────────────────────────────────────────
  const missingSprites = SPRITE_ROSTER.filter((r) => !m.sprites[r.prefix]).map((r) => r.prefix);
  for (const p of missingSprites) errors.push(`roster sprite prefix not in manifest: ${p}`);
  const missingSounds = REQUIRED_SOUNDS.filter((s) => !m.sounds[s]);
  for (const s of missingSounds) errors.push(`required sound not in manifest: ${s}`);

  // ── total size ──────────────────────────────────────────────────────────
  let bytes = 0;
  const walk = (rel: string): void => {
    const p = assetPath(rel);
    if (!existsSync(p)) return;
    bytes += statSync(p).size;
  };
  for (const e of Object.values(m.textures)) walk(e.path);
  for (const e of Object.values(m.flats)) walk(e.path);
  for (const set of Object.values(m.sprites)) for (const f of Object.values(set.frames)) walk(f.path);
  for (const e of Object.values(m.ui)) walk(e.path);
  for (const font of Object.values(m.fonts)) for (const g of Object.values(font.glyphs)) walk(g.path);
  for (const s of Object.values(m.sounds)) walk(s.path);

  const sampleSound = Object.values(m.sounds)[0];
  console.log('── manifest verification ──');
  console.log(`loaded via AssetLoader.loadManifest: OK`);
  console.log(`textures:    ${Object.keys(m.textures).length}`);
  console.log(`flats:       ${Object.keys(m.flats).length}`);
  console.log(`sprite sets: ${Object.keys(m.sprites).length} (${frameCount} frames)`);
  console.log(`ui graphics: ${Object.keys(m.ui).length}`);
  console.log(`font glyphs: ${glyphCount}`);
  console.log(`sounds:      ${Object.keys(m.sounds).length} (format: ${sampleSound?.format})`);
  console.log(`total asset size: ${(bytes / 1024 / 1024).toFixed(2)} MiB`);

  if (errors.length) {
    console.error(`\nFAILED — ${errors.length} problem(s):`);
    for (const e of errors.slice(0, 40)) console.error(`  • ${e}`);
    process.exit(1);
  }
  console.log('\nAll checks passed — schema-valid, files present, roster fully covered.');
}

main();
