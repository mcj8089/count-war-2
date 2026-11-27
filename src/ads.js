/* Ad layer that is fully wired but inert until you flip ads.enabled in game.config.json.
   Providers: none | google-adsense | poki | crazygames | gamemonetize.
   ads.testMode renders a local fake interstitial/reward so the whole pipeline is playable
   before any account exists. */
import { getPath } from './util.js';
import { t } from './i18n.js';

const PROVIDER_SCRIPTS = {
  google: (clientId) => `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(clientId)}`,
  gamemonetize: () => 'https://api.gamemonetize.com/gameapi.js'
};

export class Ads {
  constructor(cfg, hooks = {}) {
    this.cfg = cfg;
    this.ads = cfg?.ads || {};
    this.behavior = this.ads.behavior || {};
    this.hooks = hooks;
    this.provider = String(this.ads.provider || 'none').toLowerCase();
    this.active = this.ads.enabled === true && this.provider !== 'none';
    this.testMode = this.ads.testMode === true && !this.hasLiveConfig();
    this.containers = {};
    this.lastInterstitialAt = 0;
    this.levelCompletions = 0;
    this.bannerKey = null;
    this.loaded = false;
    this.sim = null;
  }

  hasLiveConfig() {
    const g = this.ads.google || {};
    if (this.provider === 'google-adsense') return Boolean(g.clientId) && Object.values(g.slots || {}).some(Boolean);
    if (this.provider === 'gamemonetize') return Boolean(getPath(this.ads, 'portals.gamemonetize.appId'));
    if (this.provider === 'poki' || this.provider === 'crazygames') return Boolean(globalThis.window);
    return false;
  }

  log(...args) { console.info('[ads]', ...args); }

  async boot() {
    if (!this.active) { this.log('disabled (ads.enabled =', this.ads.enabled, ', provider =', this.provider, ')'); return; }
    if (this.provider === 'google-adsense') {
      const id = this.ads.google?.clientId;
      if (!id) { this.log('no google.clientId - staying inert'); return; }
      await this.injectScript(PROVIDER_SCRIPTS.google(id), 'adsbygoogle-js');
      (adsbygoogle = (globalThis.adsbygoogle || [])).push({});
    }
    if (this.provider === 'poki') {
      if (!globalThis.PokiSDK) this.log('Poki SDK script not present - add <script src="https://cdn.poki.com/sdk/0.3/poki-sdk-core.js"></script> to index.html');
      else globalThis.PokiSDK?.init?.().then?.(() => this.log('poki ready'));
    }
    if (this.provider === 'crazygames') {
      const url = getPath(this.ads, 'portals.crazygames.sdkUrl');
      if (url) await this.injectScript(url, 'crazygames-sdk');
    }
    this.loaded = true;
    this.log('booted, provider =', this.provider, 'live =', this.hasLiveConfig(), 'test =', this.testMode);
  }

  injectScript(src, id) {
    return new Promise((resolve) => {
      if (!src || globalThis.document.getElementById(id)) return resolve(false);
      const s = document.createElement('script');
      s.src = src; s.async = true; s.id = id;
      s.onload = () => resolve(true);
      s.onerror = () => { this.log('failed to load', src); resolve(false); };
      document.head.appendChild(s);
    });
  }

  q(sel) { return sel ? globalThis.document?.querySelector(sel) : null; }
  containerFor(slotKey) {
    if (!this.containers[slotKey]) this.containers[slotKey] = this.q(getPath(this.ads, `containers.${slotKey}`, null));
    return this.containers[slotKey];
  }

  /* ---------- banners ---------- */
  showBanner(slotKey) {
    if (!this.active) return false;
    if (slotKey === 'playBanner' && this.behavior.bannerDuringGameplay === false) return false;
    const el = this.containerFor(slotKey);
    if (!el) return false;
    el.hidden = false;
    this.bannerKey = slotKey;
    const slotId = this.ads.google?.slots?.[slotKey];
    if (this.provider === 'google-adsense' && slotId && globalThis.adsbygoogle) {
      if (!el.dataset.filled) {
        const ins = document.createElement('ins');
        ins.className = 'adsbygoogle';
        ins.style.display = 'block';
        ins.setAttribute('data-ad-client', this.ads.google.clientId);
        ins.setAttribute('data-ad-slot', slotId);
        ins.setAttribute('data-ad-format', this.ads.google.formatOverrides?.[slotKey] || 'auto');
        ins.setAttribute('data-full-width-responsive', 'true');
        el.appendChild(ins);
        el.dataset.filled = '1';
        globalThis.adsbygoogle.push({});
      }
    } else if (this.testMode) {
      el.innerHTML = `<div class="ad-frame">${t('ad.loading')}</div>`;
    }
    return true;
  }

  hideBanner() {
    const el = this.containerFor(this.bannerKey);
    if (el) { el.hidden = true; el.innerHTML = ''; delete el.dataset.filled; }
    this.bannerKey = null;
  }

