// Music extraction: WAD music lumps (D_*) → web-playable WAV. Each lump is read as a
// Standard MIDI File (Freedoom ships MIDI) — or converted from MUS first for original
// Doom WADs — then rendered offline by the oscillator synth (synth.ts). The runtime
// (src/audio AudioManager) loads these WAVs and loops them on the music bus.
import type { WadFile } from './wad.ts';
import { isMus, musToMidi } from './mus2mid.ts';
import { parseMidi } from './midi.ts';
import { renderToPcm, floatToWav } from './synth.ts';

/** Mono render rate — half-CD quality keeps tracks small while staying clearly audible. */
export const MUSIC_RATE = 22050;

export interface MusicTrack {
  id: string;
  wav: Buffer;
  durationSec: number;
}

function toMidi(lump: Buffer): Buffer {
  if (isMus(lump)) return musToMidi(lump);
  if (lump.toString('ascii', 0, 4) === 'MThd') return lump;
  throw new Error('lump is neither MIDI (MThd) nor MUS');
}

/** Render the requested track ids found in `wad`. Missing/undecodable ids are skipped
 *  (collected in `missing`) so one bad lump never aborts the whole extraction. */
export function extractMusic(
  wad: WadFile,
  trackIds: string[],
): { tracks: MusicTrack[]; missing: string[] } {
  const tracks: MusicTrack[] = [];
  const missing: string[] = [];
  for (const id of trackIds) {
    const lump = wad.lump(id);
    if (!lump || lump.length < 4) {
      missing.push(id);
      continue;
    }
    try {
      const song = parseMidi(toMidi(lump));
      if (song.notes.length === 0) {
        missing.push(id);
        continue;
      }
      tracks.push({ id, wav: floatToWav(MUSIC_RATE, renderToPcm(song, MUSIC_RATE)), durationSec: song.durationSec });
    } catch {
      missing.push(id);
    }
  }
  return { tracks, missing };
}
