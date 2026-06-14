// Netcode smoothness harness (P3a) — `npx tsx src/session/netcode-smooth.test.ts`. Proves the
// three smoothing pieces with MEASUREMENTS, deterministically (a virtual clock + a delay-line
// transport, no real timers/wire):
//   Part A — PREDICTION + RECONCILIATION: a real authoritative GameSession behind ~80ms one-way
//            latency. The local marine moves the SAME tick a command is issued (not after the
//            round-trip), never snaps backward (no rubber-band), and lands exactly on the
//            authoritative marine when input stops (reconcile + collision agree).
//   Part B — INTERPOLATION: a remote marine fed two snapshots 100ms apart glides between them in
//            ~16mu steps instead of one 100mu teleport, and HOLDS (no NaN/overshoot) when the
//            next snapshot goes missing.
// Throws on the first failed assertion (non-zero exit); exits 0 explicitly otherwise.
import { EventBus, Rng, DEFAULT_SEED } from '../core';
import type { GameEventMap, SimContext } from '../core';
import { World } from '../entities';
import { GameSession, type TicCommand } from '../game/session';
import { buildSnapshot, type PlayerSnap, type Snapshot } from './snapshot';
import { RemoteSession, type SessionTransport, type LocalIdentity } from './remote-session';
import { NETCODE } from './netcode-config';

let passed = 0;
function ok(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
  passed++;
  console.log(`  ok  ${msg}`);
}
function cmd(over: Partial<TicCommand> = {}, seq = 0): TicCommand {
  return {
    forward: 0, strafe: 0, turn: 0, lookTurn: 0, run: false, fire: false,
    use: false, weaponSlot: 0, weaponCycle: 0, pause: false, seq, ...over,
  };
}
const dist = (a: { x: number; y: number }, b: { x: number; y: number }): number => Math.hypot(a.x - b.x, a.y - b.y);
const STEP_MS = 1000 / 60;

