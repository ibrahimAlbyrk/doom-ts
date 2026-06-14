// FROZEN CONTRACT — global numeric constants. Sources tagged inline:
//   [DD] docs/research/doom-design.md   [EN] docs/research/engine.md
//   [WA] docs/research/web-arch.md
//
// World/sim coordinates are in DOOM MAP UNITS (mu). One grid cell = CELL_SIZE mu
// (DOOM's canonical 64-unit grid). The renderer divides positions by CELL_SIZE to
// get the cell-space the DDA raycaster works in. Keeping the sim in mu lets the
// data tables in src/data use doom-design.md's numbers verbatim.

// ── Simulation timing ──────────────────────────────────────────────────────
export const TIC_RATE = 35; // [DD §0] DOOM simulation tics/second
export const SECONDS_PER_TIC = 1 / TIC_RATE;
export const FIXED_STEP = 1 / 60; // [WA §2] fixed sim step (seconds)
export const MAX_FRAME_TIME = 0.25; // [WA §2] clamp to avoid spiral-of-death

// ── Grid / world scale ─────────────────────────────────────────────────────
export const CELL_SIZE = 64; // mu per grid cell ([LDB] power-of-two DOOM grid)

// ── Render (engine.md §6, §11) ─────────────────────────────────────────────
export const INTERNAL_WIDTH_DEFAULT = 960; // [EN §6.2] 2x crisp 16:9 default
export const INTERNAL_HEIGHT_DEFAULT = 540;
export const INTERNAL_WIDTH_MED = 480; // [EN §6.2] balanced 16:9
export const INTERNAL_HEIGHT_MED = 270;
export const INTERNAL_WIDTH_RETRO = 320; // [EN §6.2] selectable 4:3 fallback
export const INTERNAL_HEIGHT_RETRO = 200;

/** Selectable internal render resolutions, low → high. Default is the last (crispest). */
export const RESOLUTION_TIERS: readonly { readonly width: number; readonly height: number }[] = [
  { width: INTERNAL_WIDTH_RETRO, height: INTERNAL_HEIGHT_RETRO },
  { width: INTERNAL_WIDTH_MED, height: INTERNAL_HEIGHT_MED },
  { width: INTERNAL_WIDTH_DEFAULT, height: INTERNAL_HEIGHT_DEFAULT },
];
export const FOV_PLANE_RATIO = 0.66; // [EN §0] camera-plane ratio → ~66° FOV
export const COLORMAP_LEVELS = 32; // [EN §5] DOOM NUMCOLORMAPS light bands
export const WALL_TEX_SIZE = 64; // [EN §11] power-of-two wall texture
export const FLAT_TEX_SIZE = 64; // [EN §11] / [assets §3.7] 64×64 flats
export const DEFAULT_SECTOR_LIGHT = 192; // 0..255 baseline sector brightness

// ── Player physics (doom-design.md §1) ─────────────────────────────────────
export const PLAYER_RADIUS = 16; // [DD §1] mu (32×32 AABB body)
export const PLAYER_HEIGHT = 56; // [DD §1]
export const VIEW_HEIGHT = 41; // [DD §1] eye height above floor
export const MAX_STEP_UP = 24; // [DD §1] auto step-up threshold (mu)
export const FRICTION = 0.90625; // [DD §1] 0xE800/65536 per-tic momentum decay
export const STOP_SPEED = 0.0625; // [DD §1] momentum below this snaps to 0 (mu/tic)
export const MAX_MOVE = 30; // [DD §1] per-axis momentum clamp (mu/tic)
export const PLAYER_MASS = 100; // [DD §1]
export const PLAYER_THRUST_WALK = 0.78125; // [DD §1] forwardmove[0]=25 → cmd*2048 fixed
export const PLAYER_THRUST_RUN = 1.5625; // [DD §1] forwardmove[1]=50

// ── Turning (doom-design.md §1) ────────────────────────────────────────────
export const TURN_WALK_DEG_PER_SEC = 123.3; // [DD §1] angleturn 640
export const TURN_RUN_DEG_PER_SEC = 246.6; // [DD §1] angleturn 1280

// ── Combat ranges (doom-design.md §2) ──────────────────────────────────────
export const MELEE_RANGE = 64; // [DD §2] fist range (mu)
export const HITSCAN_RANGE = 2048; // [DD §2] MISSILERANGE — hitscan/autoaim reach
export const ROCKET_SPLASH_RADIUS = 128; // [DD §2] P_RadiusAttack radius

// ── Health & armor caps (doom-design.md §1, §5) ────────────────────────────
export const HEALTH_START = 100;
export const HEALTH_SOFT_CAP = 100; // medikits/stimpacks clamp here
export const HEALTH_HARD_CAP = 200; // soulsphere/megasphere/bonuses
export const ARMOR_GREEN_CAP = 100;
export const ARMOR_BLUE_CAP = 200;
export const ARMOR_GREEN_FACTOR = 1 / 3; // [DD §5] green absorbs 1/3
export const ARMOR_BLUE_FACTOR = 1 / 2; // [DD §5] blue absorbs 1/2

// ── Misc ───────────────────────────────────────────────────────────────────
export const REACTION_TICS = 8; // [DD §3] monster sight→first-attack delay
export const PAIN_RNG_MAX = 256; // [DD §3] painChance is compared against 0..255
export const KNOCKBACK_SCALE = 12.5; // [DD §3] thrust ≈ damage*scale/mass

/** Default RNG seed — deterministic boot; the game can reseed at level start. */
export const DEFAULT_SEED = 0x1d00d;
