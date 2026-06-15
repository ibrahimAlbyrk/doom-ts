// Room browser — REAL WIRE end-to-end (`npx tsx server/room-browser-e2e.test.ts`). Boots the
// actual Colyseus MatchRoom + the GET /rooms discovery route and drives TWO real client stacks
// through the NO-CODES / NO-ADDRESS flow the directive asks for:
//   • client A HOSTS a co-op room (just a MatchConfig — no code shared),
//   • client B calls listRooms() and SEES A's room in the list, with the right host / mode /
//     players X/Y / joinable flag — discovered purely from the server, nothing typed,
//   • B JOINS the room by its opaque id (the row's id, never shown) → both land in one lobby,
//   • both ready up → host STARTs → a co-op match seeds and both marines spawn,
//   • once started, the room's listing flips to NON-joinable (the browser would grey it).
// Throws on the first failed assertion. Exits 0 explicitly (server timers keep the loop alive).
import http from 'node:http';
import { Server } from 'colyseus';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { type TicCommand } from '../src/game/session';
import { MatchRoom } from './match-room';
import { attachRoomsRoute } from './rooms-route';
import { ColyseusTransport } from '../src/session/colyseus-transport';
import { RemoteSession } from '../src/session/remote-session';
import { LobbyClient, defaultMatchConfig } from '../src/lobby';

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
/** Poll listRooms() until the room list satisfies `pred` (the async sibling of waitFor). */
async function waitForRooms(
  lobby: LobbyClient,
  pred: (rooms: Awaited<ReturnType<LobbyClient['listRooms']>>) => boolean,
  label: string,
  timeoutMs = 6000,
): Promise<void> {
  const start = Date.now();
  for (;;) {
    if (pred(await lobby.listRooms())) return;
    if (Date.now() - start > timeoutMs) throw new Error(`TIMEOUT waiting for ${label}`);
    await sleep(50);
  }
}
function cmd(seq = 0): TicCommand {
  return {
    forward: 0, strafe: 0, turn: 0, lookTurn: 0, run: false, fire: false,
    use: false, weaponSlot: 0, weaponCycle: 0, pause: false, seq,
  };
}

async function main(): Promise<void> {
  console.log('Room browser end-to-end over the real Colyseus wire (2 clients, no codes/addresses)');
  // MP_URL drives an already-running deployment over the real public wire (e.g.
  // wss://host); without it we boot a throwaway local server. listRooms() maps ws→http /
  // wss→https for the GET /rooms discovery call.
  const remoteUrl = process.env.MP_URL;
  const PORT = 2603;
  const url = remoteUrl ?? `ws://localhost:${PORT}`;
  let gameServer: Server | undefined;
  if (!remoteUrl) {
    // Same wiring as server/index.ts: own the http server so GET /rooms rides the ws port.
    const httpServer = http.createServer();
    attachRoomsRoute(httpServer);
    gameServer = new Server({ transport: new WebSocketTransport({ server: httpServer }) });
    gameServer.define('match', MatchRoom);
    await gameServer.listen(PORT);
  }
  console.log(`  ${remoteUrl ? 'driving remote server at' : 'server listening on'} ${url}`);

  try {
    // ── A HOSTS a co-op room (no code is shared anywhere) ───────────────────────────────────
    const aTransport = new ColyseusTransport(url);
    const aLobby = new LobbyClient(aTransport, { name: 'SARGE', color: 0 });
    aLobby.host({ ...defaultMatchConfig('coop'), skill: 4, maxPlayers: 4 });
    await waitFor(() => aLobby.phase === 'inRoom' && !!aLobby.room, 'A is hosting a co-op room');
    ok(aLobby.room!.config.mode === 'coop', 'A hosted a CO-OP room (host shared no code)');

    // ── B DISCOVERS the room via listRooms() — the browser's live query, nothing typed ───────
    const bTransport = new ColyseusTransport(url);
    const bLobby = new LobbyClient(bTransport, { name: 'DOOMGUY', color: 3 });
    await waitForRooms(bLobby, (r) => r.length >= 1, "B's browser sees a room");
    const rooms = await bLobby.listRooms();
    ok(rooms.length === 1, `B's browser lists exactly the 1 open room`);
    const row = rooms[0]!;
    ok(row.hostName === 'SARGE', `row shows the host name (${row.hostName})`);
    ok(row.mode === 'coop', `row shows the mode (CO-OP)`);
    ok(row.skill === 4, `row shows the skill (${row.skill})`);
    ok(row.players === 1 && row.maxPlayers === 4, `row shows players ${row.players}/${row.maxPlayers}`);
    ok(row.joinable === true, 'row is JOINABLE (waiting in lobby, not full)');
    ok(typeof row.id === 'string' && row.id.length > 0, 'row carries an opaque id (never shown to the player)');

    // ── B JOINS the picked room by its id (no code, no address) ──────────────────────────────
    bLobby.join(row.id);
    await waitFor(
      () => (aLobby.room?.players.length ?? 0) === 2 && (bLobby.room?.players.length ?? 0) === 2,
      'both clients share one lobby (roster size 2)',
    );
    ok(bLobby.phase === 'inRoom' && !bLobby.isHost, 'B is in the lobby as a non-host');

    // ── both ready → host STARTs → a co-op match seeds and both marines spawn ─────────────────
    aLobby.toggleReady();
    bLobby.toggleReady();
    await waitFor(() => aLobby.canStart, 'all ready + host can start');
    aLobby.start();
    await waitFor(() => !!aLobby.matchStarting && !!bLobby.matchStarting, 'both got matchStarting');
    const levelId = aLobby.matchStarting!.levelId;
    ok(aLobby.matchStarting!.config.mode === 'coop', `CO-OP match started on ${levelId}`);

    const aRemote = new RemoteSession(aTransport);
    const bRemote = new RemoteSession(bTransport);
    aRemote.enterMatch(levelId);
    bRemote.enterMatch(levelId);
    for (let i = 0; i < 24; i++) {
      aRemote.tic(cmd(i));
      bRemote.tic(cmd(i));
      await sleep(16);
    }
    await waitFor(
      () => aRemote.world.players.size >= 2 && bRemote.world.players.size >= 2,
      'both clients see two co-op marines in the running match',
    );
    ok(aRemote.world.localPlayerId !== bRemote.world.localPlayerId, 'the two clients are distinct marines');

    // ── the started room is now NON-joinable (the browser would grey it: IN PROGRESS) ─────────
    await waitForRooms(bLobby, (r) => r.length > 0 && r.every((x) => !x.joinable), 'started room is no longer joinable');
    ok(true, 'once started, the room lists as NON-joinable (browser shows IN PROGRESS)');

    aRemote.teardownLevel();
    bRemote.teardownLevel();
    await sleep(50);
  } finally {
    if (gameServer) await gameServer.gracefullyShutdown(false);
  }

  console.log(`\nAll ${passed} room-browser end-to-end assertions passed.`);
  process.exit(0);
}
main().catch((err) => {
  console.error(err);
  process.exit(1);
});
