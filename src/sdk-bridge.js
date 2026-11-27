/* 公共 SDK 接入桥。把 sdk/gamesdk.js 暴露的 GameSDK 收敛成一组安全的埋点 / 保护方法，
   任何一步失败都不会影响游戏本身（全部 try/catch 包裹）。 */

function getSDK() {
  return (typeof window !== 'undefined' && window.GameSDK) || null;
}

/** 初始化 SDK（合并 window.SDK_CONFIG 与游戏配置）。 */
export function initSDK() {
  const sdk = getSDK();
  if (!sdk) { console.warn('[sdk] GameSDK 未加载，跳过接入'); return null; }
  try { sdk.init(); } catch (e) { console.warn('[sdk] init 失败：', e); }
  return sdk;
}

function track(event, payload) {
  const sdk = getSDK();
  if (!sdk || typeof sdk.track !== 'function') return null;
  try { return sdk.track(event, payload); } catch (e) { return null; }
}

/** 存档防作弊：把当前进度交给 SDK 守护（篡改会被上报）。 */
export function shieldSave(obj) {
  const sdk = getSDK();
  if (!sdk || !sdk.shield || typeof sdk.shield.save !== 'function') return;
  try { sdk.shield.save(obj, 'count-war.progress'); } catch (e) {}
}

export const SDK = {
  load: (p) => track('load', p),
  start: (p) => track('start', p),
  win: (p) => track('win', p),
  fail: (p) => track('fail', p),
  revive: (p) => track('revive', p),
  ad: (p) => track('ad', p),
  boss: (p) => track('boss', p),
  monster: (p) => track('monster', p),
  custom: (name, p) => track(name, p)
};

export default SDK;