// ── Part A: prediction + reconciliation under latency ────────────────────────────
function partA(): void {
  console.log('\nPart A — prediction + reconciliation @ 80ms one-way latency');
  const LAT = 80; // one-way ms (160ms round-trip)
  let vnow = 0;

  // Delay lines: commands up to the server, snapshots down to the client, each held LAT ms.
  const cmdQueue: { at: number; cmd: TicCommand }[] = [];
  const snapQueue: { at: number; snap: Snapshot }[] = [];
  let deliverSnap: (s: Snapshot) => void = () => {};
  const transport: SessionTransport = {
    connect: () => Promise.resolve(),
    disconnect: () => {},
    sendCommand: (c) => cmdQueue.push({ at: vnow + LAT, cmd: c }),
    onSnapshot: (h) => { deliverSnap = (s) => h(s); },
    onEvent: () => {},
  };
  const client = new RemoteSession(transport as SessionTransport & Partial<LocalIdentity>, { sessionId: 'A' }, { now: () => vnow });
  client.enterMatch('E1M1');

  // Authoritative server: one marine (id 0), driven by the latest command that has arrived.
  const sWorld = new World();
  const sCtx: SimContext = { world: sWorld, events: new EventBus<GameEventMap>(), rng: new Rng(DEFAULT_SEED), skill: 3, episodeLevel: 0 };
  const sim = new GameSession(sCtx, { presentation: false });
  sim.startNewGame(3, 'E1M1');
  const serverCmds = new Map<number, TicCommand>();
  let sTick = 0;

  function step(c: TicCommand): void {
    vnow += STEP_MS;
    while (cmdQueue.length && cmdQueue[0]!.at <= vnow) serverCmds.set(0, cmdQueue.shift()!.cmd);
    while (snapQueue.length && snapQueue[0]!.at <= vnow) deliverSnap(snapQueue.shift()!.snap);
    client.tic(c); // sends the command (delayed) AND predicts the local marine immediately
    sim.stepNetwork(serverCmds);
    sTick++;
    if (sTick % 3 === 0) {
      const snap = buildSnapshot(sWorld, sWorld.level!, {
        tick: sTick, mode: 'coop',
        isFiring: (id) => sim.isFiring(id),
        processedSeq: (id) => sim.processedSeqFor(id),
        metaFor: () => ({ sid: 'A', name: 'A', color: 0 }),
        scoreFor: () => ({ frags: 0, deaths: 0 }),
        timeRemaining: 0,
      });
      snapQueue.push({ at: vnow + LAT, snap });
    }
  }
  const cl = (): { x: number; y: number } => { const p = client.world.players.get(0)!; return { x: p.x, y: p.y }; };
  const sv = (): { x: number; y: number } => { const p = sWorld.players.get(0)!; return { x: p.x, y: p.y }; };

  // Warm up: snapshots arrive and seed the predicted local marine at its authoritative spawn.
  let seq = 0;
  for (let i = 0; i < 40; i++) step(cmd({}, seq++));
  ok(dist(cl(), sv()) < 1.0, `seeded: predicted local marine sits on the authoritative one (Δ=${dist(cl(), sv()).toFixed(2)}mu)`);

  // PREDICTION: the command issued THIS tick moves the local marine NOW, while the server —
  // which won't receive it for LAT ms — hasn't budged. That gap IS the latency prediction hides.
  const c0 = cl(), s0 = sv();
  step(cmd({ forward: 1, run: true }, seq++));
  const cMoved = dist(cl(), c0), sMoved = dist(sv(), s0);
  ok(cMoved > 0.5, `prediction: local marine moves the SAME tick the command is issued (${cMoved.toFixed(2)}mu, no round-trip wait)`);
  ok(sMoved < 0.01, `…while the server hasn't even received it yet (${sMoved.toFixed(3)}mu) — input is not waiting ${LAT * 2}ms RTT`);

  // Sustained run: track motion along the marine's heading every tick. Rubber-banding would
  // show as the marine lurching backward (negative along-heading) when a correction lands.
  let minAlong = Infinity, maxGap = 0;
  for (let i = 0; i < 150; i++) {
    const before = cl();
    const a = client.world.players.get(0)!.angle;
    step(cmd({ forward: 1, run: true }, seq++));
    const after = cl();
    const along = (after.x - before.x) * Math.cos(a) + (after.y - before.y) * Math.sin(a);
    minAlong = Math.min(minAlong, along);
    maxGap = Math.max(maxGap, dist(cl(), sv()));
  }
  ok(minAlong > -0.5, `no rubber-band: marine never lurches backward against its heading under latency (worst ${minAlong.toFixed(3)}mu/tic)`);
  ok(maxGap < 64, `prediction stays ahead of the server by a BOUNDED lead (max ${maxGap.toFixed(1)}mu ≈ ${LAT}ms of travel) — no desync drift`);
  console.log(`     (predicted marine leads the authoritative one by ~${maxGap.toFixed(1)}mu during the run — that lead is the hidden latency)`);

  // RECONCILIATION + collision agreement: stop input, let in-flight snapshots drain. With no
  // unacked commands the predicted marine lands EXACTLY on the authoritative one — which it only
  // can if every predicted movement+collision matched the server's.
  for (let i = 0; i < 80; i++) step(cmd({}, seq++));
  const conv = dist(cl(), sv());
  ok(conv < 1.0, `reconciliation converges: predicted marine lands on the authoritative one (Δ=${conv.toFixed(3)}mu) — prediction & server collision agree`);
}

