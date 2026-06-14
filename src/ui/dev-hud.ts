// ============================================================================
// THROWAWAY DEV-HARNESS for the UI. NOT imported by src/main.ts. Loads the real
// Freedoom-extracted UI/font assets, builds a sample player, and renders every UI
// screen so the HUD + menus can be verified in a browser. Open at:
//   http://localhost:5173/src/ui/dev-hud.html  (vite dev)
// ============================================================================
import type {
  Audio,
  Bindings,
  EventBus as EventBusType,
  GameEventMap,
  IWorld,
  Player,
  RenderConfig,
  Renderer,
} from '../core';
import {
  EventBus,
  INTERNAL_WIDTH_DEFAULT,
  INTERNAL_HEIGHT_DEFAULT,
  FOV_PLANE_RATIO,
  COLORMAP_LEVELS,
} from '../core';
import type { MapData } from '../core';
import { AssetStore, AssetLoader } from '../assets';
import { loadBindings, saveBindings } from '../input';
import { EPISODE1, mapDataFor } from '../levels';
import {
  TextureCache,
  HudController,
  Menus,
  Intermission,
  drawTitle,
  drawGameOver,
  drawCredits,
  drawAutomap,
  type MenuInput,
  type LevelTally,
} from './index';

const NOOP_AUDIO: Audio = {
  resume: async () => {},
  load: async () => {},
  playSfx: () => {},
  playSfxSpatial: () => {},
  playMusic: () => {},
  stopMusic: () => {},
  setMasterVolume: () => {},
  setSfxVolume: () => {},
  setMusicVolume: () => {},
};

function samplePlayer(): Player {
  return {
    id: 1,
    x: 0,
    y: 0,
    angle: 0,
    radius: 16,
    active: true,
    velX: 0,
    velY: 0,
    health: 100,
    armor: { points: 75, factor: 1 / 3 },
    currentWeapon: 'plasmaRifle',
    pendingWeapon: null,
    weaponCooldown: 0,
    bob: 0,
    powerups: {},
    inventory: {
      weapons: {
        fist: true,
        chainsaw: false,
        pistol: true,
        shotgun: true,
        superShotgun: false,
        chaingun: true,
        rocketLauncher: false,
        plasmaRifle: true,
        bfg9000: false,
      },
      ammo: { bullets: 50, shells: 8, rockets: 0, cells: 120 },
      ammoMax: { bullets: 200, shells: 50, rockets: 50, cells: 300 },
      keys: {
        blue: { card: true, skull: false },
        yellow: { card: false, skull: true },
        red: { card: false, skull: false },
      },
      backpack: false,
    },
  };
}

const SAMPLE_TALLY: LevelTally = {
  kills: 23,
  totalKills: 28,
  items: 7,
  totalItems: 10,
  secrets: 1,
  totalSecrets: 2,
  timeSeconds: 84,
  parSeconds: 30,
};

type Screen = 'hud' | 'title' | 'menu' | 'pause' | 'intermission' | 'gameover' | 'credits' | 'automap';

