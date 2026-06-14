// src/score barrel — the shared DEATHMATCH score model (multiplayer-plan §4). The
// scoreboard + results UI (src/ui) draw from these types; P5b's deathmatch rules
// populate them. No rendering or DOM lives here, so the sim side can import it too.
export * from './types';