// ── Part B: entity interpolation ─────────────────────────────────────────────────
const NO_AMMO = { bullets: 0, shells: 0, rockets: 0, cells: 0 };
const OWN_WEAPONS = {
  fist: true, chainsaw: false, pistol: true, shotgun: false, superShotgun: false,
  chaingun: false, rocketLauncher: false, plasmaRifle: false, bfg9000: false,
};
const NO_KEYS = {
  blue: { card: false, skull: false },
  yellow: { card: false, skull: false },
  red: { card: false, skull: false },
};
function psnap(id: number, sid: string, x: number, y: number): PlayerSnap {
  return {
    id, sid, name: sid, color: 0, x, y, angle: 0, vx: 0, vy: 0, health: 100, armor: 0,
    armorFactor: 0, weapon: 'pistol', state: 'walk', bob: 0, seq: 0, frags: 0, deaths: 0,
    ammo: { ...NO_AMMO }, ammoMax: { ...NO_AMMO }, weapons: { ...OWN_WEAPONS }, keys: { ...NO_KEYS },
    backpack: false, powerups: {},
  };
}
function snapshot(tick: number, players: PlayerSnap[]): Snapshot {
  return { tick, mode: 'coop', level: 'E1M1', players, monsters: [], projectiles: [], pickups: [], doors: [], lifts: [], sounds: [], timeRemaining: 0 };
}

function partB(): void {
  console.log('\nPart B — entity interpolation (remote marine, 100ms snapshot spacing)');
  let vnow = 0;
  let deliverSnap: (s: Snapshot) => void = () => {};
  const transport: SessionTransport = {
    connect: () => Promise.resolve(),
    disconnect: () => {},
    sendCommand: () => {},
    onSnapshot: (h) => { deliverSnap = (s) => h(s); },
    onEvent: () => {},
  };
  const client = new RemoteSession(transport as SessionTransport & Partial<LocalIdentity>, { sessionId: 'A' }, { now: () => vnow });
  client.enterMatch('E1M1');

  // Local A (id 0, owned by prediction) + remote B (id 1): B at x=0 @ t0, x=100 @ t0+100ms.
  vnow = 0; deliverSnap(snapshot(0, [psnap(0, 'A', 100, 100), psnap(1, 'B', 0, 0)]));
  vnow = 100; deliverSnap(snapshot(6, [psnap(0, 'A', 100, 100), psnap(1, 'B', 100, 0)]));
  const remoteX = (): number => client.world.players.get(1)?.x ?? NaN;

  // Render forward through the interpolation window (render time = now − INTERP_DELAY).
  const samples: { t: number; x: number }[] = [];
  let prevX = 0, maxStep = 0;
  for (vnow = 100; vnow <= 210; vnow += STEP_MS) {
    client.tic(cmd({}, 0));
    const x = remoteX();
    if (samples.length > 0) maxStep = Math.max(maxStep, Math.abs(x - prevX));
    prevX = x;
    samples.push({ t: vnow, x });
  }
  ok(samples.every((s, i) => i === 0 || s.x >= samples[i - 1]!.x - 0.01), 'remote marine moves monotonically across the window — no jitter/back-step');

  // Render time = vnow − INTERP_DELAY; the two snapshots sit at recv 0 and 100, so the window
  // middle (render target = 50, x ≈ 50) is at vnow = 50 + INTERP_DELAY.
  const midVnow = 50 + NETCODE.INTERP_DELAY_MS;
  const mid = samples.reduce((best, s) => (Math.abs(s.t - midVnow) < Math.abs(best.t - midVnow) ? s : best));
  ok(Math.abs(mid.x - 50) < 12, `interpolation lerps: ~halfway (x=${mid.x.toFixed(1)}) at the window midpoint, not snapped to an endpoint`);
  ok(maxStep < 30, `glides in ~${maxStep.toFixed(1)}mu steps instead of one 100mu teleport (smooth, not popping)`);

  // Missing next snapshot: render past the newest sample → HOLD at last, no overshoot/NaN.
  for (vnow = 210; vnow <= 500; vnow += STEP_MS) client.tic(cmd({}, 0));
  const held = remoteX();
  ok(Number.isFinite(held) && Math.abs(held - 100) < 0.01, `missing snapshot: remote HOLDS at last position (x=${held.toFixed(2)}, no teleport/NaN/overshoot)`);
}

function main(): void {
  partA();
  partB();
  console.log(`\nAll ${passed} netcode-smoothness (P3a) assertions passed.`);
  process.exit(0);
}
main();
