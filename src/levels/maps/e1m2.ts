// E1M2 "Refinery" — nukage/tech (38×30, SKY1). The player drops from a north
// control room into the REACTOR HALL and circles a solid COMPUTE core ringed by
// nukage channels. A teleporter on the hall's SE corner jumps to an isolated island
// holding the YELLOW key (a second pad returns you). The west PUMP WING opens off
// the ring; behind its YELLOW-locked door waits the BLUE key. The BLUE-locked door
// east opens the exit room (switch). Secret: a hidden lift in the pump wing rises to
// a balcony with a soulsphere + berserk (the melee answer to the demon rush).
//
// Flow: control(start) ─door─ reactor ring ──(teleport)── YELLOW island
//       ring ─open─ pump wing ─YELLOW door─ BLUE key ; ring ─BLUE door─ exit(switch).
import { compile, cells } from '../build';

export const E1M2 = compile({
  id: 'E1M2',
  name: 'Refinery',
  par: 150,
  sky: 'SKY1',
  music: 'D_E1M2',
  base: { floor: 'FLOOR5_2', ceil: 'CEIL3_2', floorH: 0, ceilH: 144, light: 168 },
  legend: {
    '#': { wall: 'TEKWALL1' },
    R: { wall: 'COMPUTE1' }, // reactor core
    S: { wall: 'SW1EXIT' }, // exit switch
    L: { floor: 'FLOOR5_2' }, // secret lift platform
    '.': {},
  },
  rows: [
    '######################################',
    '######################################',
    '######..........................######',
    '######..........................######',
    '######..........................######',
    '######..........................######',
    '######..........................######',
    '##################.###################',
    '#########....................#.......#',
    '#.......#....................#.......#',
    '#.......#....................#.......#',
    '#.......#...........................S#',
    '#.......#....................#.......#',
    '#.......#......RRRRRRRR......#.......#',
    '###.#####......RRRRRRRR......#.......#',
    '#.......#......RRRRRRRR......#########',
    '#.......#......RRRRRRRR......#########',
    '#.......#......RRRRRRRR......#########',
    '#..............RRRRRRRR......#########',
    '#.......#....................#########',
    '#.......#....................#########',
    '#.......#....................#########',
    '#.......#....................#########',
    '#.......#....................##......#',
    '###L###########################......#',
    '#......########################......#',
    '#......########################......#',
    '#......########################......#',
    '#......########################......#',
    '######################################',
  ],
  paint: [
    { x0: 6, y0: 2, x1: 31, y1: 6, floor: 'FLOOR5_2', ceil: 'CEIL3_2', ceilH: 128, light: 188 }, // control room
    { x0: 10, y0: 9, x1: 13, y1: 12, floor: 'NUKAGE1', light: 124 }, // NW nukage pool
    { x0: 24, y0: 19, x1: 27, y1: 22, floor: 'NUKAGE1', light: 124 }, // SE nukage pool
    { x0: 13, y0: 13, x1: 14, y1: 18, floor: 'NUKAGE1', light: 132 }, // west reactor channel
    { x0: 23, y0: 13, x1: 24, y1: 18, floor: 'NUKAGE1', light: 132 }, // east reactor channel
    { x0: 1, y0: 9, x1: 7, y1: 13, floor: 'FLAT14', ceil: 'TLITE6_1', ceilH: 120, light: 176 }, // blue-key room
    { x0: 1, y0: 15, x1: 7, y1: 23, floor: 'FLOOR5_2', light: 150 }, // pump wing entry
    { x0: 1, y0: 25, x1: 6, y1: 28, floor: 'FLOOR5_2', floorH: 64, ceil: 'FLAT1', ceilH: 96, light: 120 }, // secret balcony (+64)
    { x0: 31, y0: 23, x1: 36, y1: 28, floor: 'FLAT14', ceil: 'TLITE6_4', ceilH: 120, light: 200 }, // yellow island
    { x0: 30, y0: 8, x1: 36, y1: 14, floor: 'FLAT1_1', ceil: 'TLITE6_1', ceilH: 120, light: 172 }, // exit room
  ],
  doors: [
    { x: 18, y: 7, texture: 'BIGDOOR4' }, // control → reactor hall
    { x: 3, y: 14, texture: 'DOORYEL', kind: 'locked', key: 'yellow' }, // pump → blue-key room
    { x: 29, y: 11, texture: 'DOORBLU', kind: 'locked', key: 'blue' }, // hall → exit
  ],
  lifts: [
    { cells: [{ x: 3, y: 24 }], low: 0, high: 64, trigger: { kind: 'walkover', x: 3, y: 23, once: false } }, // secret balcony
  ],
  teleporters: [
    { trigger: { kind: 'walkover', x: 26, y: 22, once: false }, destX: 33, destY: 25, destAngle: 180 }, // hall → yellow island
    { trigger: { kind: 'walkover', x: 33, y: 27, once: false }, destX: 26, destY: 20, destAngle: 270 }, // island → hall (return)
  ],
  exits: [{ kind: 'normal', trigger: { kind: 'switch', x: 36, y: 11 } }],
  secrets: cells(1, 25, 6, 28),
  things: [
    { id: 6, x: 34, y: 25, angle: 0 }, // yellow key (teleport island)
    { id: 5, x: 4, y: 11, angle: 0 }, // blue key (behind yellow door)
    // Weapons + economy: chaingun ~1/3 in, shotgun safety, no rockets/cells.
    { id: 2002, x: 12, y: 9 }, // chaingun
    { id: 2001, x: 20, y: 4 }, // shotgun (control room)
    { id: 2048, x: 25, y: 21 }, // box of bullets
    { id: 2007, x: 11, y: 20 }, // clip
    { id: 2007, x: 26, y: 9 }, // clip
    { id: 2007, x: 6, y: 16 }, // clip
    { id: 2049, x: 10, y: 22 }, // box of shells
    { id: 2049, x: 27, y: 9 }, // box of shells
    { id: 2008, x: 25, y: 20 }, // 4 shells
    { id: 2008, x: 11, y: 10 }, // 4 shells
    { id: 2011, x: 7, y: 3 }, // stimpack
    { id: 2011, x: 33, y: 13 }, // stimpack (exit)
    { id: 2011, x: 2, y: 16 }, // stimpack
    { id: 2011, x: 19, y: 22 }, // stimpack
    { id: 2012, x: 35, y: 13 }, // medikit (exit reward)
    { id: 2012, x: 34, y: 27 }, // medikit (island reward)
    { id: 2012, x: 5, y: 12 }, // medikit (blue room)
    { id: 2018, x: 9, y: 21 }, // green armor
    { id: 2015, x: 5, y: 26 }, // armor bonus (secret)
    { id: 2013, x: 3, y: 27 }, // soulsphere (secret balcony)
    { id: 2023, x: 2, y: 26 }, // berserk (secret balcony)
    // Monsters — denser, ~30 on HMP (21 easy / 36 UV).
    { id: 3004, x: 10, y: 9, angle: 90 }, // zombieman
    { id: 3004, x: 26, y: 10, angle: 180 }, // zombieman
    { id: 3004, x: 11, y: 21, angle: 0 }, // zombieman
    { id: 3004, x: 26, y: 21, angle: 180 }, // zombieman
    { id: 3004, x: 20, y: 5, angle: 90 }, // zombieman
    { id: 3004, x: 7, y: 17, angle: 0 }, // zombieman
    { id: 3004, x: 34, y: 24, angle: 270 }, // zombieman (island)
    { id: 9, x: 13, y: 20, angle: 90 }, // shotgun guy
    { id: 9, x: 24, y: 12, angle: 180 }, // shotgun guy
    { id: 9, x: 19, y: 8, angle: 180 }, // shotgun guy
    { id: 9, x: 7, y: 21, angle: 0 }, // shotgun guy
    { id: 3001, x: 11, y: 9, angle: 90 }, // imp
    { id: 3001, x: 26, y: 19, angle: 180 }, // imp
    { id: 3001, x: 10, y: 20, angle: 0 }, // imp
    { id: 3001, x: 27, y: 20, angle: 180 }, // imp
    { id: 3001, x: 13, y: 17, angle: 90 }, // imp
    { id: 3001, x: 24, y: 17, angle: 180 }, // imp
    { id: 3001, x: 33, y: 26, angle: 270 }, // imp (island)
    { id: 3002, x: 18, y: 9, angle: 90 }, // demon
    { id: 3002, x: 11, y: 16, angle: 0 }, // demon
    { id: 3002, x: 26, y: 16, angle: 180 }, // demon
    { id: 3004, x: 12, y: 20, angle: 90, skill: 6 }, // zombieman — normal+hard
    { id: 3004, x: 25, y: 12, angle: 180, skill: 6 }, // zombieman — normal+hard
    { id: 3004, x: 6, y: 20, angle: 0, skill: 6 }, // zombieman — normal+hard
    { id: 9, x: 25, y: 19, angle: 180, skill: 6 }, // shotgun guy — normal+hard
    { id: 9, x: 6, y: 12, angle: 0, skill: 6 }, // shotgun guy — normal+hard
    { id: 3001, x: 12, y: 10, angle: 90, skill: 6 }, // imp — normal+hard
    { id: 3001, x: 25, y: 9, angle: 180, skill: 6 }, // imp — normal+hard
    { id: 3001, x: 11, y: 18, angle: 90, skill: 6 }, // imp — normal+hard
    { id: 3002, x: 13, y: 21, angle: 90, skill: 6 }, // demon — normal+hard
    { id: 3004, x: 24, y: 9, angle: 180, skill: 4 }, // zombieman — hard only
    { id: 3004, x: 11, y: 12, angle: 0, skill: 4 }, // zombieman — hard only
    { id: 3001, x: 26, y: 12, angle: 180, skill: 4 }, // imp — hard only
    { id: 3001, x: 13, y: 19, angle: 90, skill: 4 }, // imp — hard only
    { id: 3001, x: 24, y: 19, angle: 180, skill: 4 }, // imp — hard only
    { id: 3002, x: 24, y: 21, angle: 180, skill: 4 }, // demon — hard only
  ],
  start: { x: 18, y: 3, angle: 180 },
});
