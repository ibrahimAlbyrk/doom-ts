// E1M4 "Infestation" — the base falls to the caves (40×34, SKY2). A rusting STARTAN
// entry (north) opens into a sky-lit ROCK HUB with all three colored doors in view.
// Hub-and-spoke, strict key chain: the BLUE key sits in the open north spoke; the
// BLUE door opens the multi-tier east cavern (YELLOW key on a raised shelf); the
// YELLOW door opens the south LAVA cavern where cacodemons swarm a central island —
// ride the exposed lift to the RED key; the RED door opens the west exit (switch).
// Secret: a teleporter nook in the yellow cavern jumps to an isolated ledge stocked
// with the plasma rifle, cells, soulsphere + blue armor (and teleports you back).
//
// Flow: start ─ base ─ HUB ─(open)─ BLUE key ; HUB ─BLUE─ yellow cavern(YELLOW key)
//       HUB ─YELLOW─ lava cavern ─lift─ RED key ; HUB ─RED─ exit(switch).
import { compile, cells } from '../build';

export const E1M4 = compile({
  id: 'E1M4',
  name: 'Infestation',
  par: 210,
  sky: 'SKY2',
  music: 'D_E1M4',
  base: { floor: 'RROCK04', ceil: 'CEIL5_2', floorH: 0, ceilH: 160, light: 150 },
  legend: {
    '#': { wall: 'ROCK1' }, // cave walls
    B: { wall: 'STARTAN3' }, // tech base (north)
    '=': { wall: 'ROCKRED1' }, // lava-cavern cover pillars
    L: { floor: 'RROCK05' }, // exposed lift platform
    S: { wall: 'SW1EXIT' },
    '.': {},
  },
  rows: [
    'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
    'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
    'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
    'BB............B............BBBBBBBBBBBBB',
    'BB............B............BBBBBBBBBBBBB',
    'BB............B............BBBBBBBBBBBBB',
    'BB............B............B...........B',
    'BB.........................B...........B',
    'BB............B............B...........B',
    'BB............B............B...........B',
    'BB............B............B...BB......B',
    'BB............B............B...........B',
    'BBBBBBBBBBBBBBBBBBBB..BBBBBB...........B',
    '###############............#...........#',
    '##............#............#...........#',
    '##............#............#.......##..#',
    '##............#........................#',
    '##............#............#...........#',
    '##.........................#...........#',
    '##S...........#............#...........#',
    '##............#............#...........#',
    '##............#............#...........#',
    '##............#............#...........#',
    '##............######.###################',
    '####################.###################',
    '######..........................########',
    '######..........................########',
    '######..........................########',
    '######.....=...L........=.......########',
    '######..........................##....##',
    '######..........................##....##',
    '######..........................##....##',
    '######..........................########',
    '########################################',
  ],
  paint: [
    { x0: 2, y0: 3, x1: 13, y1: 11, floor: 'FLOOR4_8', ceil: 'CEIL5_2', ceilH: 128, light: 178 }, // base entry (tech)
    { x0: 15, y0: 3, x1: 26, y1: 11, floor: 'FLOOR4_8', ceil: 'CEIL5_2', ceilH: 136, light: 162 }, // blue spoke (tech-ruin)
    { x0: 15, y0: 13, x1: 26, y1: 22, floor: 'RROCK02', ceil: null, ceilH: 256, light: 192 }, // hub (sky-open cave)
    { x0: 28, y0: 6, x1: 38, y1: 22, floor: 'RROCK04', ceil: 'CEIL5_2', ceilH: 168, light: 140 }, // yellow cavern
    { x0: 33, y0: 6, x1: 38, y1: 12, floorH: 24, floor: 'RROCK03', light: 158 }, // yellow shelf (+24, key)
    { x0: 6, y0: 25, x1: 31, y1: 32, floor: 'RROCK06', ceil: null, ceilH: 256, light: 152 }, // lava cavern (sky)
    { x0: 12, y0: 26, x1: 23, y1: 31, floor: 'LAVA1', light: 176 }, // lava pool
    { x0: 16, y0: 27, x1: 19, y1: 29, floor: 'FLAT5_7', floorH: 56, light: 172 }, // red-key island (+56)
    { x0: 2, y0: 14, x1: 13, y1: 23, floor: 'FLAT5_4', ceil: 'CEIL5_2', ceilH: 120, light: 128 }, // exit hall
    { x0: 34, y0: 29, x1: 37, y1: 31, floor: 'FLAT5_7', ceil: 'TLITE6_5', ceilH: 104, light: 182 }, // secret plasma ledge
  ],
  doors: [
    { x: 14, y: 7, texture: 'BIGDOOR5' }, // base → blue spoke
    { x: 27, y: 16, texture: 'DOORBLU', kind: 'locked', key: 'blue' }, // hub → yellow cavern
    { x: 20, y: 23, texture: 'DOORYEL', kind: 'locked', key: 'yellow' }, // hub → lava cavern
    { x: 14, y: 18, texture: 'DOORRED', kind: 'locked', key: 'red' }, // hub → exit
  ],
  lifts: [
    // trigger covers all three open lava-cavern sides of the lift (W/N/S), so it boards
    // from any approach across the lava — the east side is the +56 island destination.
    { cells: [{ x: 15, y: 28 }], low: 0, high: 56, trigger: { kind: 'walkover', x: 14, y: 28, once: false, cells: [{ x: 14, y: 28 }, { x: 15, y: 27 }, { x: 15, y: 29 }] } }, // up to red-key island
  ],
  teleporters: [
    { trigger: { kind: 'walkover', x: 37, y: 21, once: false }, destX: 35, destY: 30, destAngle: 180 }, // yellow nook → plasma ledge
    { trigger: { kind: 'walkover', x: 35, y: 31, once: false }, destX: 37, destY: 20, destAngle: 270 }, // ledge → yellow cavern (return)
  ],
  exits: [{ kind: 'normal', trigger: { kind: 'switch', x: 2, y: 19 } }],
  secrets: cells(34, 29, 37, 31),
  things: [
    { id: 5, x: 20, y: 5, angle: 90 }, // blue key (north spoke)
    { id: 6, x: 35, y: 8, angle: 180 }, // yellow key (raised shelf)
    { id: 13, x: 17, y: 28, angle: 90 }, // red key (lift island)
    // Weapons + economy. RL is the main weapon; plasma is the (optional) secret.
    { id: 2003, x: 20, y: 7 }, // rocket launcher (blue spoke)
    { id: 2002, x: 10, y: 5 }, // chaingun (pistol-start safety)
    { id: 2001, x: 5, y: 5 }, // shotgun
    { id: 2004, x: 35, y: 30 }, // plasma rifle (secret)
    { id: 17, x: 36, y: 30 }, // cell pack (secret)
    { id: 2046, x: 20, y: 16 }, // box of rockets
    { id: 2046, x: 12, y: 30 }, // box of rockets
    { id: 2010, x: 8, y: 26 }, // rocket
    { id: 2010, x: 30, y: 27 }, // rocket
    { id: 2049, x: 4, y: 9 }, // box of shells
    { id: 2049, x: 35, y: 18 }, // box of shells
    { id: 2008, x: 18, y: 5 }, // 4 shells
    { id: 2008, x: 30, y: 8 }, // 4 shells
    { id: 2008, x: 8, y: 30 }, // 4 shells
    { id: 2008, x: 28, y: 30 }, // 4 shells
    { id: 2008, x: 6, y: 16 }, // 4 shells
    { id: 2008, x: 11, y: 20 }, // 4 shells
    { id: 2048, x: 22, y: 8 }, // box of bullets
    { id: 2048, x: 8, y: 7 }, // box of bullets
    { id: 2007, x: 10, y: 9 }, // clip
    { id: 2007, x: 33, y: 20 }, // clip
    { id: 2007, x: 20, y: 26 }, // clip
    { id: 2011, x: 4, y: 4 }, // stimpack
    { id: 2011, x: 24, y: 5 }, // stimpack
    { id: 2011, x: 36, y: 10 }, // stimpack
    { id: 2011, x: 8, y: 28 }, // stimpack
    { id: 2011, x: 28, y: 28 }, // stimpack
    { id: 2011, x: 5, y: 20 }, // stimpack
    { id: 2012, x: 12, y: 4 }, // medikit
    { id: 2012, x: 33, y: 16 }, // medikit
    { id: 2012, x: 20, y: 20 }, // medikit
    { id: 2012, x: 10, y: 30 }, // medikit
    { id: 2013, x: 34, y: 31 }, // soulsphere (secret)
    { id: 2018, x: 5, y: 8 }, // green armor (base)
    { id: 2019, x: 37, y: 31 }, // blue armor (secret)
    // Monsters — ~47 on HMP (33 easy / 57 UV). Imp/demon mass + cacodemon lava swarm.
    { id: 3004, x: 12, y: 4, angle: 180 }, // zombieman (pulled back from start to ≥8c)
    { id: 3004, x: 20, y: 4, angle: 90 }, // zombieman
    { id: 3004, x: 33, y: 9, angle: 180 }, // zombieman
    { id: 9, x: 17, y: 5, angle: 180 }, // shotgun guy (blue spoke, behind the door — no hitscan at spawn)
    { id: 9, x: 24, y: 8, angle: 180 }, // shotgun guy
    { id: 9, x: 36, y: 18, angle: 180 }, // shotgun guy
    { id: 9, x: 8, y: 16, angle: 0, skill: 6 }, // shotgun guy — normal+hard (easy shotgunGuy cap ≤3)
    { id: 3001, x: 4, y: 9, angle: 0 }, // imp
    { id: 3001, x: 22, y: 6, angle: 90 }, // imp
    { id: 3001, x: 31, y: 8, angle: 180 }, // imp
    { id: 3001, x: 36, y: 20, angle: 180 }, // imp
    { id: 3001, x: 8, y: 27, angle: 0 }, // imp
    { id: 3001, x: 28, y: 27, angle: 180 }, // imp
    { id: 3001, x: 18, y: 25, angle: 90 }, // imp
    { id: 3001, x: 10, y: 16, angle: 0 }, // imp
    { id: 3001, x: 20, y: 21, angle: 90 }, // imp
    { id: 3002, x: 6, y: 10, angle: 0 }, // demon
    { id: 3002, x: 20, y: 9, angle: 90 }, // demon
    { id: 3002, x: 30, y: 21, angle: 180 }, // demon
    { id: 3002, x: 11, y: 31, angle: 0 }, // demon
    { id: 3002, x: 26, y: 31, angle: 180 }, // demon
    { id: 58, x: 16, y: 31, angle: 90 }, // spectre (lava)
    { id: 58, x: 22, y: 31, angle: 90 }, // spectre (lava)
    { id: 58, x: 9, y: 26, angle: 0, skill: 4 }, // spectre — hard only (thin the easy lava cavern)
    { id: 58, x: 29, y: 26, angle: 180 }, // spectre
    { id: 3006, x: 24, y: 16, angle: 180 }, // lost soul
    { id: 3006, x: 18, y: 14, angle: 90 }, // lost soul
    { id: 3006, x: 34, y: 9, angle: 180 }, // lost soul
    { id: 3006, x: 13, y: 26, angle: 0 }, // lost soul
    { id: 3006, x: 27, y: 25, angle: 180 }, // lost soul
    { id: 3005, x: 12, y: 26, angle: 0 }, // cacodemon (lava swarm)
    { id: 3005, x: 20, y: 31, angle: 90 }, // cacodemon (lava swarm)
    { id: 3005, x: 24, y: 26, angle: 180, skill: 6 }, // cacodemon (lava swarm) — normal+hard (easy caco ≤2)
    // higher-skill extras (6 = normal+hard, 4 = hard-only)
    { id: 3004, x: 24, y: 4, angle: 90, skill: 6 }, // zombieman
    { id: 9, x: 33, y: 18, angle: 180, skill: 6 }, // shotgun guy
    { id: 9, x: 16, y: 9, angle: 180, skill: 6 }, // shotgun guy (blue spoke, behind the door)
    { id: 3001, x: 5, y: 16, angle: 0, skill: 6 }, // imp
    { id: 3001, x: 32, y: 11, angle: 180, skill: 6 }, // imp
    { id: 3001, x: 8, y: 28, angle: 0, skill: 6 }, // imp
    { id: 3001, x: 28, y: 28, angle: 180, skill: 6 }, // imp
    { id: 3001, x: 20, y: 25, angle: 90, skill: 6 }, // imp
    { id: 3002, x: 16, y: 30, angle: 90, skill: 6 }, // demon
    { id: 58, x: 24, y: 25, angle: 90, skill: 6 }, // spectre (un-stacked from the imp at 20,25)
    { id: 3006, x: 24, y: 14, angle: 180, skill: 6 }, // lost soul
    { id: 3006, x: 34, y: 11, angle: 180, skill: 6 }, // lost soul
    { id: 3006, x: 13, y: 30, angle: 0, skill: 6 }, // lost soul
    { id: 3005, x: 16, y: 26, angle: 90, skill: 6 }, // cacodemon
    { id: 3001, x: 22, y: 5, angle: 90, skill: 4 }, // imp — hard
    { id: 3001, x: 36, y: 8, angle: 180, skill: 4 }, // imp — hard
    { id: 3001, x: 11, y: 16, angle: 0, skill: 4 }, // imp — hard
    { id: 3001, x: 20, y: 22, angle: 90, skill: 4 }, // imp — hard
    { id: 3002, x: 30, y: 25, angle: 180, skill: 4 }, // demon — hard
    { id: 3002, x: 11, y: 26, angle: 0, skill: 4 }, // demon — hard
    { id: 58, x: 24, y: 30, angle: 90, skill: 4 }, // spectre — hard
    { id: 3006, x: 18, y: 26, angle: 90, skill: 4 }, // lost soul — hard
    { id: 3006, x: 27, y: 30, angle: 180, skill: 4 }, // lost soul — hard
    { id: 3005, x: 28, y: 26, angle: 180, skill: 4 }, // cacodemon — hard
  ],
  start: { x: 3, y: 4, angle: 0 },
});
