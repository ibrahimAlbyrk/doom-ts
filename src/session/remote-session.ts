// RemoteSession — the ONLINE seam (NOT implemented in P0). When the netcode lands
// (docs/multiplayer-plan.md P2+) this implements the SAME Session interface as
// LocalSession, but over the wire: it sends each TicCommand to the authoritative
// Colyseus host through a SessionTransport, predicts the local player, and mirrors the
// broadcast snapshots into a local world. Offline single-player NEVER touches it.
//
// This file ships only the BOUNDARY on purpose — the transport interface a future
// Colyseus (or geckos.io/WebRTC) client fills, plus a stub that throws — so the
// architecture is locked in without pulling a network dependency into P0.
import type { IWorld, ILevelRuntime, MapData, SkillId } from '../core';
import type { CombatBus } from '../combat';
import type { WeaponView } from '../weapons';
import type { Session, SimStats, TicCommand, TicResult } from './session';

/** The network boundary a RemoteSession drives — the single place Colyseus plugs in.
 *  Send the local command up; receive authoritative snapshots + reliable gameplay
 *  events down. None of this is built in P0; it documents the contract P2 implements. */
export interface SessionTransport {
  /** Open the connection to the host (Colyseus room / ws). */
  connect(): Promise<void>;
  /** Send the local player's command for one tick (unreliable/best-effort). */
  sendCommand(cmd: TicCommand): void;
  /** Subscribe to authoritative world snapshots (server broadcast ~20Hz). */
  onSnapshot(handler: (snapshot: unknown) => void): void;
  /** Subscribe to reliable gameplay events (damage/death/pickup/exit/frag) the client
   *  turns into local SFX/HUD updates. */
  onEvent(handler: (event: unknown) => void): void;
  /** Close the connection. */
  disconnect(): void;
}

const NOT_YET =
  'RemoteSession: online play lands in a later phase (see docs/multiplayer-plan.md P2+).';

export class RemoteSession implements Session {
  /** Held for when the transport is wired in P2; unused in the P0 seam. */
  readonly transport: SessionTransport;

  constructor(transport: SessionTransport) {
    this.transport = transport;
  }

  get world(): IWorld {
    throw new Error(NOT_YET);
  }
  get currentLevel(): ILevelRuntime | null {
    throw new Error(NOT_YET);
  }
  get currentLevelData(): MapData | null {
    throw new Error(NOT_YET);
  }
  get levelActive(): boolean {
    return false;
  }
  get combat(): CombatBus | null {
    return null;
  }
  get processedSeq(): number {
    return -1;
  }

  getWeaponView(): WeaponView | null {
    return null;
  }
  stats(): SimStats {
    throw new Error(NOT_YET);
  }

  startNewGame(_skill: SkillId): void {
    throw new Error(NOT_YET);
  }
  startLevel(_mapId: string): void {
    throw new Error(NOT_YET);
  }
  tic(_cmd: TicCommand): TicResult {
    throw new Error(NOT_YET);
  }
  teardownLevel(): void {
    /* no-op until the transport is implemented */
  }
  advanceAfterIntermission(): 'next' | 'victory' {
    throw new Error(NOT_YET);
  }
  peekNextLevelId(): string | null {
    return null;
  }
}
