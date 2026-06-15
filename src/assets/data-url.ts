// Decode an inlined base64 `data:` URL to raw bytes WITHOUT any fetch/network API.
//
// The self-contained itch build inlines every asset as a `data:<mime>;base64,…` URL
// (embed-assets.ts). Decoding those with `fetch(dataURL)` trips the embedding host's
// Content-Security-Policy: `connect-src` governs fetch(), and a `connect-src *` policy
// does NOT cover the `data:` scheme — so the browser refuses the load
// ("Refused to connect … violates the document's Content Security Policy"). atob() is a
// pure in-memory string decode that opens no connection, so it is exempt from
// connect-src entirely. Callers branch on isDataUrl(): data: URLs decode here (itch
// build, zero fetches); real http(s) paths keep using fetch() (default build, unchanged).

export interface DecodedDataUrl {
  mime: string;
  // Backed by a fresh ArrayBuffer (not SharedArrayBuffer) so the bytes drop straight into
  // a Blob (createImageBitmap) or `.buffer` into decodeAudioData with no copy or cast.
  bytes: Uint8Array<ArrayBuffer>;
}

/** True for an inlined `data:` URL (itch build), false for an http(s) asset path. */
export function isDataUrl(url: string): boolean {
  return url.startsWith('data:');
}

/** Split a `data:<mime>;base64,<payload>` URL into its mime + decoded bytes via atob. */
export function parseDataUrl(url: string): DecodedDataUrl {
  const comma = url.indexOf(',');
  if (!isDataUrl(url) || comma === -1) {
    throw new Error('parseDataUrl: not a base64 data: URL');
  }
  const mime = url.slice(5, comma).split(';')[0] || 'application/octet-stream';
  const binary = atob(url.slice(comma + 1));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return { mime, bytes };
}
