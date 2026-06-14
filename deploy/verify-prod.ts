// Local prod-path verifier: drives TWO real client stacks (the SAME ColyseusTransport +
// LobbyClient + RemoteSession the browser uses) through host → join-by-code → ready → START →
// each-sees-the-other-move, but against an ALREADY-RUNNING prod server (server/prod.ts: express
// static + Colyseus on one port). It does NOT boot its own server — set MP_URL to the running
// host (default ws://localhost:2567). This proves the deploy packaging carries a co-op match,
// not just that the dev server does. Run: npx tsx deploy/verify-prod.ts
import { ColyseusTransport } from '../src/session/colyseus-transport';
import { RemoteSession } from '../src/session/remote-session';
import { LobbyClient, defaultMatchConfig } from '../src/lobby';
import type { TicCommand } from '../src/game/session';

const URL = process.env.MP_URL ?? 'ws://localhost:2567';
let passed = 0;
function ok(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
  passed++;
  console.log(`  ok  ${msg}`);
}
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
async function waitFor(pred: () => boolean, label: string, timeoutMs = 8000): Promise<void> {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > timeoutMs) throw new Error(`TIMEOUT waiting for ${label}`);
    await sleep(20);
  }
}
function cmd(over: Partial<TicCommand> = {}, seq = 0): TicCommand {
  return { forward: 0, strafe: 0, turn: 0, lookTurn: 0, run: false, fire: false,
    use: false, weaponSlot: 0, weaponCycle: 0, pause: false, seq, ...over };
}
function posOf(s: RemoteSession, id: number): { x: number; y: number } {
  const p = s.world.players.get(id);
  return { x: p?.x ?? 0, y: p?.y ?? 0 };
}
const dist = (a: { x: number; y: number }, b: { x: number; y: number }): number =>
  Math.hypot(a.x - b.x, a.y - b.y);

function makeStack(name: string, color: number) {
  const transport = new ColyseusTransport(URL);
  return { transport, lobby: new LobbyClient(transport, { name, color }) };
}

async function main(): Promise<void> {
  console.log(`Prod-path co-op verify against ${URL}`);

  const a = makeStack('MARINE-A', 0);
  a.lobby.host(defaultMatchConfig('coop'));
  await waitFor(() => a.lobby.phase === 'inRoom' && !!a.lobby.room, 'A hosted a room over the prod server');
  const code = a.lobby.room!.code;
  ok(!!code, `A hosted co-op room ${code} via prod matchmaking`);

  const b = makeStack('MARINE-B', 3);
  b.lobby.join({ roomCode: code });
  await waitFor(() => (b.lobby.room?.players.length ?? 0) === 2, 'B joined by code');
  await waitFor(() => (a.lobby.room?.players.length ?? 0) === 2, 'A sees B in roster');
  ok(a.lobby.room!.players.length === 2, 'both marines share one room over the prod server');

  a.lobby.toggleReady();
  b.lobby.toggleReady();
  await waitFor(() => a.lobby.allReady && a.lobby.canStart, 'all ready + host can start');
  a.lobby.start();
  await waitFor(() => !!a.lobby.matchStarting && !!b.lobby.matchStarting, 'both got matchStarting');
  const levelId = a.lobby.matchStarting!.levelId;
  ok(a.lobby.matchStarting!.config.mode === 'coop', `co-op match started on ${levelId} over the prod server`);

  const stacks = [a, b].map((s) => {
    const remote = new RemoteSession(s.transport);
    remote.enterMatch(levelId);
    return { ...s, remote };
  });
  const [ca, cb] = stacks;
  for (let i = 0; i < 20; i++) { ca!.remote.tic(cmd({}, i)); cb!.remote.tic(cmd({}, i)); await sleep(16); }
  await waitFor(() => ca!.remote.world.players.size >= 2 && cb!.remote.world.players.size >= 2, 'both see two marines');
  const aId = ca!.remote.world.localPlayerId;
  const bId = cb!.remote.world.localPlayerId;
  ok(aId !== bId, `clients resolved distinct ids (A=${aId}, B=${bId})`);

  const aSeenByB0 = { ...posOf(cb!.remote, aId) };
  for (let i = 0; i < 60; i++) {
    ca!.remote.tic(cmd({ forward: 1, run: true }, 100 + i));
    cb!.remote.tic(cmd({}, 100 + i));
    await sleep(16);
  }
  const aMovedOnB = dist(aSeenByB0, posOf(cb!.remote, aId));
  console.log(`  A moved ${aMovedOnB.toFixed(1)}mu as SEEN BY B over the prod server`);
  ok(aMovedOnB > 16, "B's mirrored world shows marine A moving over the prod server");

  const avatarsForA = ca!.remote.remotePlayers();
  ok(avatarsForA.length === 1 && avatarsForA[0]!.name === 'MARINE-B', 'A renders B as a named remote avatar');

  for (const s of stacks) s.remote.teardownLevel();
  await sleep(50);
  console.log(`\nAll ${passed} prod-path co-op assertions passed.`);
  process.exit(0);
}
main().catch((err) => { console.error(err); process.exit(1); });
