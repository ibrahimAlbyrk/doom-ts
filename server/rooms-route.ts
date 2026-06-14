// GET /rooms — the JOIN room-browser's discovery endpoint. Colyseus 0.16 removed the client's
// getAvailableRooms() and its built-in GET matchmake route 404s, so we expose our own thin JSON
// route over matchMaker.query('match'). Each open MatchRoom keeps the browser-relevant fields in
// its metadata (see MatchRoom.updateMetadata); here we fold those together with the live
// client/maxClient counts the matchmaker tracks into the RoomInfo[] the client maps to rows.
//
// One process serves client + server (deploy/DEPLOY.md), so in prod this is same-origin; in dev
// the client (Vite) is a different origin from the server (:2567), hence the permissive CORS.
import type { IncomingMessage, ServerResponse, Server as HttpServer } from 'node:http';
import { matchMaker } from 'colyseus';
import type { RoomInfo, GameMode } from '../src/lobby/protocol';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
} as const;

/** The open match rooms as RoomInfo[] — what the browser draws. A room stays listed once it
 *  starts or fills up; its `joinable` flag goes false so the browser greys it (IN PROGRESS / FULL)
 *  instead of hiding it. */
export async function queryMatchRooms(): Promise<RoomInfo[]> {
  const rooms = await matchMaker.query({ name: 'match', private: false });
  return rooms.map((r) => {
    const m = (r.metadata ?? {}) as Partial<RoomInfo>;
    return {
      id: r.roomId,
      hostName: m.hostName ?? 'MARINE',
      mode: (m.mode as GameMode) ?? 'coop',
      skill: m.skill ?? 3,
      episode: m.episode ?? 0,
      startLevel: m.startLevel ?? 0,
      players: r.clients,
      maxPlayers: r.maxClients,
      joinable: (m.joinable ?? true) && !r.locked && r.clients < r.maxClients,
    } satisfies RoomInfo;
  });
}

/** Attach the GET /rooms route to a raw http server (the dev server). Registered before
 *  gameServer.listen so Colyseus preserves it for every non-/matchmake request. */
export function attachRoomsRoute(server: HttpServer): void {
  server.on('request', (req: IncomingMessage, res: ServerResponse) => {
    if (!req.url || !req.url.startsWith('/rooms')) return;
    if (req.method === 'OPTIONS') {
      res.writeHead(204, CORS);
      res.end();
      return;
    }
    void queryMatchRooms()
      .then((rooms) => {
        res.writeHead(200, { ...CORS, 'Content-Type': 'application/json' });
        res.end(JSON.stringify(rooms));
      })
      .catch(() => {
        res.writeHead(500, { ...CORS, 'Content-Type': 'application/json' });
        res.end('[]');
      });
  });
}
