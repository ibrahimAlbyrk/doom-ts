// AudioManager — the Web Audio implementation of the frozen `Audio` contract
// (src/core/audio.ts, web-arch.md §6). Routing: every voice → sfxBus | musicBus →
// master → destination. The AudioContext starts suspended and is created lazily on
// the first load/play/resume so booting never trips a browser autoplay error; the app
// calls resume() on the first user gesture to start playback.
//
// SFX use a DOOM-style voice pool (sfx-pool.ts) to cap simultaneous channels.
// Positional SFX attenuate by distance and pan by the source's angle relative to the
// listener's facing (setListener, updated each frame). Music is a secondary, looping
// bus; with no music in the manifest the API is a graceful no-op.
//
// Master / SFX / Music gain and a master mute persist to localStorage so settings
// survive reloads.
import type { Audio } from '../core';
import { EMBEDDED_ASSETS } from '../assets/embedded';
import { VoicePool } from './sfx-pool';

/** Extra knobs for the ergonomic `play()` entry point. */
export interface PlayOptions {
  /** 0..1 gain multiplier (before positional attenuation). Default 1. */
  volume?: number;
  /** -1..1 explicit stereo pan. Ignored when `x`/`y` make the sound positional. */
  pan?: number;
  /** World position; with `y`, the sound is positioned relative to the listener. */
  x?: number;
  y?: number;
  /** Silence cutoff distance for positional sounds (world units). */
  maxDist?: number;
  /** Voice-pool priority — higher survives channel contention. Default 50. */
  priority?: number;
}

const STORE_KEYS = {
  master: 'doom.audio.master',
  sfx: 'doom.audio.sfx',
  music: 'doom.audio.music',
  muted: 'doom.audio.muted',
} as const;

// Per-level music lives outside the frozen AssetManifest (which types music as OGG-only):
// the extractor writes WAV tracks + this index, which AudioManager loads on demand.
// Path is relative so the build runs from any subdirectory.
const MUSIC_ASSETS_BASE = './assets/';
const MUSIC_INDEX_PATH = 'audio/music/index.json';

interface MusicIndexEntry {
  path: string; // relative to the assets base, e.g. "audio/music/D_E1M1.wav"
  durationSec: number;
}
interface MusicIndex {
  rate: number;
  tracks: Record<string, MusicIndexEntry>;
}

const DEFAULT_PRIORITY = 50;
// Distance model (world/map units): full volume within CLOSE_DIST, linear falloff to
// silence at MAX_DIST — roughly DOOM's S_CLOSE_DIST / S_CLIPPING_DIST.
const SFX_CLOSE_DIST = 160;
const SFX_MAX_DIST = 1200;

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

