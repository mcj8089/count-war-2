/* Asset access with two sources: normal http files, or the inlined table produced by
   tools/build-web.js for the single-file build (window.__CW_FILES__ = { "assets/img/...": "data:..." }).
   Every loader has a procedural fallback so a missing AI asset degrades the look, never the game. */
import THREE from './three.js';

const FILES = globalThis.window?.__CW_FILES__ || {};

export function hasVirtual(path) { return Object.prototype.hasOwnProperty.call(FILES, path); }

export function resolveUrl(path) {
  if (!path) return path;
  if (/^(https?:|data:|blob:)/.test(path)) return path;
  const clean = String(path).replace(/^\.\//, '').replace(/^\/+/, '');
  return hasVirtual(clean) ? FILES[clean] : './' + clean;
}

export async function readFileBytes(path) {
  const res = await fetch(resolveUrl(path));
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res.arrayBuffer();
}

export async function readFileText(path) {
  const res = await fetch(resolveUrl(path));
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res.text();
}

export function loadImageEl(path) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`${path} failed to load`));
    img.src = resolveUrl(path);
  });
}

const texCache = new Map();

/* keyed by path + options, so the same tile requested by several levels downloads once */
export async function loadTexture(path, opts = {}) {
  const key = path + JSON.stringify(opts);
  if (texCache.has(key)) return texCache.get(key);
  const p = new Promise((resolve, reject) => {
    new THREE.TextureLoader().load(
      resolveUrl(path),
      (t) => resolve(t),
      undefined,
      () => reject(new Error(path))
    );
  })
    .then((tex) => finishTexture(tex, opts))
    .catch(() => {
      if (opts.fallbackLabel !== false) console.warn('[assets] texture missing, using procedural:', path);
      return finishTexture(opts.fallback ? opts.fallback() : proceduralFallback(opts.hue || 200), opts);
    });
  texCache.set(key, p);
  return p;
}

function finishTexture(tex, opts) {
  tex.colorSpace = opts.linear ? THREE.LinearSRGBColorSpace : THREE.SRGBColorSpace;
  tex.wrapS = opts.repeatX ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  tex.wrapT = opts.repeatY ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  const rx = opts.repeatX || 1;
  const ry = opts.repeatY || rx;
  tex.repeat.set(rx, ry);
  tex.anisotropy = opts.anisotropy ?? 4;
  tex.needsUpdate = true;
  return tex;
}

function canvas(size = 256) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return [c, c.getContext('2d')];
}

export function proceduralFallback(hue = 200) {
  const [c, x] = canvas(128);
  x.fillStyle = `hsl(${hue} 32% 52%)`;
  x.fillRect(0, 0, 128, 128);
  x.fillStyle = `hsla(${hue} 40% 70% / .5)`;
  for (let i = 0; i < 140; i++) x.fillRect((i * 37) % 128, (i * 71) % 128, 3, 3);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/* Seamless value-noise ground texture, used when the AI png is absent. */
export function proceduralGround(hue, sat = 38, light = 52, seed = 7) {
  const [c, x] = canvas(256);
  x.fillStyle = `hsl(${hue} ${sat}% ${light}%)`;
  x.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 2600; i++) {
    const px = (Math.sin(i * 12.9898 + seed) * 43758.5453) % 1;
    const py = (Math.sin(i * 78.233 + seed) * 24634.6345) % 1;
    const l = light + (((i * 31) % 17) - 8);
    x.fillStyle = `hsla(${hue + ((i % 9) - 4)} ${sat}% ${l}% / .55)`;
    x.fillRect(Math.abs(px) * 256, Math.abs(py) * 256, 4, 4);
  }
  // soft blotches, wrapped so tiling stays seamless
  for (let i = 0; i < 26; i++) {
    const cx = (i * 97) % 256;
    const cy = (i * 151) % 256;
    const r = 18 + (i % 5) * 9;
    const g = x.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, `hsla(${hue} ${sat + 10}% ${light + 10}% / .35)`);
    g.addColorStop(1, `hsla(${hue} ${sat}% ${light}% / 0)`);
    x.fillStyle = g;
    x.beginPath();
    x.arc(cx, cy, r, 0, Math.PI * 2);
    x.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

export function proceduralSky(topHue = 205, bottomHue = 150) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 256;
  const x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, `hsl(${topHue} 70% 58%)`);
  g.addColorStop(0.62, `hsl(${topHue} 55% 78%)`);
  g.addColorStop(1, `hsl(${bottomHue} 45% 74%)`);
  x.fillStyle = g;
  x.fillRect(0, 0, 512, 256);
  x.fillStyle = 'rgba(255,255,255,.7)';
  for (let i = 0; i < 26; i++) {
    const cx = (i * 71) % 512;
    const cy = 30 + (i * 37) % 90;
    for (let j = 0; j < 4; j++) {
      x.beginPath();
      x.ellipse(cx + j * 14, cy + (j % 2) * 6, 20 - j * 2, 9 - j, 0, 0, Math.PI * 2);
      x.fill();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.mapping = THREE.EquirectangularReflectionMapping;
  return t;
}

/* 2x2 expression atlas used when the AI face sheet is missing: happy / angry / surprised / smug. */
export function proceduralFaces() {
  const [c, x] = canvas(512);
  x.fillStyle = '#f3e6d0';
  x.fillRect(0, 0, 512, 512);
  const cell = 256;
  const eyes = (ox, oy, style) => {
    x.save();
    x.translate(ox, oy);
    x.fillStyle = '#2b1b12';
    x.strokeStyle = '#2b1b12';
    x.lineWidth = 10;
    const eye = (ex) => {
      if (style === 'blink') { x.beginPath(); x.moveTo(ex - 26, 108); x.lineTo(ex + 26, 108); x.stroke(); return; }
      x.beginPath();
      x.arc(ex, 104, style === 'surprised' ? 30 : 26, 0, Math.PI * 2);
      x.fill();
      x.fillStyle = '#fff';
      x.beginPath(); x.arc(ex + 8, 96, 8, 0, Math.PI * 2); x.fill();
      x.fillStyle = '#2b1b12';
    };
    eye(88); eye(168);
    if (style === 'angry') {
      x.beginPath(); x.moveTo(58, 62); x.lineTo(116, 78); x.stroke();
      x.beginPath(); x.moveTo(198, 62); x.lineTo(140, 78); x.stroke();
    }
    x.lineWidth = 12;
    x.beginPath();
    if (style === 'surprised') x.arc(128, 168, 22, 0, Math.PI * 2);
    else if (style === 'smug') x.moveTo(88, 168), x.quadraticCurveTo(128, 186, 172, 160);
    else x.moveTo(78, 158), x.quadraticCurveTo(128, style === 'angry' ? 150 : 205, 178, 158);
    x.stroke();
    x.restore();
  };
  eyes(0, 0, 'happy'); eyes(cell, 0, 'angry'); eyes(0, cell, 'surprised'); eyes(cell, cell, 'smug');
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export default { resolveUrl, loadTexture, loadImageEl, readFileText, readFileBytes, proceduralGround, proceduralSky, proceduralFaces };
