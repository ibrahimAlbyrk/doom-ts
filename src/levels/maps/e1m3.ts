// E1M3 "Cavern Outpost" — dark rock caverns + a lava cavern. Heavier bestiary:
// demons, spectres, lost souls and a cacodemon in the open lava hall (where the
// rocket launcher waits). The red key is stranded in an isolated chamber reached by
// a teleporter (a second teleporter returns you). A lift climbs to a secret balcony
// with a berserk pack. The red-locked door opens a small alcove whose teleporter
// pad ends the level (exit teleporter).
//
// Layout (24×18): exit pad ── secret balcony(+64) ── lava hall(caco, rockets)
//                 red door↑        cavern (dark)        ↘ teleport
//                 start cave                         red-key chamber (teleport)
import { compile, cells } from '../build';

export const E1M3 = compile({
  id: 'E1M3',
  name: 'Cavern Outpost',
  par: 150,
  sky: 'SKY1',
  music: 'D_E1M3',
  base: { floor: 'RROCK04', ceil: 'CEIL5_2', floorH: 0, ceilH: 120, light: 96 },
  legend: {
    '#': { wall: 'ASHWALL2' },
    B: { wall: 'ROCKRED1' }, // red rock around the lava hall + key chamber
    '.': {},
  },
  rows: [
    '########################',
    '#....##....#############',
    '#....##....#############',
    '##.####....#B..........#',
    '#...........B..........#',
    '#...........B..........#',
    '#......................#',
    '#...........B..........#',
    '#...........B..........#',
    '#...........B..........#',
    '#...........B..........#',
    '#...........BBBBBBBBBBB#',
    '#...........BB.........#',
    '#...........BB.........#',
    '#.....BBBBBBBB.........#',
    '#.....BBBBBBBB.........#',
    '#.....BBBBBBBB.........#',
    '########################',
  ],
  paint: [
    { x0: 13, y0: 3, x1: 22, y1: 10, floor: 'FLOOR6_1', ceil: 'CEIL5_2', light: 140 }, // lava hall (brighter)
    { x0: 15, y0: 7, x1: 17, y1: 8, floor: 'LAVA1', light: 184 }, // lava pool (glow)
    { x0: 7, y0: 1, x1: 10, y1: 3, floor: 'FLAT5_4', ceil: 'FLAT1', floorH: 64, ceilH: 112, light: 80 }, // secret balcony (+64)
    { x0: 14, y0: 12, x1: 22, y1: 16, floor: 'FLAT5_5', ceil: 'CEIL5_2', light: 72 }, // red-key chamber (very dark)
    { x0: 1, y0: 1, x1: 4, y1: 2, floor: 'GATE1', ceil: 'TLITE6_5', light: 160 }, // exit teleporter alcove
    { x0: 1, y0: 14, x1: 5, y1: 16, light: 112 }, // start cave
    { x0: 1, y0: 10, x1: 4, y1: 13, light: 64 }, // pitch-black pocket
  ],
  doors: [
    { x: 12, y: 6, texture: 'BIGDOOR5' }, // cavern → lava hall
    { x: 2, y: 3, texture: 'DOORRED', kind: 'locked', key: 'red' }, // cavern → exit alcove
  ],
  lifts: [
    { cells: [{ x: 8, y: 4 }, { x: 9, y: 4 }], low: 0, high: 64, trigger: { kind: 'walkover', x: 8, y: 5, once: false } },
  ],
  teleporters: [
    { trigger: { kind: 'walkover', x: 20, y: 9, once: false }, destX: 18, destY: 14, destAngle: 90 }, // lava hall → key chamber
    { trigger: { kind: 'walkover', x: 16, y: 15, once: false }, destX: 5, destY: 12, destAngle: 0 }, // chamber → cavern (return)
  ],
  exits: [{ kind: 'normal', trigger: { kind: 'walkover', x: 2, y: 1 } }], // exit teleporter pad
  secrets: cells(7, 1, 10, 3),
  things: [
    { id: 13, x: 20, y: 14, angle: 90 }, // red key (isolated chamber)
    // Weapons + ammo — rocket launcher introduced for the heavier monsters.
    { id: 2003, x: 15, y: 4 }, // rocket launcher
    { id: 2046, x: 21, y: 4 }, // box of rockets
    { id: 2010, x: 17, y: 9 }, // rocket
    { id: 2001, x: 4, y: 5 }, // shotgun (pistol-start safety)
    { id: 2048, x: 3, y: 12 }, // box of bullets
    { id: 2008, x: 6, y: 9 }, // 4 shells
    { id: 2018, x: 5, y: 9 }, // green armor
    { id: 2012, x: 10, y: 12 }, // medikit
    { id: 2012, x: 2, y: 15 }, // medikit (start)
    { id: 2012, x: 21, y: 15 }, // medikit (chamber reward)
    { id: 2011, x: 16, y: 13 }, // stimpack (chamber)
    { id: 2011, x: 19, y: 6 }, // stimpack (lava)
    { id: 2023, x: 8, y: 1 }, // berserk (secret balcony)
    { id: 2015, x: 9, y: 2 }, // armor bonus (secret)
    // Monsters — demons/spectres/lost souls + a cacodemon in the open lava hall.
    { id: 3002, x: 5, y: 6, angle: 0 }, // demon
    { id: 58, x: 8, y: 9, angle: 90 }, // spectre
    { id: 3006, x: 4, y: 11, angle: 0 }, // lost soul
    { id: 3005, x: 18, y: 6, angle: 180 }, // cacodemon
    { id: 3001, x: 16, y: 5, angle: 180 }, // imp
    { id: 3002, x: 6, y: 12, angle: 90 }, // demon
    { id: 3002, x: 17, y: 14, angle: 180 }, // demon (guards the red key)
    { id: 58, x: 20, y: 5, angle: 180, skill: 6 }, // spectre — normal+hard
    { id: 3006, x: 9, y: 7, angle: 270, skill: 6 }, // lost soul — normal+hard
    { id: 3001, x: 15, y: 9, angle: 180, skill: 4 }, // imp — hard only
  ],
  start: { x: 3, y: 15, angle: 90 },
});
