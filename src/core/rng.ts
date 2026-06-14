// FROZEN CONTRACT — seeded, deterministic RNG.
// DOOM's P_Random() returns a byte 0..255 from a fixed table; a web remake may use
// any deterministic 0..255 source (doom-design.md §0). This is a mulberry32 PRNG
// so replays/tests are reproducible from a seed.

export class Rng {
  private state: number;

  constructor(seed: number) {
    // Coerce to uint32, avoid a zero state.
    this.state = (seed >>> 0) || 0x9e3779b9;
  }

  /** Reseed in place (e.g. at level start). */
  reseed(seed: number): void {
    this.state = (seed >>> 0) || 0x9e3779b9;
  }

  /** Float in [0, 1). */
  next(): number {
    let t = (this.state += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Integer in [0, maxExclusive). */
  int(maxExclusive: number): number {
    return Math.floor(this.next() * maxExclusive);
  }

  /** Integer in [min, max] inclusive. */
  range(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  /** DOOM P_Random() equivalent — a byte 0..255. */
  p(): number {
    return this.int(256);
  }

  /** True with probability prob/256 — matches `P_Random() < painChance`. */
  chance256(prob: number): boolean {
    return this.p() < prob;
  }
}
