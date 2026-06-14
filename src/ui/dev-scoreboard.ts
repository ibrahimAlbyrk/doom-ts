// ============================================================================
// THROWAWAY DEV-HARNESS for the DEATHMATCH scoreboard + results UI. NOT imported by
// src/main.ts. Loads the real Freedoom-extracted HUD font, builds a SAMPLE ScoreState,
// and renders the Tab-to-show scoreboard, the kill-feed, and the post-match results
// screen so they can be verified in a browser. Open at:
//   http://localhost:5173/src/ui/dev-scoreboard.html  (vite dev)
// ============================================================================
import type { Audio } from '../core';
import { INTERNAL_WIDTH_DEFAULT, INTERNAL_HEIGHT_DEFAULT } from '../core';
import { AssetStore, AssetLoader } from '../assets';
import type { ScoreState } from '../score';
import {
  TextureCache,
  drawScoreboard,
  drawKillFeed,
  Results,
  type KillFeedEntry,
  type MenuInput,
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

// Four players, deliberately out of frag order so "sorted by frags desc" is visible.
// 'p2' is the local player → highlighted. Mixed ping incl. one undefined placeholder.
const SAMPLE_SCORE: ScoreState = {
  mode: 'deathmatch',
  fragLimit: 20,
  timeLimit: 10,
  timeRemaining: 225, // 3:45
  localPlayerId: 'p2',
  players: [
    { id: 'p1', name: 'RIPLEY', color: 0, frags: 11, deaths: 9, ping: 42 },
    { id: 'p2', name: 'DOOMGUY', color: 3, frags: 17, deaths: 6, ping: 28 },
    { id: 'p3', name: 'BLAZ', color: 1, frags: 4, deaths: 14, ping: 130 },
    { id: 'p4', name: 'CABAL', color: 2, frags: 9, deaths: 11 },
  ],
};

const SAMPLE_FEED: KillFeedEntry[] = [
  { killer: 'DOOMGUY', victim: 'BLAZ', t: 1 },
  { killer: 'CABAL', victim: 'RIPLEY', t: 0.8 },
  { killer: 'DOOMGUY', victim: 'CABAL', t: 0.45 },
];

type Screen = 'scoreboard' | 'results';

async function main(): Promise<void> {
  const canvas = document.getElementById('screen');
  if (!(canvas instanceof HTMLCanvasElement)) throw new Error('dev-scoreboard: no <canvas id="screen">');
  const display = canvas.getContext('2d');
  if (!display) throw new Error('dev-scoreboard: 2D context unavailable');

  const W = INTERNAL_WIDTH_DEFAULT;
  const H = INTERNAL_HEIGHT_DEFAULT;
  canvas.width = W;
  canvas.height = H;

  // Load only the HUD font glyphs (the scoreboard/results draw text + plain rects).
  const store = new AssetStore();
  const loader = new AssetLoader(store, NOOP_AUDIO);
  const manifest = await loader.loadManifest();
  store.setManifest(manifest);
  const hudFont = manifest.fonts.hud;
  if (!hudFont) throw new Error('dev-scoreboard: manifest has no hud font');
  await Promise.all(
    Object.entries(hudFont.glyphs).map(([code, g]) => loader.loadTexture(`hud#${code}`, `/assets/${g.path}`)),
  );

  const cache = new TextureCache(store);
  const results = new Results(cache);
  results.start(SAMPLE_SCORE);

  let screen: Screen = 'scoreboard';
  const edges: MenuInput = { up: false, down: false, left: false, right: false, select: false, back: false };
  const takeInput = (): MenuInput => {
    const m = { ...edges };
    edges.up = edges.down = edges.left = edges.right = edges.select = edges.back = false;
    return m;
  };

  addEventListener('keydown', (e) => {
    switch (e.code) {
      case 'Digit1': screen = 'scoreboard'; break;
      case 'Digit2': screen = 'results'; results.start(SAMPLE_SCORE); break;
      case 'KeyW': edges.up = true; break;
      case 'KeyS': edges.down = true; break;
      case 'ArrowLeft': edges.left = true; break;
      case 'ArrowRight': edges.right = true; break;
      case 'KeyE': edges.select = true; break;
      case 'Escape': edges.back = true; break;
      default: break;
    }
  });

  function frame(): void {
    if (screen === 'results') {
      const action = results.update(takeInput());
      if (action) (document.getElementById('help') as HTMLElement).dataset.action = action;
      results.draw(display!, W, H);
    } else {
      takeInput();
      // Placeholder "in-match" backdrop so the overlay reads as an overlay.
      const grad = display!.createLinearGradient(0, 0, 0, H);
      grad.addColorStop(0, '#3a2a2a');
      grad.addColorStop(1, '#0c0d10');
      display!.fillStyle = grad;
      display!.fillRect(0, 0, W, H);
      drawKillFeed(display!, cache, SAMPLE_FEED, W, H);
      drawScoreboard(display!, cache, SAMPLE_SCORE, W, H);
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  (window as unknown as { __score: unknown }).__score = { results, SAMPLE_SCORE };
}

void main();
