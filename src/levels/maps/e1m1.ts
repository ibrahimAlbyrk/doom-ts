// E1M1 "Landing Zone" — tech hangar intro (34×24, SKY1). Pistol-start teaching
// level: a sky-open landing dock funnels into the bright central HANGAR hub (a
// sunken −24 floor pit in the middle), with a side armoury holding the first
// shotgun. A maintenance wing east climbs (lift) to the BLUE key on a high ledge
// overlooking the floor; the blue-locked door south opens the exit room (switch).
// One lone demon guards the route to the blue door — a telegraphed "learn the
// pinky" fight. Secret: a tucked SW alcove (green armor + bonuses).
//
// Flow: dock(start) ─door─ hangar hub ─open─ armoury(shotgun) / maintenance ─lift─
//       blue-key ledge → return → BLUE door → exit room(switch).
import { compile, cells } from '../build';

export const E1M1 = compile({
  id: 'E1M1',
  name: 'Landing Zone',
  par: 90,
  sky: 'SKY1',
  music: 'D_E1M1',
  base: { floor: 'FLOOR4_8', ceil: 'CEIL3_3', floorH: 0, ceilH: 160, light: 188 },
  legend: {
    '#': { wall: 'STARTAN3' },
    '=': { wall: 'SUPPORT2' }, // hangar cover pillars
    L: { floor: 'FLAT14' }, // lift platform up to the blue ledge
    S: { wall: 'SW1EXIT' }, // exit switch (used from the adjacent floor)
    '.': {},
  },
  rows: [
    '##################################',
    '#.......##########################',
    '#.......#.................#......#',
    '#.........................#......#',
    '#.......#...=.........=...#......#',
    '#.......#.................###LL###',
    '###.#####.................#......#',
    '#.......#.................#......#',
    '#.......#.................#......#',
    '#................................#',
    '#.......#.................#......#',
    '#.......#.................#......#',
    '#.......#.................#......#',
    '####.####.................#......#',
    '#......##...=.........=...#......#',
    '#......##.................#......#',
    '#......##.................#......#',
    '#......#######.###################',
    '#......###.........###############',
    '#......##S.........###############',
    '#......###.........###############',
    '##########.........###############',
    '##################################',
    '##################################',
  ],
  paint: [
    { x0: 1, y0: 1, x1: 7, y1: 5, floor: 'FLOOR0_3', ceil: null, ceilH: 256, light: 240 }, // landing dock (open sky)
    { x0: 1, y0: 7, x1: 7, y1: 12, floor: 'FLOOR5_1', light: 150 }, // armoury (shotgun)
    { x0: 1, y0: 14, x1: 6, y1: 20, floor: 'FLAT5_4', ceil: 'FLAT1', ceilH: 104, light: 112 }, // secret alcove (dark)
    { x0: 9, y0: 2, x1: 25, y1: 16, ceilH: 192, light: 204 }, // hangar hub — bright + tall
    { x0: 13, y0: 7, x1: 21, y1: 11, floorH: -24, floor: 'FLAT5_4', light: 168 }, // sunken pit
    { x0: 27, y0: 6, x1: 32, y1: 16, floor: 'FLOOR5_1', light: 176 }, // maintenance wing
    { x0: 27, y0: 2, x1: 32, y1: 4, floor: 'FLAT14', floorH: 64, light: 212 }, // blue-key ledge (+64)
    { x0: 10, y0: 18, x1: 18, y1: 21, floor: 'FLAT1_1', ceil: 'TLITE6_1', ceilH: 124, light: 168 }, // exit room
  ],
  doors: [
    { x: 8, y: 3, texture: 'BIGDOOR1' }, // dock → hangar
    { x: 26, y: 9, texture: 'DOOR3' }, // hangar → maintenance
    { x: 14, y: 17, texture: 'DOORBLU', kind: 'locked', key: 'blue' }, // hangar → exit
  ],
  lifts: [
    { cells: [{ x: 29, y: 5 }, { x: 30, y: 5 }], low: 0, high: 64, trigger: { kind: 'walkover', x: 29, y: 6, once: false } },
  ],
  exits: [{ kind: 'normal', trigger: { kind: 'switch', x: 9, y: 19 } }],
  secrets: cells(1, 14, 6, 20),
  things: [
    { id: 5, x: 30, y: 3, angle: 270 }, // blue keycard (high ledge)
    // Weapons + economy (pistol start): shotgun early, no rockets/cells yet.
    { id: 2001, x: 3, y: 8 }, // shotgun (armoury)
    { id: 2007, x: 5, y: 10 }, // clip
    { id: 2007, x: 12, y: 8 }, // clip
    { id: 2048, x: 20, y: 11 }, // box of bullets
    { id: 2008, x: 16, y: 3 }, // 4 shells
    { id: 2049, x: 22, y: 9 }, // box of shells
    { id: 2011, x: 24, y: 6 }, // stimpack
    { id: 2011, x: 28, y: 12 }, // stimpack
    { id: 2011, x: 2, y: 15 }, // stimpack (secret)
    { id: 2012, x: 2, y: 3 }, // medikit (dock)
    { id: 2012, x: 15, y: 19 }, // medikit (exit reward)
    { id: 2018, x: 3, y: 17 }, // green armor (secret)
    { id: 2015, x: 2, y: 18 }, // armor bonus (secret)
    { id: 2014, x: 4, y: 18 }, // health bonus (secret)
    // Monsters — teaching roster, ~18 on HMP (13 easy / 23 UV). skill 6 = normal+hard, 4 = hard-only.
    { id: 3004, x: 12, y: 6, angle: 90 }, // zombieman
    { id: 3004, x: 20, y: 7, angle: 180 }, // zombieman
    { id: 3004, x: 11, y: 11, angle: 0 }, // zombieman
    { id: 3004, x: 21, y: 11, angle: 180 }, // zombieman
    { id: 3004, x: 15, y: 3, angle: 90 }, // zombieman
    { id: 3004, x: 18, y: 15, angle: 270 }, // zombieman
    { id: 3001, x: 17, y: 8, angle: 90 }, // imp (pit)
    { id: 3001, x: 16, y: 10, angle: 0 }, // imp (pit)
    { id: 3001, x: 14, y: 5, angle: 180 }, // imp
    { id: 3001, x: 20, y: 5, angle: 180 }, // imp
    { id: 9, x: 16, y: 12, angle: 90 }, // shotgun guy
    { id: 9, x: 13, y: 7, angle: 0 }, // shotgun guy
    { id: 3002, x: 14, y: 15, angle: 90 }, // demon — guards the blue door (telegraphed)
    { id: 3004, x: 10, y: 7, angle: 0, skill: 6 }, // zombieman — normal+hard
    { id: 3004, x: 23, y: 8, angle: 180, skill: 6 }, // zombieman — normal+hard
    { id: 3001, x: 19, y: 9, angle: 90, skill: 6 }, // imp (pit) — normal+hard
    { id: 3001, x: 11, y: 14, angle: 0, skill: 6 }, // imp — normal+hard
    { id: 9, x: 24, y: 14, angle: 270, skill: 6 }, // shotgun guy — normal+hard
    { id: 3004, x: 13, y: 15, angle: 90, skill: 4 }, // zombieman — hard only
    { id: 3004, x: 19, y: 3, angle: 180, skill: 4 }, // zombieman — hard only
    { id: 3001, x: 23, y: 3, angle: 180, skill: 4 }, // imp — hard only
    { id: 3001, x: 10, y: 16, angle: 0, skill: 4 }, // imp — hard only
    { id: 9, x: 10, y: 4, angle: 0, skill: 4 }, // shotgun guy — hard only
  ],
  start: { x: 3, y: 4, angle: 0 },
});
