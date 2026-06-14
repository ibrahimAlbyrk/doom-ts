// Offline software synth: a SynthNote list (midi.ts) → mono PCM → 16-bit WAV. This is
// the "pre-render to an audio file offline" path from the task brief — deliberately a
// simple oscillator synth (no soundfont), so it is headless and dependency-free.
//
// Each note is an oscillator (waveform chosen by GM program family) shaped by a short
// ADSR envelope; percussion (channel 9) is a fast-decaying noise burst. Voices are
// summed, run through a one-pole low-pass to tame aliasing into a darker Doom tone, and
// soft-limited so dense chords never hard-clip.
import type { MidiSong, SynthNote } from './midi.ts';

type Wave = 'sine' | 'triangle' | 'square' | 'saw';

/** GM program (0..127) → oscillator waveform + a per-timbre level trim. */
function timbre(program: number, percussion: boolean): { wave: Wave; gain: number } {
  if (percussion) return { wave: 'sine', gain: 0 }; // unused (percussion is noise)
  if (program <= 7) return { wave: 'triangle', gain: 0.8 }; // pianos
  if (program <= 15) return { wave: 'triangle', gain: 0.7 }; // chromatic perc / bells
  if (program <= 23) return { wave: 'square', gain: 0.45 }; // organs
  if (program <= 31) return { wave: 'saw', gain: 0.5 }; // guitars
  if (program <= 39) return { wave: 'triangle', gain: 0.9 }; // basses
  if (program <= 79) return { wave: 'saw', gain: 0.45 }; // strings / ensemble / brass / reed
  if (program <= 103) return { wave: 'square', gain: 0.45 }; // synth lead / pad
  return { wave: 'triangle', gain: 0.6 };
}

function osc(wave: Wave, phase: number): number {
  const p = phase - Math.floor(phase);
  switch (wave) {
    case 'sine':
      return Math.sin(2 * Math.PI * p);
    case 'triangle':
      return 4 * Math.abs(p - 0.5) - 1;
    case 'square':
      return p < 0.5 ? 1 : -1;
    case 'saw':
      return 2 * p - 1;
  }
}

const ATTACK = 0.006;
const RELEASE = 0.07;

function renderNote(out: Float32Array, n: SynthNote, rate: number): void {
  const start = Math.floor(n.startSec * rate);
  const tail = n.percussion ? 0 : RELEASE;
  const total = Math.floor((n.durSec + tail) * rate);
  if (total <= 0) return;
  const vel = n.velocity / 127;
  const chVol = n.channelVolume / 127;
  const sustainLen = Math.floor(n.durSec * rate);

  if (n.percussion) {
    // noise burst with fast exponential decay — drums/cymbals without pitch
    const amp = 0.5 * vel * chVol;
    const decay = 1 / (0.18 * rate);
    let env = 1;
    let prev = 0;
    for (let i = 0; i < total && start + i < out.length; i++) {
      const white = Math.random() * 2 - 1;
      prev = prev * 0.5 + white * 0.5; // soften to low-mid noise
      out[start + i]! += prev * env * amp;
      env -= decay;
      if (env < 0) break;
    }
    return;
  }

  const { wave, gain } = timbre(n.program, false);
  const amp = 0.32 * vel * chVol * gain;
  const freq = 440 * Math.pow(2, (n.midiNote - 69) / 12);
  const step = freq / rate;
  const attackS = Math.max(1, Math.floor(ATTACK * rate));
  const releaseS = Math.max(1, Math.floor(RELEASE * rate));
  for (let i = 0; i < total && start + i < out.length; i++) {
    let env: number;
    if (i < attackS) env = i / attackS;
    else if (i < sustainLen) env = 1;
    else env = Math.max(0, 1 - (i - sustainLen) / releaseS);
    out[start + i]! += osc(wave, i * step) * env * amp;
  }
}

/** Render a parsed song to mono float PCM at `rate`, normalised + soft-limited. */
export function renderToPcm(song: MidiSong, rate: number): Float32Array {
  const len = Math.ceil((song.durationSec + RELEASE + 0.1) * rate);
  const buf = new Float32Array(Math.max(1, len));
  for (const n of song.notes) renderNote(buf, n, rate);

  // One-pole low-pass (~6 kHz) for a softer, darker tone.
  const a = Math.exp((-2 * Math.PI * 6000) / rate);
  let y = 0;
  for (let i = 0; i < buf.length; i++) {
    y = a * y + (1 - a) * buf[i]!;
    buf[i] = y;
  }

  // Normalise toward -3 dBFS, then tanh soft-clip as a safety limiter.
  let peak = 0;
  for (let i = 0; i < buf.length; i++) peak = Math.max(peak, Math.abs(buf[i]!));
  const norm = peak > 1e-4 ? 0.7 / peak : 1;
  for (let i = 0; i < buf.length; i++) buf[i] = Math.tanh(buf[i]! * norm * 1.2);
  return buf;
}

/** Wrap mono float PCM (−1..1) as a 16-bit signed PCM WAV. */
export function floatToWav(rate: number, pcm: Float32Array): Buffer {
  const dataBytes = pcm.length * 2;
  const buf = Buffer.alloc(44 + dataBytes);
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(36 + dataBytes, 4);
  buf.write('WAVE', 8, 'ascii');
  buf.write('fmt ', 12, 'ascii');
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36, 'ascii');
  buf.writeUInt32LE(dataBytes, 40);
  for (let i = 0; i < pcm.length; i++) {
    const s = Math.max(-1, Math.min(1, pcm[i]!));
    buf.writeInt16LE((s * 32767) | 0, 44 + i * 2);
  }
  return buf;
}