async function main(): Promise<void> {
  const canvas = document.getElementById('screen');
  if (!(canvas instanceof HTMLCanvasElement)) throw new Error('dev-hud: no <canvas id="screen">');
  const display: CanvasRenderingContext2D = (() => {
    const c = canvas.getContext('2d');
    if (!c) throw new Error('dev-hud: 2D context unavailable');
    return c;
  })();

  const config: RenderConfig = {
    internalWidth: INTERNAL_WIDTH_DEFAULT,
    internalHeight: INTERNAL_HEIGHT_DEFAULT,
    fovRatio: FOV_PLANE_RATIO,
    colormapLevels: COLORMAP_LEVELS,
  };

  // Load only the assets the UI needs (manifest + UI graphics + HUD font glyphs).
  const store = new AssetStore();
  const loader = new AssetLoader(store, NOOP_AUDIO);
  const manifest = await loader.loadManifest();
  store.setManifest(manifest);
  const hudFont = manifest.fonts.hud;
  if (!hudFont) throw new Error('dev-hud: manifest has no hud font');
  await Promise.all([
    ...Object.entries(manifest.ui).map(([id, e]) => loader.loadTexture(id, `/assets/${e.path}`)),
    ...Object.entries(hudFont.glyphs).map(([code, g]) => loader.loadTexture(`hud#${code}`, `/assets/${g.path}`)),
  ]);

  const cache = new TextureCache(store);
  const events: EventBusType<GameEventMap> = new EventBus<GameEventMap>();
  const player = samplePlayer();
  const world = { player } as unknown as IWorld;

  const fakeRenderer: Renderer = {
    init: () => {},
    resize: () => {},
    setPalette: () => {},
    setAssets: () => {},
    getViewport: () => ({ width: config.internalWidth, height: config.internalHeight }),
    blitHudLayer: (layer) => display.drawImage(layer, 0, 0),
    render: () => {},
  };

  const hud = new HudController(cache, events);
  const intermission = new Intermission(cache);
  // Persisted bindings mirror real game wiring: setBinding saves; reload re-loads.
  const bindings: Bindings = loadBindings();
  const applyResolution = (): void => {
    canvas.width = config.internalWidth;
    canvas.height = config.internalHeight;
  };
  const menus = new Menus(cache, {
    config,
    getBindings: () => bindings,
    setBinding: (action, code) => {
      bindings[action] = code;
      saveBindings(bindings);
    },
    audio: NOOP_AUDIO,
    onResolutionChange: applyResolution,
  });

  // Compiled geometry for the automap demo; spawn the sample player at the start.
  const automapMap: MapData | undefined = mapDataFor(EPISODE1.levels[0]!.id);
  if (automapMap) {
    player.x = automapMap.playerStart.x;
    player.y = automapMap.playerStart.y;
    player.angle = (automapMap.playerStart.angle * Math.PI) / 180;
  }

  let screen: Screen = 'hud';
  intermission.start(SAMPLE_TALLY, { finishedName: 'Hangar', nextName: 'Nuclear Plant' });

  const edges = { up: false, down: false, left: false, right: false, select: false, back: false };
  const takeMenuInput = (): MenuInput => {
    const m = { ...edges };
    edges.up = edges.down = edges.left = edges.right = edges.select = edges.back = false;
    return m;
  };

  addEventListener('keydown', (e) => {
    switch (e.code) {
      case 'Digit1': screen = 'hud'; break;
      case 'Digit2': screen = 'title'; break;
      case 'Digit3': screen = 'menu'; menus.open('main'); break;
      case 'Digit4': screen = 'pause'; menus.open('pause'); break;
      case 'Digit5': screen = 'intermission'; intermission.start(SAMPLE_TALLY, { finishedName: 'Hangar', nextName: 'Nuclear Plant' }); break;
      case 'Digit6': screen = 'gameover'; break;
      case 'Digit7': screen = 'credits'; break;
      case 'Digit8': screen = 'automap'; break;
      case 'KeyW': edges.up = true; break;
      case 'KeyS': edges.down = true; break;
      case 'ArrowLeft': edges.left = true; break;
      case 'ArrowRight': edges.right = true; break;
      case 'KeyE': edges.select = true; break;
      case 'Escape': edges.back = true; break;
      case 'KeyP': events.emit('player:damaged', { amount: 8, sourceFaction: 'monster', remainingHealth: (player.health = Math.max(0, player.health - 8)) }); break;
      case 'KeyL': events.emit('player:damaged', { amount: 35, sourceFaction: 'monster', remainingHealth: (player.health = Math.max(0, player.health - 35)) }); break;
      case 'KeyO': events.emit('weapon:pickedUp', { weapon: 'rocketLauncher' }); player.inventory.weapons.rocketLauncher = true; break;
      case 'KeyK': events.emit('key:collected', { color: 'red' }); player.inventory.keys.red.card = true; break;
      default: break;
    }
  });

  let last = performance.now();
  function frame(now: number): void {
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;

    hud.update(dt);
    intermission.update(dt);

    if (screen === 'menu' || screen === 'pause') {
      const cmd = menus.update(takeMenuInput());
      if (cmd && (cmd.type === 'exitMenu' || cmd.type === 'resume')) screen = screen === 'pause' ? 'hud' : 'title';
      menus.draw(display, config.internalWidth, config.internalHeight);
    } else if (screen === 'title') {
      drawTitle(display, cache, config.internalWidth, config.internalHeight);
    } else if (screen === 'intermission') {
      if (takeMenuInput().select) intermission.skip();
      intermission.draw(display, config.internalWidth, config.internalHeight);
    } else if (screen === 'gameover') {
      drawGameOver(display, cache, config.internalWidth, config.internalHeight);
    } else if (screen === 'credits') {
      drawCredits(display, config.internalWidth, config.internalHeight);
    } else if (screen === 'automap') {
      if (automapMap) drawAutomap(display, automapMap, player, config.internalWidth, config.internalHeight);
    } else {
      // HUD over a placeholder 3D background.
      const grad = display.createLinearGradient(0, 0, 0, config.internalHeight);
      grad.addColorStop(0, '#2a2f3a');
      grad.addColorStop(1, '#0c0d10');
      display.fillStyle = grad;
      display.fillRect(0, 0, config.internalWidth, config.internalHeight);
      hud.composite(fakeRenderer, world);
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  (window as unknown as { __ui: unknown }).__ui = { hud, menus, intermission };
}

void main();
