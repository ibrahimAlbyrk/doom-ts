// Standard MIDI File (SMF) reader → a flat, time-sorted note list for the synth
// (synth.ts). Freedoom 0.13.0 ships its music lumps as real MIDI (MThd), so this is
// the path the extractor actually exercises; MUS lumps are pre-converted by mus2mid.ts.
//
// We merge every track's events into one absolute-tick stream, walk it once while
// tracking the tempo map (default 120 BPM until a Set-Tempo meta event), and pair
// note-on/off into notes carrying the channel's current program + volume.

export interface SynthNote {
  channel: number; // 0..15
  program: number; // GM program at note start (0..127)
  midiNote: number; // 0..127
  startSec: number;
  durSec: number;
  velocity: number; // 1..127
  channelVolume: number; // CC7 at note start (0..127)
  percussion: boolean; // MIDI channel 9
}

export interface MidiSong {
  notes: SynthNote[];
  durationSec: number;
}

const DEFAULT_TEMPO = 500000; // µs per quarter note (120 BPM) until a tempo event

interface RawEvent {
  tick: number;
  seq: number; // insertion order — stabilises same-tick ordering
  kind: 'noteOn' | 'noteOff' | 'program' | 'volume' | 'tempo' | 'end';
  channel: number;
  a: number; // note / program / CC value / tempo
  b: number; // velocity
}

class Reader {
  pos = 0;
  readonly buf: Buffer;
  constructor(buf: Buffer) {
    this.buf = buf;
  }
  u8(): number {
    return this.buf[this.pos++]!;
  }
  u16(): number {
    const v = this.buf.readUInt16BE(this.pos);
    this.pos += 2;
    return v;
  }
  u32(): number {
    const v = this.buf.readUInt32BE(this.pos);
    this.pos += 4;
    return v;
  }
  str(n: number): string {
    const s = this.buf.toString('ascii', this.pos, this.pos + n);
    this.pos += n;
    return s;
  }
  /** Variable-length quantity (7 bits/byte, high bit = continue). */
  vlq(): number {
    let v = 0;
    for (;;) {
      const b = this.u8();
      v = (v << 7) | (b & 0x7f);
      if ((b & 0x80) === 0) return v;
    }
  }
}

function parseTrack(r: Reader, end: number, seqStart: number, out: RawEvent[]): number {
  let tick = 0;
  let status = 0; // running status
  let seq = seqStart;
  while (r.pos < end) {
    tick += r.vlq();
    let b = r.buf[r.pos]!;
    if (b & 0x80) {
      status = b;
      r.pos++;
    } else if (status === 0) {
      r.pos++; // malformed — skip
      continue;
    }
    const hi = status & 0xf0;
    const ch = status & 0x0f;
    if (status === 0xff) {
      // meta event: type + length + bytes
      const type = r.u8();
      const len = r.vlq();
      if (type === 0x51 && len === 3) {
        const t = (r.buf[r.pos]! << 16) | (r.buf[r.pos + 1]! << 8) | r.buf[r.pos + 2]!;
        out.push({ tick, seq: seq++, kind: 'tempo', channel: 0, a: t, b: 0 });
      } else if (type === 0x2f) {
        out.push({ tick, seq: seq++, kind: 'end', channel: 0, a: 0, b: 0 });
      }
      r.pos += len;
      status = 0; // meta cancels running status
    } else if (status === 0xf0 || status === 0xf7) {
      const len = r.vlq();
      r.pos += len;
      status = 0; // sysex cancels running status
    } else if (hi === 0x90) {
      const note = r.u8();
      const vel = r.u8();
      out.push({ tick, seq: seq++, kind: vel > 0 ? 'noteOn' : 'noteOff', channel: ch, a: note, b: vel });
    } else if (hi === 0x80) {
      const note = r.u8();
      const vel = r.u8();
      out.push({ tick, seq: seq++, kind: 'noteOff', channel: ch, a: note, b: vel });
    } else if (hi === 0xb0) {
      const cc = r.u8();
      const val = r.u8();
      if (cc === 7 || cc === 11) out.push({ tick, seq: seq++, kind: 'volume', channel: ch, a: val, b: 0 });
    } else if (hi === 0xc0) {
      out.push({ tick, seq: seq++, kind: 'program', channel: ch, a: r.u8(), b: 0 });
    } else if (hi === 0xd0) {
      r.pos += 1; // channel pressure
    } else if (hi === 0xa0 || hi === 0xe0) {
      r.pos += 2; // poly aftertouch / pitch bend
    } else {
      r.pos += 1; // unknown — best-effort skip
    }
  }
  return seq;
}

export function parseMidi(buf: Buffer): MidiSong {
  const r = new Reader(buf);
  if (r.str(4) !== 'MThd') throw new Error('not a Standard MIDI File (missing MThd)');
  const headerLen = r.u32();
  r.u16(); // format
  const ntrks = r.u16();
  const division = r.u16();
  r.pos = 8 + headerLen;
  if (division & 0x8000) throw new Error('SMPTE time division not supported');

  const raw: RawEvent[] = [];
  let seq = 0;
  for (let t = 0; t < ntrks && r.pos + 8 <= buf.length; t++) {
    if (r.str(4) !== 'MTrk') break;
    const len = r.u32();
    seq = parseTrack(r, r.pos + len, seq, raw);
    r.pos = Math.min(r.pos, buf.length);
  }
  raw.sort((x, y) => x.tick - y.tick || x.seq - y.seq);

  // Walk in time order: integrate tempo, track per-channel program + volume, pair notes.
  const program = new Array<number>(16).fill(0);
  const volume = new Array<number>(16).fill(100);
  const active = new Map<number, { start: number; vel: number; prog: number; vol: number }>();
  const notes: SynthNote[] = [];
  let tempo = DEFAULT_TEMPO;
  let lastTick = 0;
  let sec = 0;

  const close = (key: number, endSec: number): void => {
    const a = active.get(key);
    if (!a) return;
    active.delete(key);
    const ch = key >> 7;
    notes.push({
      channel: ch,
      program: a.prog,
      midiNote: key & 0x7f,
      startSec: a.start,
      durSec: Math.max(0.02, endSec - a.start),
      velocity: a.vel,
      channelVolume: a.vol,
      percussion: ch === 9,
    });
  };

  for (const e of raw) {
    sec += (e.tick - lastTick) * (tempo / 1e6 / division);
    lastTick = e.tick;
    const key = e.channel * 128 + e.a;
    switch (e.kind) {
      case 'tempo':
        tempo = e.a;
        break;
      case 'program':
        program[e.channel] = e.a;
        break;
      case 'volume':
        volume[e.channel] = e.a;
        break;
      case 'noteOn':
        if (active.has(key)) close(key, sec);
        active.set(key, { start: sec, vel: e.b, prog: program[e.channel]!, vol: volume[e.channel]! });
        break;
      case 'noteOff':
        close(key, sec);
        break;
      case 'end':
        break;
    }
  }
  for (const key of [...active.keys()]) close(key, sec);

  let durationSec = 0;
  for (const n of notes) durationSec = Math.max(durationSec, n.startSec + n.durSec);
  return { notes, durationSec };
}
