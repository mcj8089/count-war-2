/* Builds a level's entity layout from gameplay.levels[*] in game.config.json.
   Numbers, spacing and difficulty are config-driven, so tuning never needs code edits.
   Geometry + materials are shared between groups; only instance buffers are per group. */
import THREE from '../three.js';
import { makeRand, formatCount } from '../util.js';
import { Crowd } from './Crowd.js';
import {
  gateFrameGeometry, doorGeometry, towerGeometry, towerAllyGeometry,
  bossGeometry, bossFaceGeometry, monsterGeometry,
  creatureGeometries, crowdMaterials, CrowdView
} from './Models.js';

const GOOD = ['add', 'mul'];
const _dir = new THREE.Vector3();

export class Level {
  constructor(cfg, scene, assets) {
    this.cfg = cfg;
    this.scene = scene;
    this.assets = assets;
    this.gates = [];
    this.towers = [];
    this.neutralGroups = [];
    this.boss = null;
    this.monsters = [];
    this.projectiles = [];
    this.hits = [];
    this.projGeo = new THREE.SphereGeometry(0.17, 8, 6);
    this.projMat = new THREE.MeshLambertMaterial({ color: 0xffd167, emissive: 0xff7a2e });
    this.rand = makeRand(9);
    this.finishZ = 0;
    this.def = null;
    this.index = 0;

    const neutral = creatureGeometries('neutral');
    const nmat = crowdMaterials({ faceTexture: assets.faces });
    this.neutralShared = { body: neutral.body, face: neutral.face, matBody: nmat.body, matFace: nmat.face };
    const enemy = creatureGeometries('enemy');
    const emat = crowdMaterials({ faceTexture: assets.faces });
    this.enemyShared = { body: enemy.body, face: enemy.face, matBody: emat.body, matFace: emat.face };
    this.allyTowerGeo = towerAllyGeometry();
  }

  clear() {
    for (const c of this.neutralGroups) {
      c.view.removeFrom(this.scene);
    }
    this.neutralGroups = [];
    for (const g of this.gates) {
      disposeMesh(this.scene, g.frame);
      for (const d of g.doors) disposeMesh(this.scene, d.mesh);
    }
    this.gates = [];
    for (const t of this.towers) disposeMesh(this.scene, t.mesh);
    this.towers = [];
    for (const m of this.monsters) disposeMesh(this.scene, m.mesh);
    this.monsters = [];
    if (this.boss) {
      disposeMesh(this.scene, this.boss.body);
      this.scene.remove(this.boss.face);
    }
    this.boss = null;
    for (const p of this.projectiles) this.scene.remove(p.mesh);
    this.projectiles = [];
    this.rand = makeRand(9 + this.index * 13);
  }

  build(def, index) {
    this.index = index;
    this.clear();
    this.def = def;
    const g = this.cfg.gameplay;
    const prog = g.progression || {};
    const diff = Number(def.difficulty ?? 1) * Math.pow(prog.gateScalePerLevel ?? 1, index);
    const halfWidth = Number(g.player.halfWidth ?? 6.2);
    const length = Number(def.length ?? 260);
    this.bounds = { halfWidth, length };

    const gateCount = Math.max(1, Number(def.gates ?? 9));
    const firstZ = length * 0.1;
    const lastZ = length * (def.boss ? 0.72 : 0.9);
    const stepZ = gateCount > 1 ? (lastZ - firstZ) / (gateCount - 1) : 0;
    for (let i = 0; i < gateCount; i++) {
      this.addGate(Math.round(firstZ + stepZ * i + this.rand.range(-2.2, 2.2)), halfWidth, diff, i);
    }

    const neutralCount = Math.max(0, Number(def.neutrals ?? 6));
    for (let i = 0; i < neutralCount; i++) {
      const z = length * (0.13 + 0.74 * ((i + 0.5) / neutralCount)) + this.rand.range(-5, 5);
      if (this.gates.some((gate) => Math.abs(gate.z - z) < 9)) continue;
      this.addNeutral(z, halfWidth, diff);
    }

    const towerCount = Math.max(0, Number(def.towers ?? g.towers.count));
    for (let i = 0; i < towerCount; i++) {
      const z = length * (0.18 + 0.64 * ((i + 0.5) / Math.max(1, towerCount))) + this.rand.range(-4, 4);
      this.addTower((i % 2 === 0 ? -1 : 1) * (halfWidth - 1.2), z, diff, Math.floor(i / 2) + 1);
    }

    if (def.boss) this.addBoss(length - 16, halfWidth, diff);

    const monsterCount = Math.max(0, Number(def.monsters ?? 0));
    for (let i = 0; i < monsterCount; i++) {
      const z = length * (0.34 + 0.4 * ((i + 0.5) / Math.max(1, monsterCount))) + this.rand.range(-4, 4);
      if (this.boss && Math.abs(z - (length - 16)) < 22) continue;
      this.addMonster(z, halfWidth, diff, Math.min(3, 1 + this.index));
    }

    this.finishZ = length;
    return this.bounds;
  }

