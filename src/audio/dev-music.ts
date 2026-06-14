// ============================================================================
// THROWAWAY DEV-HARNESS — NOT imported by src/main.ts, NOT in the production build.
// Drives AudioManager.playMusic against the extractor's music index in a real browser
// so looping playback, the music gain bus, and mute can be verified after a user gesture.
// Open at: http://localhost:5173/src/audio/dev-music.html  (vite dev)
// ============================================================================
import { AudioManager } from './audio-manager';

const mgr = new AudioManager();
const analyser = mgr.attachAnalyser();
const samples = new Float32Array(analyser.fftSize);

const $ = (id: string): HTMLElement => document.getElementById(id)!;
let currentTrack = '-';
let peak = 0;

// Expose live readings for headless inspection (agent-browser evaluate()).
const probe = { rms: 0, peak: 0, playing: false, muted: false, ctx: '-', track: '-' };
(window as unknown as { __music: typeof probe }).__music = probe;

for (const btn of document.querySelectorAll<HTMLButtonElement>('button[data-track]')) {
  btn.addEventListener('click', async () => {
    await mgr.resume(); // first user gesture starts the suspended AudioContext
    currentTrack = btn.dataset.track!;
    mgr.playMusic(currentTrack, true);
  });
}
$('stop').addEventListener('click', () => {
  mgr.stopMusic();
  currentTrack = '-';
  peak = 0;
});
$('mute').addEventListener('click', () => mgr.setMuted(!mgr.isMuted()));
const vol = $('vol') as HTMLInputElement;
vol.addEventListener('input', () => {
  const v = Number(vol.value);
  mgr.setMusicVolume(v);
  $('volval').textContent = v.toFixed(2);
});

function tick(): void {
  analyser.getFloatTimeDomainData(samples);
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i]! * samples[i]!;
  const rms = Math.sqrt(sum / samples.length);
  if (rms > peak) peak = rms;

  probe.rms = rms;
  probe.peak = peak;
  probe.playing = mgr.isMusicPlaying;
  probe.muted = mgr.isMuted();
  probe.ctx = (mgr as unknown as { ctx: AudioContext | null }).ctx?.state ?? '-';
  probe.track = currentTrack;

  $('rms').textContent = rms.toFixed(4);
  $('peak').textContent = peak.toFixed(4);
  $('playing').textContent = String(probe.playing);
  $('muted').textContent = String(probe.muted);
  $('ctx').textContent = probe.ctx;
  $('track').textContent = currentTrack;
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);
