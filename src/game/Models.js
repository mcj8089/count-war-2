/* 原创角色模型（AI 生成的造型，非原版蓝色士兵）。
   设计概念："辉光小怪"(Glimmer) —— 圆润能量机器人：胶囊躯干 + 胸口能量核 + 大头 + 触角 +
   短手短脚。四种阵营用糖果色区分；Boss 重做为"巨像"(Colossus)；大怪为"蛮兽"(Brute)。
   所有几何体由基础图元合并而成（顶点色 + InstancedMesh），不依赖任何外部模型文件。 */
import THREE from '../three.js';
import { mergeParts } from '../util.js';

/* 阵营配色：糖果 / 能量色系，刻意避开原版的军蓝。 */
export const FACTIONS = {
  player: { body: 0xffce8a, head: 0xfff1d6, core: 0x22d3a7, peak: 0x18b890, leg: 0xb9663a },
  neutral: { body: 0xd9c7ff, head: 0xeee6ff, core: 0x9b7bff, peak: 0x8b6bf0, leg: 0x7a6bb0 },
  enemy: { body: 0xff9bb0, head: 0xffd0db, core: 0xe23b63, peak: 0xc62f52, leg: 0xb83a5a },
  ally: { body: 0xb6f5d8, head: 0xe6fff2, core: 0x34c98a, peak: 0x2f9fb6, leg: 0x3d9c78 }
};

export const FACE_QUADRANTS = {
  happy: { col: 0, row: 1 },
  angry: { col: 1, row: 1 },
  surprised: { col: 0, row: 0 },
  smug: { col: 1, row: 0 }
};

const FACE_UV = {
  player: 'happy',
  ally: 'smug',
  neutral: 'surprised',
  enemy: 'angry'
};

function sphere(r, ws = 10, hs = 8) { return new THREE.SphereGeometry(r, ws, hs); }

/* 脸部圆盘：贴在头顶前方，UV 裁剪到图集的一个象限（表情）。 */
function faceDisc(radius, quadrant) {
  const g = new THREE.CircleGeometry(radius, 14);
  g.rotateX(-Math.PI / 2);
  const uv = g.attributes.uv;
  const q = FACE_QUADRANTS[quadrant] || FACE_QUADRANTS.happy;
  for (let i = 0; i < uv.count; i++) {
    uv.array[i * 2] = (q.col + uv.array[i * 2]) * 0.5;
    uv.array[i * 2 + 1] = (q.row + uv.array[i * 2 + 1]) * 0.5;
  }
  uv.needsUpdate = true;
  return g;
}

/* 全新"辉光小怪"角色：胶囊躯干 + 胸口能量核 + 头 + 触角 + 双臂 + 双腿。 */
export function creatureGeometries(faction = 'player', faceTexture = null) {
  const p = FACTIONS[faction] || FACTIONS.player;
  const body = mergeParts([
    { geo: new THREE.CapsuleGeometry(0.17, 0.16, 4, 10), pos: [0, 0.34, 0], color: p.body },
    { geo: new THREE.SphereGeometry(0.1, 10, 8), pos: [0, 0.3, -0.13], color: p.core },
    { geo: new THREE.SphereGeometry(0.165, 12, 10), pos: [0, 0.62, 0], color: p.head },
    { geo: new THREE.CylinderGeometry(0.012, 0.012, 0.16, 6), pos: [0, 0.8, 0], color: p.peak },
    { geo: new THREE.SphereGeometry(0.045, 8, 6), pos: [0, 0.9, 0], color: p.core },
    { geo: new THREE.CapsuleGeometry(0.045, 0.12, 3, 6), pos: [-0.2, 0.34, 0], color: p.body },
    { geo: new THREE.CapsuleGeometry(0.045, 0.12, 3, 6), pos: [0.2, 0.34, 0], color: p.body },
    { geo: new THREE.CapsuleGeometry(0.05, 0.08, 3, 6), pos: [-0.08, 0.1, 0], color: p.leg },
    { geo: new THREE.CapsuleGeometry(0.05, 0.08, 3, 6), pos: [0.08, 0.1, 0], color: p.leg }
  ]);
  const face = faceDisc(0.12, FACE_UV[faction] || 'happy');
  face.translate(0, 0.66, -0.05);
  return { body, face };
}

export function crowdMaterials({ bodyVertexColors = true, faceTexture, tint = 0xffffff }) {
  const body = new THREE.MeshLambertMaterial({ color: tint, vertexColors: bodyVertexColors, flatShading: false });
  const face = new THREE.MeshLambertMaterial({ color: 0xffffff, map: faceTexture || null, transparent: false });
  return { body, face };
}

