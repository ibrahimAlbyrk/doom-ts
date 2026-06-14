// Pure local-player MOVEMENT for one tick — the only slice of a marine's command the
// online client predicts and replays (turn + thrust + wall-slide collision). Extracted
// from GameSession.applyPlayerInput (multiplayer-plan §1.2 / netcode §5.2) so the SERVER
// authority and the CLIENT prediction run byte-identical movement and therefore agree on
// position AND wall collisions. Everything else in a tick (use, fire, weapons, AI,
// projectiles, doors, items) stays server-authoritative and is never predicted.
import type { ILevelRuntime, Player } from '../core';
import {
  FIXED_STEP,
  PLAYER_THRUST_WALK,
  PLAYER_THRUST_RUN,
  TURN_WALK_DEG_PER_SEC,
  TURN_RUN_DEG_PER_SEC,
  degToRad,
} from '../core';
import { applyThrust, stepMovement } from '../world';
import type { TicCommand } from './session';

/** Advance ONE marine's angle + position for a tick from its command, over `tics` DOOM
 *  tics: keyboard turn + folded mouse-look, forward/strafe momentum thrust, then a
 *  friction slide-move with wall collision. Deterministic over (player, level, cmd) — the
 *  client's predicted/replayed result matches the server's authoritative step exactly. */
export function applyPlayerMovement(p: Player, level: ILevelRuntime, cmd: TicCommand, tics: number): void {
  const turnRate = degToRad(cmd.run ? TURN_RUN_DEG_PER_SEC : TURN_WALK_DEG_PER_SEC);
  p.angle += cmd.turn * turnRate * FIXED_STEP + cmd.lookTurn;

  const thrust = cmd.run ? PLAYER_THRUST_RUN : PLAYER_THRUST_WALK;
  if (cmd.forward !== 0) applyThrust(p, p.angle, thrust * cmd.forward, tics);
  if (cmd.strafe !== 0) applyThrust(p, p.angle + Math.PI / 2, thrust * cmd.strafe, tics);
  stepMovement(p, level, tics);
}
