// src/session barrel — the Session abstraction: the boundary between the client app
// and the authoritative sim. LocalSession (offline single-player, in-process) +
// RemoteSession (online seam). See docs/multiplayer-plan.md §0.1.
export * from './session';
export * from './local-session';
export * from './remote-session';
