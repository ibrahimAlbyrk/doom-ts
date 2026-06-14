// Lobby state-machine harness — run with `npx tsx src/lobby/lobby-client.test.ts`.
// Drives the LobbyClient through the MockLobbyTransport and asserts the §3.2 lifecycle:
// create (host) → waiting ↔ allReady → starting, the config-clears-ready rule, the
// START gate (host-only + all-ready), and the non-host join (read-only) path.
import { LobbyClient } from './lobby-client';
import { MockLobbyTransport } from './mock-transport';
import { defaultMatchConfig } from './protocol';

let passed = 0;
function ok(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
  passed++;
}

// ── host flow: create → waiting → allReady → starting ────────────────────────────
{
  const mock = new MockLobbyTransport(); // no auto-fake-player: drive it explicitly
  const client = new LobbyClient(mock, { name: 'MARINE' });

  client.host(defaultMatchConfig('coop'));
  // host() connects via a resolved promise; flush microtasks so createRoom is delivered.
  await Promise.resolve();
  await Promise.resolve();

  ok(client.phase === 'inRoom', 'host lands in a room');
  ok(client.isHost, 'creator is host');
  ok(client.room?.status === 'hosting', 'solo room status is hosting');
  ok(client.room?.players.length === 1, 'room has just the host');
  ok(!client.canStart, 'cannot start a 1-player hosting room (needs all ready)');
  ok(!!client.room?.code && client.room.code.length === 4, 'room has a 4-char code');

  const botId = mock.simulatePlayerJoin('BOT', 2);
  ok(client.room?.players.length === 2, 'second player appears in roster');
  ok(client.room?.status === 'waiting', 'status drops to waiting with an unready player');
  ok(!client.canStart, 'still cannot start: not everyone ready');

  client.toggleReady(); // host readies
  ok(client.localPlayer?.ready === true, 'host ready flips true');
  ok(client.room?.status === 'waiting', 'still waiting: bot not ready');
  ok(!client.canStart, 'host ready alone does not unlock START');

  mock.simulatePlayerReady(botId, true);
  ok(client.room?.status === 'allReady', 'all ready ⇒ allReady status');
  ok(client.allReady, 'allReady derived flag set');
  ok(client.canStart, 'host START unlocks when everyone is ready');

  client.start();
  ok(client.phase === 'starting', 'start → starting phase');
  ok(client.matchStarting?.config.mode === 'coop', 'matchStarting carries the config');
  ok(typeof client.matchStarting?.levelId === 'string', 'matchStarting resolves a levelId');
}

// ── config change clears everyone's ready (§3.2) ─────────────────────────────────
{
  const mock = new MockLobbyTransport();
  const client = new LobbyClient(mock, { name: 'MARINE' });
  client.host(defaultMatchConfig('coop'));
  await Promise.resolve();
  await Promise.resolve();
  const botId = mock.simulatePlayerJoin('BOT', 2);
  client.toggleReady();
  mock.simulatePlayerReady(botId, true);
  ok(client.canStart, 'precondition: all ready');

  client.setConfig({ mode: 'deathmatch' });
  ok(client.room?.config.mode === 'deathmatch', 'config change applied');
  ok(client.room!.players.every((p) => !p.ready), 'config change cleared everyone ready');
  ok(!client.canStart, 'START re-locked after config change');
}

// ── listRooms: the JOIN browser's discovery query (no codes/addresses) ───────────
{
  const mock = new MockLobbyTransport();
  const client = new LobbyClient(mock, { name: 'BROWSER' });
  const rooms = await client.listRooms();
  ok(rooms.length >= 1, 'listRooms returns the open rooms');
  ok(rooms.every((r) => typeof r.id === 'string' && r.id.length > 0), 'each room carries an opaque id');
  ok(rooms.some((r) => r.joinable), 'at least one room is joinable');
  ok(rooms.some((r) => !r.joinable), 'a non-joinable (full/in-progress) room is listed too');
  const r0 = rooms[0]!;
  ok(typeof r0.hostName === 'string' && (r0.mode === 'coop' || r0.mode === 'deathmatch'), 'rows carry host + mode');
  ok(typeof r0.players === 'number' && typeof r0.maxPlayers === 'number', 'rows carry players X/Y');
}

// ── non-host join: read-only, cannot start, cannot edit config ───────────────────
{
  const mock = new MockLobbyTransport();
  const client = new LobbyClient(mock, { name: 'NEWCOMER' });
  client.join('room-abcd'); // join by opaque room id (the browser passes the picked room's id)
  await Promise.resolve();
  await Promise.resolve();

  ok(client.phase === 'inRoom', 'joiner lands in a room');
  ok(!client.isHost, 'joiner is NOT host');
  ok(client.room!.players.some((p) => p.isHost && p.id !== client.localPlayerId), 'a separate host exists');

  const before = client.room?.config.mode;
  client.setConfig({ mode: 'deathmatch' }); // guarded: non-host edits are dropped
  ok(client.room?.config.mode === before, 'non-host setConfig is a no-op');

  client.toggleReady();
  ok(client.localPlayer?.ready === true, 'joiner can still ready up');
  ok(!client.canStart, 'joiner can never START');
}

// ── join rejection: full room ────────────────────────────────────────────────────
{
  const mock = new MockLobbyTransport();
  const client = new LobbyClient(mock, { name: 'LATE' });
  client.join('room-full');
  await Promise.resolve();
  await Promise.resolve();
  // fill the room to capacity, then a fresh joiner is rejected
  const room = mock.getRoom()!;
  while (mock.getRoom()!.players.length < room.config.maxPlayers) mock.simulatePlayerJoin();
  const c2 = new LobbyClient(mock, { name: 'TOOLATE' });
  c2.join('room-full');
  await Promise.resolve();
  await Promise.resolve();
  ok(c2.phase === 'rejected', 'joining a full room is rejected');
  ok(c2.rejectReason === 'ROOM FULL', 'rejection carries a reason');
}

console.log(`lobby-client: ${passed} assertions passed`);
