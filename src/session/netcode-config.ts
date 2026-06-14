// Netcode smoothing tunables — ONE place for the knobs P3a's prediction / reconciliation /
// interpolation read ([netcode §4.3–4.5]). Offline single-player never imports this.
export const NETCODE = {
  /** Render remote entities this many ms in the PAST. ~2 snapshot intervals (server
   *  broadcasts ~20Hz → 50ms each) so there are always two snapshots to interpolate
   *  between, hiding a dropped/late one ([netcode §4.4]). */
  INTERP_DELAY_MS: 100,
  /** Max snapshots retained for the interpolation buffer (≥ INTERP_DELAY/interval + margin). */
  SNAPSHOT_BUFFER: 32,
  /** Reconciliation error-smoothing: after a snap+replay correction the leftover position
   *  error is kept as a visual offset and decayed by this factor each predicted tic, so a
   *  misprediction eases out instead of popping (1 = hard snap, →0 = slow slide). */
  RECONCILE_SMOOTH_DECAY: 0.82,
  /** Below this the smoothing offset is treated as zero (mu). */
  RECONCILE_SMOOTH_EPS: 0.05,
  /** Above this residual (mu) a correction is a real teleport (respawn/telefrag/lift) — snap
   *  instantly rather than sliding the marine across the room. */
  RECONCILE_SNAP_MU: 48,
  /** Ticks the local weapon view shows its firing frame after a fire command, so the gun
   *  reacts to the trigger immediately instead of waiting a round-trip for the snapshot. */
  FIRE_VIEW_LATCH_TICS: 3,
  /** Cap on queued networked SFX awaiting playback — drops the oldest if the presenter
   *  stalls so a backlog can never balloon (a hitch should never replay seconds of sound). */
  SOUND_QUEUE_MAX: 64,
} as const;

/** Default artificial latency for the dev network-sim (the GameClient flag / tests). */
export const DEFAULT_NET_SIM = { baseMs: 120, jitterMs: 30 };
