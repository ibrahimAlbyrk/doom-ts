// AudioManager — implements the Audio contract (Web Audio API, web-arch.md §6).
// The AudioContext is created lazily on the first user gesture (resume/load) so the
// app boots without an autoplay warning. Positional SFX pan/volume by distance+angle;
// music is a secondary bus.
import type { Audio } from '../core';

export class AudioManager implements Audio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private musicSource: AudioBufferSourceNode | null = null;
  private readonly buffers = new Map<string, AudioBuffer>();

  private masterVol = 0.8;
  private sfxVol = 1.0;
  private musicVol = 0.7;

  private ensure(): AudioContext {
    if (this.ctx) return this.ctx;
    const ctx = new AudioContext();
    this.master = ctx.createGain();
    this.sfxBus = ctx.createGain();
    this.musicBus = ctx.createGain();
    this.master.gain.value = this.masterVol;
    this.sfxBus.gain.value = this.sfxVol;
    this.musicBus.gain.value = this.musicVol;
    this.sfxBus.connect(this.master);
    this.musicBus.connect(this.master);
    this.master.connect(ctx.destination);
    this.ctx = ctx;
    return ctx;
  }

  async resume(): Promise<void> {
    await this.ensure().resume();
  }

  async load(id: string, url: string): Promise<void> {
    const ctx = this.ensure();
    const raw = await (await fetch(url)).arrayBuffer();
    this.buffers.set(id, await ctx.decodeAudioData(raw));
  }

  playSfx(id: string, volume = 1, pan = 0): void {
    if (!this.ctx || !this.sfxBus) return;
    const buf = this.buffers.get(id);
    if (!buf) return;
    const src = this.ctx.createBufferSource();
    const gain = this.ctx.createGain();
    const panner = this.ctx.createStereoPanner();
    src.buffer = buf;
    gain.gain.value = volume;
    panner.pan.value = Math.max(-1, Math.min(1, pan));
    src.connect(gain).connect(panner).connect(this.sfxBus);
    src.start();
  }

  playSfxSpatial(id: string, dx: number, dy: number, maxDist = 800): void {
    const dist = Math.hypot(dx, dy);
    if (dist > maxDist) return;
    const volume = 1 - dist / maxDist;
    const pan = Math.max(-1, Math.min(1, dx / (maxDist * 0.5)));
    this.playSfx(id, volume, pan);
  }

  playMusic(id: string, loop = true): void {
    if (!this.ctx || !this.musicBus) return;
    this.stopMusic();
    const buf = this.buffers.get(id);
    if (!buf) return;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.loop = loop;
    src.connect(this.musicBus);
    src.start();
    this.musicSource = src;
  }

  stopMusic(): void {
    this.musicSource?.stop();
    this.musicSource = null;
  }

  setMasterVolume(v: number): void {
    this.masterVol = v;
    if (this.master) this.master.gain.value = v;
  }

  setSfxVolume(v: number): void {
    this.sfxVol = v;
    if (this.sfxBus) this.sfxBus.gain.value = v;
  }

  setMusicVolume(v: number): void {
    this.musicVol = v;
    if (this.musicBus) this.musicBus.gain.value = v;
  }
}
