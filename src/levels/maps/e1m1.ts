// E1M1 "Landing Bay" — tech/hangar intro. Pistol-start teaching level: zombiemen
// and imps in a bright central hangar, an early shotgun, a normal door + a lift up
// to the blue key on an open-air ledge, then a blue-locked door into the exit room.
// Secret: a tucked-away north alcove (sector 9) with green armor. Exit: wall switch.
//
// Layout (24×18, y0 at top):
//   north alcove(secret) ── north corridor(sky) ── lift ── key ledge(+64, sky)
//          │                      │ (north door)
//   start room ── manual door ── HALLW ── central hangar ── blue door ── exit+switch
import { compile, cells } from '../build';

export const E1M1 = compile({
  id: 'E1M1',
  name: 'Landing Bay',
  par: 60,
  sky: 'SKY1',
  base: { floor: 'FLOOR4_8', ceil: 'CEIL1_1', floorH: 0, ceilH: 160, light: 192 },
  legend: {
    '#': { wall: 'STARTAN3' },
    C: { wall: 'COMPUTE1' }, // computer wall around the north door
    B: { wall: 'BROWN1' }, // exit-room walls
    M: { wall: 'METAL' }, // start-room east wall
    S: { wall: 'SW1EXIT' }, // exit switch (used from the adjacent floor)
    '.': {},
  },
  rows: [
    '########################',
    '#.....................##',
    '#.....................##',
    '#.....CCCC.CCCCCCC....##',
    '#####...........##....##',
    '#####...........##....##',
    '#####...........########',
    '####............########',
    '####............B....BB#',
    '####............B....BB#',
    '####.................BB#',
    '####............B....SB#',
    '#......M#########....BB#',
    '#......M#########....BB#',
    '#......M#########....BB#',
    '#......M################',
    '#......M################',
    '########################',
  ],
  paint: [
    { x0: 1, y0: 12, x1: 6, y1: 16, light: 160 }, // start room — dimmer
    { x0: 1, y0: 1, x1: 5, y1: 3, floor: 'FLAT5_4', ceil: 'FLAT1', ceilH: 96, light: 96 }, // secret alcove (dark)
    { x0: 6, y0: 1, x1: 16, y1: 2, floor: 'FLOOR0_3', ceil: null, ceilH: 192, light: 255 }, // north corridor (open sky)
    { x0: 17, y0: 1, x1: 17, y1: 2, floor: 'FLAT14', ceil: null, ceilH: 256, light: 255 }, // lift shaft (sky)
    { x0: 18, y0: 1, x1: 21, y1: 5, floor: 'FLOOR0_3', ceil: null, floorH: 64, ceilH: 256, light: 255 }, // key ledge (+64, sky)
    { x0: 17, y0: 8, x1: 20, y1: 14, floor: 'FLAT1_1', ceil: 'TLITE6_1', ceilH: 128, light: 144 }, // exit room
  ],
  doors: [
    { x: 4, y: 11, texture: 'BIGDOOR1' }, // start → HALLW (normal)
    { x: 10, y: 3, texture: 'DOOR3' }, // hangar → north corridor (normal)
    { x: 16, y: 10, texture: 'DOORBLU', kind: 'locked', key: 'blue' }, // hangar → exit
  ],
  lifts: [
    { cells: [{ x: 17, y: 1 }, { x: 17, y: 2 }], low: 0, high: 64, trigger: { kind: 'walkover', x: 16, y: 2, once: false } },
  ],
  exits: [{ kind: 'normal', trigger: { kind: 'switch', x: 21, y: 11 } }],
  secrets: cells(1, 1, 5, 3),
  things: [
    // Key (gates the exit), reached via the lift — placed before the blue door.
    { id: 5, x: 20, y: 3, angle: 270 }, // blue keycard on the ledge
    // Weapon + ammo/health economy (pistol start).
    { id: 2001, x: 7, y: 7 }, // shotgun
    { id: 2007, x: 9, y: 5 }, // clip
    { id: 2048, x: 13, y: 8 }, // box of bullets
    { id: 2008, x: 14, y: 5 }, // 4 shells
    { id: 2011, x: 6, y: 10 }, // stimpack
    { id: 2012, x: 3, y: 16 }, // medikit (start)
    { id: 2012, x: 18, y: 13 }, // medikit (exit reward)
    { id: 2018, x: 2, y: 2 }, // green armor (secret)
    { id: 2015, x: 4, y: 2 }, // armor bonus (secret)
    // Monsters — escalating with skill. Core set on all skills; extras flagged for
    // higher skills only (skill bitmask 1=easy 2=normal 4=hard).
    { id: 3004, x: 8, y: 8, angle: 180 }, // zombieman
    { id: 3004, x: 12, y: 6, angle: 225 }, // zombieman
    { id: 3001, x: 10, y: 9, angle: 90 }, // imp
    { id: 3001, x: 6, y: 5, angle: 0 }, // imp
    { id: 3002, x: 12, y: 9, angle: 90 }, // demon (guards the blue door)
    { id: 9, x: 13, y: 9, angle: 135, skill: 6 }, // shotgun guy — normal+hard
    { id: 9, x: 5, y: 9, angle: 45, skill: 4 }, // shotgun guy — hard only
  ],
  start: { x: 3, y: 15, angle: 0 },
});