  /* ---------- interstitial ---------- */
  canShowInterstitial(reason) {
    if (!this.active) return false;
    if (reason === 'levelComplete' && this.behavior.interstitialOnLevelComplete === false) return false;
    if (reason === 'gameOver' && this.behavior.interstitialOnGameOver !== true) return false;
    const every = Number(this.behavior.interstitialEveryLevels ?? 1);
    if (reason === 'levelComplete' && every > 1 && this.levelCompletions % every !== 0) return false;
    const minGap = Number(this.behavior.minSecondsBetweenInterstitials ?? 0) * 1000;
    if (minGap && performance.now() - this.lastInterstitialAt < minGap) return false;
    return true;
  }

  async interstitial(reason = 'levelComplete') {
    if (!this.canShowInterstitial(reason)) return 'skipped';
    this.lastInterstitialAt = performance.now();
    if (reason === 'levelComplete') this.levelCompletions++;
    if (this.behavior.pauseMusicDuringAds !== false) this.hooks.onAdStart?.(reason);

    try {
      if (this.provider === 'poki' && globalThis.PokiSDK?.displayAd) {
        await globalThis.PokiSDK.displayAd(() => this.hooks.gameplay?.());
        return 'shown';
      }
      if (this.provider === 'crazygames' && globalThis.CrazyGames?.SDK?.ads?.requestAd) {
        await globalThis.CrazyGames.SDK.ads.requestAd({ adType: 'interstitial' });
        return 'shown';
      }
      if (this.provider === 'gamemonetize' && globalThis.gameApi?.displayAd) {
        await globalThis.gameApi.displayAd();
        return 'shown';
      }
      if (this.provider === 'google-adsense' && this.hasLiveConfig() && this.testMode === false) {
        await this.simulateDomAd(getPath(this.ads, 'containers.betweenLevels'), 2200);
        return 'shown';
      }
      if (this.testMode) {
        await this.simulateDomAd(getPath(this.ads, 'containers.betweenLevels'), 1600);
        return 'shown';
      }
      return 'unavailable';
    } finally {
      this.hooks.onAdEnd?.(reason);
    }
  }

  /* ---------- rewarded ---------- */
  async rewarded(kind = 'revive') {
    if (!this.active) return 'unavailable';
    if (kind === 'revive' && this.behavior.rewardedForRevive === false) return 'unavailable';
    if (this.behavior.pauseMusicDuringAds !== false) this.hooks.onAdStart?.('rewarded');
    try {
      if (this.provider === 'poki' && globalThis.PokiSDK?.rewardedBreak) {
        const ok = await globalThis.PokiSDK.rewardedBreak();
        return ok ? 'rewarded' : 'skipped';
      }
      if (this.provider === 'crazygames' && globalThis.CrazyGames?.SDK?.ads?.requestAd) {
        await globalThis.CrazyGames.SDK.ads.requestAd({ adType: 'rewarded' });
        return 'rewarded';
      }
      if (this.testMode) {
        await this.simulateDomAd(getPath(this.ads, 'containers.betweenLevels'), 1400);
        return 'rewarded';
      }
      return 'unavailable';
    } finally {
      this.hooks.onAdEnd?.('rewarded');
    }
  }

  /* Fake ad used by testMode and AdSense's "no creative yet" state so you can verify the flow. */
  simulateDomAd(containerSel, ms = 1500) {
    const el = this.q(containerSel) || globalThis.document.getElementById('ad-interstitial');
    if (!el) return Promise.resolve();
    return new Promise((resolve) => {
      const prev = el.innerHTML;
      const hidden = el.hidden;
      el.hidden = false;
      el.classList.remove('is-hidden');
      el.innerHTML = `<div class="ad-frame">${t('ad.loading')}</div>`;
      const close = document.createElement('button');
      close.className = 'ad-close';
      close.type = 'button';
      close.textContent = '·';
      close.disabled = true;
      el.appendChild(close);
      const started = performance.now();
      const tick = () => {
        const left = Math.max(0, Math.ceil((ms - (performance.now() - started)) / 1000));
        if (left === 0) { close.textContent = '×'; close.disabled = false; close.setAttribute('aria-label', t('ad.close')); }
        else close.textContent = String(left);
      };
      tick();
      const iv = setInterval(tick, 200);
      const done = () => {
        clearInterval(iv);
        el.removeEventListener('click', done);
        el.innerHTML = prev;
        el.hidden = hidden;
        el.classList.add('is-hidden');
        resolve();
      };
      close.addEventListener('click', done);
      setTimeout(() => { if (close.disabled === false && document.body.contains(close)) done(); }, ms + 12000);
    });
  }

  /* Poki / CrazyGames style gameplay lifecycle notifications, no-ops when the provider is absent. */
  gameplayStarted() { globalThis.PokiSDK?.gameplayStart?.(); globalThis.CrazyGames?.SDK?.gameStarted?.(); }
  gameplayEnded() { globalThis.PokiSDK?.gameplayStop?.(); globalThis.CrazyGames?.SDK?.gameEnded?.(); }
  contentLoaded() { globalThis.PokiSDK?.contentLoaded?.(); }
}

export default Ads;
