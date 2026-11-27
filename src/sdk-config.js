/* 游戏级 SDK 配置（count-war）。会被 sdk/gamesdk.js 的 GameSDK.init() 读取。
   - 广告：本游戏自带 ads.js 已接管广告位，这里仅保留 SDK 的埋点能力，ads.enabled=false。
   - 域名：与 game.config.json 的 hosting 保持一致，便于统一管理白名单。
   - 防破解：开启配置完整性 / 篡改上报，但关闭会干扰本地调试的选项（右键、F12、debugger 陷阱）。 */
(function (root) {
  const SDK_CONFIG = {
    appId: 'count-war',
    appName: 'Count War',
    version: '1.0.0',

    domain: {
      enabled: true,
      allowedHosts: ['localhost', '127.0.0.1', '::1', 'pipygames.com', '*.pipygames.com'],
      redirectUrl: 'https://pipygames.com/',
      redirectDelayMs: 3000,
      allowFileProtocol: true,
      allowIframe: true,
      debug: true
    },

    ads: {
      enabled: false, // 广告由本游戏 ads.js 接管；SDK 仅做埋点
      provider: 'none',
      testMode: true,
      global: { pauseGameDuringAd: true, muteAudioDuringAd: true, fillTimeoutMs: 9000, simulateMs: 1200 },
      placements: {
        revive: { format: 'rewarded', id: '', enabled: true, maxPerRun: 1, cooldownMs: 0, sdk: '' },
        doubleCoins: { format: 'rewarded', id: '', enabled: true, maxPerRun: 1, cooldownMs: 0, sdk: '' },
        stageClear: { format: 'interstitial', id: '', enabled: true, everyNLevels: 3, cooldownMs: 45000, sdk: '' },
        gameOver: { format: 'interstitial', id: '', enabled: false, everyNPlays: 2, cooldownMs: 60000, sdk: '' }
      },
      providerConfig: {
        poki: { sdkUrl: 'https://game-cdn.poki.com/scripts/v2/poki-sdk.js', gameId: '' },
        crazygames: { sdkUrl: 'https://sdk.crazygames.com/crazygames-sdk-v3.js' },
        custom: { scriptUrl: '', adapterGlobal: 'GameAdAdapter' }
      },
      mockText: '广告播放中…'
    },

    protect: {
      enabled: true,
      devtoolsAction: 'warn',       // 仅上报，不阻断
      devtoolsTrap: false,          // 关闭 debugger 陷阱，避免拖慢自动化/调试
      disableContextMenu: false,     // 保留右键，方便本地调试
      disableDevtoolsShortcuts: false,
      integrity: true,
      integrityToken: '',           // 留空则不强制；上线后可用 tools/gen_token.js 生成
      heartbeatMs: 0,
      reportUrl: ''
    },

    tracking: {
      enabled: true,
      bufferSize: 200,
      endpoint: '',                 // 空 = 仅本地 console + localStorage
      debug: true,
      autoEnv: true,
      storageKey: 'countwar_sdk_events'
    },

    save: {
      enabled: true,
      key: 'count-war.progress',
      guard: { coins: 1e9, best: 1e9, count: 1e8 }
    }
  };

  if (typeof window !== 'undefined') window.SDK_CONFIG = SDK_CONFIG;
  if (typeof module !== 'undefined' && module.exports) module.exports = SDK_CONFIG;
})(typeof window !== 'undefined' ? window : globalThis);
