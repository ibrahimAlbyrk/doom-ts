// In-game HUD — the classic DOOM status bar (STBAR) plus a top-of-screen message
// line and damage/pickup screen flashes (doom-design.md §6). The bar is rendered at
// its native 320×32 into a cached canvas using real STBAR/STTNUM/STF*/STKEYS graphics,
// then composited over the 3D frame through Renderer.blitHudLayer at viewport scale.
//
// Reactivity: the controller subscribes to the gameplay event bus so the mugshot
// reacts (pain turns, ouch, evil grin on a weapon, god face, rampage, death) and the
// message line shows pickups — but it reads health/armor/ammo/keys live from the
// player struct each frame. The state machine (src/game) owns transitions; it calls
// update(dt) per tick and composite(renderer, world) after rendering the world.
import type {
  IWorld,
  Player,
  PlayerInventory,
  AmmoType,
  KeyColor,
  EventBus,
  GameEventMap,
} from '../core';
import type { Renderer } from '../render';
import { WEAPONS, ITEMS_BY_ID, POWERUPS } from '../data';
import { TextureCache, drawText, HUD_FONT } from './gfx';

// ── Status-bar field layout (native 320×32 bar coordinates, DOOM st_stuff.c) ──
const BAR_W = 320;
const BAR_H = 32;
const BIG_W = 13; // STTNUM / STTPRCNT digit advance
const SMALL_W = 4; // STYSNUM digit advance
const NUM_Y = 3;
const AMMO_RIGHT_X = 44; // big current-ammo number right edge
const HEALTH_RIGHT_X = 90; // health %: number ends here, '%' starts here
const ARMS_X = 111;
const ARMS_Y = 4;
const ARMS_DX = 12;
const ARMS_DY = 10;
const FACE_X = 143; // mugshot panel left
const FACE_W = 24;
const ARMOR_RIGHT_X = 221;
const KEY_X = 239;
const KEY_Y = [3, 13, 23];
const AMMO_HAVE_X = 288; // small ammo-table count right edge
const AMMO_MAX_X = 314; // small ammo-table max right edge
const AMMO_ROW_Y = [5, 11, 17, 23];
const AMMO_ROWS: AmmoType[] = ['bullets', 'shells', 'rockets', 'cells'];
const KEY_COLORS: KeyColor[] = ['blue', 'yellow', 'red'];

// ── Mugshot timing (seconds) + thresholds ────────────────────────────────────
const EVIL_TIME = 1.0; // evil grin after a new weapon
const OUCH_TIME = 0.7; // big-hit ouch face
const TURN_TIME = 0.4; // pain turn toward damage
const IDLE_VARIANT_TIME = 0.7; // straight-face look cycle
const RAMPAGE_THRESHOLD = 1.8; // sustained fire before the gritted face
const FIRE_LINGER = 0.25; // a shot counts as "still firing" this long
const BIG_HIT = 20; // ouch threshold (one hit)
const MESSAGE_TIME = 4.0;
const FLASH_TIME = 0.4;

type FaceExpr = 'idle' | 'turnLeft' | 'turnRight' | 'ouch' | 'evil';

/** Mugshot health bracket 0 (healthy) .. 4 (near death) — DOOM ST_calcPainOffset. */
function painBand(health: number): number {
  const h = Math.max(0, Math.min(100, health));
  return Math.min(4, Math.floor(((100 - h) * 5) / 101));
}

/** Does the player own any weapon in arms slot `slot` (2..7)? */
function ownsSlot(inv: PlayerInventory, slot: number): boolean {
  for (const w of Object.values(WEAPONS)) {
    if (w.slot === slot && inv.weapons[w.id]) return true;
  }
  return false;
}

/** STKEYS icon index for a colour's held forms, or null when not held. */
function keyIconIndex(base: number, card: boolean, skull: boolean): number | null {
  if (card && skull) return base + 6;
  if (skull) return base + 3;
  if (card) return base;
  return null;
}

export class HudController {
  private readonly cache: TextureCache;
  private readonly unsubs: Array<() => void> = [];
  private readonly bar: HTMLCanvasElement;
  private readonly barCtx: CanvasRenderingContext2D;
  private layer: HTMLCanvasElement | null = null;

  // reactive mugshot state
  private expr: FaceExpr = 'idle';
  private exprTimer = 0;
  private idleVariant = 0;
  private idleTimer = IDLE_VARIANT_TIME;
  private fireTimer = 0;
  private rampage = 0;
  private lastTurn: 'turnLeft' | 'turnRight' = 'turnRight';

  // message line + screen flash
  private message = '';
  private messageTimer = 0;
  private flashColor = '';
  private flashAlpha = 0;
  private flashTimer = 0;

  constructor(cache: TextureCache, events: EventBus<GameEventMap>) {
    this.cache = cache;
    const bar = document.createElement('canvas');
    bar.width = BAR_W;
    bar.height = BAR_H;
    const ctx = bar.getContext('2d');
    if (!ctx) throw new Error('HudController: 2D context unavailable');
    this.bar = bar;
    this.barCtx = ctx;
    this.subscribe(events);
  }

