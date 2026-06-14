// DMX digitized sound (DS* lumps) → WAV (assets.md §3.9). DMX is unsigned 8-bit
// mono PCM with a small header; the first/last 16 sample bytes are padding. We
// trim the padding and re-encode as 16-bit signed PCM WAV (decodes everywhere via
// Web Audio decodeAudioData). PC-speaker (DP*) lumps are format 0 and skipped.
export interface DmxSound {
  rate: number;
  samples: Uint8Array; // trimmed, unsigned 8-bit
}

export function decodeDmx(data: Buffer): DmxSound | null {
  if (data.length < 8) return null;
  const format = data.readUInt16LE(0);
  if (format !== 3) return null; // not a digital DMX sound
  const rate = data.readUInt16LE(2);
  const declared = data.readUInt32LE(4);
  const available = data.length - 8;
  let n = Math.min(declared, available);
  let off = 8;
  if (n > 32) {
    off = 8 + 16; // trim 16 leading pad bytes
    n -= 32; // ...and 16 trailing
  }
  return { rate: rate || 11025, samples: data.subarray(off, off + n) };
}

/** Wrap unsigned-8-bit mono PCM as a 16-bit signed PCM WAV. */
export function encodeWav(rate: number, samples: Uint8Array): Buffer {
  const dataBytes = samples.length * 2;
  const buf = Buffer.alloc(44 + dataBytes);
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(36 + dataBytes, 4);
  buf.write('WAVE', 8, 'ascii');
  buf.write('fmt ', 12, 'ascii');
  buf.writeUInt32LE(16, 16); // fmt chunk size
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28); // byte rate (mono, 2 bytes/sample)
  buf.writeUInt16LE(2, 32); // block align
  buf.writeUInt16LE(16, 34); // bits per sample
  buf.write('data', 36, 'ascii');
  buf.writeUInt32LE(dataBytes, 40);
  for (let i = 0; i < samples.length; i++) {
    buf.writeInt16LE((samples[i]! - 128) << 8, 44 + i * 2);
  }
  return buf;
}