export class CrowdView {
  constructor({ geometry, faceGeometry, material, faceMaterial, maxInstances, faceTexture }) {
    this.body = new THREE.InstancedMesh(geometry, material, maxInstances);
    if (faceGeometry) {
      this.face = new THREE.InstancedMesh(faceGeometry, faceMaterial || material, maxInstances);
      this.face.instanceMatrix = this.body.instanceMatrix;
    } else {
      this.face = null;
    }
    this.body.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.body.frustumCulled = false;
    if (this.face) this.face.frustumCulled = false;
    this.body.count = 0;
    if (this.face) this.face.count = 0;
    this.maxInstances = maxInstances;
    this.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(maxInstances * 3), 3);
    this.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.body.instanceColor = this.instanceColor;
    if (this.face) this.face.instanceColor = this.instanceColor;
  }

  setCount(n) {
    this.body.count = n;
    if (this.face) this.face.count = n;
  }

  addTo(scene) {
    scene.add(this.body);
    if (this.face) scene.add(this.face);
  }

  removeFrom(scene) {
    scene.remove(this.body);
    if (this.face) scene.remove(this.face);
  }
}

export function towerGeometry() {
  return mergeParts([
    { geo: new THREE.CylinderGeometry(0.62, 0.8, 1.5, 12), pos: [0, 0.75, 0], color: 0x9d8b74 },
    { geo: new THREE.CylinderGeometry(0.72, 0.72, 0.22, 12), pos: [0, 1.6, 0], color: 0x7c6a55 },
    { geo: new THREE.ConeGeometry(0.86, 0.9, 8), pos: [0, 2.16, 0], color: 0xe4436c },
    { geo: new THREE.BoxGeometry(0.26, 0.26, 0.06), pos: [0, 1.0, -0.78], color: 0x33251a }
  ]);
}

export function towerAllyGeometry() {
  return mergeParts([
    { geo: new THREE.CylinderGeometry(0.62, 0.8, 1.5, 12), pos: [0, 0.75, 0], color: 0x9d8b74 },
    { geo: new THREE.CylinderGeometry(0.72, 0.72, 0.22, 12), pos: [0, 1.6, 0], color: 0x7c6a55 },
    { geo: new THREE.ConeGeometry(0.86, 0.9, 8), pos: [0, 2.16, 0], color: 0x38d6a6 },
    { geo: new THREE.BoxGeometry(0.26, 0.26, 0.06), pos: [0, 1.0, -0.78], color: 0x33251a }
  ]);
}

/* 全新"巨像"Boss：腹部 + 胸口 + 头 + 冠 + 双角 + 肩臂 + 能量核 + 双腿 + 双眼。 */
export function bossGeometry() {
  return mergeParts([
    { geo: sphere(1.5, 16, 12), pos: [0, 1.5, 0], scale: [1, 0.95, 1], color: 0x6a3d8a },
    { geo: sphere(1.15, 16, 12), pos: [0, 3.0, 0], color: 0x8052a0 },
    { geo: sphere(0.95, 16, 12), pos: [0, 4.1, 0], color: 0x9360b6 },
    { geo: new THREE.ConeGeometry(0.5, 1.2, 8), pos: [0, 5.3, 0], color: 0xffb02e },
    { geo: new THREE.ConeGeometry(0.28, 1.3, 8), pos: [-0.85, 4.5, -0.2], color: 0x3a2350 },
    { geo: new THREE.ConeGeometry(0.28, 1.3, 8), pos: [0.85, 4.5, -0.2], color: 0x3a2350 },
    { geo: new THREE.BoxGeometry(0.7, 1.6, 0.7), pos: [-1.7, 2.6, -0.1], color: 0x5a3b6e },
    { geo: new THREE.BoxGeometry(0.7, 1.6, 0.7), pos: [1.7, 2.6, -0.1], color: 0x5a3b6e },
    { geo: new THREE.SphereGeometry(0.55, 12, 10), pos: [0, 3.0, -0.9], color: 0xff5b3a },
    { geo: new THREE.BoxGeometry(0.6, 1.6, 0.6), pos: [-0.7, 0.8, 0], color: 0x4a3058 },
    { geo: new THREE.BoxGeometry(0.6, 1.6, 0.6), pos: [0.7, 0.8, 0], color: 0x4a3058 },
    { geo: new THREE.SphereGeometry(0.2, 10, 8), pos: [-0.4, 4.2, -0.8], color: 0xffe14d },
    { geo: new THREE.SphereGeometry(0.2, 10, 8), pos: [0.4, 4.2, -0.8], color: 0xffe14d }
  ]);
}

export function bossFaceGeometry() {
  const g = faceDisc(0.8, 'angry');
  g.translate(0, 3.9, -0.85);
  return g;
}

