/* Renderer, scene, chase camera, terrain and dressing. One sun + hemisphere light only. */
import THREE from '../three.js';
import { clamp, damp, makeRand, disposeNode } from '../util.js';
import { loadTexture, proceduralGround, proceduralSky } from '../assets.js';
import { propGeometry, finishArchGeometry, gateFrameGeometry } from './Models.js';

export const THEMES = {
  grass: { ground: 'assets/img/tex/ground-grass.png', hue: 110, sat: 34, light: 48, sky: 'assets/img/sky/sky-forest.png', fog: 0x9fd4d0, side: 0x76b07a, prop: ['tree', 'tree', 'rock'], lightColor: 0xfff3d6, intensity: 1.05 },
  sand: { ground: 'assets/img/tex/ground-sand.png', hue: 36, sat: 44, light: 58, sky: 'assets/img/sky/sky-dusk.png', fog: 0xe7c39a, side: 0xd8b077, prop: ['rock', 'crystal', 'rock'], lightColor: 0xffe2ad, intensity: 1.12 },
  stone: { ground: 'assets/img/tex/ground-stone.png', hue: 210, sat: 8, light: 52, sky: 'assets/img/sky/sky-forest.png', fog: 0xbfc9cf, side: 0x8b97a1, prop: ['crystal', 'rock', 'tree'], lightColor: 0xe8f0ff, intensity: 0.95 },
  dusk: { ground: 'assets/img/tex/ground-stone.png', hue: 268, sat: 22, light: 38, sky: 'assets/img/sky/sky-dusk.png', fog: 0x4a3b63, side: 0x5b4a76, prop: ['crystal', 'crystal', 'rock'], lightColor: 0xcbb3ff, intensity: 0.85 },
  ice: { ground: 'assets/img/tex/ground-stone.png', hue: 195, sat: 32, light: 62, sky: 'assets/img/sky/sky-forest.png', fog: 0xbfe3ef, side: 0x9cc8dd, prop: ['crystal', 'crystal', 'rock'], lightColor: 0xeaf8ff, intensity: 1.0 }
};

export class World {
  constructor(canvas, cfg) {
    this.cfg = cfg;
    this.camCfg = cfg.gameplay.camera;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = false;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(this.camCfg.fov || 52, 1, 0.5, 320);
    this.camPos = new THREE.Vector3(0, 15, -12);
    this.camLook = new THREE.Vector3(0, 0, 6);
    this.shake = 0;

    this.hemi = new THREE.HemisphereLight(0xffffff, 0x4a6b58, 0.55);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xfff3d6, 1.05);
    this.sun.position.set(-18, 34, -12);
    this.scene.add(this.sun);
    this.ambient = new THREE.AmbientLight(0xffffff, 0.22);
    this.scene.add(this.ambient);

    this.track = new THREE.Group();
    this.scene.add(this.track);
    this.dressing = new THREE.Group();
    this.scene.add(this.dressing);

