/* All DOM: screens, hud numbers, world-anchored labels, toasts. Text comes from i18n only. */
import THREE from '../three.js';
import { t, applyI18n } from '../i18n.js';
import { formatCount } from '../util.js';

const _v = new THREE.Vector3();

export class Labels {
  constructor(layer) {
    this.layer = layer;
    this.items = new Map();
    this.pool = [];
    this.used = [];
  }

  set(id, pos, text, cls = 'label-neutral', base = 22) {
    let el = this.items.get(id);
    if (!el) {
      el = this.pool.pop() || document.createElement('div');
      if (!el.parentNode) this.layer.appendChild(el);
      this.items.set(id, el);
    }
    el.className = `label label-num ${cls}`;
    el.dataset.base = String(base);
    el.__text = text;
    el.__x = pos.x; el.__y = pos.y; el.__z = pos.z;
    this.used.push(el);
    return el;
  }

  remove(id) {
    const el = this.items.get(id);
    if (!el) return;
    el.style.display = 'none';
    this.items.delete(id);
    this.pool.push(el);
  }

  clear() {
    for (const [id] of [...this.items]) this.remove(id);
  }

  render(camera, w, h) {
    const seen = new Set(this.used);
    for (const el of this.items.values()) if (!seen.has(el)) el.style.display = 'none';
    for (const el of this.used) {
      _v.set(el.__x, el.__y, el.__z).project(camera);
      if (_v.z > 1 || _v.z < -1) { el.style.display = 'none'; continue; }
      const sx = (_v.x * 0.5 + 0.5) * w;
      const sy = (-_v.y * 0.5 + 0.5) * h;
      if (sx < -120 || sx > w + 120 || sy < -60 || sy > h + 60) { el.style.display = 'none'; continue; }
      const dist = Math.hypot(camera.position.x - el.__x, camera.position.y - el.__y, camera.position.z - el.__z);
      const base = Number(el.dataset.base || 22);
      const size = Math.max(11, Math.min(base * 1.9, (base * 30) / Math.max(4, dist)));
      el.style.display = 'block';
      el.style.fontSize = size.toFixed(1) + 'px';
      el.style.transform = `translate(-50%,-50%) translate(${sx.toFixed(1)}px,${sy.toFixed(1)}px)`;
      if (el.textContent !== el.__text) el.textContent = el.__text;
    }
    this.used.length = 0;
  }
}

export class Hud {
  constructor(doc = document) {
    this.doc = doc;
    this.$ = (sel) => doc.querySelector(sel);
    this.el = {
      hud: this.$('#hud'),
      count: this.$('#hud-count-value'),
      level: this.$('#hud-level-value'),
      progress: this.$('#hud-progress-bar'),
      hint: this.$('#hud-hint'),
      loading: this.$('#screen-loading'),
      loadingBar: this.$('#loading-bar'),
      menu: this.$('#screen-menu'),
      menuHero: this.$('.menu-hero'),
      menuLogo: this.$('#menu-logo-img'),
      levelList: this.$('#level-list'),
      best: this.$('#menu-best'),
      pause: this.$('#screen-pause'),
      result: this.$('#screen-result'),
      resultTitle: this.$('#result-title'),
      resultDetail: this.$('#result-detail'),
      btnNext: this.$('#btn-next'),
      btnRevive: this.$('#btn-revive'),
      host: this.$('#screen-host'),
      error: this.$('#screen-error'),
      errorDetail: this.$('#error-detail'),
      btnSound: this.$('#btn-sound'),
      labelLayer: this.$('#labels')
    };
    this.labels = new Labels(this.el.labelLayer);
    this.screens = ['loading', 'menu', 'hud', 'pause', 'result', 'host', 'error'];
    this.toastTimer = 0;
    this.hintTimer = 0;
  }

  show(name) {
    for (const s of this.screens) {
      const key = s === 'hud' ? 'hud' : s;
      const node = this.el[key];
      if (!node) continue;
      const on = s === name;
      node.classList.toggle('is-hidden', !on);
    }
  }

  progress(ratio) {
    if (this.el.loadingBar) this.el.loadingBar.style.width = `${Math.round(Math.max(0, Math.min(1, ratio)) * 100)}%`;
  }

  fail(message) {
    if (this.el.errorDetail) this.el.errorDetail.textContent = message;
    this.show('error');
  }

  setHero(url) {
    if (this.el.menuHero && url) this.el.menuHero.style.backgroundImage = `url("${url}")`;
  }