  /**
   * Status-bar height in viewport pixels at the given viewport width — the bottom strip
   * the bar occupies. The game subtracts this from the internal height to get the play
   * view region the 3D world + weapon render into (DOOM bar = 32 of 200 ≈ 16%).
   */
  barHeightPx(viewportWidth: number): number {
    return Math.round(BAR_H * (viewportWidth / BAR_W));
  }

  /** Show a HUD message (pickup/key line). Auto-clears after a few seconds. */
  setMessage(text: string): void {
    this.message = text;
    this.messageTimer = MESSAGE_TIME;
  }

  /** Advance mugshot animation, message timeout, and screen-flash decay. */
  update(dt: number): void {
    if (this.exprTimer > 0) {
      this.exprTimer -= dt;
      if (this.exprTimer <= 0) this.expr = 'idle';
    }
    this.idleTimer -= dt;
    if (this.idleTimer <= 0) {
      this.idleVariant = (this.idleVariant + 1) % 3;
      this.idleTimer = IDLE_VARIANT_TIME;
    }
    if (this.fireTimer > 0) {
      this.fireTimer -= dt;
      this.rampage += dt;
    } else {
      this.rampage = 0;
    }
    if (this.messageTimer > 0) this.messageTimer -= dt;
    if (this.flashTimer > 0) this.flashTimer -= dt;
  }

  /** Render the HUD into the viewport-sized layer and blit it over the world frame. */
  composite(renderer: Renderer, world: IWorld): void {
    const vp = renderer.getViewport();
    if (vp.width <= 0 || vp.height <= 0) return;
    const layer = this.ensureLayer(vp.width, vp.height);
    const ctx = layer.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, vp.width, vp.height);
    ctx.imageSmoothingEnabled = false;

    if (this.flashTimer > 0 && this.flashColor) {
      ctx.globalAlpha = this.flashAlpha * Math.max(0, this.flashTimer / FLASH_TIME);
      ctx.fillStyle = this.flashColor;
      ctx.fillRect(0, 0, vp.width, vp.height);
      ctx.globalAlpha = 1;
    }

    const scale = vp.width / BAR_W;

    if (this.messageTimer > 0 && this.message) {
      drawText(ctx, this.cache, HUD_FONT, this.message, Math.round(4 * scale), Math.round(3 * scale), {
        scale: Math.max(1, Math.round(scale)),
      });
    }

    this.renderBar(world.player);
    const barH = this.barHeightPx(vp.width);
    ctx.drawImage(this.bar, 0, vp.height - barH, vp.width, barH);

