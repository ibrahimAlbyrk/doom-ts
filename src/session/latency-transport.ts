// LatencyTransport — DEV-ONLY artificial latency for the SESSION channel (commands up,
// snapshots/events down), so netcode smoothness can be verified without a real WAN. Wraps a
// live SessionTransport (+ its LocalIdentity) and delays every send/receive by `base ± jitter`
// ms. A normal match never wraps with this — only the GameClient dev flag or the netcode test
// turns it on. The lobby channel is untouched (latency only matters once the match is live).
import type { SessionTransport, LocalIdentity } from './remote-session';
import type { TicCommand } from '../game/session';

export interface LatencyOptions {
  baseMs: number;
  jitterMs: number;
}

export class LatencyTransport implements SessionTransport, LocalIdentity {
  constructor(
    private readonly inner: SessionTransport & LocalIdentity,
    private readonly opts: LatencyOptions,
  ) {}

  get sessionId(): string {
    return this.inner.sessionId;
  }
  connect(): Promise<void> {
    return this.inner.connect();
  }
  disconnect(): void {
    this.inner.disconnect();
  }
  sendCommand(cmd: TicCommand): void {
    this.delay(() => this.inner.sendCommand(cmd));
  }
  onSnapshot(handler: (snapshot: unknown) => void): void {
    this.inner.onSnapshot((s) => this.delay(() => handler(s)));
  }
  onEvent(handler: (event: unknown) => void): void {
    this.inner.onEvent((e) => this.delay(() => handler(e)));
  }

  /** base ± jitter ms, never negative; independent per packet so ordering can swap (realistic). */
  private delay(fn: () => void): void {
    const { baseMs, jitterMs } = this.opts;
    const d = Math.max(0, baseMs + (Math.random() * 2 - 1) * jitterMs);
    setTimeout(fn, d);
  }
}
