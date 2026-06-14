// MUS → Standard MIDI File conversion (assets.md §3.10, the classic mus2mid algorithm).
// Freedoom 0.13.0 ships its music as MIDI already, so this path is NOT exercised by our
// assets — it is here so the extractor stays correct for original Doom / PWAD music
// lumps, which use the MUS format. music.ts calls it only when a lump's magic is "MUS\x1a".
//
// MUS is a compact, Doom-specific cousin of MIDI: 16 channels (15 = percussion), events
// carry a 4-bit type + 4-bit channel and an optional trailing delay in 140 Hz ticks. We
// emit a format-0 MIDI with division 70 so the default 120 BPM tempo yields exactly
// 140 ticks/second, matching MUS playback.

const MUS_MAGIC = 'MUS\x1a';

// MUS "change controller" index → MIDI controller number (index 0 is a program change).
const CONTROLLER_MAP = [0, 0, 1, 7, 10, 11, 91, 93, 64, 67];
// MUS "system" controller (10..14) → MIDI controller number.
const SYSTEM_MAP: Record<number, number> = { 10: 120, 11: 123, 12: 126, 13: 127, 14: 121 };

export function isMus(buf: Buffer): boolean {
  return buf.length >= 4 && buf.toString('binary', 0, 4) === MUS_MAGIC;
}

/** MUS channel → MIDI channel: 15→9 (percussion), 9..14 shift up to free MIDI ch 9. */
function midiChannel(mus: number): number {
  if (mus === 15) return 9;
  if (mus >= 9) return mus + 1;
  return mus;
}

export function musToMidi(mus: Buffer): Buffer {
  if (!isMus(mus)) throw new Error('not a MUS lump');
  const scoreStart = mus.readUInt16LE(6);

  const track: number[] = [];
  const lastVol = new Array<number>(16).fill(100);
  let pendingDelta = 0;

  const writeVarLen = (value: number): void => {
    const bytes = [value & 0x7f];
    let v = value >> 7;
    while (v > 0) {
      bytes.unshift((v & 0x7f) | 0x80);
      v >>= 7;
    }
    track.push(...bytes);
  };
  const event = (...bytes: number[]): void => {
    writeVarLen(pendingDelta);
    pendingDelta = 0;
    track.push(...bytes);
  };

  let p = scoreStart;
  let done = false;
  while (p < mus.length && !done) {
    const desc = mus[p++]!;
    const type = (desc >> 4) & 0x07;
    const ch = midiChannel(desc & 0x0f);
    switch (type) {
      case 0: // release note
        event(0x80 | ch, mus[p++]! & 0x7f, 64);
        break;
      case 1: {
        // play note: bit7 = volume byte follows
        let note = mus[p++]!;
        if (note & 0x80) lastVol[ch] = mus[p++]! & 0x7f;
        note &= 0x7f;
        event(0x90 | ch, note, lastVol[ch]!);
        break;
      }
      case 2: {
        // pitch wheel: 8-bit → 14-bit MIDI bend
        const bend = (mus[p++]! & 0xff) << 6;
        event(0xe0 | ch, bend & 0x7f, (bend >> 7) & 0x7f);
        break;
      }
      case 3: {
        // system event → MIDI controller, value 0
        const ctrl = SYSTEM_MAP[mus[p++]! & 0x7f] ?? 0;
        event(0xb0 | ch, ctrl, 0);
        break;
      }
      case 4: {
        // change controller (index, value)
        const idx = mus[p++]! & 0x7f;
        const val = mus[p++]! & 0x7f;
        if (idx === 0) event(0xc0 | ch, val); // program change
        else event(0xb0 | ch, CONTROLLER_MAP[idx] ?? 0, val);
        break;
      }
      case 6: // score end
        done = true;
        break;
      case 5: // end of measure — no MIDI output
      case 7: // unused
        break;
    }
    if (desc & 0x80) {
      // trailing delay in MUS ticks
      let delay = 0;
      let b: number;
      do {
        b = mus[p++]!;
        delay = (delay << 7) | (b & 0x7f);
      } while (b & 0x80);
      pendingDelta += delay;
    }
  }
  // end-of-track meta
  writeVarLen(pendingDelta);
  track.push(0xff, 0x2f, 0x00);

  const header = Buffer.from([
    0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, 0, 70, // MThd, format 0, 1 track, div 70
    0x4d, 0x54, 0x72, 0x6b, // MTrk
  ]);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(track.length, 0);
  return Buffer.concat([header, len, Buffer.from(track)]);
}
