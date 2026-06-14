// Production entry — serves the built client AND the Colyseus match server from ONE Node
// process on ONE port (multiplayer-deploy.md §5.3 "Node serves static itself"; the directive's
// "single Node process is simplest for a friends-deployment"). This is purely packaging: it
// reuses the SAME MatchRoom the dev server (server/index.ts) defines, so it stays agnostic to
// whatever the multiplayer logic becomes.
//
// One http.Server backs both:
//   • Express serves the static Vite build (dist/) with the cross-origin-isolation headers the
//     client wants (mirrors vite.config dev headers + the Caddyfile),
//   • Colyseus attaches its WebSocket transport + /matchmake HTTP routes to the same server
//     (Colyseus preserves the Express request listener for everything that isn't /matchmake).
//
// Behind Caddy (TLS, recommended) Caddy reverse-proxies everything to this one port; for a quick
// LAN / raw-IP test this process is reachable directly over http://<host>:PORT. Run: npm run start:prod
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { Server } from 'colyseus';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { MatchRoom } from './match-room';
import { queryMatchRooms } from './rooms-route';

const PORT = Number(process.env.PORT ?? 2567);
// HOST 0.0.0.0 so friends on the LAN / internet can reach it (not just localhost).
const HOST = process.env.HOST ?? '0.0.0.0';

const repoRoot = path.resolve(fileURLToPath(import.meta.url), '..', '..');
const clientDir = process.env.CLIENT_DIR ?? path.join(repoRoot, 'dist');

const app = express();

// Cross-origin isolation — same headers vite dev + the Caddyfile send, so SharedArrayBuffer /
// AudioWorklet keep working when the client is served by this process directly.
app.use((_req, res, next) => {
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
  next();
});

// JOIN room-browser discovery (same-origin here, so no CORS needed): the open match rooms as
// RoomInfo[]. Must come before the SPA fallback so it isn't swallowed as a client route.
app.get('/rooms', (_req, res) => {
  void queryMatchRooms()
    .then((rooms) => res.json(rooms))
    .catch(() => res.json([]));
});

app.use(express.static(clientDir));
// SPA fallback for any non-asset, non-/matchmake request (Colyseus intercepts /matchmake before
// this listener runs). Express 5 catch-all via a bare middleware, avoiding path-pattern parsing.
app.use((_req, res) => res.sendFile(path.join(clientDir, 'index.html')));

const httpServer = http.createServer(app);
const gameServer = new Server({ transport: new WebSocketTransport({ server: httpServer }) });
gameServer.define('match', MatchRoom);

gameServer
  .listen(PORT, HOST)
  .then(() =>
    console.log(`[prod] DOOM client + match server on http://${HOST}:${PORT} (client: ${clientDir})`),
  )
  .catch((err) => {
    console.error('[prod] failed to start:', err);
    process.exit(1);
  });
