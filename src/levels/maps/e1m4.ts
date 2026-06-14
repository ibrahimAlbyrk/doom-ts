// E1M4 "Bruiser's Keep" — marble/hell climax under a red sky. An open marble
// courtyard leads to a raised altar (lift) holding the blue key; a normal wooden
// door tucks away the secret plasma rifle + cells. The blue-locked door opens the
// blood-floored boss arena: a Baron of Hell backed by a Hell Knight (higher skills)
// and cacodemons. A wall switch at the arena's far side ends the level (and, as the
// episode's final map, the episode → victory).
//
// Layout (24×18): secret(plasma) ── altar(+64, blue key) ── (above courtyard)
//                 courtyard(open sky) ──blue door── boss arena(blood) ── exit switch
//                 start
import { compile, cells } from '../build';

export const E1M4 = compile({
  id: 'E1M4',
  name: "Bruiser's Keep",
  par: 180,
  sky: 'SKY3',
  music: 'D_E1M4',
  base: { floor: 'FLOOR7_1', ceil: 'CEIL5_2', floorH: 0, ceilH: 160, light: 144 },
  legend: {
    '#': { wall: 'MARBLE1' },
    G: { wall: 'GSTONE1' }, // gargoyle stone around the arena
    S: { wall: 'SW1EXIT' },
    '.': {},
  },
  rows: [
    '########################',
    '#...##...###############',
    '#...##...###############',
    '##.####.########......##',
    '#..............G......G#',
    '#..............G......G#',
    '#..............G......G#',
    '#..............G......G#',
    '#.....................G#',
    '#..............G......S#',
    '#..............G......G#',
    '#..............G......G#',
    '#..............G......G#',
    '#.....GGGGGGGGGG......G#',
    '#.....GGGGGGGGGG......G#',
    '#.....GGGGGGGGGG......G#',
    '#.....GGGGGGGGGGGGGGGGG#',
    '########################',
  ],
  paint: [
    { x0: 1, y0: 4, x1: 14, y1: 12, floor: 'FLAT5_4', ceil: null, ceilH: 256, light: 200 }, // open courtyard
    { x0: 6, y0: 1, x1: 8, y1: 2, floor: 'FLAT1', ceil: null, floorH: 64, ceilH: 256, light: 255 }, // blue-key altar (+64)
    { x0: 1, y0: 1, x1: 3, y1: 2, floor: 'FLAT5_5', ceil: 'FLAT1', ceilH: 120, light: 96 }, // secret (plasma)
    { x0: 16, y0: 3, x1: 21, y1: 15, floor: 'BLOOD1', ceil: 'FLAT1', ceilH: 176, light: 110 }, // boss arena (blood)
    { x0: 1, y0: 13, x1: 5, y1: 16, light: 130 }, // start
    { x0: 20, y0: 8, x1: 21, y1: 10, light: 200 }, // exit-switch glow
  ],
  doors: [
    { x: 2, y: 3, texture: 'WOODGARG' }, // courtyard → secret (normal)
    { x: 15, y: 8, texture: 'DOORBLU', kind: 'locked', key: 'blue' }, // courtyard → boss arena
  ],
  lifts: [
    { cells: [{ x: 7, y: 3 }], low: 0, high: 64, trigger: { kind: 'walkover', x: 7, y: 4, once: false } }, // up to the altar
  ],
  exits: [{ kind: 'normal', trigger: { kind: 'switch', x: 22, y: 9 } }],
  secrets: cells(1, 1, 3, 2),
  things: [
    { id: 5, x: 7, y: 1, angle: 270 }, // blue key (altar)
    // Secret arsenal + courtyard economy for the boss fight.
    { id: 2004, x: 2, y: 1 }, // plasma rifle (secret)
    { id: 17, x: 3, y: 2 }, // cell pack (secret)
    { id: 2015, x: 1, y: 2 }, // armor bonus (secret)
    { id: 82, x: 12, y: 4 }, // super shotgun
    { id: 2048, x: 6, y: 5 }, // box of bullets
    { id: 2049, x: 4, y: 11 }, // box of shells
    { id: 2046, x: 9, y: 8 }, // box of rockets
    { id: 2013, x: 13, y: 11 }, // soulsphere
    { id: 2019, x: 2, y: 14 }, // blue armor (start)
    { id: 2012, x: 5, y: 5 }, // medikit
    { id: 2012, x: 12, y: 9 }, // medikit
    { id: 2012, x: 17, y: 14 }, // medikit (arena)
    { id: 2011, x: 20, y: 4 }, // stimpack (arena)
    // Monsters — the climax. Baron boss + a Hell Knight on higher skills, cacodemons.
    { id: 3003, x: 19, y: 8, angle: 180 }, // BARON OF HELL (boss)
    { id: 3005, x: 19, y: 5, angle: 180 }, // cacodemon
    { id: 3001, x: 17, y: 4, angle: 180 }, // imp
    { id: 3001, x: 20, y: 13, angle: 270 }, // imp
    { id: 3001, x: 8, y: 6, angle: 0 }, // imp (courtyard)
    { id: 3002, x: 5, y: 8, angle: 0 }, // demon (courtyard)
    { id: 3002, x: 11, y: 10, angle: 90 }, // demon (courtyard)
    { id: 69, x: 18, y: 12, angle: 180, skill: 6 }, // hell knight — normal+hard (second bruiser)
    { id: 3005, x: 18, y: 10, angle: 180, skill: 4 }, // cacodemon — hard only
    { id: 3006, x: 10, y: 5, angle: 0, skill: 6 }, // lost soul — normal+hard
  ],
  start: { x: 3, y: 15, angle: 90 },
});
