// Keyboard-navigable DOOM-style menus: main, episode select, 5-skill select,
// options (volumes, mouse sensitivity, internal resolution, key-bindings view), and
// the in-game pause menu. The state machine (src/game) owns transitions and feeds
// input; this controller owns intra-menu navigation and settings mutation, returning
// a MenuCommand whenever the player picks something that requires a state change.
import type { RenderConfig, Audio, Bindings, Action, Input, SkillId } from '../core';
import { RESOLUTION_TIERS } from '../core';
import { SKILLS } from '../data';
import { EPISODE1 } from '../levels';
import type { LobbyClient, MatchConfig, RoomStatus } from '../lobby';
import { defaultMatchConfig } from '../lobby';
import { TextureCache, drawText, FONT_LINE_HEIGHT, HUD_FONT } from './gfx';

/** Available episodes for the host config picker (grows with content). */
const EPISODES = [EPISODE1];

/** Edge-triggered menu navigation. Fill from whatever keys integration prefers. */
export interface MenuInput {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
  select: boolean;
  back: boolean;
}

/** Map the standard input actions onto menu navigation (W/S + arrows + use/pause). */
export function readMenuInput(input: Input): MenuInput {
  return {
    up: input.wasPressed('moveForward'),
    down: input.wasPressed('moveBack'),
    left: input.wasPressed('turnLeft'),
    right: input.wasPressed('turnRight'),
    select: input.wasPressed('use'),
    back: input.wasPressed('pause'),
  };
}

/** A choice the integration layer must act on (it owns the state machine). */
export type MenuCommand =
  | { type: 'startGame'; skill: SkillId; episode: number; level: number }
  | { type: 'resume' } // pause → playing
  | { type: 'endGame' } // pause → title
  | { type: 'showCredits' }
  | { type: 'quit' }
  // Host pressed START with everyone ready. The integration hands `config` to a
  // RemoteSession to begin the networked match (multiplayer-plan §3.6; P2 stub today).
  | { type: 'mpStartMatch'; config: MatchConfig; seed: number; levelId: string }
  | { type: 'exitMenu' }; // backed out of the root main menu → title

/** Services the menus read/mutate. config is mutated in place (it is live settings). */
export interface MenuContext {
  readonly config: RenderConfig;
  readonly getBindings: () => Bindings;
  /** Persist a rebound action. Wire to InputManager.setBinding to enable rebinding;
   *  omit to leave the key-bindings screen read-only. */
  readonly setBinding?: (action: Action, code: string) => void;
  readonly audio?: Audio;
  /** Called after the menu toggles internal resolution so integration can re-init. */
  readonly onResolutionChange?: () => void;
  /** The client lobby state machine the multiplayer screens drive (multiplayer-plan
   *  §3). Omit to leave HOST/JOIN as "SOON" stubs (offline-only builds). */
  readonly lobby?: LobbyClient;
}

type PageId =
  | 'main'
  | 'multiplayer'
  | 'mpHost'
  | 'mpJoin'
  | 'mpLobby'
  | 'episodes'
  | 'skill'
  | 'options'
  | 'keybinds'
  | 'pause';

interface MenuItem {
  label: string;
  value?: string;
  onSelect?: () => MenuCommand | null;
  onLeft?: () => void;
  onRight?: () => void;
}

interface Frame {
  page: PageId;
  cursor: number;
}

const PAGE_TITLE: Record<PageId, string> = {
  main: 'DOOM // TS',
  multiplayer: 'MULTIPLAYER',
  mpHost: 'CREATE ROOM',
  mpJoin: 'JOIN ROOM',
  mpLobby: 'LOBBY',
  episodes: 'WHICH EPISODE',
  skill: 'CHOOSE SKILL',
  options: 'OPTIONS',
  keybinds: 'KEY BINDINGS',
  pause: 'PAUSED',
};

const SKILL_IDS: SkillId[] = [1, 2, 3, 4, 5];

