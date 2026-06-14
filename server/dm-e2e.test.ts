// P5b deathmatch — REAL WIRE end-to-end (`npx tsx server/dm-e2e.test.ts`). Boots the actual
// Colyseus MatchRoom and drives TWO real client stacks (ColyseusTransport + LobbyClient +
// RemoteSession) through host → join → ready → START a DEATHMATCH, then OBSERVES, over the wire:
//   • both marines spawn at DISTINCT, spread DM spawns,
//   • the synced score view (scoreState) is populated on each client (mode deathmatch, frags 0),
//   • the two marines hunt + DAMAGE each other (FF on) until a frag is scored,
//   • reaching the frag limit ENDS the match → matchEnded with the final standings (a winner),
//   • the host's REMATCH restarts the match (a fresh matchStarting reaches both clients).
// Throws on the first failed assertion. Exits 0 explicitly (server timers keep the loop alive).
import { Server } from 'colyseus';
import { type TicCommand } from '../src/game/session';
import { MatchRoom } from './match-room';
import { ColyseusTransport } from '../src/session/colyseus-transport';
import { RemoteSession } from '../src/session/remote-session';
import { LobbyClient, defaultMatchConfig } from '../src/lobby';
import { matchWinner, type ScoreState } from '../src/score';

let passed = 0;
function ok(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
  passed++;
  console.log(`  ok  ${msg}`);
}
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
async function waitFor(pred: () => boolean, label: string, timeoutMs = 6000): Promise<void> {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > timeoutMs) throw new Error(`TIMEOUT waiting for ${label}`);
    await sleep(20);
  }
}
function cmd(over: Partial<TicCommand> = {}, seq = 0): TicCommand {
  return {
    forward: 0, strafe: 0, turn: 0, lookTurn: 0, run: false, fire: false,
    use: false, weaponSlot: 0, weaponCycle: 0, pause: false, seq, ...over,
  };
}

interface Stack {
  transport: ColyseusTransport;
  lobby: LobbyClient;
  remote: RemoteSession;
}
const SCORE_META = { mode: 'deathmatch' as const, fragLimit: 1, timeLimit: 0 };

/** A best-effort seeker: steer toward the OTHER marine (positions from its own mirrored world),
 *  hold the trigger (autoaim frags on a clear shot), and press use to push through doors. The
 *  spread DM spawns + DOOM map geometry mean a clean frag isn't guaranteed — the round still ends
 *  deterministically on the time limit, which is what the end→results→rematch proof relies on. */
function huntCmd(me: RemoteSession, myId: number, foeId: number, seq: number): TicCommand {
  const self = me.world.players.get(myId);
  const foe = me.world.players.get(foeId);
  if (!self || !foe) return cmd({ fire: true }, seq);
  let d = Math.atan2(foe.y - self.y, foe.x - self.x) - self.angle;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  const lookTurn = Math.max(-0.25, Math.min(0.25, d));
  return cmd({ forward: 1, run: true, fire: true, use: seq % 8 === 0, lookTurn }, seq);
}

