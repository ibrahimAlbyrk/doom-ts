// FROZEN CONTRACT — audio service interface (Web Audio API, docs/research/web-arch.md §6).
// Positional playback is by distance + angle relative to the player; music is a
// secondary priority. OGG is primary, WAV acceptable for short SFX.

export interface Audio {
  /** Resume the AudioContext on the first user gesture (it starts suspended). */
  resume(): Promise<void>;
  /** Decode and cache a buffer under `id`. */
  load(id: string, url: string): Promise<void>;

  /** Fire a one-shot effect. volume 0..1, pan -1..1. */
  playSfx(id: string, volume?: number, pan?: number): void;
  /** Positional one-shot: dx/dy are world offsets from the listener (player). */
  playSfxSpatial(id: string, dx: number, dy: number, maxDist?: number): void;

  playMusic(id: string, loop?: boolean): void;
  stopMusic(): void;

  setMasterVolume(v: number): void;
  setSfxVolume(v: number): void;
  setMusicVolume(v: number): void;
}
