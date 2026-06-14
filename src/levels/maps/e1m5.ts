// E1M5 "Hell's Maw" — the base gives way to hell (42×34, SKY3). From a rock/marble
// MAW you cross a narrow MARBLE BRIDGE over a sky-open LAVA chasm — hell knights and
// imps fire from raised flanking ledges as you cross. A grand door opens the MARBLE
// CATHEDRAL (GSTONE pillars, high ceiling), the RED key on a raised altar. The RED
// door opens the east SKIN/flesh wing where a Baron (two on Hurt Me Plenty+) guards
// the BLUE key; the BLUE door opens the NW exit pad. Secret: a hidden lift in the
// cathedral rises to a ledge with the BFG + megasphere.
//
// Flow: maw(start) ─bridge─ CATHEDRAL(RED key) ─RED door─ flesh wing(baron, BLUE key)
//       ─BLUE door─ exit pad. (exit needs both keys, in sequence.)
import { compile, cells } from '../build';

export const E1M5 = compile({
  id: 'E1M5',
  name: "Hell's Maw",
  par: 240,
  sky: 'SKY3',
  music: 'D_E1M3',
  base: { floor: 'FLAT5_4', ceil: 'CEIL5_1', floorH: 0, ceilH: 160, light: 140 },
  legend: {
    '#': { wall: 'MARBLE1' },
    g: { wall: 'GSTONE1' }, // cathedral pillars
    K: { wall: 'SKIN2' }, // flesh wing
    L: { floor: 'FLAT5_4' }, // hidden lift platform
    '.': {},
  },
  rows: [
    '##########################################',
    '##########################################',
    '##.......#......................##########',
    '##.......#......................##########',
    '##.......#...................L..KKKKKKKKKK',
    '##............g............g....K........K',
    '##.......#......................K........K',
    '##.......#......................K........K',
    '##.......#...............................K',
    '##.......#......................K........K',
    '##########....g............g....K........K',
    '##########......................K........K',
    '##########......................K........K',
    '##########......................K........K',
    '####################.###########K........K',
    '#########.......................K..KKKK..K',
    '#########.......................K..KKKK..K',
    '#########.......................K..KKKK..K',
    '#########.......................K..KKKK..K',
    '#########.......................K........K',
    '#########.......................K........K',
    '#########.......................K........K',
    '#########.......................K........K',
    '#########.......................K........K',
    '#########.......................K........K',
    '#########.......................K........K',
    '#########.......................K........K',
    '#########.......................K........K',
    '#########.......................KKKKKKKKKK',
    '################..........################',
    '################..........################',
    '################..........################',
    '################..........################',
    '##########################################',
  ],
  paint: [
    { x0: 2, y0: 2, x1: 8, y1: 9, floor: 'GATE3', ceil: 'TLITE6_5', ceilH: 104, light: 168 }, // exit room
    { x0: 10, y0: 2, x1: 31, y1: 13, floor: 'FLAT5_4', ceil: 'CEIL5_1', ceilH: 208, light: 152 }, // cathedral (high)
    { x0: 19, y0: 6, x1: 22, y1: 8, floor: 'MFLR8_1', floorH: 24, light: 184 }, // red-key altar (+24)
    { x0: 27, y0: 2, x1: 30, y1: 3, floor: 'MFLR8_1', floorH: 64, ceil: 'FLAT1', ceilH: 96, light: 120 }, // secret BFG ledge (+64)
    { x0: 9, y0: 15, x1: 31, y1: 28, floor: 'LAVA1', floorH: -16, ceil: null, ceilH: 256, light: 178 }, // lava chasm (sky)
    { x0: 10, y0: 16, x1: 14, y1: 26, floor: 'MFLR8_3', floorH: 8, light: 150 }, // west flanking ledge
    { x0: 27, y0: 16, x1: 30, y1: 26, floor: 'MFLR8_3', floorH: 8, light: 150 }, // east flanking ledge
    { x0: 19, y0: 15, x1: 22, y1: 28, floor: 'FLAT5_4', floorH: 0, light: 150 }, // marble bridge
    { x0: 33, y0: 5, x1: 40, y1: 27, floor: 'FLAT5_7', ceil: 'CEIL5_1', ceilH: 152, light: 122 }, // flesh wing
    { x0: 16, y0: 29, x1: 25, y1: 32, floor: 'RROCK16', ceil: 'CEIL5_1', ceilH: 128, light: 136 }, // maw entrance
  ],
  doors: [
    { x: 20, y: 14, texture: 'BIGDOOR7' }, // bridge → cathedral (grand door)
    { x: 32, y: 8, texture: 'DOORRED', kind: 'locked', key: 'red' }, // cathedral → flesh wing
    { x: 9, y: 5, texture: 'DOORBLU', kind: 'locked', key: 'blue' }, // cathedral → exit
  ],
  lifts: [
    { cells: [{ x: 29, y: 4 }], low: 0, high: 64, trigger: { kind: 'walkover', x: 29, y: 5, once: false } }, // secret BFG ledge
  ],
  exits: [{ kind: 'normal', trigger: { kind: 'walkover', x: 5, y: 6 } }], // exit pad
  secrets: cells(27, 2, 30, 3),
  things: [
    { id: 13, x: 20, y: 7, angle: 90 }, // red key (altar)
    { id: 5, x: 37, y: 8, angle: 180 }, // blue key (flesh wing)
    // Weapons + economy: SSG + plasma main; RL for barons; BFG in the secret.
    { id: 82, x: 20, y: 30 }, // super shotgun (entrance)
    { id: 2004, x: 15, y: 10 }, // plasma rifle (cathedral)
    { id: 2003, x: 25, y: 11 }, // rocket launcher
    { id: 2006, x: 28, y: 3 }, // BFG9000 (secret)
    { id: 83, x: 29, y: 3 }, // megasphere (secret)
    { id: 17, x: 16, y: 10 }, // cell pack
    { id: 2046, x: 25, y: 12 }, // box of rockets
    { id: 2046, x: 36, y: 24 }, // box of rockets
    { id: 2010, x: 12, y: 11 }, // rocket
    { id: 2010, x: 28, y: 11 }, // rocket
    { id: 2049, x: 18, y: 30 }, // box of shells
    { id: 2049, x: 13, y: 8 }, // box of shells
    { id: 2049, x: 37, y: 11 }, // box of shells
    { id: 2008, x: 22, y: 30 }, // 4 shells
    { id: 2008, x: 34, y: 26 }, // 4 shells
    { id: 2048, x: 11, y: 5 }, // box of bullets
    { id: 2007, x: 17, y: 31 }, // clip
    { id: 2007, x: 34, y: 20 }, // clip
    { id: 2011, x: 24, y: 30 }, // stimpack
    { id: 2011, x: 12, y: 12 }, // stimpack
    { id: 2011, x: 29, y: 12 }, // stimpack
    { id: 2011, x: 13, y: 18 }, // stimpack
    { id: 2011, x: 28, y: 24 }, // stimpack
    { id: 2011, x: 38, y: 26 }, // stimpack
    { id: 2012, x: 20, y: 16 }, // medikit
    { id: 2012, x: 5, y: 8 }, // medikit (exit)
    { id: 2012, x: 16, y: 5 }, // medikit
    { id: 2012, x: 25, y: 5 }, // medikit
    { id: 2012, x: 39, y: 16 }, // medikit
    { id: 2013, x: 20, y: 24 }, // soulsphere (bridge reward)
    { id: 2019, x: 4, y: 5 }, // blue armor (exit)
    // Monsters — ~42 on HMP (28 easy / 54 UV); hell knights + first barons.
    // START-SAFETY: the maw + bridge mouth carry NO hitscan at spawn (the 4 shotgun
    // guys live in the cathedral, behind the closed grand door). Easy flanking fire is
    // capped at 3 ranged with LOS to the start (2 ledge imps + the lone west knight).
    // EASY roster (28): bridge/ledge ambush, cathedral hall, flesh-wing bruisers.
    { id: 3001, x: 13, y: 25, angle: 90 }, // imp (west ledge — bridge flanker)
    { id: 3001, x: 29, y: 25, angle: 270 }, // imp (east ledge — bridge flanker)
    { id: 69, x: 12, y: 22, angle: 90 }, // hell knight (west ledge — the gauntlet, lone heavy with LOS)
    { id: 58, x: 14, y: 18, angle: 90 }, // spectre (west ledge, melee)
    { id: 58, x: 27, y: 18, angle: 270 }, // spectre (east ledge, melee)
    { id: 58, x: 20, y: 20, angle: 180 }, // spectre (bridge, melee)
    // cathedral hall — behind the grand bridge door, no LOS to the maw at spawn
    { id: 9, x: 13, y: 6, angle: 90 }, // shotgun guy (cathedral)
    { id: 9, x: 27, y: 6, angle: 270 }, // shotgun guy (cathedral)
    { id: 9, x: 12, y: 12, angle: 0 }, // shotgun guy (cathedral)
    { id: 9, x: 29, y: 11, angle: 180 }, // shotgun guy (cathedral)
    { id: 3001, x: 12, y: 4, angle: 0 }, // imp (cathedral)
    { id: 3001, x: 30, y: 4, angle: 180 }, // imp (cathedral)
    { id: 3001, x: 16, y: 3, angle: 90 }, // imp (cathedral)
    { id: 3001, x: 25, y: 3, angle: 90 }, // imp (cathedral)
    { id: 3002, x: 16, y: 12, angle: 0 }, // demon (cathedral)
    { id: 3002, x: 25, y: 12, angle: 180 }, // demon (cathedral)
    { id: 3002, x: 12, y: 8, angle: 0 }, // demon (cathedral)
    { id: 3002, x: 30, y: 8, angle: 180 }, // demon (cathedral)
    { id: 3002, x: 28, y: 5, angle: 270 }, // demon (cathedral)
    { id: 3006, x: 15, y: 5, angle: 0 }, // lost soul (cathedral)
    { id: 3006, x: 26, y: 5, angle: 180 }, // lost soul (cathedral)
    { id: 3005, x: 12, y: 5, angle: 0 }, // cacodemon (cathedral)
    { id: 3005, x: 23, y: 4, angle: 180 }, // cacodemon (cathedral)
    // flesh wing — behind the RED door, no LOS at spawn: bruiser nest + blue key
    { id: 3005, x: 34, y: 12, angle: 180 }, // cacodemon (flesh wing)
    { id: 3006, x: 34, y: 11, angle: 180 }, // lost soul (flesh wing)
    { id: 3006, x: 38, y: 23, angle: 180 }, // lost soul (flesh wing)
    { id: 69, x: 38, y: 12, angle: 180 }, // hell knight (flesh wing)
    { id: 3003, x: 37, y: 23, angle: 180 }, // BARON OF HELL (guards blue key)
    // skill 6 = normal+hard — denser ledges + cathedral, second baron (still no maw hitscan)
    { id: 3001, x: 11, y: 17, angle: 90, skill: 6 }, // imp (west ledge)
    { id: 3001, x: 28, y: 17, angle: 270, skill: 6 }, // imp (east ledge)
    { id: 3001, x: 12, y: 18, angle: 90, skill: 6 }, // imp (west ledge)
    { id: 3001, x: 28, y: 24, angle: 270, skill: 6 }, // imp (east ledge)
    { id: 9, x: 16, y: 5, angle: 90, skill: 6 }, // shotgun guy (cathedral)
    { id: 3001, x: 17, y: 11, angle: 0, skill: 6 }, // imp (cathedral)
    { id: 3001, x: 24, y: 11, angle: 180, skill: 6 }, // imp (cathedral)
    { id: 3002, x: 20, y: 11, angle: 90, skill: 6 }, // demon (cathedral)
    { id: 58, x: 20, y: 18, angle: 180, skill: 6 }, // spectre (bridge)
    { id: 3006, x: 18, y: 5, angle: 0, skill: 6 }, // lost soul (cathedral)
    { id: 3006, x: 23, y: 5, angle: 180, skill: 6 }, // lost soul (cathedral)
    { id: 3005, x: 16, y: 16, angle: 90, skill: 6 }, // cacodemon (chasm)
    { id: 69, x: 36, y: 22, angle: 180, skill: 6 }, // hell knight (flesh wing)
    { id: 3003, x: 34, y: 16, angle: 180, skill: 6 }, // BARON (second bruiser)
    // skill 4 = hard-only — UV density
    { id: 3001, x: 11, y: 25, angle: 90, skill: 4 }, // imp (west ledge)
    { id: 3001, x: 29, y: 17, angle: 270, skill: 4 }, // imp (east ledge)
    { id: 3001, x: 20, y: 22, angle: 180, skill: 4 }, // imp (bridge)
    { id: 3006, x: 38, y: 20, angle: 180, skill: 4 }, // lost soul (flesh wing)
    { id: 3006, x: 34, y: 8, angle: 180, skill: 4 }, // lost soul (flesh wing)
    { id: 3005, x: 27, y: 16, angle: 270, skill: 4 }, // cacodemon (chasm)
    { id: 3005, x: 38, y: 8, angle: 180, skill: 4 }, // cacodemon (flesh wing)
    { id: 9, x: 24, y: 6, angle: 270, skill: 4 }, // shotgun guy (cathedral)
    { id: 3002, x: 16, y: 8, angle: 0, skill: 4 }, // demon (cathedral)
    { id: 3005, x: 23, y: 12, angle: 90, skill: 4 }, // cacodemon (cathedral)
    { id: 3001, x: 30, y: 12, angle: 180, skill: 4 }, // imp (cathedral)
    { id: 69, x: 38, y: 26, angle: 180, skill: 4 }, // hell knight (flesh wing)
  ],
  start: { x: 20, y: 31, angle: 0 },
});