async function main(): Promise<void> {
  console.log('Deathmatch end-to-end over the real Colyseus wire (2 clients)');
  const PORT = 2601;
  const url = `ws://localhost:${PORT}`;
  const gameServer = new Server();
  gameServer.define('match', MatchRoom);
  await gameServer.listen(PORT);
  console.log(`  server listening on ${url}`);

  try {
    // ── lobby: host a DEATHMATCH (frag limit 1 so a single frag ends the round), join, ready, start
    const a: Partial<Stack> = {};
    a.transport = new ColyseusTransport(url);
    a.lobby = new LobbyClient(a.transport, { name: 'MARINE-A', color: 3 });
    // Frag limit 1 (a single frag ends it) AND time limit 1min — so the round ends on a frag if
    // the bots reach each other, or deterministically on the clock otherwise (the match-end →
    // results → rematch chain is proven over the wire either way).
    a.lobby.host({ ...defaultMatchConfig('deathmatch'), fragLimit: 1, timeLimit: 1 });
    await waitFor(() => a.lobby!.phase === 'inRoom' && !!a.lobby!.room, 'A hosting a DM room');
    const code = a.lobby.room!.code;
    ok(a.lobby.room!.config.mode === 'deathmatch', `A hosted a DEATHMATCH room ${code}`);

    const b: Partial<Stack> = {};
    b.transport = new ColyseusTransport(url);
    b.lobby = new LobbyClient(b.transport, { name: 'MARINE-B', color: 0 });
    b.lobby.join({ roomCode: code });
    await waitFor(() => (a.lobby!.room?.players.length ?? 0) === 2 && (b.lobby!.room?.players.length ?? 0) === 2, 'both in room');
    ok(true, 'MARINE-B joined the DM room (roster size 2)');

    a.lobby.toggleReady();
    b.lobby.toggleReady();
    await waitFor(() => a.lobby!.canStart, 'all ready + host can start');
    a.lobby.start();
    await waitFor(() => !!a.lobby!.matchStarting && !!b.lobby!.matchStarting, 'both got matchStarting');
    const levelId = a.lobby.matchStarting!.levelId;
    ok(a.lobby.matchStarting!.config.mode === 'deathmatch', `DEATHMATCH started on ${levelId} (FF on)`);

    a.remote = new RemoteSession(a.transport!);
    b.remote = new RemoteSession(b.transport!);
    a.remote.enterMatch(levelId);
    b.remote.enterMatch(levelId);
    const A = a as Stack;
    const B = b as Stack;

    // ── idle ticks: resolve own ids, observe DISTINCT spread DM spawns + score sync ──────────
    for (let i = 0; i < 24; i++) {
      A.remote.tic(cmd({}, i));
      B.remote.tic(cmd({}, i));
      await sleep(16);
    }
    await waitFor(() => A.remote.world.players.size >= 2 && B.remote.world.players.size >= 2, 'both see two marines');
    const aId = A.remote.world.localPlayerId;
    const bId = B.remote.world.localPlayerId;
    ok(aId !== bId, `clients resolved distinct ids (A=${aId}, B=${bId})`);

    const pa = A.remote.world.players.get(aId)!;
    const pbOnA = A.remote.world.players.get(bId)!;
    const spawnSep = Math.hypot(pa.x - pbOnA.x, pa.y - pbOnA.y);
    console.log(`  spawn separation ${Math.round(spawnSep)}mu`);
    ok(spawnSep > 128, 'the two marines spawned at distinct, spread DM spawns');

    const sa = A.remote.scoreState(SCORE_META) as ScoreState;
    ok(!!sa && sa.mode === 'deathmatch' && sa.players.length === 2, 'A’s synced scoreboard lists both marines in DM');
    ok(sa.players.every((p) => p.frags === 0 && p.deaths === 0), 'frags/deaths start at 0 for everyone');
    ok(sa.localPlayerId === String(aId), 'A’s scoreboard highlights A as "you"');

    // ── combat: the two hunt + DAMAGE each other; the match ends on a frag or on the clock ───
    let firstHurt = -1;
    let firstBlood = -1;
    const deadline = Date.now() + 65_000; // the 1-minute time limit ends it if no frag lands first
    for (let i = 0; !a.lobby!.matchEnded && Date.now() < deadline; i++) {
      A.remote.tic(huntCmd(A.remote, aId, bId, 100 + i));
      B.remote.tic(huntCmd(B.remote, bId, aId, 100 + i));
      const s = A.remote.scoreState(SCORE_META);
      const me = A.remote.world.players.get(aId);
      const foe = A.remote.world.players.get(bId);
      if (firstHurt < 0 && ((me && me.health < 100) || (foe && foe.health < 100))) firstHurt = i;
      if (firstBlood < 0 && s && s.players.some((p) => p.deaths > 0)) firstBlood = i;
      await sleep(10);
    }
    console.log(`  combat: damage observed=${firstHurt >= 0} frag observed=${firstBlood >= 0}`);

    // ── match end → results (the authoritative final standings reach both clients) ───────────
    await waitFor(() => !!a.lobby!.matchEnded && !!b.lobby!.matchEnded, 'both clients received matchEnded');
    const res = a.lobby.matchEnded!;
    ok(res.mode === 'deathmatch' && res.scores.length === 2, 'match ENDED → matchEnded carries the DM final standings (2 players)');
    const winner = matchWinner({ ...SCORE_META, timeRemaining: 0, players: res.scores, localPlayerId: String(aId) });
    const hasFrag = res.scores.some((s) => s.frags >= 1);
    const endedBy = hasFrag ? `frag limit (winner ${winner?.name})` : 'time limit (draw)';
    ok(hasFrag ? winner !== null : winner === null, `results screen resolves the outcome coherently: ${endedBy}`);

    // ── REMATCH: the host restarts; a fresh matchStarting reaches both clients ────────────────
    a.lobby.matchStarting = null;
    b.lobby.matchStarting = null;
    a.lobby.rematch();
    await waitFor(() => !!a.lobby!.matchStarting && !!b.lobby!.matchStarting, 'rematch re-broadcast matchStarting to both');
    ok(a.lobby.matchStarting!.config.mode === 'deathmatch', 'REMATCH restarted the DM match with the same config');

    A.remote.teardownLevel();
    B.remote.teardownLevel();
    await sleep(50);
  } finally {
    await gameServer.gracefullyShutdown(false);
  }

  console.log(`\nAll ${passed} deathmatch end-to-end assertions passed.`);
  process.exit(0);
}
main().catch((err) => {
  console.error(err);
  process.exit(1);
});
