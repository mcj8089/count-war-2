/* Runtime config: game.config.json + url overrides. Nothing in the game hard-codes a value
   that the objective says must stay configurable (hosts, ads, language, gameplay numbers). */
import { deepMerge, getPath } from './util.js';
import { readFileText } from './assets.js';

const CONFIG_URL = './game.config.json';

/* Values used if game.config.json is missing a key - keeps a hand-edited config from bricking the build. */
const HARD_DEFAULTS = {
  meta: { name: 'Count War', version: '0.0.0', singlePlayer: true },
  language: { default: 'en', supported: ['en', 'zh'], urlParams: ['lang', 'locale'], showSwitchButton: false, fallBackToBrowser: false },
  hosting: {
    enforce: true, allowedHosts: ['localhost', '127.0.0.1', 'pipygames.com', '*.pipygames.com'],
    unauthorizedAction: 'redirect', redirectUrl: 'https://pipygames.com/', redirectDelayMs: 3000,
    showNoticeWhileWaiting: true, blockGameplayUntilRedirect: true, bypassUrlParam: 'hostcheck'
  },
  ads: {
    enabled: false, provider: 'none', testMode: true,
    google: { clientId: '', slots: {} }, portals: {},
    behavior: {
      interstitialOnLevelComplete: true, interstitialOnGameOver: false, interstitialEveryLevels: 2,
      minSecondsBetweenInterstitials: 75, rewardedForRevive: true, pauseMusicDuringAds: true, bannerDuringGameplay: false
    },
    containers: { menuBanner: '#ad-menu', playBanner: '#ad-play', betweenLevels: '#ad-interstitial' }
  },
  audio: { master: 0.9, music: 0.45, sfx: 0.85, startMuted: false, maxSimultaneous: 12, sounds: {} },
  assets: {},
  gameplay: {
    startCount: 6, maxCount: 900, sim: {}, camera: {}, player: {}, gates: {}, neutrals: {}, towers: {}, boss: {},
    levels: [], progression: {}, persistence: { localStorageKey: 'count-war.progress' }
  }
};

/* ?units=1200 &speed=7&maxSpeed=9&start=12&level=3&sound=0&ads=1&hostcheck=off */
const PARAM_MAP = [
  ['units', 'gameplay.maxCount', 'num'],
  ['maxUnits', 'gameplay.maxCount', 'num'],
  ['start', 'gameplay.startCount', 'num'],
  ['speed', 'gameplay.player.forwardSpeed', 'num'],
  ['maxSpeed', 'gameplay.sim.maxSpeed', 'num'],
  ['sound', '@sound', 'num'],
  ['ads', '@ads', 'bool'],
  ['hostcheck', '@hostcheck', 'str']
];

export const runtime = {
  config: null,
  params: new URLSearchParams(globalThis.location?.search || ''),
  overrides: {},
  requestedLevel: null,
  get(pathKey, fallback) {
    const v = getPath(this.config, pathKey, undefined);
    return v === undefined ? (fallback ?? getPath(HARD_DEFAULTS, pathKey)) : v;
  },
  num(pathKey, fallback) {
    const v = this.get(pathKey, undefined);
    return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
  },
  bool(pathKey, fallback) { return Boolean(this.get(pathKey, fallback)); }
};

function coerce(kind, raw) {
  if (raw == null) return undefined;
  if (kind === 'num') { const n = Number(raw); return Number.isFinite(n) ? n : undefined; }
  if (kind === 'bool') return raw === '1' || raw === 'true' || raw === 'on';
  return String(raw);
}

function setDeep(target, dotted, value) {
  const parts = dotted.split('.');
  let cur = target;
  for (let i = 0; i < parts.length - 1; i++) {
    if (!cur[parts[i]] || typeof cur[parts[i]] !== 'object') cur[parts[i]] = {};
    cur = cur[parts[i]];
  }
  cur[parts[parts.length - 1]] = value;
}

function readUrlOverrides() {
  const flat = {};
  const dotted = {};
  for (const [param, key, kind] of PARAM_MAP) {
    if (!runtime.params.has(param)) continue;
    const value = coerce(kind, runtime.params.get(param));
    if (value === undefined) continue;
    if (key.startsWith('@')) flat[key.slice(1)] = value;
    else setDeep(dotted, key, value);
  }
  return { flat, dotted };
}

export async function loadConfig() {
  let userCfg = null;
  let error = null;
  try {
    userCfg = JSON.parse(await readFileText(CONFIG_URL));
  } catch (e) { error = e; }

  runtime.config = deepMerge(HARD_DEFAULTS, userCfg || {});
  runtime.configUrlError = error;

  const { flat, dotted } = readUrlOverrides();
  if (Object.keys(dotted).length) runtime.config = deepMerge(runtime.config, dotted);
  runtime.overrides = flat;
  if (runtime.params.has('level')) {
    const n = Number(runtime.params.get('level'));
    if (Number.isFinite(n) && n >= 1) runtime.requestedLevel = Math.round(n);
  }
  return runtime.config;
}

export function pickLevelIndex(cfg, requestedId, fallback = 0) {
  const list = cfg?.gameplay?.levels || [];
  if (!list.length) return 0;
  if (requestedId != null) {
    const byId = list.findIndex((l) => Number(l.id) === Number(requestedId));
    if (byId >= 0) return byId;
  }
  return Math.max(0, Math.min(list.length - 1, fallback));
}

export default runtime;