    this.groundMesh = null;
    this.sideMeshes = [];
    this.skyTexCache = new Map();
    this.groundCache = new Map();
    this.rand = makeRand(20260);
    this.time = 0;
    this.finished = null;
    this.theme = THEMES.grass;
    this.bounds = { halfWidth: 6.2, length: 260 };
  }

  async preloadTexture(cache, key, url, opts) {
    if (cache.has(key)) return cache.get(key);
    const tex = await loadTexture(url, opts);
    cache.set(key, tex);
    return tex;
  }

  async build(themeName, bounds) {
    const theme = THEMES[themeName] || THEMES.grass;
    this.theme = theme;
    this.bounds = bounds;
    this.scene.fog = new THREE.Fog(theme.fog, bounds.length * 0.34, bounds.length * 0.52 + 60);
    this.scene.background = await this.getSky(theme);
    this.sun.color.set(theme.lightColor);
    this.sun.intensity = theme.intensity;
    this.rebuildTrack();
    this.rebuildDressing();
    this.buildFinish();
  }

  getSky(theme) {
    if (this.skyTexCache.has(theme.sky)) return this.skyTexCache.get(theme.sky);
    /* one promise per sky url: repeated level changes reuse the same GPU texture */
    const p = loadTexture(theme.sky, {
      fallback: () => proceduralSky(themeNameHue(theme), theme.hue - 40)
    }).then((tex) => {
      tex.mapping = THREE.EquirectangularReflectionMapping;
      return tex;
    });
    this.skyTexCache.set(theme.sky, p);
    return p;
  }

  rebuildTrack() {
    disposeNode(this.groundMesh);
    const { halfWidth, length } = this.bounds;
    const geo = new THREE.PlaneGeometry(halfWidth * 2, length + 40, 1, 1);
    const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, map: null });
    this.groundMesh = new THREE.Mesh(geo, mat);
    this.groundMesh.rotation.x = -Math.PI / 2;
    this.groundMesh.position.set(0, 0, length / 2);
    this.track.add(this.groundMesh);

    // texture applied asynchronously; procedural tile used until (or if) the png never arrives
    const key = this.theme.ground;
    const cached = this.groundCache.get(key);
    if (cached && !(cached instanceof Promise)) {
      this.applyGround(cached);
    } else {
      const fallback = proceduralGround(this.theme.hue, this.theme.sat, this.theme.light);
      this.applyGround(fallback);
      Promise.resolve(cached || loadTexture(key, { repeatX: 3, repeatY: Math.max(6, Math.round(length / 9)), fallback: () => fallback }))
        .then((tex) => {
          this.groundCache.set(key, tex);
          const t = tex.clone();
          t.repeat.set(3, Math.max(6, Math.round(length / 9)));
          t.needsUpdate = true;
          this.applyGround(t);
        });
    }

    disposeSide(this.sideMeshes);
    this.sideMeshes = [];
    for (const dir of [-1, 1]) {
      const g = new THREE.PlaneGeometry(120, length + 260);
      const m = new THREE.MeshLambertMaterial({ color: this.theme.side });
      const mesh = new THREE.Mesh(g, m);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(dir * (halfWidth + 60), -0.06, length / 2);
      this.track.add(mesh);
      this.sideMeshes.push(mesh);
    }

    // kerb strips so the playable width reads clearly
    for (const dir of [-1, 1]) {
      const g = new THREE.BoxGeometry(0.5, 0.34, length + 20);
      const m = new THREE.MeshLambertMaterial({ color: 0xf3f6f7 });
      const kerb = new THREE.Mesh(g, m);
      kerb.position.set(dir * (halfWidth + 0.25), 0.17, length / 2);
      this.track.add(kerb);
      this.sideMeshes.push(kerb);
    }
  }

  applyGround(tex) {
    if (!this.groundMesh) return;
    tex.repeat.set(3, Math.max(6, Math.round(this.bounds.length / 9)));
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.needsUpdate = true;
    this.groundMesh.material.map = tex;
    this.groundMesh.material.color.set(0xffffff);
    this.groundMesh.material.needsUpdate = true;
  }

  rebuildDressing() {
    disposeNode(this.dressing);
    this.dressing = new THREE.Group();
    this.scene.add(this.dressing);
    const kinds = this.theme.prop;
    for (const kind of kinds) {
      const geo = propGeometry(kind);
      const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
      const count = Math.max(18, Math.round(this.bounds.length / 9));
      const mesh = new THREE.InstancedMesh(geo, mat, count);
      const m = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      const s = new THREE.Vector3();
      const p = new THREE.Vector3();
      let placed = 0;
      for (let i = 0; i < count; i++) {
        const side = this.rand.chance(0.5) ? 1 : -1;
        const dist = this.bounds.halfWidth + 2.5 + this.rand.range(0, 34);
        p.set(side * dist, 0, this.rand.range(-10, this.bounds.length + 20));
        const sc = this.rand.range(0.7, 1.9);
        s.set(sc, sc * this.rand.range(0.85, 1.2), sc);
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.rand.range(0, Math.PI * 2));
        m.compose(p, q, s);
        mesh.setMatrixAt(placed++, m);
      }
      mesh.count = placed;
      mesh.instanceMatrix.needsUpdate = true;
      mesh.frustumCulled = false;
      this.dressing.add(mesh);
    }
  }

  buildFinish() {
    if (this.finished) disposeNode(this.finished);
    const geo = finishArchGeometry();
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.finished = new THREE.Mesh(geo, mat);
    this.finished.position.set(0, 0, this.bounds.length);
    this.scene.add(this.finished);
  }

  /* chase camera follows the swarm anchor; lookAhead keeps the incoming gates readable */
  follow(dt, x, z, speedRatio = 1) {
    const c = this.camCfg;
    const targetX = x * 0.55;
    const targetZ = z - (c.back || 12);
    this.camPos.x = damp(this.camPos.x, targetX, (c.followLerp || 6.5) * 0.75, dt);
    this.camPos.y = (c.height || 15.5) + Math.sin(this.time * 0.4) * 0.12;
    this.camPos.z = damp(this.camPos.z, targetZ, (c.followLerp || 6.5) * (speedRatio > 0.1 ? 1 : 0.35), dt);
    this.camLook.x = damp(this.camLook.x, x * 0.4, 6, dt);
    this.camLook.z = z + (c.lookAhead || 6.5);
    this.camLook.y = 0.6;

    this.camera.position.copy(this.camPos);
    if (this.shake > 0.001) {
      this.shake = Math.max(0, this.shake - dt * 2.2);
      const a = this.shake * 0.5;
      this.camera.position.x += Math.sin(this.time * 42) * a;
      this.camera.position.y += Math.cos(this.time * 37) * a * 0.6;
    }
    this.camera.lookAt(this.camLook);
    this.camera.updateMatrixWorld();
  }

  kick(amount = 0.35) { this.shake = Math.min(0.9, this.shake + amount); }

  project(vec3, out) {
    out.copy(vec3).project(this.camera);
    return out;
  }

  resize(w, h) {
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
  }

  render() { this.renderer.render(this.scene, this.camera); }

  update(dt) { this.time += dt; }

  dispose() {
    disposeNode(this.track);
    disposeNode(this.dressing);
    disposeNode(this.finished);
    this.renderer.dispose();
  }
}

function disposeSide(list) {
  for (const m of list) disposeNode(m);
  list.length = 0;
}

function themeNameHue(theme) {
  return clamp(theme.hue + 90, 0, 360);
}

export default World;
