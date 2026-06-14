// Freedoom WAD extractor — PLACEHOLDER (asset worker fills this in).
// Runs under Node (outside the Vite/src tsc build). See ./README.md and
// docs/research/assets.md §3–§5 for the full pipeline + manifest schema.
//
// Usage: npm run extract-assets -- --wad path/to/freedoom2.wad

function main(): void {
  throw new Error(
    'NotImplemented: WAD extractor. Implement per docs/research/assets.md §3–§5 ' +
      'and emit public/manifest.json matching src/assets/manifest.ts.',
  );
}

main();