export class AudioManager implements Audio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private musicSource: AudioBufferSourceNode | null = null;
  private musicIndex: Record<string, MusicIndexEntry> | null = null;
  private musicIndexLoad: Promise<void> | null = null;
  private pendingMusicId: string | null = null;
  private readonly buffers = new Map<string, AudioBuffer>();
  private readonly pool = new VoicePool();

  private masterVol = 0.8;
  private sfxVol = 1.0;
  private musicVol = 0.7;
  private muted = false;

  // Listener pose for positional playback; integration updates it each frame.
  private listenerX = 0;
  private listenerY = 0;
  private listenerAngle = 0;

  constructor() {
    this.loadSettings();
  }

  // ── AudioContext lifecycle ───────────────────────────────────────────────────
  private ensure(): AudioContext {
    if (this.ctx) return this.ctx;
    const ctx = new AudioContext();
    this.master = ctx.createGain();
    this.sfxBus = ctx.createGain();
    this.musicBus = ctx.createGain();
    this.sfxBus.connect(this.master);
    this.musicBus.connect(this.master);
    this.master.connect(ctx.destination);
    this.ctx = ctx;
    this.applyGains();
    return ctx;
  }

  /** Resume the (suspended) AudioContext — call on the first user gesture. */
  async resume(): Promise<void> {
    await this.ensure().resume();
  }

  /** Fetch + decode a buffer under `id` (used by the boot AssetLoader). */
  async load(id: string, url: string): Promise<void> {
    const ctx = this.ensure();
    const raw = await (await fetch(url)).arrayBuffer();
    this.buffers.set(id, await ctx.decodeAudioData(raw));
  }

  // ── SFX (frozen contract) ────────────────────────────────────────────────────
  playSfx(id: string, volume = 1, pan = 0): void {
    this.spawn(id, volume, pan, DEFAULT_PRIORITY);
  }

  playSfxSpatial(id: string, dx: number, dy: number, maxDist = SFX_MAX_DIST): void {
    const placed = this.spatial(dx, dy, maxDist);
    if (!placed) return;
    this.spawn(id, placed.volume, placed.pan, DEFAULT_PRIORITY);
  }

  // ── SFX (ergonomic entry point for game + integration) ───────────────────────
  /** One call for positional or flat SFX. Give `x`/`y` for positional playback
   *  (relative to the current listener), or `pan`/`volume` for a flat sound. */
  play(id: string, opts: PlayOptions = {}): void {
    const baseVol = opts.volume ?? 1;
    const priority = opts.priority ?? DEFAULT_PRIORITY;
    if (opts.x !== undefined && opts.y !== undefined) {
      const placed = this.spatial(opts.x - this.listenerX, opts.y - this.listenerY, opts.maxDist ?? SFX_MAX_DIST);
      if (!placed) return;
      this.spawn(id, baseVol * placed.volume, placed.pan, priority);
      return;
    }
    this.spawn(id, baseVol, opts.pan ?? 0, priority);
  }

  /** Update the listener pose (player position + facing, radians) each frame. */
  setListener(x: number, y: number, angle: number): void {
    this.listenerX = x;
    this.listenerY = y;
    this.listenerAngle = angle;
  }

  /** Cut every active SFX voice (e.g. on level teardown). Music is untouched. */
  stopAllSfx(): void {
    this.pool.stopAll();
  }

  /** Number of SFX voices currently playing (for debug HUD / channel-cap checks). */
  get activeVoices(): number {
    return this.pool.activeCount;
  }

  // ── Music (looping bus; tracks load on demand from the music index) ──────────
  /** Start looping `id` on the music bus. The track is fetched + decoded on first use
   *  (from the extractor's music index); unknown ids are a graceful no-op. Calling again
   *  with a new id crossfades by replacing the source once the new track is ready. */
  playMusic(id: string, loop = true): void {
    this.pendingMusicId = id;
    const buf = this.buffers.get(id);
    if (buf) {
      this.startMusicSource(id, buf, loop);
      return;
    }
    void this.loadAndPlayMusic(id, loop);
  }

  /** Stop the current track and cancel any in-flight track load. */
  stopMusic(): void {
    this.pendingMusicId = null;
    this.stopMusicSource();
  }

  private startMusicSource(id: string, buf: AudioBuffer, loop: boolean): void {
    const ctx = this.ctx;
    if (!ctx || !this.musicBus) return;
    if (this.pendingMusicId !== id) return; // superseded by a newer playMusic call
    this.stopMusicSource();
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = loop;
    src.connect(this.musicBus);
    src.start();
    this.musicSource = src;
  }

  private stopMusicSource(): void {
    if (!this.musicSource) return;
    this.musicSource.onended = null;
    try {
      this.musicSource.stop();
    } catch {
      // already stopped
    }
    this.musicSource = null;
  }

  private async loadAndPlayMusic(id: string, loop: boolean): Promise<void> {
    const ctx = this.ensure();
    try {
      await this.ensureMusicIndex();
      const entry = this.musicIndex?.[id];
      if (!entry || this.pendingMusicId !== id) return; // unknown id / superseded
      const raw = await (await fetch(MUSIC_ASSETS_BASE + entry.path)).arrayBuffer();
      const buf = await ctx.decodeAudioData(raw);
      this.buffers.set(id, buf);
      this.startMusicSource(id, buf, loop);
    } catch {
      // fetch/decode failed → stay silent rather than throw into the game loop
    }
  }

  private ensureMusicIndex(): Promise<void> {
    if (this.musicIndex) return Promise.resolve();
    if (!this.musicIndexLoad) {
      this.musicIndexLoad = (async () => {
        // The self-contained itch build embeds no music (uncompressed WAV would dwarf
        // the bundle); skip the fetch so an opaque-origin sandbox logs no CORS errors.
        if (EMBEDDED_ASSETS) {
          this.musicIndex = {};
          return;
        }
        try {
          const res = await fetch(MUSIC_ASSETS_BASE + MUSIC_INDEX_PATH);
          this.musicIndex = res.ok ? ((await res.json()) as MusicIndex).tracks ?? {} : {};
        } catch {
          this.musicIndex = {};
        }
      })();
    }
    return this.musicIndexLoad;
  }

  /** True while a music track is playing — for debug HUDs and playback tests. */
  get isMusicPlaying(): boolean {
    return this.musicSource !== null;
  }

  /** Insert an AnalyserNode on the master output and return it (VU metering / tests). */
  attachAnalyser(fftSize = 2048): AnalyserNode {
    const ctx = this.ensure();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = fftSize;
    this.master!.disconnect();
    this.master!.connect(analyser);
    analyser.connect(ctx.destination);
    return analyser;
  }

  // ── Mixer (gain + mute, persisted) ───────────────────────────────────────────
  setMasterVolume(v: number): void {
    this.masterVol = clamp(v, 0, 1);
    this.applyGains();
    this.persist(STORE_KEYS.master, this.masterVol);
  }

  setSfxVolume(v: number): void {
    this.sfxVol = clamp(v, 0, 1);
    this.applyGains();
    this.persist(STORE_KEYS.sfx, this.sfxVol);
  }

  setMusicVolume(v: number): void {
    this.musicVol = clamp(v, 0, 1);
    this.applyGains();
    this.persist(STORE_KEYS.music, this.musicVol);
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.applyGains();
    this.persist(STORE_KEYS.muted, muted ? 1 : 0);
  }

  isMuted(): boolean {
    return this.muted;
  }

  getMasterVolume(): number {
    return this.masterVol;
  }

  getSfxVolume(): number {
    return this.sfxVol;
  }

  getMusicVolume(): number {
    return this.musicVol;
  }

  // ── internals ────────────────────────────────────────────────────────────────
  private spawn(id: string, volume: number, pan: number, priority: number): void {
    if (volume <= 0) return;
    const ctx = this.ctx;
    if (!ctx || !this.sfxBus) return;
    const buf = this.buffers.get(id);
    if (!buf) return;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    if (!this.pool.admit(src, priority)) return; // cut by channel limit
    const gain = ctx.createGain();
    gain.gain.value = clamp(volume, 0, 1);
    const panner = ctx.createStereoPanner();
    panner.pan.value = clamp(pan, -1, 1);
    src.connect(gain).connect(panner).connect(this.sfxBus);
    src.start();
  }

  /** Distance attenuation + stereo pan from a world offset, using listener facing.
   *  Returns null when the source is past the cutoff (caller skips the sound). */
  private spatial(dx: number, dy: number, maxDist: number): { volume: number; pan: number } | null {
    const dist = Math.hypot(dx, dy);
    if (dist >= maxDist) return null;
    const volume = dist <= SFX_CLOSE_DIST ? 1 : (maxDist - dist) / (maxDist - SFX_CLOSE_DIST);
    if (dist < 1e-3) return { volume, pan: 0 };
    // Lateral component in the listener's frame: +1 = fully to the player's right.
    const sin = Math.sin(this.listenerAngle);
    const cos = Math.cos(this.listenerAngle);
    const right = dx * sin - dy * cos;
    return { volume, pan: clamp(right / dist, -1, 1) };
  }

  private applyGains(): void {
    if (this.master) this.master.gain.value = this.muted ? 0 : this.masterVol;
    if (this.sfxBus) this.sfxBus.gain.value = this.sfxVol;
    if (this.musicBus) this.musicBus.gain.value = this.musicVol;
  }

  private loadSettings(): void {
    const store = this.store();
    if (!store) return;
    const num = (key: string, fallback: number): number => {
      const raw = store.getItem(key);
      if (raw === null) return fallback;
      const n = Number.parseFloat(raw);
      return Number.isFinite(n) ? clamp(n, 0, 1) : fallback;
    };
    this.masterVol = num(STORE_KEYS.master, this.masterVol);
    this.sfxVol = num(STORE_KEYS.sfx, this.sfxVol);
    this.musicVol = num(STORE_KEYS.music, this.musicVol);
    this.muted = store.getItem(STORE_KEYS.muted) === '1';
  }

  private persist(key: string, value: number): void {
    this.store()?.setItem(key, String(value));
  }

  private store(): Storage | null {
    try {
      return typeof localStorage !== 'undefined' ? localStorage : null;
    } catch {
      return null; // access denied (private mode / sandboxed iframe)
    }
  }
}
