# DOOM (1993) Design Reference — for a faithful web remake

Implementation-ready stats for a Canvas-2D raycaster, DOOM-style web FPS (TypeScript + Vite)
using Freedoom art/audio. All values are DOOM canonical (from the original `linuxdoom-1.10`
source / Doom Wiki). Freedoom reuses the **same engine, same thing/editor IDs, and the same
numeric stats** — only sprite and sound *lumps* are reskinned — so every number below applies
directly to a Freedoom-asset build. Where Freedoom renames a creature/weapon, the equivalent is
noted, but the anchor an engineer should key on is the **DoomEd thing ID** (section 8), which is
identical between DOOM and Freedoom.

> Sources are cited inline as `[DW:Page]` = doomwiki.org, `[SRC]` = original id Software source
> (`info.c`, `p_*.c`, `g_game.c`), `[SW]` = StrategyWiki, `[D2N]` = doom2.net weapon FAQ,
> `[LDB]` = leveldesignbook.com Doom metrics. Full URLs in section 10.

---

## 0. Units & engine conventions (read first)

| Concept | Value | Notes |
|---|---|---|
| Tic rate | **35 tics/second** | The simulation step. ALL timing below is in tics. `seconds = tics / 35`. |
| Map unit (mu) | the world distance unit | Player is 32 mu wide. Treat 1 mu ≈ ~1 inch-ish; only ratios matter. |
| Fixed point | 16.16 (`FRACUNIT = 65536`) | Original uses fixed-point; a JS remake can use floats freely. |
| Angle (BAM) | 32-bit binary angle | `0x100000000` = 360°. `1° ≈ 11930464 BAM`. Used for turn/spread math. |
| RNG | `P_Random()` returns 0–255 | A fixed 256-entry table in vanilla. A web remake can use any 0–255 RNG. |
| `d N` notation | `(P_Random() % N) + 1` → 1..N | e.g. "d3 × 5" = `((rnd%3)+1)*5` = 5/10/15. This is THE damage idiom. |

**Damage idiom:** nearly every attack is `((P_Random() % N) + 1) * M`. Encode one helper
`rollDamage(N, M)` and you cover ~90% of all DOOM combat. `[SRC]`

---

## 1. Player movement & physics

### Speeds (steady-state top speed; thrust applied each tic, then friction)
| Property | Command value | Top speed (mu/tic) | Top speed (mu/s) | Source |
|---|---|---|---|---|
| Walk forward | forwardmove[0] = 25 | 8.31 | **290.9** | `[DW:Speed]` `[SRC g_game.c]` |
| Run forward (run/shift) | forwardmove[1] = 50 | 16.62 | **581.81** | `[DW:Speed]` |
| Walk strafe | sidemove[0] = 24 | ~7.97 | ~279 | `[SRC]` |
| Run strafe | sidemove[1] = 40 | ~13.3 | ~465 | `[SRC]` |
| Straferun (SR40: fwd50 + side40) | vector 64 | — | **~745** (128% of run) | `[DW:Straferunning]` |

**Physics model (encode this exactly):** each tic, if a move key is held and the player is on
the ground, add thrust `cmd * 2048` (fixed) to the X/Y momentum vector along facing (forward) or
facing−90° (strafe). Then every tic momentum is multiplied by **friction = 0.90625**
(`0xE800/65536`). Momentum below **STOPSPEED 0x1000 (≈0.0625 mu/tic)** snaps to 0. Per-axis
momentum is clamped to **MAXMOVE = 30 mu/tic**. `[SRC p_user.c, p_mobj.c]`
- Steady-state speed = `thrust / (1 − friction)`. There is **no separate accel curve** — friction
  *is* the accel/decel curve. Reaching top speed takes ~0.5 s; stopping is similarly exponential.
- Diagonal is faster (vector sum) — DOOM never normalized diagonal movement; straferunning is the
  famous consequence. Decide whether to replicate or normalize (see §9).

### Turning
| Action | angleturn | °/tic | °/second | Source |
|---|---|---|---|---|
| Walk turn | 640 | 3.52 | **123.3** | `[SRC g_game.c]` |
| Run/fast turn | 1280 | 7.03 | **246.6** | `[SRC]` |
| Turn ease-in (first ≤6 tics) | 320 | 1.76 | 61.6 | `[SRC SLOWTURNTICS]` |
Keyboard turning ramps slow→fast over the first 6 tics. **Mouse turning is uncapped** (raw delta ×
sensitivity). No vertical look in vanilla (autoaim handles pitch — see §9). `[SRC]`