  addGate(z, halfWidth, diff, i) {
    const cfg = this.cfg.gameplay.gates;
    const goodKind = this.rand.chance(cfg.multiplyChance ?? 0.18) ? 'mul' : 'add';
    const badKind = this.rand.chance(cfg.divideChance ?? 0.1) ? 'div' : 'sub';
    const kinds = this.rand.chance(0.5) ? [goodKind, badKind] : [badKind, goodKind];

    const frame = new THREE.Mesh(gateFrameGeometry(), new THREE.MeshLambertMaterial({ vertexColors: true }));
    frame.position.set(0, 0, z);
    this.scene.add(frame);

    const doors = kinds.map((op, di) => {
      let value;
      if (op === 'add') value = Math.round(this.rand.range(...(cfg.addRange || [8, 26])) * diff);
      else if (op === 'sub') value = Math.round(this.rand.range(...(cfg.subRange || [4, 18])) * diff);
      else if (op === 'mul') value = this.rand.pick(cfg.multiplyValues || [2, 3]);
      else value = this.rand.chance(0.6) ? 2 : 3;
      const good = GOOD.includes(op);
      const mesh = new THREE.Mesh(doorGeometry(), new THREE.MeshLambertMaterial({
        color: good ? 0x3fd39a : 0xf2596b, transparent: true, opacity: 0.6, side: THREE.DoubleSide
      }));
      const doorWidth = halfWidth * 0.96;
      mesh.scale.x = doorWidth / 5.6;
      const x = (di === 0 ? -1 : 1) * halfWidth / 2;
      mesh.position.set(x, 1.55, z);
      this.scene.add(mesh);
      return { op, value, good, x, halfW: doorWidth / 2, mesh, text: gateText(op, value) };
    });

    const gate = { z, doors, used: false, frame, index: i };
    this.gates.push(gate);
    return gate;
  }

  addNeutral(z, halfWidth, diff) {
    const cfgN = this.cfg.gameplay.neutrals;
    if (!this.rand.chance(cfgN.spawnChance ?? 0.75)) return null;
    const count = Math.max(3, Math.round(this.rand.range(...(cfgN.countRange || [4, 40])) * diff));
    const x = this.rand.range(-halfWidth + 1.6, halfWidth - 1.6);
    const shared = this.rand.chance(0.22) ? this.enemyShared : this.neutralShared;
    const maxInstances = Math.min(this.cfg.gameplay.maxCount, Math.max(64, count * 2));
    const view = new CrowdView({
      geometry: shared.body, faceGeometry: shared.face, material: shared.matBody,
      faceMaterial: shared.matFace, maxInstances
    });
    view.addTo(this.scene);
    const group = new NeutralGroup({ x, z, count, view, sim: this.cfg.gameplay.sim, maxInstances });
    this.neutralGroups.push(group);
    return group;
  }

  addTower(x, z, diff, level) {
    const mesh = new THREE.Mesh(towerGeometry(), new THREE.MeshLambertMaterial({ vertexColors: true }));
    mesh.position.set(x, 0, z);
    this.scene.add(mesh);
    const cfgT = this.cfg.gameplay.towers;
    const tower = {
      x, z, level, mesh,
      hp: Math.round((cfgT.hp ?? 70) * diff),
      maxHp: Math.round((cfgT.hp ?? 70) * diff),
      captured: false,
      cooldown: this.rand.range(0, 1.2),
      reward: Math.round((cfgT.captureReward ?? 8) * (1 + level * 0.15)),
      allyGeo: this.allyTowerGeo
    };
    this.towers.push(tower);
    return tower;
  }

  addBoss(z, halfWidth, diff) {
    const cfg = this.cfg.gameplay.boss;
    const body = new THREE.Mesh(bossGeometry(), new THREE.MeshLambertMaterial({ vertexColors: true }));
    body.position.set(0, 0, z);
    const face = new THREE.Mesh(bossFaceGeometry(), new THREE.MeshLambertMaterial({ map: this.assets.faces }));
    face.position.set(0, 0, z);
    this.scene.add(body);
    this.scene.add(face);
    this.boss = {
      x: 0, z, hp: Math.round((cfg.hp ?? 320) * diff), maxHp: Math.round((cfg.hp ?? 320) * diff),
      body, face, timer: 0.6, alive: true, radius: 2.6, width: cfg.sweepWidth ?? 7
    };
    return this.boss;
  }

