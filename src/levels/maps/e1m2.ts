// E1M2 "Reactor Sublevel" — nukage/tech. The player starts sealed in an east
// control room and must press out through a door into the reactor hall (a ring
// around a solid COMPUTE2 core, nukage channels underfoot). The yellow key sits on
// an isolated chamber reachable only by a teleporter; a second teleporter returns
// you. A lift climbs to a secret balcony with a soulsphere. The yellow-locked door
// in the west wall opens the exit room (wall switch).
//
// Layout (24×18): secret balcony(+64) ─ reactor hall(ring) ─ key chamber(teleport)
//                 yellow door → exit(switch)          control room(start, door)
import { compile, cells } from '../build';

export const E1M2 = compile({
  id: 'E1M2',
  name: 'Reactor Sublevel',
  par: 90,
  sky: 'SKY1',
  music: 'D_E1M2',
  base: { floor: 'FLOOR5_2', ceil: 'CEIL5_1', floorH: 0, ceilH: 144, light: 168 },
  legend: {
    '#': { wall: 'ICKWALL3' },
    M: { wall: 'METAL2' }, // control-room divider wall
    R: { wall: 'COMPUTE2' }, // reactor core
    S: { wall: 'SW1EXIT' },
    '~': { floor: 'NUKAGE1', light: 96 }, // nukage (cosmetic hazard floor)
    '.': {},
  },
  rows: [
    '########################',
    '#....#############.....#',
    '#....#############.....#',
    '#....#############.....#',
    '#................#.....#',
    '#................M######',
    '#................M.....#',
    '#......~RRRR~....M.....#',
    '#......~RRRR~..........#',
    '#......~RRRR~....M.....#',
    '#......~RRRR~....M.....#',
    '#................M.....#',
    '##.##............#######',
    '#....#..~~~~~~...#######',
    '#....#..~~~~~~...#######',
    '#...S#...........#######',
    '#....#...........#######',
    '########################',
  ],
  paint: [
    { x0: 1, y0: 1, x1: 4, y1: 3, floor: 'FLAT5_5', ceil: 'FLAT1', floorH: 64, ceilH: 128, light: 96 }, // secret balcony (+64)
    { x0: 18, y0: 1, x1: 22, y1: 4, floor: 'FLAT5_1', ceil: 'TLITE6_4', ceilH: 120, light: 160 }, // key chamber
    { x0: 18, y0: 6, x1: 22, y1: 11, floor: 'FLOOR0_1', ceil: 'CEIL3_5', light: 200 }, // control room (start)
    { x0: 1, y0: 13, x1: 4, y1: 16, floor: 'FLAT1_1', ceil: 'TLITE6_1', ceilH: 112, light: 144 }, // exit room
    { x0: 5, y0: 7, x1: 15, y1: 11, light: 112 }, // reactor gloom
  ],
  doors: [
    { x: 17, y: 8, texture: 'BIGDOOR4' }, // control room → reactor hall
    { x: 2, y: 12, texture: 'DOORYEL', kind: 'locked', key: 'yellow' }, // hall → exit
  ],
  lifts: [
    { cells: [{ x: 2, y: 4 }, { x: 3, y: 4 }], low: 0, high: 64, trigger: { kind: 'walkover', x: 2, y: 5, once: false } },
  ],
  teleporters: [
    { trigger: { kind: 'walkover', x: 15, y: 5, once: false }, destX: 20, destY: 3, destAngle: 180 }, // hall → key chamber
    { trigger: { kind: 'walkover', x: 19, y: 2, once: false }, destX: 15, destY: 6, destAngle: 270 }, // chamber → hall (return)
  ],
  exits: [{ kind: 'normal', trigger: { kind: 'switch', x: 4, y: 15 } }],
  secrets: cells(1, 1, 4, 3),
  things: [
    { id: 6, x: 21, y: 2, angle: 0 }, // yellow key (on the teleport island)
    // Weapons + ammo/health.
    { id: 2001, x: 19, y: 10 }, // shotgun (pistol-start safety)
    { id: 2002, x: 6, y: 5 }, // chaingun
    { id: 2007, x: 21, y: 10 }, // clip
    { id: 2007, x: 12, y: 9 }, // clip
    { id: 2048, x: 13, y: 5 }, // box of bullets
    { id: 2008, x: 7, y: 6 }, // 4 shells
    { id: 2049, x: 14, y: 14 }, // box of shells
    { id: 2012, x: 16, y: 13 }, // medikit
    { id: 2012, x: 3, y: 14 }, // medikit (exit reward)
    { id: 2011, x: 20, y: 11 }, // stimpack
    { id: 2018, x: 5, y: 9 }, // green armor
    { id: 2013, x: 2, y: 2 }, // soulsphere (secret balcony)
    { id: 2015, x: 1, y: 2 }, // armor bonus (secret)
    // Monsters — denser than E1M1, more shotgun guys + demons.
    { id: 3004, x: 6, y: 6, angle: 0 }, // zombieman
    { id: 3004, x: 8, y: 14, angle: 90 }, // zombieman (nukage)
    { id: 3001, x: 14, y: 6, angle: 180 }, // imp
    { id: 3001, x: 6, y: 9, angle: 0 }, // imp
    { id: 3001, x: 12, y: 11, angle: 90 }, // imp
    { id: 9, x: 5, y: 7, angle: 0 }, // shotgun guy
    { id: 3002, x: 15, y: 10, angle: 180 }, // demon
    { id: 3002, x: 10, y: 13, angle: 90 }, // demon (nukage moat)
    { id: 9, x: 13, y: 9, angle: 180, skill: 6 }, // shotgun guy — normal+hard
    { id: 9, x: 19, y: 11, angle: 270, skill: 4 }, // shotgun guy — hard only (control-room ambush)
  ],
  start: { x: 20, y: 9, angle: 180 },
});
