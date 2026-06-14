// E1M3 "Waste Tunnels" — corruption creeps into the base (40×32, SKY1). Flooded
// BROWN tunnels (FWATER channels, nukage pockets) wind to a bright central COMM
// beacon (COMPUTE consoles, raised tier) holding the YELLOW key. The YELLOW door
// opens the dark GRAY storage maze (spectres + lost souls between pillars); a
// teleporter deep in the maze drops you into an isolated RED vault, and a return pad
// brings you back. The RED door opens the NE exit (switch). First cacodemon guards
// the comm beacon. Secret: an ASHWALL-framed alcove off the west loop (rockets+armor
// + soulsphere). Berserk in the tunnels answers the lost souls.
//
// Flow: start ─tunnels─ COMM(yellow) ─YELLOW door─ maze ──(teleport)── RED vault
//       ─return─ maze ─RED door─ exit(switch).
import { compile, cells } from '../build';

export const E1M3 = compile({
  id: 'E1M3',
  name: 'Waste Tunnels',
  par: 180,
  sky: 'SKY1',
  music: 'D_E1M3',
  base: { floor: 'FLAT5_4', ceil: 'CEIL3_1', floorH: 0, ceilH: 112, light: 128 },
  legend: {
    '#': { wall: 'BROWN1' },
    g: { wall: 'GRAY1' }, // storage-maze pillars
    C: { wall: 'COMPUTE1' }, // comm-room consoles
    A: { wall: 'ASHWALL2' }, // corruption accent (telegraphs the secret)
    S: { wall: 'SW1EXIT' },
    '.': {},
  },
  rows: [
    '########################################',
    '########################################',
    '#################################......#',
    '#################################S.....#',
    '#################################......#',
    '#########................##########.####',
    '#########................##............#',
    '#AA######..################............#',
    '#..........################.g.g.g.g.g..#',
    '#..........################............#',
    '#....####..################.g.g.g.g.g..#',
    '#AA..####..######.........#............#',
    '###..####..######.........#.g.g.g.g.g..#',
    '###..####..######..C..C...#............#',
    '#......##..######.........#.g.g.g.g.g..#',
    '#......................................#',
    '#.........................#.g.g.g.g.g..#',
    '#......##..##..##..C..C...#............#',
    '#......##..##..##.........#.g.g.g.g.g..#',
    '#......##..##..##.........#............#',
    '#########..##..##.........#.g.g.g.g.g..#',
    '#########..##..#####.######............#',
    '#########..##..############.g.g.g.g.g..#',
    '#########..##..############............#',
    '#########..##..############.g.g.g.g.g..#',
    '#########..##..############............#',
    '#.....###..##..############.g.g.g.g.g..#',
    '#.....###................##............#',
    '#.....###................##............#',
    '#.....#####################............#',
    '#.....##################################',
    '########################################',
  ],
  paint: [
    { x0: 1, y0: 14, x1: 6, y1: 19, floor: 'RROCK01', light: 120 }, // start cave
    { x0: 9, y0: 5, x1: 10, y1: 28, floor: 'FWATER1', light: 132 }, // flooded spine
    { x0: 9, y0: 5, x1: 24, y1: 6, floor: 'FWATER1', light: 132 }, // north flood
    { x0: 9, y0: 27, x1: 24, y1: 28, floor: 'FWATER1', light: 132 }, // south flood
    { x0: 3, y0: 8, x1: 4, y1: 9, floor: 'NUKAGE1', light: 110 }, // toxic pocket
    { x0: 13, y0: 22, x1: 14, y1: 26, floor: 'NUKAGE1', light: 110 }, // toxic pocket
    { x0: 17, y0: 11, x1: 25, y1: 20, floor: 'FLOOR6_1', ceil: 'CEIL3_1', floorH: 16, ceilH: 128, light: 208 }, // comm beacon (raised, bright)
    { x0: 27, y0: 6, x1: 38, y1: 29, floor: 'FLAT5_4', ceil: 'CEIL3_1', ceilH: 100, light: 92 }, // storage maze (dark)
    { x0: 33, y0: 2, x1: 38, y1: 4, floor: 'FLOOR0_3', ceil: 'TLITE6_1', ceilH: 120, light: 172 }, // exit room
    { x0: 1, y0: 26, x1: 5, y1: 30, floor: 'GATE2', ceil: 'TLITE6_5', ceilH: 104, light: 150 }, // red vault (teleport)
    { x0: 1, y0: 8, x1: 2, y1: 10, floor: 'FLAT5_4', ceil: 'FLAT1', ceilH: 96, light: 108 }, // secret alcove
  ],
  doors: [
    { x: 16, y: 15, texture: 'BIGDOOR2' }, // tunnels → comm
    { x: 26, y: 15, texture: 'DOORYEL', kind: 'locked', key: 'yellow' }, // comm → storage maze
    { x: 35, y: 5, texture: 'DOORRED', kind: 'locked', key: 'red' }, // maze → exit
  ],
  teleporters: [
    { trigger: { kind: 'walkover', x: 36, y: 25, once: false }, destX: 3, destY: 28, destAngle: 0 }, // maze → red vault
    { trigger: { kind: 'walkover', x: 3, y: 29, once: false }, destX: 36, destY: 23, destAngle: 270 }, // vault → maze (return)
  ],
  exits: [{ kind: 'normal', trigger: { kind: 'switch', x: 33, y: 3 } }],
  secrets: cells(1, 8, 2, 10),
  things: [
    { id: 6, x: 20, y: 15, angle: 0 }, // yellow key (comm beacon)
    { id: 13, x: 3, y: 27, angle: 0 }, // red key (vault)
    // Weapons + economy: rocket launcher ~halfway, chaingun + berserk for lost souls.
    { id: 2003, x: 12, y: 27 }, // rocket launcher
    { id: 2002, x: 9, y: 7 }, // chaingun
    { id: 2001, x: 3, y: 17 }, // shotgun (pistol-start safety)
    { id: 2023, x: 5, y: 9 }, // berserk (tunnels)
    { id: 2046, x: 2, y: 9 }, // box of rockets (secret)
    { id: 2010, x: 14, y: 20 }, // rocket
    { id: 2010, x: 31, y: 23 }, // rocket
    { id: 2049, x: 4, y: 12 }, // box of shells
    { id: 2049, x: 28, y: 9 }, // box of shells
    { id: 2008, x: 8, y: 15 }, // 4 shells
    { id: 2008, x: 22, y: 18 }, // 4 shells
    { id: 2008, x: 31, y: 11 }, // 4 shells
    { id: 2008, x: 36, y: 27 }, // 4 shells
    { id: 2048, x: 19, y: 19 }, // box of bullets
    { id: 2007, x: 10, y: 5 }, // clip
    { id: 2007, x: 34, y: 9 }, // clip
    { id: 2011, x: 2, y: 15 }, // stimpack
    { id: 2011, x: 13, y: 17 }, // stimpack
    { id: 2011, x: 27, y: 7 }, // stimpack
    { id: 2011, x: 36, y: 17 }, // stimpack
    { id: 2011, x: 23, y: 11 }, // stimpack
    { id: 2012, x: 5, y: 18 }, // medikit
    { id: 2012, x: 31, y: 15 }, // medikit
    { id: 2012, x: 3, y: 28 }, // medikit (vault reward)
    { id: 2013, x: 2, y: 8 }, // soulsphere (secret)
    { id: 2018, x: 1, y: 9 }, // green armor (secret)
    { id: 2015, x: 1, y: 10 }, // armor bonus (secret)
    // Monsters — ~40 on HMP (28 easy / 48 UV). Demons/spectres/lost souls + first caco.
    { id: 3004, x: 5, y: 15, angle: 0 }, // zombieman
    { id: 3004, x: 9, y: 6, angle: 90 }, // zombieman
    { id: 3004, x: 20, y: 12, angle: 90 }, // zombieman
    { id: 3004, x: 23, y: 18, angle: 180 }, // zombieman
    { id: 9, x: 12, y: 16, angle: 0 }, // shotgun guy
    { id: 9, x: 9, y: 27, angle: 90 }, // shotgun guy
    { id: 9, x: 21, y: 16, angle: 180 }, // shotgun guy
    { id: 9, x: 19, y: 19, angle: 90 }, // shotgun guy
    { id: 3001, x: 4, y: 9, angle: 0 }, // imp
    { id: 3001, x: 10, y: 8, angle: 90 }, // imp
    { id: 3001, x: 14, y: 23, angle: 90 }, // imp
    { id: 3001, x: 23, y: 12, angle: 180 }, // imp
    { id: 3001, x: 29, y: 9, angle: 180 }, // imp
    { id: 3001, x: 33, y: 11, angle: 180 }, // imp
    { id: 3001, x: 31, y: 27, angle: 270 }, // imp
    { id: 3001, x: 36, y: 9, angle: 180 }, // imp
    { id: 3002, x: 3, y: 13, angle: 0 }, // demon
    { id: 3002, x: 13, y: 19, angle: 90 }, // demon
    { id: 3002, x: 20, y: 18, angle: 180 }, // demon
    { id: 3002, x: 28, y: 27, angle: 180 }, // demon
    { id: 58, x: 29, y: 17, angle: 180 }, // spectre (maze)
    { id: 58, x: 33, y: 23, angle: 180 }, // spectre (maze)
    { id: 58, x: 31, y: 13, angle: 270 }, // spectre (maze)
    { id: 3006, x: 29, y: 11, angle: 180 }, // lost soul (maze)
    { id: 3006, x: 33, y: 17, angle: 180 }, // lost soul (maze)
    { id: 3006, x: 31, y: 19, angle: 270 }, // lost soul (maze)
    { id: 3006, x: 35, y: 23, angle: 180 }, // lost soul (maze)
    { id: 3005, x: 21, y: 12, angle: 90 }, // cacodemon — guards the comm beacon (debut)
    // higher-skill extras (6 = normal+hard, 4 = hard-only)
    { id: 3004, x: 10, y: 27, angle: 90, skill: 6 }, // zombieman
    { id: 3004, x: 24, y: 12, angle: 180, skill: 6 }, // zombieman
    { id: 9, x: 23, y: 16, angle: 180, skill: 6 }, // shotgun guy
    { id: 9, x: 11, y: 16, angle: 0, skill: 6 }, // shotgun guy
    { id: 3001, x: 5, y: 16, angle: 0, skill: 6 }, // imp
    { id: 3001, x: 22, y: 12, angle: 90, skill: 6 }, // imp
    { id: 3001, x: 31, y: 9, angle: 180, skill: 6 }, // imp
    { id: 3001, x: 36, y: 11, angle: 180, skill: 6 }, // imp
    { id: 3002, x: 18, y: 17, angle: 90, skill: 6 }, // demon
    { id: 58, x: 33, y: 27, angle: 180, skill: 6 }, // spectre
    { id: 3006, x: 29, y: 23, angle: 180, skill: 6 }, // lost soul
    { id: 3006, x: 35, y: 11, angle: 180, skill: 6 }, // lost soul
    { id: 3001, x: 36, y: 7, angle: 180, skill: 4 }, // imp — hard
    { id: 3001, x: 29, y: 27, angle: 180, skill: 4 }, // imp — hard
    { id: 3001, x: 31, y: 17, angle: 270, skill: 4 }, // imp — hard
    { id: 58, x: 31, y: 23, angle: 180, skill: 4 }, // spectre — hard
    { id: 58, x: 29, y: 13, angle: 180, skill: 4 }, // spectre — hard
    { id: 3006, x: 33, y: 19, angle: 270, skill: 4 }, // lost soul — hard
    { id: 3006, x: 35, y: 7, angle: 180, skill: 4 }, // lost soul — hard
    { id: 3005, x: 30, y: 7, angle: 180, skill: 4 }, // cacodemon — hard (maze)
  ],
  start: { x: 3, y: 16, angle: 0 },
});
