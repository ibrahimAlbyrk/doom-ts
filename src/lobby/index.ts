// src/lobby barrel — the CLIENT lobby/room system (multiplayer-plan §3): the
// transport-neutral protocol (MatchConfig + message set + room state), the LobbyClient
// state machine that views the authoritative room, and a MockLobbyTransport that fakes
// a server so the whole lobby UI is navigable now (no network until P2).
export * from './protocol';
export * from './lobby-client';
export * from './mock-transport';