    renderer.blitHudLayer(layer);
  }

  /** Detach event subscriptions (call at teardown). */
  dispose(): void {
    for (const off of this.unsubs) off();
    this.unsubs.length = 0;
  }

  // ── internals ────────────────────────────────────────────────────────────────

  private ensureLayer(w: number, h: number): HTMLCanvasElement {
    let layer = this.layer;
    if (!layer) {
      layer = document.createElement('canvas');
      this.layer = layer;
    }
    if (layer.width !== w || layer.height !== h) {
      layer.width = w;
      layer.height = h;
    }
    return layer;
  }

  private renderBar(p: Player): void {
    const ctx = this.barCtx;
    ctx.clearRect(0, 0, BAR_W, BAR_H);
    this.cache.draw(ctx, 'STBAR', 0, 0);

    const weapon = WEAPONS[p.currentWeapon];
    if (weapon.ammo) this.drawNum('STTNUM', p.inventory.ammo[weapon.ammo], AMMO_RIGHT_X, NUM_Y, BIG_W);

    this.drawPercent(Math.max(0, p.health), HEALTH_RIGHT_X);
    this.drawArms(p.inventory);
    this.drawFace(p);
    this.drawPercent(p.armor.points, ARMOR_RIGHT_X);
    this.drawArmorTint(p);
    this.drawKeys(p.inventory);
    this.drawAmmoTable(p.inventory);
  }

  private drawNum(prefix: string, value: number, rightX: number, y: number, digitW: number): void {
    const s = String(Math.max(0, Math.floor(value)));
    let x = rightX;
    for (let i = s.length - 1; i >= 0; i--) {
      x -= digitW;
      this.cache.draw(this.barCtx, `${prefix}${s.charAt(i)}`, x, y);
    }
  }

  private drawPercent(value: number, rightX: number): void {
    this.cache.draw(this.barCtx, 'STTPRCNT', rightX, NUM_Y);
    this.drawNum('STTNUM', value, rightX, NUM_Y, BIG_W);
  }

  private drawArms(inv: PlayerInventory): void {
    for (let slot = 2; slot <= 7; slot++) {
      const i = slot - 2;
      const x = ARMS_X + (i % 3) * ARMS_DX;
      const y = ARMS_Y + Math.floor(i / 3) * ARMS_DY;
      const prefix = ownsSlot(inv, slot) ? 'STYSNUM' : 'STGNUM';
      this.cache.draw(this.barCtx, `${prefix}${slot}`, x, y);
    }
  }

  private drawFace(p: Player): void {
    const img = this.cache.image(this.faceId(p));
    if (!img) return;
    const x = FACE_X + Math.floor((FACE_W - img.width) / 2);
    const y = Math.floor((BAR_H - img.height) / 2);
    this.barCtx.drawImage(img, x, y);
  }

  private faceId(p: Player): string {
    if (p.health <= 0) return 'STFDEAD0';
    const band = painBand(p.health);
    if (p.powerups.invulnerability != null) return 'STFGOD0';
    switch (this.expr) {
      case 'ouch':
        return `STFOUCH${band}`;
      case 'evil':
        return `STFEVL${band}`;
      case 'turnLeft':
        return `STFTL${band}0`;
      case 'turnRight':
        return `STFTR${band}0`;
      case 'idle':
        break;
    }
    if (this.fireTimer > 0 && this.rampage >= RAMPAGE_THRESHOLD) return `STFKILL${band}`;
    return `STFST${band}${this.idleVariant}`;
  }

  /** A faint colour wash over the armor number signalling green (1/3) vs blue (1/2). */
  private drawArmorTint(p: Player): void {
    if (p.armor.points <= 0 || p.armor.factor <= 0) return;
    const blue = p.armor.factor >= 0.5;
    this.barCtx.save();
    this.barCtx.globalAlpha = 0.35;
    this.barCtx.globalCompositeOperation = 'multiply';
    this.barCtx.fillStyle = blue ? '#6688ff' : '#66ff66';
    this.barCtx.fillRect(ARMOR_RIGHT_X - BIG_W * 3, NUM_Y, BIG_W * 3, 16);
    this.barCtx.restore();
  }

  private drawKeys(inv: PlayerInventory): void {
    for (let i = 0; i < KEY_COLORS.length; i++) {
      const color = KEY_COLORS[i]!;
      const held = inv.keys[color];
      const icon = keyIconIndex(i, held.card, held.skull);
      if (icon !== null) this.cache.draw(this.barCtx, `STKEYS${icon}`, KEY_X, KEY_Y[i]!);
    }
  }

  private drawAmmoTable(inv: PlayerInventory): void {
    for (let i = 0; i < AMMO_ROWS.length; i++) {
      const type = AMMO_ROWS[i]!;
      const y = AMMO_ROW_Y[i]!;
      this.drawNum('STYSNUM', inv.ammo[type], AMMO_HAVE_X, y, SMALL_W);
      this.drawNum('STYSNUM', inv.ammoMax[type], AMMO_MAX_X, y, SMALL_W);
    }
  }

  private flash(color: string, alpha: number): void {
    this.flashColor = color;
    this.flashAlpha = alpha;
    this.flashTimer = FLASH_TIME;
  }

  private subscribe(events: EventBus<GameEventMap>): void {
    this.unsubs.push(
      events.on('player:damaged', (e) => {
        this.flash('#c00000', Math.min(0.6, 0.2 + e.amount / 100));
        if (e.amount >= BIG_HIT) {
          this.expr = 'ouch';
          this.exprTimer = OUCH_TIME;
        } else {
          this.lastTurn = this.lastTurn === 'turnRight' ? 'turnLeft' : 'turnRight';
          this.expr = this.lastTurn;
          this.exprTimer = TURN_TIME;
        }
      }),
    );
    this.unsubs.push(events.on('weapon:fired', () => (this.fireTimer = FIRE_LINGER)));
    this.unsubs.push(
      events.on('weapon:pickedUp', (e) => {
        this.expr = 'evil';
        this.exprTimer = EVIL_TIME;
        this.setMessage(`GOT THE ${WEAPONS[e.weapon].name.toUpperCase()}!`);
      }),
    );
    this.unsubs.push(
      events.on('key:collected', (e) => {
        this.flash('#cccc44', 0.3);
        this.setMessage(`PICKED UP THE ${e.color.toUpperCase()} KEY.`);
      }),
    );
    this.unsubs.push(
      events.on('powerup:started', (e) => {
        this.flash('#cccc44', 0.3);
        this.setMessage(POWERUPS[e.kind].name.toUpperCase());
      }),
    );
    this.unsubs.push(
      events.on('pickup:collected', (e) => {
        const def = ITEMS_BY_ID.get(e.thingId);
        // Weapons/keys/powerups have dedicated events above — only voice the rest.
        if (!def || def.kind === 'weapon' || def.kind === 'key' || def.kind === 'powerup') return;
        this.flash('#cccc44', 0.22);
        this.setMessage(`PICKED UP THE ${def.name.toUpperCase()}.`);
      }),
    );
  }
}
