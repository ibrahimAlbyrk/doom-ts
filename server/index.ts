// Authoritative multiplayer server bootstrap (multiplayer-plan §2 / P2). A single Colyseus
// process behind which one `MatchRoom == one match` runs the SAME headless GameSession the
// browser runs — just authoritatively for every connected marine. It imports the shared sim
// from ../src directly (no workspaces/monorepo; multiplayer-plan §2). Run: `npm run server`.
import { Server } from 'colyseus';
import { MatchRoom } from './match-room';

const PORT = Number(process.env.PORT ?? 2567);

const gameServer = new Server();
// One room type — "match". The client creates it (host) or joins by id (multiplayer-plan §3.3).
gameServer.define('match', MatchRoom);

gameServer
  .listen(PORT)
  .then(() => console.log(`[colyseus] DOOM match server listening on ws://localhost:${PORT}`))
  .catch((err) => {
    console.error('[colyseus] failed to start:', err);
    process.exit(1);
  });