function volumeBar(frac: number): string {
  const n = 10;
  const filled = Math.max(0, Math.min(n, Math.round(frac * n)));
  return `[${'#'.repeat(filled)}${'-'.repeat(n - filled)}]`;
}

/** Step a skill id 1..5 with wraparound. */
function stepSkill(s: SkillId, dir: number): SkillId {
  return ((((s - 1 + dir) % 5) + 5) % 5 + 1) as SkillId;
}

/** Wrap an index into [0, n) by `dir` steps. */
function wrap(i: number, dir: number, n: number): number {
  return (((i + dir) % n) + n) % n;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function statusLabel(s: RoomStatus): string {
  switch (s) {
    case 'hosting':
      return 'WAITING FOR PLAYERS';
    case 'waiting':
      return 'NOT ALL READY';
    case 'allReady':
      return 'ALL READY';
    case 'starting':
      return 'STARTING...';
    case 'inMatch':
      return 'IN MATCH';
    case 'postMatch':
      return 'POST MATCH';
  }
}

export class Menus {
  private readonly cache: TextureCache;
  private readonly ctx: MenuContext;
  private stack: Frame[] = [{ page: 'main', cursor: 0 }];
  private chosenEpisode = 0;
  private readonly settings = { master: 1, sfx: 1, music: 0.7, sensitivity: 1 };
  /** Non-null while the key-bindings screen waits for the next key to bind. */
  private capturing: Action | null = null;
  /** The host's working config on the create-room screen (before the room exists). */
  private hostDraft: MatchConfig = defaultMatchConfig('coop');
  /** The join screen's editable text fields (room code / host address). */
  private readonly joinFields = { code: '', addr: '' };
  /** Non-null while a join text field captures typed characters. */
  private typing: 'code' | 'addr' | null = null;

  constructor(cache: TextureCache, ctx: MenuContext) {
    this.cache = cache;
    this.ctx = ctx;
    this.applyVolumes();
  }

  /** Reset navigation to a root page; call when entering the menu or pause state. */
  open(root: 'main' | 'pause'): void {
    this.stack = [{ page: root, cursor: 0 }];
  }

  /** Advance navigation/settings for one input frame. Returns a command or null. */
  update(input: MenuInput): MenuCommand | null {
    // While rebinding or typing a join field, a window listener owns the keys; freeze nav.
    if (this.capturing || this.typing) return null;
    const frame = this.stack[this.stack.length - 1]!;

    // Networked match start is server-driven + asynchronous: once `matchStarting` arrives
    // (the host pressed START and the authority accepted), hand off to the networked match
    // for the host AND every joiner alike — no extra keypress on either side.
    const ms = this.ctx.lobby?.matchStarting;
    if (frame.page === 'mpLobby' && this.ctx.lobby?.phase === 'starting' && ms) {
      return { type: 'mpStartMatch', config: ms.config, seed: ms.seed, levelId: ms.levelId };
    }
    const items = this.items(frame.page);
    const n = items.length;
    if (n === 0) {
      if (input.back) {
        this.sound('back');
        return this.back();
      }
      return null;
    }
    if (frame.cursor >= n) frame.cursor = n - 1;
    if (input.up) {
      frame.cursor = (frame.cursor - 1 + n) % n;
      this.sound('move');
    }
    if (input.down) {
      frame.cursor = (frame.cursor + 1) % n;
      this.sound('move');
    }
    const cur = items[frame.cursor]!;
    if (input.left && cur.onLeft) {
      cur.onLeft();
      this.sound('move');
    }
    if (input.right && cur.onRight) {
      cur.onRight();
      this.sound('move');
    }
    if (input.select && cur.onSelect) {
      this.sound('select');
      return cur.onSelect();
    }
    if (input.back) {
      this.sound('back');
      return this.back();
    }
    return null;
  }

  /** Draw the current page full-screen to the visible context. */
  draw(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    ctx.fillStyle = '#0a0a0d';
    ctx.fillRect(0, 0, w, h);
    ctx.imageSmoothingEnabled = false;

    const frame = this.stack[this.stack.length - 1]!;
    const scale = Math.max(1, Math.round(w / 320));
    const titleScale = scale * 2;
    drawText(ctx, this.cache, HUD_FONT, PAGE_TITLE[frame.page], w / 2, h * 0.12, { scale: titleScale, align: 'center' });

    if (frame.page === 'keybinds') {
      this.drawKeybinds(ctx, w, h, scale, frame.cursor);
    } else if (frame.page === 'mpLobby') {
      const itemsTop = this.drawLobbyHeader(ctx, w, h, scale);
      this.drawItems(ctx, frame, w, h, scale, itemsTop);
    } else {
      this.drawItems(ctx, frame, w, h, scale);
    }

    const hint = this.typing
      ? 'TYPE   ENTER OK   ESC DONE'
      : this.capturing
        ? 'PRESS A KEY   ESC CANCELS'
        : 'W/S MOVE   A/D CHANGE   E SELECT   ESC BACK';
    drawText(ctx, this.cache, HUD_FONT, hint, w / 2, h - 14 * scale, {
      scale,
      align: 'center',
    });
  }

  // ── internals ────────────────────────────────────────────────────────────────

  private drawItems(ctx: CanvasRenderingContext2D, frame: Frame, w: number, h: number, baseScale: number, topFrac = 0.32): void {
    const items = this.items(frame.page);
    // Value rows (sliders/choices) carry a wide bar string, so they render a notch
    // smaller across the full width; plain lists stay big and centred.
    const hasValues = items.some((it) => it.value !== undefined);
    const scale = hasValues ? Math.max(1, baseScale - 1) : baseScale;
    const labelX = hasValues ? w * 0.14 : w / 2 - 60 * scale;
    const valueX = w * 0.86;
    const lineH = (FONT_LINE_HEIGHT + 6) * scale;
    let y = h * topFrac;
    for (let i = 0; i < items.length; i++) {
      const it = items[i]!;
      const selected = i === frame.cursor;
      ctx.globalAlpha = selected ? 1 : 0.55;
      if (selected) drawText(ctx, this.cache, HUD_FONT, '>', labelX - 12 * scale, y, { scale });
      drawText(ctx, this.cache, HUD_FONT, it.label, labelX, y, { scale });
      if (it.value) drawText(ctx, this.cache, HUD_FONT, it.value, valueX, y, { scale, align: 'right' });
      ctx.globalAlpha = 1;
      y += lineH;
    }
  }

  private drawKeybinds(ctx: CanvasRenderingContext2D, w: number, h: number, scale: number, cursor: number): void {
    const bindings = this.ctx.getBindings();
    const actions = Object.keys(bindings) as Action[];
    const lineH = (FONT_LINE_HEIGHT + 2) * scale;
    const rows = Math.ceil(actions.length / 2);
    const colW = w / 2;
    for (let i = 0; i < actions.length; i++) {
      const action = actions[i]!;
      const col = Math.floor(i / rows);
      const row = i % rows;
      const x = 14 * scale + col * colW;
      const y = h * 0.24 + row * lineH;
      const selected = i === cursor;
      ctx.globalAlpha = selected ? 1 : 0.55;
      if (selected) drawText(ctx, this.cache, HUD_FONT, '>', x - 10 * scale, y, { scale });
      drawText(ctx, this.cache, HUD_FONT, action, x, y, { scale });
      const value = this.capturing === action ? '...' : bindings[action];
      drawText(ctx, this.cache, HUD_FONT, value, x + colW - 24 * scale, y, { scale, align: 'right' });
      ctx.globalAlpha = 1;
    }
  }

  /** One navigable row per action; selecting a row starts press-to-bind capture. */
  private keybindItems(): MenuItem[] {
    const actions = Object.keys(this.ctx.getBindings()) as Action[];
    return actions.map((action) => ({
      label: action,
      onSelect: () => {
        this.beginCapture(action);
        return null;
      },
    }));
  }

  /** Listen (capture phase) for the next key and bind it. Escape cancels. The capture
   *  phase + stopPropagation keep the key from leaking to the game's own input. */
  private beginCapture(action: Action): void {
    if (!this.ctx.setBinding || this.capturing) return;
    this.capturing = action;
    const handler = (e: KeyboardEvent): void => {
      e.preventDefault();
      e.stopPropagation();
      window.removeEventListener('keydown', handler, true);
      this.capturing = null;
      if (e.code === 'Escape') return; // cancel — keep the old binding
      this.ctx.setBinding?.(action, e.code);
      this.sound('select');
    };
    window.addEventListener('keydown', handler, true);
  }

  // ── multiplayer lobby ──────────────────────────────────────────────────────────

  /** Apply a host create-screen edit; changing episode resets the chosen level. */
  private editDraft(partial: Partial<MatchConfig>): void {
    Object.assign(this.hostDraft, partial);
    if (partial.episode !== undefined) this.hostDraft.startLevel = 0;
  }

  /** The MatchConfig rows, shared (DRY) by the host create screen and the lobby panel
   *  (multiplayer-plan §3.5). When `editable` is false (a non-host viewing the lobby)
   *  the rows are read-only: no onLeft/onRight and the value drops its < > markers. */
  private configRows(cfg: MatchConfig, editable: boolean, apply: (p: Partial<MatchConfig>) => void): MenuItem[] {
    const row = (label: string, value: string, prev: () => void, next: () => void): MenuItem =>
      editable ? { label, value: `< ${value} >`, onLeft: prev, onRight: next } : { label, value };

    const toggleMode = (): void => apply({ mode: cfg.mode === 'coop' ? 'deathmatch' : 'coop' });
    const ep = EPISODES[cfg.episode] ?? EPISODES[0]!;
    const lvl = ep.levels[cfg.startLevel] ?? ep.levels[0]!;
    const rows: MenuItem[] = [
      row('MODE', cfg.mode === 'coop' ? 'CO-OP' : 'DEATHMATCH', toggleMode, toggleMode),
      row(
        'SKILL',
        SKILLS[cfg.skill].name,
        () => apply({ skill: stepSkill(cfg.skill, -1) }),
        () => apply({ skill: stepSkill(cfg.skill, 1) }),
      ),
      row(
        'EPISODE',
        ep.name,
        () => apply({ episode: wrap(cfg.episode, -1, EPISODES.length) }),
        () => apply({ episode: wrap(cfg.episode, 1, EPISODES.length) }),
      ),
      row(
        'LEVEL',
        lvl.name,
        () => apply({ startLevel: wrap(cfg.startLevel, -1, ep.levels.length) }),
        () => apply({ startLevel: wrap(cfg.startLevel, 1, ep.levels.length) }),
      ),
      row(
        'MAX PLAYERS',
        String(cfg.maxPlayers),
        () => apply({ maxPlayers: clamp(cfg.maxPlayers - 1, 2, 8) }),
        () => apply({ maxPlayers: clamp(cfg.maxPlayers + 1, 2, 8) }),
      ),
    ];

    if (cfg.mode === 'deathmatch') {
      const toggleRespawn = (): void => apply({ itemRespawn: !cfg.itemRespawn });
      rows.push(
        row(
          'FRAG LIMIT',
          cfg.fragLimit === 0 ? 'OFF' : String(cfg.fragLimit),
          () => apply({ fragLimit: clamp(cfg.fragLimit - 5, 0, 50) }),
          () => apply({ fragLimit: clamp(cfg.fragLimit + 5, 0, 50) }),
        ),
        row(
          'TIME LIMIT',
          cfg.timeLimit === 0 ? 'OFF' : `${cfg.timeLimit} MIN`,
          () => apply({ timeLimit: clamp(cfg.timeLimit - 5, 0, 30) }),
          () => apply({ timeLimit: clamp(cfg.timeLimit + 5, 0, 30) }),
        ),
        row('ITEM RESPAWN', cfg.itemRespawn ? 'ON' : 'OFF', toggleRespawn, toggleRespawn),
      );
    } else {
      const order: MatchConfig['coopRespawn'][] = ['levelStart', 'waitForRevive', 'partyWipe'];
      const labels: Record<MatchConfig['coopRespawn'], string> = {
        levelStart: 'LEVEL START',
        waitForRevive: 'WAIT REVIVE',
        partyWipe: 'PARTY WIPE',
      };
      const i = order.indexOf(cfg.coopRespawn);
      rows.push(
        row(
          'DEATH RULE',
          labels[cfg.coopRespawn],
          () => apply({ coopRespawn: order[wrap(i, -1, order.length)]! }),
          () => apply({ coopRespawn: order[wrap(i, 1, order.length)]! }),
        ),
      );
    }
    return rows;
  }

  /** The lobby screen's interactive rows: ready toggle, the (editable-if-host) config
   *  panel, the host START gate, leave. The roster + code are the drawLobbyHeader. */
  private lobbyItems(): MenuItem[] {
    const lobby = this.ctx.lobby;
    const room = lobby?.room;
    if (!lobby || !room) return []; // connecting / rejected — header shows the status
    const me = lobby.localPlayer;
    const items: MenuItem[] = [
      {
        label: 'READY',
        value: me?.ready ? 'YES' : 'NO',
        onSelect: () => {
          lobby.toggleReady();
          return null;
        },
      },
      ...this.configRows(room.config, lobby.isHost, (p) => lobby.setConfig(p)),
    ];
    if (lobby.isHost) {
      items.push({
        label: 'START MATCH',
        value: lobby.canStart ? undefined : 'WAIT ALL READY',
        onSelect: () => {
          // Just ask the authority to start; the actual handoff fires for everyone in
          // update() once the server's matchStarting broadcast lands (it is async).
          if (lobby.canStart) lobby.start();
          return null;
        },
      });
    }
    items.push({
      label: 'LEAVE ROOM',
      onSelect: () => {
        lobby.leave();
        this.stack.length = Math.max(1, this.stack.length - 2); // back to the multiplayer page
        return null;
      },
    });
    return items;
  }

  /** Draw the room code + roster + status above the lobby's interactive rows. Returns
   *  the top fraction those rows should start at (it slides down as the roster grows). */
  private drawLobbyHeader(ctx: CanvasRenderingContext2D, w: number, h: number, scale: number): number {
    const lobby = this.ctx.lobby;
    const room = lobby?.room;
    if (!lobby || !room) {
      const msg = lobby?.phase === 'rejected' ? `JOIN FAILED: ${lobby.rejectReason ?? ''}` : 'CONNECTING...';
      drawText(ctx, this.cache, HUD_FONT, msg, w / 2, h * 0.4, { scale, align: 'center' });
      return 0.5;
    }
    drawText(ctx, this.cache, HUD_FONT, `ROOM ${room.code}   ${statusLabel(room.status)}`, w / 2, h * 0.2, {
      scale,
      align: 'center',
    });
    const lineH = (FONT_LINE_HEIGHT + 4) * scale;
    let y = h * 0.28;
    for (const p of room.players) {
      const tag = p.isHost ? '[HOST] ' : '       ';
      const ready = p.ready ? 'READY' : '......';
      const you = p.id === lobby.localPlayerId ? ' <' : '';
      drawText(ctx, this.cache, HUD_FONT, `${tag}${p.name}`, w * 0.14, y, { scale });
      drawText(ctx, this.cache, HUD_FONT, ready + you, w * 0.86, y, { scale, align: 'right' });
      y += lineH;
    }
    return Math.min(0.62, 0.34 + room.players.length * 0.06);
  }

  /** Capture typed characters into a join text field until Enter/Escape (mirrors the
   *  key-rebind capture: a capture-phase listener keeps keys out of the game input). */
  private beginTextCapture(field: 'code' | 'addr'): void {
    if (this.typing) return;
    this.typing = field;
    const max = field === 'code' ? 6 : 24;
    const handler = (e: KeyboardEvent): void => {
      e.preventDefault();
      e.stopPropagation();
      if (e.code === 'Enter' || e.code === 'Escape') {
        window.removeEventListener('keydown', handler, true);
        this.typing = null;
        this.sound('select');
        return;
      }
      if (e.code === 'Backspace') {
        this.joinFields[field] = this.joinFields[field].slice(0, -1);
        return;
      }
      if (e.key.length === 1 && /[A-Za-z0-9.:]/.test(e.key) && this.joinFields[field].length < max) {
        this.joinFields[field] += field === 'code' ? e.key.toUpperCase() : e.key;
      }
    };
    window.addEventListener('keydown', handler, true);
  }

  private back(): MenuCommand | null {
    if (this.stack.length > 1) {
      this.stack.pop();
      return null;
    }
    return this.stack[0]!.page === 'pause' ? { type: 'resume' } : { type: 'exitMenu' };
  }

  private push(page: PageId): null {
    this.stack.push({ page, cursor: 0 });
    return null;
  }

  private items(page: PageId): MenuItem[] {
    switch (page) {
      case 'main':
        return [
          // Offline single-player is first-class and always available — it runs the full
          // game in-process via a LocalSession, no server needed (multiplayer-plan §0.1).
          { label: 'SINGLE PLAYER', onSelect: () => this.push('episodes') },
          { label: 'MULTIPLAYER', onSelect: () => this.push('multiplayer') },
          { label: 'OPTIONS', onSelect: () => this.push('options') },
          { label: 'CREDITS', onSelect: () => ({ type: 'showCredits' }) },
          { label: 'QUIT', onSelect: () => ({ type: 'quit' }) },
        ];
      case 'multiplayer':
        // Host/Join drive the client lobby state machine over a (mock) LobbyTransport
        // (multiplayer-plan §3). The real network transport lands in P2; until then the
        // mock makes the whole flow navigable. Offline single-player is unaffected.
        if (!this.ctx.lobby) {
          return [
            { label: 'HOST GAME', value: 'SOON', onSelect: () => null },
            { label: 'JOIN GAME', value: 'SOON', onSelect: () => null },
            { label: 'BACK', onSelect: () => this.back() },
          ];
        }
        return [
          {
            label: 'HOST GAME',
            onSelect: () => {
              this.hostDraft = defaultMatchConfig('coop');
              return this.push('mpHost');
            },
          },
          { label: 'JOIN GAME', onSelect: () => this.push('mpJoin') },
          { label: 'BACK', onSelect: () => this.back() },
        ];
      case 'mpHost':
        return [
          ...this.configRows(this.hostDraft, true, (partial) => this.editDraft(partial)),
          {
            label: 'CREATE ROOM',
            onSelect: () => {
              this.ctx.lobby?.host({ ...this.hostDraft });
              return this.push('mpLobby');
            },
          },
          { label: 'BACK', onSelect: () => this.back() },
        ];
      case 'mpJoin':
        return [
          {
            label: 'ROOM CODE',
            value: this.joinFields.code || '____',
            onSelect: () => {
              this.beginTextCapture('code');
              return null;
            },
          },
          {
            label: 'ADDRESS',
            value: this.joinFields.addr || 'HOST:PORT',
            onSelect: () => {
              this.beginTextCapture('addr');
              return null;
            },
          },
          {
            label: 'JOIN',
            onSelect: () => {
              this.ctx.lobby?.join({
                roomCode: this.joinFields.code || undefined,
                addr: this.joinFields.addr || undefined,
              });
              return this.push('mpLobby');
            },
          },
          { label: 'BACK', onSelect: () => this.back() },
        ];
      case 'mpLobby':
        return this.lobbyItems();
      case 'episodes':
        return [EPISODE1].map((ep, i) => ({
          label: ep.name,
          onSelect: () => {
            this.chosenEpisode = i;
            return this.push('skill');
          },
        }));
      case 'skill':
        return SKILL_IDS.map((s) => ({
          label: SKILLS[s].name,
          onSelect: () => ({ type: 'startGame', skill: s, episode: this.chosenEpisode, level: 0 }),
        }));
      case 'options':
        return [
          this.volumeItem('MASTER VOLUME', 'master', (v) => this.ctx.audio?.setMasterVolume(v)),
          this.volumeItem('SFX VOLUME', 'sfx', (v) => this.ctx.audio?.setSfxVolume(v)),
          this.volumeItem('MUSIC VOLUME', 'music', (v) => this.ctx.audio?.setMusicVolume(v)),
          this.sensitivityItem(),
          this.resolutionItem(),
          { label: 'KEY BINDINGS', onSelect: () => this.push('keybinds') },
        ];
      case 'keybinds':
        return this.keybindItems();
      case 'pause':
        return [
          { label: 'RESUME', onSelect: () => ({ type: 'resume' }) },
          { label: 'OPTIONS', onSelect: () => this.push('options') },
          { label: 'QUIT TO TITLE', onSelect: () => ({ type: 'endGame' }) },
        ];
    }
  }

  private volumeItem(label: string, key: 'master' | 'sfx' | 'music', apply: (v: number) => void): MenuItem {
    const set = (v: number): void => {
      this.settings[key] = Math.max(0, Math.min(1, Math.round(v * 20) / 20));
      apply(this.settings[key]);
    };
    const v = this.settings[key];
    return {
      label,
      value: `${volumeBar(v)} ${Math.round(v * 100)}%`,
      onLeft: () => set(v - 0.05),
      onRight: () => set(v + 0.05),
    };
  }

  private sensitivityItem(): MenuItem {
    const set = (v: number): void => {
      this.settings.sensitivity = Math.max(0.25, Math.min(4, Math.round(v * 4) / 4));
    };
    const v = this.settings.sensitivity;
    return {
      label: 'MOUSE SENS',
      value: `${volumeBar(v / 4)} ${v.toFixed(2)}`,
      onLeft: () => set(v - 0.25),
      onRight: () => set(v + 0.25),
    };
  }

  private resolutionItem(): MenuItem {
    const cfg = this.ctx.config;
    return {
      label: 'RESOLUTION',
      value: `${cfg.internalWidth}X${cfg.internalHeight}`,
      onLeft: () => this.cycleResolution(-1),
      onRight: () => this.cycleResolution(1),
      onSelect: () => {
        this.cycleResolution(1);
        return null;
      },
    };
  }

  /** Step to the previous/next resolution tier (wraps), then notify integration. */
  private cycleResolution(dir: number): void {
    const cfg = this.ctx.config;
    const n = RESOLUTION_TIERS.length;
    const cur = RESOLUTION_TIERS.findIndex(
      (t) => t.width === cfg.internalWidth && t.height === cfg.internalHeight,
    );
    const next = RESOLUTION_TIERS[(((cur < 0 ? 0 : cur) + dir) % n + n) % n]!;
    cfg.internalWidth = next.width;
    cfg.internalHeight = next.height;
    this.ctx.onResolutionChange?.();
  }

  /** Current mouse-sensitivity multiplier (no canonical home in the core contract). */
  getSensitivity(): number {
    return this.settings.sensitivity;
  }

  private applyVolumes(): void {
    this.ctx.audio?.setMasterVolume(this.settings.master);
    this.ctx.audio?.setSfxVolume(this.settings.sfx);
    this.ctx.audio?.setMusicVolume(this.settings.music);
  }

  private sound(kind: 'move' | 'select' | 'back'): void {
    const audio = this.ctx.audio;
    if (!audio) return;
    audio.playSfx(kind === 'move' ? 'DSPSTOP' : kind === 'select' ? 'DSPISTOL' : 'DSSWTCHX');
  }
}