  /* 大怪：中途强敌，迎向玩家、按人数掉血、周期横扫扣人，击溃后给奖励人数。
     与 Boss 不同，大怪可出现在关卡中段，一关可有多只，且死亡后放行。 */
  addMonster(z, halfWidth, diff, tier = 1) {
    const cfg = this.cfg.gameplay.monsters || {};
    tier = Math.max(1, Math.min(3, tier | 0));
    const geo = monsterGeometry(tier);
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(0, 0, z);
    this.scene.add(mesh);
    const m = {
      x: 0, z, tier, mesh, alive: true,
      hp: Math.round((cfg.hp ?? 160) * diff * (1 + (tier - 1) * 0.6)),
      maxHp: Math.round((cfg.hp ?? 160) * diff * (1 + (tier - 1) * 0.6)),
      radius: 1.3 + (tier - 1) * 0.35,
      width: (cfg.sweepWidth ?? 6) * (0.8 + (tier - 1) * 0.2),
      timer: cfg.attackInterval ?? 1.5,
      windup: 0,   // >0 表示攻击前摇中，落点为 aimX（可躲避）
      aimX: 0,
      reward: Math.round((cfg.reward ?? 30) * (1 + (tier - 1) * 0.5))
    };
    this.monsters.push(m);
    return m;
  }

  spawnProjectile(fromX, fromY, fromZ, tx, tz) {
    if (this.projectiles.length > 48) return null;
    const mesh = this.projPool?.pop() || null;
    const m = mesh || new THREE.Mesh(this.projGeo, this.projMat);
    m.visible = true;
    m.position.set(fromX, fromY, fromZ);
    this.scene.add(m);
    const p = { mesh: m, tx, tz, life: 3.4, speed: this.cfg.gameplay.towers.projectileSpeed ?? 14 };
    this.projectiles.push(p);
    return p;
  }

  /* Homing shots aimed at the swarm centre; returns this.hits (reused array of {x,z}). */
  updateProjectiles(dt, cx, cz) {
    const hits = this.hits;
    hits.length = 0;
    const pool = this.projPool || (this.projPool = []);
    for (let k = this.projectiles.length - 1; k >= 0; k--) {
      const p = this.projectiles[k];
      p.life -= dt;
      p.tx = cx;
      p.tz = cz;
      const pos = p.mesh.position;
      _dir.set(p.tx - pos.x, 0.9 - pos.y, p.tz - pos.z);
      const dist = _dir.length();
      if (dist < 0.6 || p.life <= 0) {
        hits.push({ x: p.tx, z: p.tz, arrived: dist < 0.6 });
        this.scene.remove(p.mesh);
        p.mesh.visible = false;
        if (pool.length < 24) pool.push(p.mesh);
        this.projectiles.splice(k, 1);
        continue;
      }
      _dir.multiplyScalar((p.speed * dt) / dist);
      pos.add(_dir);
    }
    return hits;
  }
}

/* Idle swarm: same instanced look as the player crowd, cheap wobble instead of full boids. */
class NeutralGroup {
  constructor({ x, z, count, view, sim, maxInstances }) {
    this.view = view;
    this.x = x;
    this.z = z;
    this.dead = false;
    this.sim = sim;
    this.crowd = new Crowd({ view, radius: sim.unitRadius ?? 0.34, spacing: sim.spacing ?? 0.62, seed: Math.round(x * 137 + z * 11) || 7 });
    this.crowd.hold = true;
    this.crowd.reset(x, z, Math.min(count, maxInstances));
    this.radius = this.crowd.radiusOfGroup;
  }

  update(dt) {
    if (this.dead) return;
    this.crowd.time += dt;
    this.crowd.writeMatrices(0.55);
  }

  shrink() {
    this.dead = true;
    this.crowd.n = 0;
    this.view.setCount(0);
  }

  get count() { return this.crowd.n; }
}

function gateText(op, value) {
  if (op === 'add') return '+' + formatCount(value);
  if (op === 'sub') return '-' + formatCount(value);
  if (op === 'mul') return '×' + value;
  return '÷' + value;
}

function disposeMesh(scene, mesh) {
  if (!mesh) return;
  scene.remove(mesh);
  mesh.geometry?.dispose?.();
  if (mesh.material && mesh.material.dispose && !mesh.material.__shared) mesh.material.dispose();
}

export default Level;
