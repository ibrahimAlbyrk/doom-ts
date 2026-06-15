// Ambient type for the virtual module the embed-assets Vite plugin provides.
// Default build → `null`; build:itch → an EmbeddedAssets payload. Typed `unknown`
// here and narrowed in embedded.ts to avoid a circular type import.
declare module 'virtual:doom-embedded-assets' {
  const value: unknown;
  export default value;
}
