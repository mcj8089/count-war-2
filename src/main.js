/* Boot order matters: config -> language -> assets -> audio/ads -> game -> host lock.
   The host lock only fires once everything is loaded, so an unauthorised domain still sees
   the finished game for hosting.redirectDelayMs before being sent to hosting.redirectUrl. */
import './sdk-config.js';
import './sdk/gamesdk.js';
import { initSDK, SDK } from './sdk-bridge.js';
import { loadConfig, runtime, pickLevelIndex } from './config.js';
import { resolveLanguage, setLanguage, applyI18n, t } from './i18n.js';
import { runHostLock, evaluateHost, currentHost } from './permissions.js';
import { Ads } from './ads.js';
import { AudioEngine } from './audio.js';
import { loadTexture, proceduralFaces, resolveUrl } from './assets.js';
import { Hud } from './game/Hud.js';
import { Game } from './game/Game.js';

const canvas = document.getElementById('scene');

function webglAvailable() {
  try {
    const c = document.createElement('canvas');
    return Boolean(c.getContext('webgl2') || c.getContext('webgl') || c.getContext('experimental-webgl'));
  } catch { return false; }
}

async function boot() {
  const hud = new Hud(document);
  hud.show('loading');
  hud.progress(0.06);

  /* 公共 SDK：域名授权 / 反调试 / 配置完整性 / 埋点 / 存档护盾。 */
  initSDK();
  SDK.load({ version: '1.0.0' });

  if (!webglAvailable()) {
    hud.fail(t('error.webgl'));
    return;
  }

  const cfg = await loadConfig();
  hud.progress(0.18);
  if (runtime.configUrlError) console.warn('[config]', runtime.configUrlError.message, '- using built-in defaults');

  const lang = resolveLanguage(cfg);
  setLanguage(lang);
  applyI18n(document);
  document.title = t('menu.title');

  const faces = await loadTexture(cfg.assets.faces || 'assets/img/tex/creature-face.png', {
    fallback: proceduralFaces
  });
  hud.progress(0.4);

  const audio = new AudioEngine(cfg);
  if (runtime.overrides.sound != null) audio.muted = runtime.overrides.sound === 0;
  else if (cfg.audio?.startMuted) audio.muted = true;

  const ads = new Ads(cfg, {
    onAdStart: () => audio.setDuck(true),
    onAdEnd: () => audio.setDuck(false),
    gameplay: () => { if (game) game.resume(); }
  });

  const game = new Game({ canvas, cfg, hud, audio, ads, assets: { faces } });
  game.input.onFirstGesture = () => audio.ensureContext();

  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', onResize);
  function onResize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    game.world.resize(w, h);
  }
  onResize();

  hud.setHero(resolveUrl(cfg.assets.menuHero || 'assets/img/menu/menu-hero.png'));
  hud.setLogo(resolveUrl(cfg.assets.logo || 'assets/img/ui/logo.png'));
  hud.soundLabel(audio.muted);

  let startIndex = pickLevelIndex(cfg, runtime.requestedLevel, levelIndexFromProgress(game.progress));
  hud.levelList(game.levels, game.progress.highest, game.levels[startIndex]?.id, (id) => {
    startIndex = pickLevelIndex(cfg, id, 0);
    play(startIndex);
  });
  hud.bestLine(game.progress);
  hud.progress(0.62);

  const unlockAudio = () => {
    audio.ensureContext();
    audio.load().catch(() => {});
    window.removeEventListener('pointerdown', unlockAudio);
    window.removeEventListener('keydown', unlockAudio);
  };
  window.addEventListener('pointerdown', unlockAudio);
  window.addEventListener('keydown', unlockAudio);

  await game.startLevel(startIndex, { preview: true });
  hud.progress(0.9);
  game.start();

  bindUi();

  function play(index) {
    unlockAudio();
    startIndex = index;
    hud.show('hud');
    game.startLevel(index).catch((e) => hud.fail(String(e?.message || e)));
  }

  function bindUi() {
    const on = (sel, fn) => document.querySelector(sel)?.addEventListener('click', () => { audio.play('uiClick', { volume: 0.6 }); fn(); });
    on('#btn-play', () => play(startIndex));
    on('#btn-levels', () => hud.toggleLevelList(hud.el.levelList.classList.contains('is-closed')));
    on('#btn-sound', () => {
      const muted = audio.setMuted(!audio.muted);
      hud.soundLabel(muted);
    });
    on('#btn-pause', () => game.pause());
    on('#btn-resume', () => game.resume());
    on('#btn-retry', () => game.retry());
    on('#btn-menu', () => game.toMenu());
    on('#btn-again', () => game.retry());
    on('#btn-result-menu', () => game.toMenu());
    on('#btn-next', () => {
      if (game.state === 'won') game.confirmNext();
      else game.next();
    });
    on('#btn-reload', () => location.reload());
    const revive = document.querySelector('#btn-revive');
    if (revive) revive.addEventListener('click', async () => {
      const ok = await game.revive();
      if (!ok) hud.toast(t('error.unknown', { message: t('ad.loading') }));
    });
    document.addEventListener('keydown', (e) => {
      if (e.code === 'Escape' && game.state === 'playing') game.pause();
      else if (e.code === 'Escape' && game.state === 'paused') game.resume();
      else if (e.code === 'KeyR' && (game.state === 'lost' || game.state === 'won')) game.retry();
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && game.state === 'playing') game.pause();
    });
    document.getElementById('screen-pause')?.addEventListener('click', (e) => {
      if (e.target.id === 'screen-pause') game.resume();
    });
  }

  hud.show('menu');

  hud.progress(1);
  document.getElementById('loading-note').textContent = t('loading.ready');

  /* expose the instance before the host check so debugging tools (and the smoke test) can
     inspect a session that is about to be redirected */
  window.__COUNT_WAR__ = { cfg, game, hud, audio, ads, runtime };

  const verdict = evaluateHost(cfg);
  const lock = runHostLock(cfg, {
    noticeEl: document.getElementById('screen-host'),
    showHost: () => hud.show('host')
  }, () => {
    game.input.enabled = false;
    game.state = 'paused';
  });

  if (lock.active) {
    console.warn('[hosting] unauthorised host:', verdict.host, '->', lock.target, `after ${lock.delay}ms`);
    window.__COUNT_WAR__.lock = { ...verdict, redirecting: true };
    return;
  }
  console.info(`[hosting] ok on "${verdict.host}" (${verdict.reason}) · language=${lang} · ads=${ads.active ? ads.provider : 'off'}`);
  window.__COUNT_WAR__.lock = verdict;
}

function levelIndexFromProgress(progress) {
  return Math.max(0, (progress.highest || 1) - 1);
}

boot().catch((err) => {
  console.error(err);
  const hud = new Hud(document);
  hud.fail(t('error.unknown', { message: String(err?.message || err) }));
});