### Collision body & geometry limits
| Property | Value | Notes |
|---|---|---|
| Player radius | **16 mu** | Bounding box is an axis-aligned 32×32 square (DOOM has no round hitboxes). `[SRC info.c]` |
| Player height | **56 mu** | Collision height. |
| View / eye height | **41 mu** | Camera height above floor; bobs ±~something while walking. `[SRC]` |
| Auto step-up | **≤24 mu** | Steps/ledges ≤24 mu tall are climbed automatically; >24 blocks. `[SRC maxstepup]` |
| Step-down / fall | unlimited, **no fall damage** | `[SRC]` |
| Practical min corridor | ~33 mu wide / ~56 tall | Matches radius×2; `[LDB]` cites 33×58 as min hallway. |
| Player mass | 100 | Affects knockback taken. |

### Starting / cap stats
| Stat | Start | Soft cap | Hard cap | Notes |
|---|---|---|---|---|
| Health | 100 | 100 (medikits) | **200** (soulsphere/megasphere/bonuses) | `[DW:Health]` |
| Armor | 0 | 100 (green) | **200** (blue/megasphere) | `[DW:Armor]` |
| Weapons | Fist + Pistol | — | — | |
| Ammo | 50 bullets | — | see §4 | |

---

## 2. Weapon roster

Damage uses the `d N × M` idiom from §0. **Hitscan** = instant ray (uses autoaim slope + optional
horizontal spread). **Projectile** = spawned moving thing. Fire rates from `[D2N]`/`[SW]`
(continuous-hold rate); tic periods are derived (`period ≈ 35 / shots-per-sec`).

| # | Weapon | Type | Damage (per shot/pellet) | Pellets | Fire rate | Ammo | /shot | Notes |
|---|---|---|---|---|---|---|---|---|
| 1 | **Fist** | hitscan melee | d10 × 2 = **2–20** | 1 | ~2/s (anim-bound) | none | 0 | Range 64 mu. ×10 under Berserk → **20–200**. `[SW][SRC]` |
| 1 | **Chainsaw** | hitscan melee | d10 × 2 = **2–20** | 1 | ~8.7/s (~4 tics) | none | 0 | Range ~65 mu, continuous; tugs player toward target, no knockback so target can't flee. |
| 2 | **Pistol** | hitscan | d3 × 5 = **5/10/15** | 1 | ~2.5/s (~14 tics) | bullet | 1 | 1st shot perfectly accurate; held shots get spread. `[D2N]` |
| 3 | **Shotgun** | hitscan | d3 × 5 per pellet | **7** | ~0.97/s (~36 tics) | shell | 1 | All 7 pellets spread horizontally; vertical fixed to autoaim. `[D2N]` |
| 3 | **Super Shotgun** | hitscan | d3 × 5 per pellet | **20** | ~0.7/s (~50 tics) | shell | **2** | **DOOM II / Freedoom** (not in DOOM 1993). Wide H **and** V spread. (`[SW]` says 21 — source loop is 20.) |
| 4 | **Chaingun** | hitscan | d3 × 5 = 5/10/15 | 1 | **~8.8/s** (~4 tics, ~530/min) | bullet | 1 | 1st shot accurate, then spread. `[D2N]` |
| 5 | **Rocket Launcher** | projectile | direct **d8 × 20 = 20–160** + splash | 1 | ~1.7/s (~20 tics) | rocket | 1 | Splash: radius 128 mu, falloff (see below). Hurts the shooter too. `[D2N]` |
| 6 | **Plasma Rifle** | projectile | d8 × 5 = **5–40** | 1 | **~11.7/s** (every 3 tics) | cell | 1 | +21-tic (0.6 s) cool-down on release before re-fire. No splash. `[DW:Plasma]` |
| 7 | **BFG9000** | projectile + spray | ball **d8 × 100 = 100–800** | 1 | single (30-tic charge) | cell | **40** | See BFG below. Up to ~600–4800 total. `[DW:BFG][D2N]` |

### Hitscan spread (encode for held-fire / multi-pellet)
- 1st shot of pistol/chaingun (and the autoaim ray generally): **perfectly accurate** horizontally.
- Held pistol/chaingun, and **every** shotgun pellet: horizontal offset `(P_Random()−P_Random()) << 18`
  BAM → **±~5.6°** max. `[SRC p_pspr.c]`
