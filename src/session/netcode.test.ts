// Netcode P2 acceptance harness (`npx tsx src/session/netcode.test.ts`). Two halves:
//   Part 1 — IN-PROCESS authoritative sim: the N-player stepNetwork moves each marine from
//            its own command, a marine's gunshot damages a shared monster, and co-op
//            friendly-fire is OFF (player→player blocked; player→monster + self-splash kept).
//   Part 2 — REAL WIRE: boots the Colyseus match server, drives TWO real client stacks
//            (ColyseusTransport + LobbyClient + RemoteSession) through host → join-by-code →
//            ready → START, then proves EACH CLIENT SEES THE OTHER MOVE in its mirrored world.
// Throws on the first failed assertion (non-zero exit). Exits 0 explicitly (server timers).
import { Server } from 'colyseus';
import { EventBus, Rng, DEFAULT_SEED } from '../core';
import type { GameEventMap, SimContext } from '../core';
import { World, spawnMonster } from '../entities';
import { applyDamage } from '../combat';
import { GameSession, type TicCommand } from '../game/session';
import { MatchRoom } from '../../server/match-room';
import { ColyseusTransport } from './colyseus-transport';
import { RemoteSession } from './remote-session';
import { LobbyClient, defaultMatchConfig } from '../lobby';

let passed = 0;
function ok(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
  passed++;
  console.log(`  ok  ${msg}`);
}
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
async function waitFor(pred: () => boolean, label: string, timeoutMs = 5000): Promise<void> {
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

// ── Part 1: in-process authoritative step ───────────────────────────────────────
function part1(): void {
  console.log('\nPart 1 — authoritative N-player step (in-process)');
  const world = new World();
  const events = new EventBus<GameEventMap>();
  const rng = new Rng(DEFAULT_SEED);
  world.addPlayer(0, 0, 0); // 2 marines total (ids 0,1)
  const ctx: SimContext = { world, events, rng, skill: 3, episodeLevel: 0 };
  const sim = new GameSession(ctx, { presentation: false });
  sim.startNewGame(3, 'E1M1');
  world.friendlyFire = false; // co-op seed

  const p0 = world.players.get(0)!;
  const p1 = world.players.get(1)!;
  ok(world.players.size === 2, 'match seeded with two marines tracked');
  ok(Math.hypot(p0.x - p1.x, p0.y - p1.y) > 0, 'marines spawned at distinct co-op start offsets');

  // Per-player movement: drive ONLY p0 forward; p0 advances, p1 holds position.
  const p0x = p0.x, p0y = p0.y, p1x = p1.x, p1y = p1.y;
  for (let i = 0; i < 30; i++) {
    sim.stepNetwork(new Map([[0, cmd({ forward: 1 }, i)], [1, cmd({}, i)]]));
  }
  ok(Math.hypot(p0.x - p0x, p0.y - p0y) > 16, 'p0 moved under its own command (authoritative per-player movement)');
  ok(Math.hypot(p1.x - p1x, p1.y - p1y) < 2, 'p1 stayed put — only its own command moves it');

  // Shoot a monster THROUGH the authoritative step: a zombie point-blank ahead of p0.
  const mAng = p0.angle;
  const mon = spawnMonster(world, 3004, p0.x + Math.cos(mAng) * 44, p0.y + Math.sin(mAng) * 44, 0, events);
  ok(!!mon, 'spawned a shared monster in front of p0');
  p0.inventory.weapons.shotgun = true;
  p0.currentWeapon = 'shotgun';
  p0.inventory.ammo.shells = 20;
  const monHp = mon!.health;
  for (let i = 0; i < 24; i++) {
    sim.stepNetwork(new Map([[0, cmd({ fire: true }, 100 + i)], [1, cmd({}, 100 + i)]]));
  }
  const monGone = !world.monsters.some((m) => m.id === mon!.id);
  ok(monGone || mon!.health < monHp, 'a marine gunshot damaged the shared monster (shooting works over the step)');

  // Friendly fire OFF: player→OTHER-player blocked; player→monster + self-splash still land.
  p1.health = 100;
  applyDamage(world, p1, 40, p0.id, 'player', rng); // FF off
  ok(p1.health === 100, 'friendly fire OFF: p0 cannot damage p1');
  const fresh = spawnMonster(world, 3004, p1.x + 30, p1.y, 0, events)!;
  const fHp = fresh.health;
  applyDamage(world, fresh, 15, p0.id, 'player', rng);
  ok(fresh.health < fHp, 'friendly fire OFF still lets a marine damage MONSTERS');
  p0.health = 100;
  applyDamage(world, p0, 25, p0.id, 'player', rng); // self-splash (sourceId === target)
  ok(p0.health < 100, 'friendly fire OFF still lets your OWN splash hurt you');

  // Control: FF ON lets player damage player.
  world.friendlyFire = true;
  p1.health = 100;
  applyDamage(world, p1, 40, p0.id, 'player', rng);
  ok(p1.health < 100, 'friendly fire ON (deathmatch/SP default): player damages player');
}

// ── Part 2: real Colyseus 2-client see-each-other ────────────────────────────────
interface ClientStack {
  transport: ColyseusTransport;
  lobby: LobbyClient;
  remote: RemoteSession;
}
function makeStack(url: string, name: string, color: number): { transport: ColyseusTransport; lobby: LobbyClient } {
  const transport = new ColyseusTransport(url);
  const lobby = new LobbyClient(transport, { name, color });
  return { transport, lobby };
}

async function part2(): Promise<void> {
  console.log('\nPart 2 — real Colyseus wire: two clients SEE EACH OTHER move');
  const PORT = 2599;
  const url = `ws://localhost:${PORT}`;
  const gameServer = new Server();
  gameServer.define('match', MatchRoom);
  await gameServer.listen(PORT);
  console.log(`  server listening on ${url}`);

  try {
    // Client A hosts a co-op room.
    const a = makeStack(url, 'MARINE-A', 0);
    a.lobby.host(defaultMatchConfig('coop'));
    await waitFor(() => a.lobby.phase === 'inRoom' && !!a.lobby.room, 'A in room');
    const roomId = a.lobby.room!.code; // RoomState.code is the server roomId (joinById target)
    ok(!!roomId, `A hosted room ${roomId}`);

    // Client B joins by the room id (what the browser passes from the picked room).
    const b = makeStack(url, 'MARINE-B', 3);
    b.lobby.join(roomId);
    await waitFor(() => b.lobby.phase === 'inRoom' && (b.lobby.room?.players.length ?? 0) === 2, 'B joined');
    await waitFor(() => (a.lobby.room?.players.length ?? 0) === 2, 'A sees B in roster');
    ok(a.lobby.room!.players.length === 2, 'both marines share one room (roster size 2)');

    // Both ready up; host starts.
    a.lobby.toggleReady();
    b.lobby.toggleReady();
    await waitFor(() => a.lobby.allReady && a.lobby.canStart, 'all ready + host can start');
    a.lobby.start();
    await waitFor(() => !!a.lobby.matchStarting && !!b.lobby.matchStarting, 'both got matchStarting');
    const levelId = a.lobby.matchStarting!.levelId;
    ok(a.lobby.matchStarting!.config.mode === 'coop', `match started co-op on ${levelId} (friendly fire off)`);

    // Build each client's RemoteSession over the SAME room and enter the match.
    const stacks: ClientStack[] = [a, b].map((s) => {
      const remote = new RemoteSession(s.transport);
      remote.enterMatch(levelId);
      return { ...s, remote };
    });
    const [ca, cb] = stacks;

    // Pump a few idle ticks so both resolve their own marine id from the first snapshots.
    for (let i = 0; i < 20; i++) {
      ca!.remote.tic(cmd({}, i));
      cb!.remote.tic(cmd({}, i));
      await sleep(16);
    }
    await waitFor(() => ca!.remote.world.players.size >= 2 && cb!.remote.world.players.size >= 2, 'both see two marines');
    const aId = ca!.remote.world.localPlayerId;
    const bId = cb!.remote.world.localPlayerId;
    ok(aId !== bId, `clients resolved distinct ids (A=${aId}, B=${bId})`);

    // A walks forward; B holds. B's mirrored world must show A's avatar advancing.
    const aSeenByB0 = { ...posOf(cb!.remote, aId) };
    const aSelf0 = { ...posOf(ca!.remote, aId) };
    for (let i = 0; i < 60; i++) {
      ca!.remote.tic(cmd({ forward: 1, run: true }, 100 + i));
      cb!.remote.tic(cmd({}, 100 + i));
      await sleep(16);
    }
    const aSeenByB1 = posOf(cb!.remote, aId);
    const aSelf1 = posOf(ca!.remote, aId);
    const aMovedOnB = dist(aSeenByB0, aSeenByB1);
    console.log(`  A moved ${aMovedOnB.toFixed(1)}mu as SEEN BY B  (A self ${dist(aSelf0, aSelf1).toFixed(1)}mu)`);
    ok(aMovedOnB > 16, "B's screen shows marine A moving in real time");
    ok(dist(aSelf0, aSelf1) > 16, 'A also advances in its own authoritative view');

    // Now B walks; A holds. A's mirrored world must show B's avatar advancing.
    const bSeenByA0 = { ...posOf(ca!.remote, bId) };
    for (let i = 0; i < 60; i++) {
      ca!.remote.tic(cmd({}, 300 + i));
      cb!.remote.tic(cmd({ forward: 1, run: true }, 300 + i));
      await sleep(16);
    }
    const bSeenByA1 = posOf(ca!.remote, bId);
    const bMovedOnA = dist(bSeenByA0, bSeenByA1);
    console.log(`  B moved ${bMovedOnA.toFixed(1)}mu as SEEN BY A`);
    ok(bMovedOnA > 16, "A's screen shows marine B moving in real time");

    // Other-player avatar feed is populated (what scene.ts renders as PLAY billboards).
    const avatarsForA = ca!.remote.remotePlayers();
    ok(avatarsForA.length === 1 && avatarsForA[0]!.name === 'MARINE-B', 'A renders B as a named remote avatar');

    for (const s of stacks) s.remote.teardownLevel();
    await sleep(50);
  } finally {
    await gameServer.gracefullyShutdown(false);
  }
}

function posOf(s: RemoteSession, id: number): { x: number; y: number } {
  const p = s.world.players.get(id);
  return { x: p?.x ?? 0, y: p?.y ?? 0 };
}
function dist(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

async function main(): Promise<void> {
  part1();
  await part2();
  console.log(`\nAll ${passed} netcode (P2) assertions passed.`);
  process.exit(0);
}
main().catch((err) => {
  console.error(err);
  process.exit(1);
});
