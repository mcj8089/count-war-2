/* English + Chinese copy. Language comes only from ?lang= / ?locale= (see game.config.json language.*).
   No language switch button is ever rendered. */

const en = {
  'loading': 'Loading',
  'loading.assets': 'Preparing the swarm',
  'loading.ready': 'Ready',
  'hud.count': 'Crowd',
  'hud.level': 'Level',
  'hint.drag': 'Drag left / right to steer your crowd',
  'hint.gate': 'Pick a gate - the wrong half costs units',
  'hint.tower': 'Surround the watchtower to capture it',
  'hint.boss': 'Throw everything at the boss',
  'hint.monster': 'Crush the monster with your numbers',
  'hint.dodge': 'Dodge! Move away from the warning mark',
  'menu.title': 'Count War',
  'menu.sub': 'Grow the swarm. Break the gate.',
  'menu.play': 'Play',
  'menu.levels': 'Levels',
  'menu.soundOn': 'Sound: On',
  'menu.soundOff': 'Sound: Off',
  'menu.best': 'Best crowd: {count} · Cleared: {level}',
  'menu.foot': 'Single player · works offline once loaded',
  'level.name': 'Level {id} - {name}',
  'level.locked': 'Locked',
  'pause.title': 'Paused',
  'pause.resume': 'Resume',
  'pause.retry': 'Restart level',
  'pause.menu': 'Main menu',
  'result.win': 'Track cleared!',
  'result.lose': 'Swarm wiped out',
  'result.next': 'Next level',
  'result.retry': 'Try again',
  'result.revive': 'Continue with 20 units',
  'result.detail.win': 'Crowd {count} reached the finish line.',
  'result.detail.lose': 'You made it to {percent}% of the track.',
  'result.newBest': 'New best crowd!',
  'host.title': 'Opening the official page',
  'host.note': 'This build is licensed for pipygames.com. Taking you there in a moment…',
  'host.dest': 'Destination',
  'error.title': 'Could not start',
  'error.webgl': 'This browser has no WebGL. Enable hardware acceleration and reload.',
  'error.config': 'game.config.json could not be loaded.',
  'error.unknown': 'Unexpected error: {message}',
  'ad.loading': 'Advertisement',
  'ad.close': 'Continue',
  'toast.captured': 'Watchtower captured  +{reward}',
  'toast.absorbed': '+{count} joined the swarm',
  'toast.lost': '-{count} lost at the gate',
  'toast.multiplied': 'x{factor} crowd!',
  'toast.monsterDown': 'Monster crushed  +{count}'
};

const zh = {
  'loading': '加载中',
  'loading.assets': '正在准备队伍',
  'loading.ready': '准备完成',
  'hud.count': '队伍',
  'hud.level': '关卡',
  'hint.drag': '左右拖动来控制队伍',
  'hint.gate': '选择一侧闸门，选错会掉人数',
  'hint.tower': '围住瞭望塔即可占领',
  'hint.boss': '把所有兵力压向 Boss',
  'hint.monster': '用人数压垮大怪',
  'hint.dodge': '快躲开！离开地面上的 ⚠ 落点标记',
  'menu.title': '人数战争',
  'menu.sub': '壮大队伍，冲破闸门',
  'menu.play': '开始游戏',
  'menu.levels': '选择关卡',
  'menu.soundOn': '声音：开',
  'menu.soundOff': '声音：关',
  'menu.best': '最佳人数：{count} · 已通过：{level}',
  'menu.foot': '单机游戏 · 加载完成后可离线运行',
  'level.name': '第 {id} 关 · {name}',
  'level.locked': '未解锁',
  'pause.title': '已暂停',
  'pause.resume': '继续',
  'pause.retry': '重开本关',
  'pause.menu': '主菜单',
  'result.win': '赛道通关！',
  'result.lose': '队伍全灭',
  'result.next': '下一关',
  'result.retry': '再来一次',
  'result.revive': '看广告复活（20 人）',
  'result.detail.win': '队伍 {count} 人抵达终点。',
  'result.detail.lose': '本关推进到 {percent}%。',
  'result.newBest': '刷新最佳人数！',
  'host.title': '正在打开官方页面',
  'host.note': '本版本仅授权在 pipygames.com 运行，马上为你跳转…',
  'host.dest': '目标地址',
  'error.title': '无法启动',
  'error.webgl': '当前浏览器不支持 WebGL，请开启硬件加速后刷新。',
  'error.config': '无法读取 game.config.json。',
  'error.unknown': '发生未知错误：{message}',
  'ad.loading': '广告加载中',
  'ad.close': '继续',
  'toast.captured': '占领瞭望塔  +{reward}',
  'toast.absorbed': '+{count} 人加入队伍',
  'toast.lost': '闸门损失 {count} 人',
  'toast.multiplied': '队伍 x{factor}！',
  'toast.monsterDown': '大怪被击溃  +{count}'
};

const DICTS = { en, zh };

let current = 'en';
let listener = null;

export function resolveLanguage(cfg, search = globalThis.location?.search || '') {
  const supported = cfg?.language?.supported?.length ? cfg.language.supported : ['en'];
  const params = new URLSearchParams(search);
  for (const key of cfg?.language?.urlParams || ['lang']) {
    const raw = params.get(key);
    if (!raw) continue;
    const v = String(raw).trim().toLowerCase();
    const exact = supported.find((s) => s === v);
    if (exact) return exact;
    const prefix = supported.find((s) => v.startsWith(s));
    if (prefix) return prefix;
  }
  if (cfg?.language?.fallBackToBrowser) {
    const nav = String(globalThis.navigator?.language || '').toLowerCase();
    const byNav = supported.find((s) => nav.startsWith(s));
    if (byNav) return byNav;
  }
  const dflt = cfg?.language?.default || 'en';
  return supported.includes(dflt) ? dflt : supported[0];
}

export function setLanguage(lang) {
  current = DICTS[lang] ? lang : 'en';
  if (typeof document !== 'undefined') document.documentElement.lang = current === 'zh' ? 'zh-CN' : 'en';
  listener?.(current);
}

export function getLanguage() { return current; }
export function onChange(fn) { listener = fn; }

export function t(key, vars) {
  const src = DICTS[current] || en;
  let out = src[key];
  if (out == null) out = en[key];
  if (out == null) return key;
  if (!vars) return out;
  return out.replace(/\{(\w+)\}/g, (m, name) => (vars[name] != null ? String(vars[name]) : m));
}

/* Re-translate every node carrying data-i18n (used on boot and never for a UI toggle). */
export function applyI18n(root = globalThis.document) {
  if (!root) return;
  for (const el of root.querySelectorAll('[data-i18n]')) {
    const key = el.getAttribute('data-i18n');
    if (el.dataset.i18nAttr === 'title') el.title = t(key);
    else el.textContent = t(key);
  }
}

export const hasLanguage = (lang) => Boolean(DICTS[lang]);
