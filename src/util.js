/* Small shared helpers: math, geometry baking, storage, config paths. */
import THREE from './three.js';

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, k) => a + (b - a) * k;
export const smoothstep = (t) => t * t * (3 - 2 * t);
export const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rng() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const makeRand = (seed = 1337) => {
  const rng = mulberry32(seed);
  return {
    next: rng,
    range: (min, max) => min + rng() * (max - min),
    int: (min, max) => Math.floor(min + rng() * (max - min + 1)),
    pick: (arr) => arr[Math.floor(rng() * arr.length) % arr.length],
    chance: (p) => rng() < p
  };
};

export function getPath(obj, dotted, fallback) {
  const parts = String(dotted).split('.');
  let cur = obj;
  for (const p of parts) {
    if (cur == null || typeof cur !== 'object') return fallback;
    cur = cur[p];
  }
  return cur === undefined || cur === null || (Number.isNaN(cur)) ? fallback : cur;
}

export function deepMerge(base, extra) {
  if (!extra || typeof extra !== 'object') return base;
  const out = Array.isArray(base) ? base.slice() : { ...base };
  for (const [k, v] of Object.entries(extra)) {
    const bv = out[k];
    if (v && typeof v === 'object' && !Array.isArray(v) && bv && typeof bv === 'object' && !Array.isArray(bv)) {
      out[k] = deepMerge(bv, v);
    } else out[k] = v;
  }
  return out;
}

export function formatCount(n) {
  const v = Math.max(0, Math.floor(n));
  if (v >= 1000000) return (v / 1000000).toFixed(v >= 10000000 ? 0 : 1) + 'M';
  if (v >= 10000) return (v / 1000).toFixed(v >= 100000 ? 0 : 1) + 'k';
  return String(v);
}

export const store = {
  get(key, fallback = null) {
    try {
      const raw = globalThis.localStorage?.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch { return fallback; }
  },
  set(key, value) {
    try { globalThis.localStorage?.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
  }
};

/* ---------- geometry helpers (avoid the examples/jsm addon so vendor stays 1 file) ---------- */

const _m4 = new THREE.Matrix4();
const _nm = new THREE.Matrix3();
const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();

export function paint(geo, hex) {
  const c = new THREE.Color(hex);
  const count = geo.attributes.position.count;
  const arr = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

/* Merge a list of { geo, pos?, rotY?, scale?, color? } into one indexed BufferGeometry with vertex colors. */
export function mergeParts(parts) {
  let vTotal = 0;
  let iTotal = 0;
  for (const p of parts) {
    vTotal += p.geo.attributes.position.count;
    iTotal += p.geo.index ? p.geo.index.count : p.geo.attributes.position.count;
  }
  const position = new Float32Array(vTotal * 3);
  const normal = new Float32Array(vTotal * 3);
  const color = new Float32Array(vTotal * 3);
  const uv = new Float32Array(vTotal * 2);
  const index = new Uint32Array(iTotal);
  const tint = new THREE.Color();

  let vOff = 0;
  let iOff = 0;
  for (const p of parts) {
    const g = p.geo;
    const gp = g.attributes.position;
    const gn = g.attributes.normal;
    const gu = g.attributes.uv;
    const gc = g.attributes.color;

    _m4.identity();
    if (p.pos || p.rotY || p.scale) {
      _v.set(p.pos?.[0] || 0, p.pos?.[1] || 0, p.pos?.[2] || 0);
      _q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.rotY || 0);
      const sc = p.scale == null ? 1 : (Array.isArray(p.scale) ? 0 : p.scale);
      _s.set(Array.isArray(p.scale) ? p.scale[0] : sc, Array.isArray(p.scale) ? p.scale[1] ?? sc : sc, Array.isArray(p.scale) ? p.scale[2] ?? sc : sc);
      _m4.compose(_v, _q, _s);
    }
    _nm.getNormalMatrix(_m4);
    tint.set(p.color ?? 0xffffff);

    for (let i = 0; i < gp.count; i++) {
      const o = (vOff + i) * 3;
      _v.fromBufferAttribute(gp, i).applyMatrix4(_m4);
      position[o] = _v.x; position[o + 1] = _v.y; position[o + 2] = _v.z;
      if (gn) {
        _v.fromBufferAttribute(gn, i).applyMatrix3(_nm).normalize();
        normal[o] = _v.x; normal[o + 1] = _v.y; normal[o + 2] = _v.z;
      } else { normal[o + 1] = 1; }
      color[o] = gc ? gc.array[i * 3] * tint.r : tint.r;
      color[o + 1] = gc ? gc.array[i * 3 + 1] * tint.g : tint.g;
      color[o + 2] = gc ? gc.array[i * 3 + 2] * tint.b : tint.b;
      if (gu) {
        const u2 = (vOff + i) * 2;
        uv[u2] = gu.array[i * 2];
        uv[u2 + 1] = gu.array[i * 2 + 1];
      }
    }

    if (g.index) {
      for (let i = 0; i < g.index.count; i++) index[iOff + i] = g.index.array[i] + vOff;
      iOff += g.index.count;
    } else {
      for (let i = 0; i < gp.count; i++) index[iOff + i] = vOff + i;
      iOff += gp.count;
    }
    vOff += gp.count;
  }

  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(position, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
  out.setAttribute('color', new THREE.BufferAttribute(color, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.setIndex(new THREE.BufferAttribute(index, 1));
  out.computeBoundingSphere();
  out.computeBoundingBox();
  for (const p of parts) p.geo.dispose();
  return out;
}

export function disposeNode(node) {
  if (!node) return;
  node.traverse?.((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) {
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) { if (m.map) m.map.dispose(); m.dispose(); }
    }
  });
  node.parent?.remove(node);
}