  /* logo.png comes out of the generator on a fake-transparent checkerboard, so it is only
     used when it really carries alpha; otherwise the CSS wordmark stays. */
  setLogo(url) {
    const img = this.el.menuLogo;
    if (!img || !url) return;
    const probe = new Image();
    probe.onload = () => {
      if (!hasRealAlpha(probe)) { img.classList.add('is-missing'); return; }
      img.src = url;
      img.classList.remove('is-missing');
    };
    probe.onerror = () => img.classList.add('is-missing');
    probe.src = url;
  }

  levelList(levels, unlockedUntil, currentId, onPick) {
    const box = this.el.levelList;
    if (!box) return;
    box.innerHTML = '';
    box.classList.add('is-closed');
    for (const l of levels) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'lvl';
      const locked = l.id > unlockedUntil;
      if (locked) b.classList.add('is-locked');
      if (l.id < unlockedUntil) b.classList.add('is-done');
      b.textContent = String(l.id);
      b.title = t('level.name', { id: l.id, name: l.name || '' }) + (locked ? ` · ${t('level.locked')}` : '');
      b.addEventListener('click', () => { if (!locked) onPick(l.id); });
      box.appendChild(b);
    }
  }

  toggleLevelList(open) {
    const box = this.el.levelList;
    if (!box) return false;
    box.classList.toggle('is-closed', !open);
    return box.classList.contains('is-closed') === false;
  }

  bestLine(progress) {
    if (!this.el.best) return;
    const cleared = progress?.highest ?? '-';
    const best = progress?.bestCount != null ? formatCount(progress.bestCount) : '-';
    this.el.best.textContent = t('menu.best', { count: best, level: cleared });
  }

  soundLabel(muted) {
    const btn = this.el.btnSound;
    if (!btn) return;
    const span = btn.querySelector('span') || btn;
    span.textContent = t(muted ? 'menu.soundOff' : 'menu.soundOn');
  }

  update({ count, level, ratio, maxCount }) {
    if (this.el.count) this.el.count.textContent = formatCount(count);
    if (this.el.level) this.el.level.textContent = String(level);
    if (this.el.progress) this.el.progress.style.width = `${Math.round(Math.max(0, Math.min(1, ratio)) * 100)}%`;
    if (this.el.hud) this.el.hud.classList.toggle('is-dim', maxCount != null && count >= maxCount);
  }

  hint(key, ms = 3200) {
    if (!this.el.hint) return;
    this.el.hint.textContent = t(key);
    this.el.hint.style.opacity = '1';
    clearTimeout(this.hintTimer);
    this.hintTimer = setTimeout(() => { this.el.hint.style.opacity = '0.25'; }, ms);
  }

  toast(text, cls = '') {
    const layer = this.el.labelLayer;
    if (!layer) return;
    const el = document.createElement('div');
    el.className = `label label-title ${cls}`;
    el.style.cssText = 'left:50%;top:22%;font-size:clamp(15px,2.4vh,24px);background:rgba(6,20,26,.55);padding:6px 14px;border-radius:12px;';
    el.textContent = text;
    layer.appendChild(el);
    let life = 1500;
    const iv = setInterval(() => {
      life -= 100;
      el.style.opacity = String(Math.max(0, Math.min(1, life / 700)));
      if (life <= 0) { clearInterval(iv); el.remove(); }
    }, 100);
  }

  result({ win, count, ratio, nextLabel, canRevive, newBest }) {
    if (this.el.resultTitle) this.el.resultTitle.textContent = t(win ? 'result.win' : 'result.lose');
    if (this.el.resultDetail) {
      const main = win
        ? t('result.detail.win', { count: formatCount(count) })
        : t('result.detail.lose', { percent: Math.round(ratio * 100) });
      this.el.resultDetail.textContent = main + (newBest ? ` ${t('result.newBest')}` : '');
    }
    const next = this.el.btnNext?.querySelector('span') || this.el.btnNext;
    if (next) next.textContent = nextLabel || t('result.next');
    if (this.el.btnNext) this.el.btnNext.style.display = win ? '' : 'none';
    if (this.el.btnRevive) this.el.btnRevive.hidden = !(canRevive && !win);
    this.show('result');
  }

  retranslate() { applyI18n(this.doc); }
}

function hasRealAlpha(img) {
  try {
    const c = document.createElement('canvas');
    c.width = Math.min(64, img.naturalWidth || 64);
    c.height = Math.min(64, img.naturalHeight || 64);
    const x = c.getContext('2d');
    x.drawImage(img, 0, 0, c.width, c.height);
    const d = x.getImageData(0, 0, c.width, c.height).data;
    let transparent = 0;
    for (let i = 3; i < d.length; i += 16) if (d[i] < 128) transparent++;
    return transparent > d.length / 16 * 0.2;
  } catch { return false; }
}

export default Hud;