/* 全新"蛮兽"大怪：拉长的躯体 + 头 + 下颚 + 双眼 + 双角 + 四条腿。面向 -z（迎向玩家）。 */
export function monsterGeometry(tier = 1) {
  const s = 1 + (Math.max(1, tier) - 1) * 0.25;
  return mergeParts([
    { geo: sphere(1.0 * s, 14, 10), pos: [0, 1.0 * s, 0], scale: [1.15, 0.9, 1.3], color: 0x7a2f3a },
    { geo: sphere(0.6 * s, 12, 10), pos: [0, 1.9 * s, -0.6 * s], color: 0x8f3a47 },
    { geo: new THREE.BoxGeometry(1.0 * s, 0.35 * s, 0.6 * s), pos: [0, 1.5 * s, -1.0 * s], color: 0x5e2230 },
    { geo: new THREE.SphereGeometry(0.16 * s, 8, 6), pos: [-0.3 * s, 2.1 * s, -1.0 * s], color: 0xffd23a },
    { geo: new THREE.SphereGeometry(0.16 * s, 8, 6), pos: [0.3 * s, 2.1 * s, -1.0 * s], color: 0xffd23a },
    { geo: new THREE.ConeGeometry(0.22 * s, 0.9 * s, 8), pos: [-0.5 * s, 2.6 * s, -0.4 * s], color: 0x33121a },
    { geo: new THREE.ConeGeometry(0.22 * s, 0.9 * s, 8), pos: [0.5 * s, 2.6 * s, -0.4 * s], color: 0x33121a },
    { geo: new THREE.CapsuleGeometry(0.18 * s, 0.7 * s, 3, 6), pos: [-0.6 * s, 0.5 * s, 0.5 * s], color: 0x5e2230 },
    { geo: new THREE.CapsuleGeometry(0.18 * s, 0.7 * s, 3, 6), pos: [0.6 * s, 0.5 * s, 0.5 * s], color: 0x5e2230 },
    { geo: new THREE.CapsuleGeometry(0.18 * s, 0.7 * s, 3, 6), pos: [-0.6 * s, 0.5 * s, -0.5 * s], color: 0x5e2230 },
    { geo: new THREE.CapsuleGeometry(0.18 * s, 0.7 * s, 3, 6), pos: [0.6 * s, 0.5 * s, -0.5 * s], color: 0x5e2230 }
  ]);
}

export function propGeometry(kind = 'tree') {
  if (kind === 'rock') {
    return mergeParts([{ geo: new THREE.IcosahedronGeometry(0.9, 0), pos: [0, 0.5, 0], scale: [1, 0.7, 1], color: 0x8d9aa4 }]);
  }
  if (kind === 'crystal') {
    return mergeParts([
      { geo: new THREE.ConeGeometry(0.4, 1.6, 6), pos: [0, 0.8, 0], color: 0x7fe3ff },
      { geo: new THREE.ConeGeometry(0.24, 0.9, 6), pos: [0.45, 0.45, 0.2], color: 0x59c8e8 }
    ]);
  }
  return mergeParts([
    { geo: new THREE.CylinderGeometry(0.16, 0.22, 1.1, 7), pos: [0, 0.55, 0], color: 0x8b5a2b },
    { geo: sphere(0.85, 10, 8), pos: [0, 1.5, 0], scale: [1, 0.92, 1], color: 0x3f9d5a },
    { geo: sphere(0.5, 8, 6), pos: [0.55, 1.95, 0.1], color: 0x4fb46b }
  ]);
}

export function gateFrameGeometry() {
  return mergeParts([
    { geo: new THREE.BoxGeometry(0.5, 3.4, 0.5), pos: [-3.2, 1.7, 0], color: 0x4c5b66 },
    { geo: new THREE.BoxGeometry(0.5, 3.4, 0.5), pos: [3.2, 1.7, 0], color: 0x4c5b66 },
    { geo: new THREE.BoxGeometry(0.5, 0.5, 0.5), pos: [0, 1.7, 0], color: 0x4c5b66 },
    { geo: new THREE.BoxGeometry(7.4, 0.5, 0.5), pos: [0, 3.6, 0], color: 0x5d707d }
  ]);
}

export function finishArchGeometry() {
  return mergeParts([
    { geo: new THREE.BoxGeometry(0.7, 5.2, 0.7), pos: [-6.4, 2.6, 0], color: 0xffb02e },
    { geo: new THREE.BoxGeometry(0.7, 5.2, 0.7), pos: [6.4, 2.6, 0], color: 0xffb02e },
    { geo: new THREE.BoxGeometry(13.5, 0.9, 0.9), pos: [0, 5.4, 0], color: 0xffd167 },
    { geo: new THREE.TorusGeometry(1.1, 0.2, 8, 16), pos: [0, 6.3, 0], color: 0x38d6a6 }
  ]);
}

export function doorGeometry() {
  return new THREE.BoxGeometry(5.6, 2.9, 0.28);
}
