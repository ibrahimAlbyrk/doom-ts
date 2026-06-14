// Authoritative multiplayer server bootstrap (multiplayer-plan §2 / P2). A single Colyseus
// process behind which one `MatchRoom == one match` runs the SAME headless GameSession the
// browser runs — just authoritatively for every connected marine. It imports the shared sim
// from ../src directly (no workspaces/monorepo; multiplayer-plan §2). Run: `npm run server`.
import http from 'node:http';
import { Server } from 'colyseus';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { MatchRoom } from './match-room';
import { attachRoomsRoute } from './rooms-route';

const PORT = Number(process.env.PORT ?? 2567);

// Own the http server so the JOIN room-browser's GET /rooms route can ride the same port as the
// Colyseus ws/matchmake endpoint (Colyseus preserves request listeners registered before listen).
const httpServer = http.createServer();
attachRoomsRoute(httpServer);

const gameServer = new Server({ transport: new WebSocketTransport({ server: httpServer }) });
// One room type — "match". The client creates it (host) or joins by id (multiplayer-plan §3.3).
gameServer.define('match', MatchRoom);

gameServer
  .listen(PORT)
  .then(() => console.log(`[colyseus] DOOM match server listening on ws://localhost:${PORT}`))
  .catch((err) => {
    console.error('[colyseus] failed to start:', err);
    process.exit(1);
  });