- Super shotgun pellets: horizontal `<< 19` → **±~11.2°**, plus vertical scatter `<< 18`.
- Vertical aim for all hitscan = **autoaim**: engine picks the first target within a vertical cone
  along the shot line (you don't aim pitch manually). See §9 for the grid-raycaster implication.

### Projectile speeds & splash
| Projectile | Speed (mu/tic) | On-hit damage | Splash | Source |
|---|---|---|---|---|
| Rocket | **20** | d8×20 (20–160) direct | `P_RadiusAttack(128)`: damage = `128 − distance(mu)` to anything in 128-mu radius **with line of sight**, scaled by overlap; max 128 at point-blank. Applies to monsters AND the shooter. | `[DW:Rocket][SRC p_map.c]` |
| Plasma cell | **25** | d8×5 (5–40) | none | `[SRC]` |
| BFG ball | **25** | d8×100 (100–800) direct | none from the ball itself | `[SRC]` |

### BFG9000 firing sequence (the famous two-part hit) `[DW:BFG9000]`
1. Trigger held → **30-tic (~0.857 s) charge**, consumes **40 cells** up front, then spawns one
   BFG ball (speed 25).
2. Ball impact: 100–800 direct damage to whatever it hits.
3. **Same frame as impact**, fire **40 invisible tracer rays** in a 90°-ish cone *from the player's
   position toward the player's facing* (NOT from the ball). Each tracer that hits a target deals
   `sum of 15 × d8` = **15–120** (i.e. `for j in 0..14: dmg += (rnd%8)+1`). Massed close-range hit
   can stack to ~600–4800. This "aim the ball, then face the target as it lands" timing is the BFG
   skill mechanic — replicate the tracer origin = player, not the ball.

---

## 3. Enemy roster

Core **Episode 1 (Knee-Deep in the Dead)** monster set: Zombieman, Shotgun Guy, Imp, Demon,
Spectre, Lost Soul, Cacodemon, Baron of Hell (E1M8 boss pair). Hell Knight, Cyberdemon, Spider
Mastermind etc. are later episodes / DOOM II — included for a full episode build. Freedoom ships
analogues under different names with **identical stats and thing IDs**.

| Monster | Freedoom name (approx) | ID | HP | Speed (mu/tic) | Attack | Damage | Proj. speed | Pain chance | Mass |
|---|---|---|---|---|---|---|---|---|---|
| **Zombieman** | Zombie / Former Human | 3004 | **20** | 8 | hitscan (pistol) | d5 × 3 = **3–15** | — | 200 (78%) | 100 |
| **Shotgun Guy** | Shotgun Zombie | 9 | **30** | 8 | hitscan, 3 pellets | d5 × 3 each = 3–15 | — | 170 (67%) | 100 |
| **Imp** | Serpentipede | 3001 | **60** | 8 | melee OR fireball | melee d8×3=**3–24**; fireball d8×3=3–24 | **10** | 200 (78%) | 100 |
| **Demon (Pinky)** | Flesh Worm / Pinky | 3002 | **150** | **10** | melee bite only | d10 × 4 = **4–40** | — | 180 (70%) | 400 |
| **Spectre** | (invisible Demon) | 58 | **150** | **10** | melee bite only | d10 × 4 = 4–40 | — | 180 (70%) | 400 |
| **Lost Soul** | Dark Soul / flying skull | 3006 | **100** | 8 (charge **20**) | melee charge bite | d8 × 3 = **3–24** | charge=20 | 256 (always*) | 56 |
| **Cacodemon** | Trilobite | 3005 | **400** | 8 (floats) | melee OR fireball | melee d6×10=**10–60**; fireball d8×5=**5–40** | **10** | 128 (50%) | 400 |
| **Baron of Hell** | Bruiser Demon | 3003 | **1000** | 8 | melee OR fireball | melee d8×10=**10–80**; fireball d8×8=**8–64** | **15** | 50 (20%) | 1000 |
| **Hell Knight** | (lesser Bruiser) | 69 | **500** | 8 | melee OR fireball | same as Baron (10–80 / 8–64) | **15** | 50 (20%) | 1000 |
| *Cyberdemon* (E2 boss) | Assault Tripod | 16 | **4000** | 16 | 3× rockets (as §2) | rocket 20–160 + splash | 20 | 20 (8%, near-immune) | 1000 |
| *Spider Mastermind* (E3 boss) | Large Technospider | 7 | **3000** | 12 | rapid hitscan (chaingun) | d5 × 3 = 3–15/bullet | — | 40 (16%) | 1000 |

Sources: HP/speed/painchance/mass from `[SRC info.c]`; projectile speeds confirmed `[DW:Fast monsters]`
(imp/caco fireball 10 mu/tic → 20 under fast; baron/knight 15 → +33%). `*`Lost Soul painchance 256 >
RNG max 255 ⇒ always flinches — **except** it ignores pain while in its charge (skullfly) state.

### Pain chance mechanic `[DW:Pain chance][SRC]`
On taking damage, monster enters its **pain state** if `P_Random() < painChance`. Pain = brief
flinch (interrupts current action ~6 tics) + knockback. Percentages above = `painChance/256`.
Knockback magnitude ≈ `damage * (≈12.5) / mass` mu/tic of thrust away from the hit (so a 1000-mass
Baron barely moves; a 56-mass Lost Soul flies). Heavy single hits can "stunlock" weak monsters.

### Generic monster AI state machine (encode once, parameterize per monster) `[SRC p_enemy.c]`
```
SPAWN/IDLE  (S_*_STND)  → runs A_Look every ~few tics:
                          sees player if within 180° front cone + line of sight,
                          OR hears player's weapon noise (sound travels through
                          sectors until blocked by sound-blocking lines).
   │ target acquired (reactiontime ≈ 8 tics delay before first act)
   ▼
CHASE       (S_*_RUN)   → A_Chase: step toward target in one of 8 compass dirs,
                          re-pick direction periodically, play active sound (~%),
                          if target in range + LOS + cooldown elapsed → attack.
   ├─ target within melee range (≈64 + radii) and has melee → MELEE
   ▼
MELEE/MISSILE (S_*_ATK) → A_FaceTarget, then A_<Mon>Attack:
                          melee = instant damage roll; ranged = spawn projectile
                          aimed at target (with autoaim Z). Then back to CHASE.
   │ took damage (prob = painChance/256)
   ▼
PAIN        (S_*_PAIN)  → A_Pain (play pain sound), apply knockback, ~6 tics, → CHASE.
   │ health ≤ 0
   ▼
DEATH       (S_*_DIE)   → A_Scream (death sound), A_Fall (clear SOLID so corpse is
                          walkable), settle to corpse frame.
   │ health < −spawnHealth (massive overkill)
   ▼
GIB/XDEATH  (S_*_XDIE)  → gory death animation (optional in a 2D remake).
```
- **Reaction time**: ~8 tics between sighting and first attack.
- **Attack cooldown**: baked into state durations (each monster's missile/melee state set has fixed
  tic counts; e.g. an Imp can't chain-fire instantly).
- **Infighting** `[DW:Monster infighting]`: if monster A is *hit by* monster B's attack (not its
  own species, with a few exceptions), A switches its target to B and they fight. Splash and stray
  hitscan trigger this. Cheap to add (`onDamaged(from): if from.isMonster && from.type != self.type → target = from`)
  and a big part of DOOM's emergent feel — recommend keeping.
- **Floating** monsters (Cacodemon, Lost Soul) ignore floor height and move in Z toward the target
  (irrelevant in a flat grid — see §9).

### Sounds (lump names — Freedoom provides same-named replacement lumps) `[SRC sounds.c]`
| Monster | sight | attack | pain | death | active |
|---|---|---|---|---|---|
| Zombieman | posit1/2/3 | pistol | popain | podth1/2/3 | posact |
| Shotgun Guy | posit1/2/3 | shotgn | popain | podth/sgtdth | posact |
| Imp | bgsit1/2 | claw/firsht | popain | bgdth1/2 | bgact |
| Demon/Spectre | sgtsit | sgtatk | dmpain | sgtdth | dmact |
| Lost Soul | (none) | sklatk | dmpain | firxpl | dmact |
| Cacodemon | cacsit | firsht | dmpain | cacdth | dmact |
| Baron/Knight | brssit/kntsit | — | dmpain | brsdth/kntdth | dmact |
Plus global SFX: `dshtgn` (player shotgun), `rlaunc`/`barexp` (rocket/explosion), `plasma`,
`bfg`, `firxpl` (projectile impact), `oof` (player land/hurt), `itemup`/`wpnup`, `dsdoor*`, etc.

---

## 4. Ammo types, capacities & backpack `[DW:Ammo][SRC p_inter.c]`

| Ammo | Used by | Normal max | Backpack max | Small pickup | Box pickup |
|---|---|---|---|---|---|
| **Bullets** (clip) | Pistol, Chaingun | 200 | **400** | Clip = +10 | Box = +50 |
| **Shells** | Shotgun, Super Shotgun | 50 | **100** | 4 shells = +4 | Box = +20 |
| **Rockets** | Rocket Launcher | 50 | **100** | 1 rocket = +1 | Box = +5 |
| **Cells** | Plasma, BFG | 300 | **600** | Cell = +20 | Cell pack = +100 |

- **Backpack** (ID 8): **doubles every max** (as above) AND grants one small pickup of each ammo
  (+10 bullets, +4 shells, +1 rocket, +20 cells) on grab.
- **Dropped weapons/ammo**: a killed Zombieman drops a clip (+10), Shotgun Guy drops a shotgun
  (+4 shells on pickup... gives weapon's ammo). Picking up a *weapon* grants ammo: shotgun → 8
  shells, chaingun → 20 bullets (2 clips), rocket launcher → 2 rockets, plasma → 40 cells,
  BFG → 40 cells, super shotgun → 8 shells. `[SRC]`
- **Pickup doubling**: on skills **1 (ITYTD)** and **5 (Nightmare)**, all ammo *pickups* give ×2
  (clip → 20, box → 100, etc.). `[DW:Skill level]`
- Picking up ammo over max is clamped to max (excess wasted).

---

## 5. Items & pickups

### Health & armor `[DW:Health][DW:Armor][SRC p_inter.c]`
| Item | ID | Effect | Cap |
|---|---|---|---|
| Health bonus (potion) | 2014 | +1 health | up to **200** (can exceed 100) |
| Stimpack | 2011 | +10 health | 100 |
| Medikit | 2012 | +25 health | 100 |
| Soulsphere (supercharge) | 2013 | **+100 health** | up to **200** |
| Megasphere | 83 | health → **200** + blue armor **200** | (DOOM II) |
| Armor bonus (helmet) | 2015 | +1 armor | up to **200** |
| Green armor (security) | 2018 | armor → **100**, type 1 | absorbs **1/3** of damage |
| Blue armor (mega) | 2019 | armor → **200**, type 2 | absorbs **1/2** of damage |

**Armor damage model:** incoming damage is split — armor absorbs `1/3` (green) or `1/2` (blue) of
each hit, the rest hits health. Absorbed amount is deducted from armor points; when armor hits 0,
type resets and 100% goes to health. Picking up a *lesser* armor over a greater one does **not**
downgrade absorption type if it would lower it (green won't overwrite blue's points... actually green
sets points to 100 & type 1 — pickup logic: only upgrades). Keep it simple: store `{points, factor}`.

### Powerups (timed unless noted) `[DW:Powerup][SRC d_player.h]`
| Powerup | ID | Effect | Duration |
|---|---|---|---|
| **Berserk pack** | 2023 | Health → 100 (if lower); **fist ×10** (20–200); red screen tint; auto-switch to fist | **rest of level** (permanent strength) |
| **Invulnerability** | 2022 | Immune to all damage (except telefrag/crusher); inverted ("god") palette | **30 s** (1050 tics) |
| **Radiation suit** | 2025 | No damage from nukage/slime/lava floors; green tint; blinks when expiring | **60 s** (2100 tics) |
| **Partial invisibility** (blur) | 2024 | Monsters' aim becomes erratic (random angle); player drawn with fuzz | **60 s** (2100 tics) |
| **Light amp visor** (infrared) | 2045 | Full-bright vision everywhere | **120 s** (4200 tics) |
| **Computer area map** | 2026 | Reveals entire automap | rest of level |

### Keycards & skull keys `[DW:Key]`
| Key | Card ID | Skull ID | Use |
|---|---|---|---|
| Blue | 5 | 40 | Opens blue-locked doors |
| Yellow | 6 | 39 | Opens yellow-locked doors |
| Red | 13 | 38 | Opens red-locked doors |
3 colors × 2 forms. A locked door accepts the matching color in **either** form. Keys persist for
the whole level (lost on level transition). HUD shows owned keys (see §6).

---

## 6. HUD / status bar (STBAR) `[DW:Status bar]`

Bottom-of-screen bar, 320×32 (in 320×200 reference). Left → right field layout:

```
┌──────────────────────────────────────────────────────────────────────────┐
│ AMMO │   HEALTH%  │  ARMS   │  [MUGSHOT]  │  ARMOR% │  KEYS │  AMMO COUNTS  │
│ (big)│  (big red) │ 2 3 4   │  (face,     │ (big %) │  ▢▢▢  │  BULL  x/ y   │
│  red │   nn %     │ 5 6 7   │   center)   │  nn %   │ B Y R │  SHEL  x/ y   │
│  num │            │ lit=own │             │         │ cards │  RCKT  x/ y   │
│      │            │         │             │         │/skulls│  CELL  x/ y   │
└──────────────────────────────────────────────────────────────────────────┘
```

Fields:
1. **Ammo** (far left, large red number): current weapon's ammo count. Blank for fist/chainsaw.
2. **Health %** (large number + `%`).
3. **Arms panel**: weapon-slot numbers **2–7**, each lit if owned, dim if not (slot 1 fist always
   owned, not shown as a number; in DOOM II a `3` doubles for shotgun/SSG share).
4. **Mugshot (Doomguy face, `STF*`)** — center. States, cycle ~ every few tics:
   - 5 **health brackets** (≈ >80, 60–80, 40–60, 20–40, <20) each with 3 facing variants
     (straight / look-left / look-right), cycling randomly.
   - **Turns toward damage direction** when hit (faces left/right of incoming).
   - **Ouch** face (`STFOUCH`) on a big sudden hit (≥20 in one tic).
   - **Evil grin** (`STFEVL`) for ~a second after picking up a new weapon.
   - **Rampage** (gritted) face while continuously firing.
   - **God** face (`STFGOD`) under invulnerability/IDDQD; **Dead** face (`STFDEAD`) at 0 health.
5. **Armor %** (large number + `%`).
6. **Keys panel** (right of face): up to 3 slots showing owned blue/yellow/red, card or skull icon.
7. **Ammo counts** (far right): a 2-column small-number table — for each of BULL/SHEL/RCKT/CELL,
   `current / max` (max updates when backpack grabbed).

Also: fullscreen HUD variant (no bar) shows the same numbers as overlay. Automap is a separate
mode. Screen-edge **damage flash** (red) and **pickup flash** (gold) are palette effects, plus the
berserk(red)/radsuit(green)/invuln(inverted) tints noted in §5.

---

## 7. Game flow

### Episode / map structure (DOOM 1993, "Episode 1: Knee-Deep in the Dead") `[DW:Doom][DW:E1]`
- Original DOOM = **3 episodes × 9 maps** (Ultimate DOOM added a 4th episode). For a "full episode
  of 3–5 levels" remake, model **one episode of N maps + optionally 1 secret map**.
- Episode 1 layout: **E1M1 … E1M8**, plus secret **E1M9** reached via a *secret exit* in **E1M3**.
- **Boss:** E1M8 spawns **two Barons of Hell** ("Bruiser Brothers"); killing them triggers a
  floor-lower (boss-death special) that opens the exit. (Each episode's M8 has a scripted boss
  death tied to a tag.)
- After the episode's last map → text/story screen → (in DOOM) the next episode or end.

### Exits, switches, teleporters `[DW:Linedef type]`
- **Normal exit**: a wall **switch** (linedef type 11 `S1 Exit`) or a **walk-over** line
  (type 52 `W1 Exit`) ends the level → intermission → next map.
- **Secret exit**: switch type 51 / walk-over type 124 → goes to the **secret map** instead.
- **Teleporters**: linedef type 39/97 (W1/WR teleport) move the player (and monsters) to a
  `MT_TELEPORTMAN` (ID 14) destination in the tagged sector, with a flash + `tport` sound. Used
  for in-level transit and some exits.
- **Doors**: linedef specials (e.g. 1 `DR Door`, 31 manual stay-open, 26/27/28 locked blue/yellow/red).
  Open/close on use or trigger; locked ones check the key. In a grid remake, model a door as a cell
  whose "open amount" animates 0→1.

### Secret areas `[DW:Secret]`
- Sectors flagged with **sector special 9 ("Secret")**. Entering one increments the secret counter
  and (in modern ports) prints "A secret is revealed." Found by pushing walls (use), shooting
  switches, or stepping on hidden triggers.
- Counted on the tally as **Secret %**.

### Intermission / tally screen `[DW:Intermission]`
After each level, a stats screen for the player(s):
- **Kills %** = monsters killed / total monsters on the map.
- **Items %** = items picked up / total counted items.
- **Secret %** = secret sectors entered / total.
- **Time** = your completion time vs **Par** (a designer-set target, e.g. E1M1 par = 0:30).
- A "Finished / Entering" map-name banner with the level-complete animation.
- Lost Souls historically did **not** add to the map's monster total in vanilla (a known counting
  quirk) — decide whether your kill % counts them.

### Skill levels (5) `[DW:Skill level][SRC]`
Each map's *things* carry skill flags: **MTF_EASY** (skills 1–2), **MTF_NORMAL** (skill 3),
**MTF_HARD** (skills 4–5). A monster/item appears only if its flag matches the chosen skill, which
is how counts scale.

| # | Name | Monster set | Player damage taken | Ammo pickups | Special |
|---|---|---|---|---|---|
| 1 | I'm Too Young To Die | EASY flag (fewest) | **×0.5** (half) | **×2** | — |
| 2 | Hey Not Too Rough | EASY flag | ×1 | ×1 | — |
| 3 | Hurt Me Plenty | NORMAL flag | ×1 | ×1 | default |
| 4 | Ultra-Violence | HARD flag (most) | ×1 | ×1 | — |
| 5 | **Nightmare!** | HARD flag | ×1 | **×2** | **Fast monsters** + **respawn** + aggressive |

**Nightmare specifics** `[DW:Fast monsters][DW:Nightmare]`:
- **Fast projectiles**: Imp/Caco fireball 10→**20** mu/tic; Baron/Knight shot 15→**~20** (+33%);
  others scaled similarly.
- **Fast monster movement/attacks**: Demons & Spectres move/attack **~2×**; melee/missile state
  timings shortened; monsters re-attack with shorter cooldowns and chase more aggressively.
- **Respawn**: dead monsters resurrect at their spawn corpse roughly **~12 s** after death
  (telefrag-respawn), so the map never empties.
- Ammo pickups doubled (as ITYTD). Skill is selectable mid-confirmation ("are you sure?").
- `-fast` command-line gives fast monsters without respawn (e.g. for UV-Fast).

---

## 8. DoomEd thing-ID quick reference (Freedoom-compatible)

Freedoom WADs reuse these exact editor numbers, so keying your spawner on the ID guarantees
DOOM/Freedoom interchangeability. `[DW:Thing types]`

| ID | Thing | ID | Thing | ID | Thing |
|---|---|---|---|---|---|
| 1 | Player 1 start | 2007 | Clip (+10 bul) | 2014 | Health bonus |
| 14 | Teleport dest | 2048 | Box bullets (+50) | 2011 | Stimpack |
| 3004 | Zombieman | 2008 | 4 shells (+4) | 2012 | Medikit |
| 9 | Shotgun Guy | 2049 | Box shells (+20) | 2013 | Soulsphere |
| 3001 | Imp | 2010 | Rocket (+1) | 83 | Megasphere |
| 3002 | Demon | 2046 | Box rockets (+5) | 2015 | Armor bonus |
| 58 | Spectre | 2047 | Cell (+20) | 2018 | Green armor |
| 3006 | Lost Soul | 17 | Cell pack (+100) | 2019 | Blue armor |
| 3005 | Cacodemon | 8 | Backpack | 2023 | Berserk |
| 3003 | Baron of Hell | 5 / 40 | Blue card / skull | 2022 | Invulnerability |
| 69 | Hell Knight | 6 / 39 | Yellow card / skull | 2025 | Radiation suit |
| 16 | Cyberdemon | 13 / 38 | Red card / skull | 2024 | Partial invis |
| 7 | Spider Mastermind | 2001 | Shotgun (pickup) | 2026 | Computer map |
| | | 2002 | Chaingun (pickup) | 2045 | Light visor |
| | | 2003 | Rocket launcher | 2005 | Chainsaw (pickup) |
| | | 2004 | Plasma rifle | 82 | Super shotgun |
| | | 2006 | BFG9000 | | |

---

## 9. Grid-raycaster fidelity flags — SCOPE DECISIONS NEEDED

DOOM is **not** a grid game: it's a 2.5D BSP engine with arbitrary-angle walls and per-sector
floor/ceiling heights. A uniform-grid, flat-floor Wolfenstein-style raycaster cannot reproduce
several mechanics 1:1. Flagging the costly ones so you can decide *replicate vs. approximate vs. cut*:

1. **Variable floor/ceiling heights & vertical geometry — BIGGEST.** Stairs, lifts, raised
   platforms, ledges, the 24-mu auto step-up, crushers, deep nukage pits — all depend on per-sector
   Z. A flat grid has one floor height. *Decision:* accept flat levels (cut height entirely), OR
   add a per-cell floor/ceiling height field and do textured-floor casting (much more engine work).
   **Recommend cutting height for v1**; it cascades into items 2–5.

2. **Arbitrary-angle / non-orthogonal walls.** DOOM walls are BSP line segments at any angle; a
   grid is axis-aligned blocks. Diagonal rooms, angled corridors, circular arenas are impossible on
   a pure grid. *Decision:* design levels to the grid (orthogonal), OR support arbitrary wall
   segments (then it's not really a grid raycaster anymore).

3. **Vertical aim / autoaim & projectile Z.** DOOM hitscan auto-pitches to targets; rockets/plasma
   travel in 3D; you can shoot over/under things. On a flat grid everything shares one Z plane, so
   "autoaim" degenerates to "first thing along the 2D ray." *Decision:* treat all combat as 2D
   (simplest, mostly fine), and drop the vertical cone.

4. **Flying / floating monsters at altitude (Cacodemon, Lost Soul).** Their threat comes from
   attacking from above/across pits. Flat grid → they're just ground monsters that ignore terrain.
   Acceptable downgrade, but it changes their feel.

5. **Moving sectors: lifts, crushers, raising stairs, door *floors*.** Doors translate fine to a
   grid (animate a cell's open amount). Lifts/crushers/raising-floor puzzles do **not** without Z.
   *Decision:* keep doors + simple teleporters; cut lifts/crushers.

6. **Splash damage line-of-sight in 2D** — feasible and cheap (radius check + 2D LOS); keep it, but
   note it can't fall off vertically.

7. **Sound-propagation AI wakeups** (noise travels through connected sectors until a sound-block
   line) — needs a flood-fill over your map graph. Approximate with a simple radius or "same room"
   wake. Low cost, worth a simplified version.

8. **Partial-invisibility fuzz, invuln palette inversion, light diminishing/sector lighting** —
   pure rendering effects. Cheap to fake (sprite dithering, full-screen invert, distance fog). Keep
   as polish, not blocking.

9. **Infighting & pain-stun** — pure logic, no geometry dependency. **Cheap, keep it** (high
   gameplay value per line of code).

10. **Straferunning / un-normalized diagonal speed** — a *bug-feature*. Decide deliberately: keep
    (authentic, enables speed tricks) or normalize diagonal (cleaner modern feel). One-line choice.

**Net recommendation for v1:** flat single-height grid; 2D combat (no vertical aim); doors +
teleporters but no lifts/crushers; keep infighting, splash, pain-chance, pickups, HUD, skill
scaling, and the full damage/HP/speed tables above — those carry the DOOM *feel* and are all
grid-friendly. Revisit per-cell heights only if vertical level design proves essential.

---

## 10. Sources

- `[DW:*]` The Doom Wiki — https://doomwiki.org/ : pages *Speed*, *Straferunning*, *Player*,
  *Monster*, *Fast monsters*, *Pain chance*, *Monster infighting*, *Health*, *Armor*, *Ammo*,
  *Backpack*, *Powerup*, *Key*, *Skill level*, *Status bar*, *Intermission*, *Linedef type*,
  *Thing types*, *Rocket launcher*, *Plasma gun*, *BFG9000*, *Knee-Deep in the Dead*.
- `[SRC]` id Software `linuxdoom-1.10` source — `info.c` (mobjinfo/states/sounds), `p_enemy.c`
  (AI), `p_pspr.c` (weapons), `p_inter.c` (pickups/damage), `p_map.c` (radius attack),
  `g_game.c` (movement/turn constants), `d_player.h` (powerup durations).
- `[SW]` StrategyWiki — https://strategywiki.org/wiki/Doom/Weapons (note: lists SSG as 21 pellets;
  source loop is 20).
- `[D2N]` doom2.net weapon FAQ — https://www.doom2.net/single/weaponfaq.html (fire rates, damage).
- `[LDB]` Level Design Book — https://book.leveldesignbook.com/process/blockout/metrics/doom
  (player size, room/corridor metrics, power-of-two grid).

> Freedoom asset note: Freedoom (freedoom.github.io) ships Phase 1 (episodic, DOOM-1-style) and
> Phase 2 (DOOM-II-style, includes Super Shotgun & extra monsters). It is sprite/sound-compatible
> with these stats via identical thing IDs — load Freedoom WAD lumps but drive behavior from the
> numbers in this document.
