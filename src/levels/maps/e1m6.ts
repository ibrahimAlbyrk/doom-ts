// E1M6 "The Iron Throne" — hell fortress, BOSS CLIMAX (44×38, SKY3). From the
// Gates two parallel flesh wings (W = YELLOW key, E = RED key) feed a central
// antechamber: the YELLOW door opens it, the RED door opens the grand sky-lit ARENA.
// A CYBERDEMON waits before its throne, flanked by hell knights, cacodemons and imps
// among MARBFACE pillars (cover that breaks rocket LOS). The BFG + cells are staged
// at the arena mouth and perimeter; a megasphere sits mid-floor to pull you forward.
// Kill your way to the dais and throw the exit switch behind the throne → VICTORY.
// Secret: a hidden lift in the antechamber rises to an invulnerability (grab it
// before committing to the boss).
//
// Flow: Gates(start) ─W/E wings (YELLOW + RED keys, either order) ─YELLOW door─
//       antechamber ─RED door─ cyberdemon ARENA ─ exit switch behind throne → victory.
import { compile, cells } from '../build';

export const E1M6 = compile({
  id: 'E1M6',
  name: 'The Iron Throne',
  par: 300,
  sky: 'SKY3',
  music: 'D_E1M4',
  base: { floor: 'MFLR8_1', ceil: 'CEIL5_1', floorH: 0, ceilH: 168, light: 140 },
  legend: {
    '#': { wall: 'MARBLE1' },
    P: { wall: 'SP_DUDE1' }, // impaled-corpse wall behind the throne
    '=': { wall: 'MARBFACE' }, // arena cover pillars
    S: { wall: 'SW1EXIT' },
    L: { floor: 'FLAT5_7' }, // secret lift platform
    '.': {},
  },
  rows: [
    '############################################',
    '############################################',
    '############################################',
    '#################PPPPSPPPPP#################',
    '####....................................####',
    '####....................................####',
    '####....................................####',
    '####....................................####',
    '####.....==......................==.....####',
    '####.....==......................==.....####',
    '####....................................####',
    '####............==.........==...........####',
    '####............==.........==...........####',
    '####.....==......................==.....####',
    '####.....==......................==.....####',
    '####....................................####',
    '####....................................####',
    '####....................................####',
    '#####################.######################',
    '####################...#####################',
    '##.............#####...######.............##',
    '##.............#####...######.............##',
    '##.............#####...######.............##',
    '##.............#####...######.............##',
    '##.............#............#.............##',
    '##.............#............#.............##',
    '##.............#.........L..#.............##',
    '##.............#............#.............##',
    '##.............#............#.............##',
    '##.............#............#.............##',
    '##.............#............#.............##',
    '##.............######.#######.............##',
    '##.............#............#.............##',
    '##........................................##',
    '##.............#............#.............##',
    '##.............#............#.............##',
    '############################################',
    '############################################',
  ],
  paint: [
    { x0: 4, y0: 4, x1: 39, y1: 17, floor: 'MFLR8_1', ceil: null, ceilH: 256, light: 168 }, // arena (sky)
    { x0: 17, y0: 4, x1: 26, y1: 7, floor: 'FLAT5_7', floorH: 16, light: 150 }, // throne dais (+16)
    { x0: 17, y0: 8, x1: 26, y1: 8, floor: 'BLOOD3', light: 130 }, // blood before the throne
    { x0: 20, y0: 18, x1: 22, y1: 23, floor: 'FLAT5_4', light: 138 }, // spine
    { x0: 16, y0: 24, x1: 27, y1: 30, floor: 'FLAT5_7', ceil: 'CEIL5_1', ceilH: 144, light: 128 }, // antechamber
    { x0: 24, y0: 24, x1: 26, y1: 25, floor: 'MFLR8_1', floorH: 64, ceil: 'FLAT1', ceilH: 104, light: 120 }, // secret perch (+64)
    { x0: 16, y0: 32, x1: 27, y1: 35, floor: 'FLAT5_4', ceil: 'CEIL5_1', ceilH: 128, light: 142 }, // gates/entry
    { x0: 2, y0: 20, x1: 14, y1: 35, floor: 'BLOOD1', ceil: 'CEIL5_1', ceilH: 152, light: 120 }, // yellow wing (flesh)
    { x0: 29, y0: 20, x1: 41, y1: 35, floor: 'BLOOD1', ceil: 'CEIL5_1', ceilH: 152, light: 120 }, // red wing (flesh)
  ],
  doors: [
    { x: 21, y: 18, texture: 'DOORRED', kind: 'locked', key: 'red' }, // antechamber → arena
    { x: 21, y: 31, texture: 'DOORYEL', kind: 'locked', key: 'yellow' }, // entry → antechamber
    { x: 15, y: 33, texture: 'WOODGARG' }, // entry → yellow wing
    { x: 28, y: 33, texture: 'WOODGARG' }, // entry → red wing
  ],
  lifts: [
    // trigger covers all three open antechamber sides of the lift (S/W/E), so it boards
    // from any approach — the north side is the +64 secret-perch destination.
    { cells: [{ x: 25, y: 26 }], low: 0, high: 64, trigger: { kind: 'walkover', x: 25, y: 27, once: false, cells: [{ x: 25, y: 27 }, { x: 24, y: 26 }, { x: 26, y: 26 }] } }, // secret invuln perch
  ],
  exits: [{ kind: 'normal', trigger: { kind: 'switch', x: 21, y: 3 } }], // behind the throne → VICTORY
  secrets: cells(24, 24, 26, 25),
  things: [
    { id: 6, x: 5, y: 25, angle: 0 }, // yellow key (west wing)
    { id: 13, x: 38, y: 25, angle: 180 }, // red key (east wing)
    // Boss economy: BFG + cells staged, megasphere mid-arena, RL/plasma backups in wings.
    { id: 2006, x: 21, y: 16 }, // BFG9000 (arena mouth pedestal)
    { id: 17, x: 6, y: 16 }, // cell pack (perimeter)
    { id: 17, x: 37, y: 16 }, // cell pack (perimeter)
    { id: 17, x: 21, y: 5 }, // cell pack (by the throne — forces movement)
    { id: 83, x: 21, y: 11 }, // megasphere (mid-arena)
    { id: 2004, x: 10, y: 28 }, // plasma rifle (yellow wing)
    { id: 2003, x: 33, y: 28 }, // rocket launcher (red wing)
    { id: 2046, x: 7, y: 5 }, // box of rockets
    { id: 2046, x: 36, y: 5 }, // box of rockets
    { id: 82, x: 21, y: 34 }, // super shotgun (gates)
    { id: 2002, x: 37, y: 21 }, // chaingun (red wing, pistol-start)
    { id: 2001, x: 5, y: 21 }, // shotgun (yellow wing, pistol-start)
    { id: 2049, x: 5, y: 28 }, // box of shells
    { id: 2049, x: 37, y: 28 }, // box of shells
    { id: 2048, x: 10, y: 25 }, // box of bullets
    { id: 2048, x: 33, y: 25 }, // box of bullets
    { id: 2012, x: 7, y: 7 }, // medikit
    { id: 2012, x: 36, y: 7 }, // medikit
    { id: 2012, x: 21, y: 7 }, // medikit (dais)
    { id: 2011, x: 6, y: 33 }, // stimpack
    { id: 2011, x: 37, y: 33 }, // stimpack
    { id: 2019, x: 21, y: 33 }, // blue armor (gates)
    { id: 2022, x: 25, y: 24 }, // invulnerability (secret perch)
    { id: 2013, x: 24, y: 25 }, // soulsphere (secret perch)
    // BOSS + escort — 11 easy / 15 HMP / 20 UV (+ the cyberdemon, the boss).
    { id: 16, x: 21, y: 9, angle: 270 }, // CYBERDEMON (before the throne)
    { id: 9, x: 10, y: 21, angle: 0 }, // shotgun guy (wing)
    { id: 9, x: 33, y: 21, angle: 180 }, // shotgun guy (wing)
    { id: 3001, x: 7, y: 6, angle: 0 }, // imp
    { id: 3001, x: 36, y: 6, angle: 180 }, // imp
    { id: 3001, x: 14, y: 15, angle: 0 }, // imp
    { id: 3001, x: 29, y: 15, angle: 180 }, // imp
    { id: 69, x: 13, y: 9, angle: 0 }, // hell knight
    { id: 69, x: 30, y: 9, angle: 180 }, // hell knight
    { id: 3005, x: 7, y: 12, angle: 0 }, // cacodemon
    { id: 3005, x: 36, y: 12, angle: 180 }, // cacodemon
    // skill 6 = normal+hard
    { id: 3001, x: 21, y: 6, angle: 270, skill: 6 }, // imp
    { id: 3001, x: 14, y: 12, angle: 0, skill: 6 }, // imp
    { id: 69, x: 8, y: 15, angle: 0, skill: 6 }, // hell knight
    { id: 3005, x: 21, y: 15, angle: 90, skill: 6 }, // cacodemon
    // skill 4 = hard-only (never a second cyberdemon)
    { id: 3001, x: 5, y: 9, angle: 0, skill: 4 }, // imp
    { id: 3001, x: 38, y: 9, angle: 180, skill: 4 }, // imp
    { id: 3001, x: 29, y: 12, angle: 180, skill: 4 }, // imp
    { id: 69, x: 36, y: 15, angle: 180, skill: 4 }, // hell knight
    { id: 3005, x: 5, y: 15, angle: 0, skill: 4 }, // cacodemon
  ],
  start: { x: 21, y: 33, angle: 0 },
});
