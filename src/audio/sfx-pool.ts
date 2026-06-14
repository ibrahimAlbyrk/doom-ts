// DOOM-style SFX voice pool. Classic DOOM mixes a fixed number of channels; when
// they are all busy a new sound steals the lowest-priority (oldest on a tie) channel,
// and a more-important sound is never dropped for a less-important one. This caps the
// simultaneous AudioBufferSourceNodes so a busy fight can't spawn unbounded voices.

interface Voice {
  src: AudioBufferSourceNode;
  priority: number;
  seq: number; // monotonic start order — lowest = oldest
}

export const DEFAULT_MAX_VOICES = 16;

export class VoicePool {
  private readonly voices = new Set<Voice>();
  private seq = 0;

  constructor(private readonly maxVoices: number = DEFAULT_MAX_VOICES) {}

  /**
   * Try to give `src` a channel. At capacity the lowest-priority voice (oldest on a
   * tie) is cut, but only when the newcomer is at least as important. Returns true
   * and registers self-cleanup on admission; false means the sound should not play.
   */
  admit(src: AudioBufferSourceNode, priority: number): boolean {
    if (this.voices.size >= this.maxVoices) {
      const victim = this.lowest();
      if (!victim || priority < victim.priority) return false;
      this.release(victim);
      try {
        victim.src.stop();
      } catch {
        // already stopped/ended — nothing to cut.
      }
    }
    const voice: Voice = { src, priority, seq: this.seq++ };
    this.voices.add(voice);
    src.onended = () => this.voices.delete(voice);
    return true;
  }

  /** Cut every active voice (e.g. on level change). */
  stopAll(): void {
    for (const voice of this.voices) {
      this.release(voice);
      try {
        voice.src.stop();
      } catch {
        // ignore
      }
    }
    this.voices.clear();
  }

  get activeCount(): number {
    return this.voices.size;
  }

  private release(voice: Voice): void {
    voice.src.onended = null;
    this.voices.delete(voice);
  }

  private lowest(): Voice | null {
    let lowest: Voice | null = null;
    for (const voice of this.voices) {
      if (!lowest || voice.priority < lowest.priority || (voice.priority === lowest.priority && voice.seq < lowest.seq)) {
        lowest = voice;
      }
    }
    return lowest;
  }
}
