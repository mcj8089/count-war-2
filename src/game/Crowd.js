/* Boids crowd: spatial-hash separation + cohesion-to-anchor + alignment. The simulation owns
   plain Float32Arrays and writes its matrices straight into a CrowdView's instance buffer.
   Scratch objects are module-level so the hot loop never allocates. */
import THREE from '../three.js';
import { clamp } from '../util.js';

const _pos = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _euler = new THREE.Euler(0, 0, 0, 'YXZ');
const _scale = new THREE.Vector3();
const _mat = new THREE.Matrix4();
const GRID_MASK = 0xffff;
const AXIS_Y = new THREE.Vector3(0, 1, 0);

export class Crowd {
  constructor({ view, radius = 0.34, spacing = 0.62, seed = 1 }) {
    this.view = view;
    this.max = view.maxInstances;
    this.radius = radius;
    this.spacing = spacing;
    this.n = 0;
    this.px = new Float32Array(this.max);
    this.pz = new Float32Array(this.max);
    this.vx = new Float32Array(this.max);
    this.vz = new Float32Array(this.max);
    this.scaleJit = new Float32Array(this.max);
    this.phase = new Float32Array(this.max);
    this.cx = 0;
    this.cz = 0;
    this.targetX = 0;
    this.targetZ = 0;
    this.hold = false;
    this.time = 0;
    this.cell = Math.max(0.8, spacing * 1.8);
    this.inv = 1 / this.cell;
    this.bucketHead = new Int32Array(1 << 14);
    this.bucketNext = new Int32Array(this.max);
    this.rand = seedRand(seed);
    this.deadCount = 0;
  }

  get count() { return this.n; }
  get radiusOfGroup() { return Math.max(0.9, Math.sqrt(Math.max(1, this.n) / Math.PI) * this.spacing * 1.15); }

  reset(x, z, count) {
    this.n = 0;
    this.cx = x;
    this.cz = z;
    this.targetX = x;
    this.targetZ = z;
    this.deadCount = 0;
    this.spawnRing(x, z, count, 0.5);
    this.writeMatrices();
  }

  spawnRing(x, z, amount, startRadius = 0.4) {
    const color = this.view.instanceColor;
    const spreadR = Math.min(3.4, 0.7 * Math.sqrt(amount + 1));
    for (let k = 0; k < amount; k++) {
      if (this.n >= this.max) break;
      const i = this.n++;
      const a = this.rand() * Math.PI * 2;
      const r = startRadius + Math.sqrt(this.rand()) * spreadR;
      this.px[i] = x + Math.cos(a) * r;
      this.pz[i] = z + Math.sin(a) * r;
      this.vx[i] = (this.rand() - 0.5) * 0.6;
      this.vz[i] = (this.rand() - 0.5) * 0.6;
      this.scaleJit[i] = 0.84 + this.rand() * 0.32;
      this.phase[i] = this.rand() * Math.PI * 2;
      if (color) {
        const j = 0.9 + this.rand() * 0.18;
        color.array[i * 3] = j;
        color.array[i * 3 + 1] = j;
        color.array[i * 3 + 2] = j;
      }
    }
    if (color) color.needsUpdate = true;
    this.recomputeCentroid();
  }

  recomputeCentroid() {
    if (this.n === 0) return;
    let sx = 0;
    let sz = 0;
    for (let i = 0; i < this.n; i++) { sx += this.px[i]; sz += this.pz[i]; }
    this.cx = sx / this.n;
    this.cz = sz / this.n;
  }

  removeAt(i) {
    const last = this.n - 1;
    if (i !== last) {
      this.px[i] = this.px[last]; this.pz[i] = this.pz[last];
      this.vx[i] = this.vx[last]; this.vz[i] = this.vz[last];
      this.scaleJit[i] = this.scaleJit[last]; this.phase[i] = this.phase[last];
    }
    this.n = last;
    this.deadCount++;
  }

  /* Remove the `amount` units nearest (x,z) inside `radius`.
     范围内没有单位时不做任何删除（此前会兜底删队尾，导致"躲开攻击仍扣血"，
     躲避机制因此永远无效）。打空 = 0 伤害，对塔弹道 / Boss / 大怪横扫都成立。 */
  killNear(x, z, amount, radius = 1.8) {
    let removed = 0;
    for (let pass = 0; pass < amount && this.n > 0; pass++) {
      let best = -1;
      let bestD = radius * radius;
      for (let i = 0; i < this.n; i++) {
        const dx = this.px[i] - x;
        const dz = this.pz[i] - z;
        const d = dx * dx + dz * dz;
        if (d < bestD) { bestD = d; best = i; }
      }
      if (best < 0) break; // 范围内无人：不兜底，直接结束
      this.removeAt(best);
      removed++;
    }
    return removed;
  }

  setCount(count, originX, originZ) {
    const target = clamp(Math.round(count), 0, this.max);
    if (target > this.n) this.spawnRing(originX ?? this.cx, originZ ?? this.cz - 1.2, target - this.n, this.radiusOfGroup * 0.6);
    else while (this.n > target) this.removeAt(Math.floor(this.rand() * this.n));
    this.recomputeCentroid();
  }

  teleport(x, z) {
    const dx = x - this.cx;
    const dz = z - this.cz;
    for (let i = 0; i < this.n; i++) { this.px[i] += dx; this.pz[i] += dz; }
    this.cx = x;
    this.cz = z;
    this.targetX = x;
    this.targetZ = z;
  }

  /* keep the swarm on the tarmac */
  clampTo(bound) {
    for (let i = 0; i < this.n; i++) {
      if (this.px[i] < -bound) { this.px[i] = -bound; this.vx[i] = Math.abs(this.vx[i]) * 0.4; }
      else if (this.px[i] > bound) { this.px[i] = bound; this.vx[i] = -Math.abs(this.vx[i]) * 0.4; }
    }
  }

  buildGrid() {
    const head = this.bucketHead;
    head.fill(-1);
    const inv = this.inv;
    for (let i = 0; i < this.n; i++) {
      const cell = cellOf(Math.floor(this.px[i] * inv), Math.floor(this.pz[i] * inv), head.length);
      this.bucketNext[i] = head[cell];
      head[cell] = i;
    }
  }

  update(dt, sim, drive) {
    if (this.n === 0) return;
    /* keep the step bounded for separation stability, but no tighter than the game loop's own
       clamp: a smaller cap silently puts the whole run in slow motion on low-fps devices */
    dt = Math.min(dt, 0.05);
    this.time += dt;
    const cohesion = sim.cohesion ?? 6.2;
    const separation = sim.separation ?? 9.5;
    const alignment = sim.alignment ?? 2.4;
    const driveForce = sim.driveForce ?? 7.5;
    const maxSpeed = sim.maxSpeed ?? 8.6;
    const jitter = sim.jitter ?? 0.18;
    const spacing = sim.spacing ?? this.spacing;
    const bobAmp = sim.bobbing ?? 1;

    this.buildGrid();
    const inv = this.inv;
    const head = this.bucketHead;
    const next = this.bucketNext;
    const sepR = spacing * 1.02;
    const sepR2 = sepR * sepR;
    const neiR = spacing * 2.4;
    const neiR2 = neiR * neiR;
    const anchorX = this.targetX;
    const anchorZ = this.targetZ;
    const lateralLead = drive.laneOffset + drive.x * 0.35;

    for (let i = 0; i < this.n; i++) {
      const x = this.px[i];
      const z = this.pz[i];
      let sepX = 0, sepZ = 0, cohX = 0, cohZ = 0, aliX = 0, aliZ = 0, neighbours = 0;
      const gx = Math.floor(x * inv);
      const gz = Math.floor(z * inv);
      for (let oa = -1; oa <= 1; oa++) {
        for (let ob = -1; ob <= 1; ob++) {
          const cell = cellOf(gx + oa, gz + ob, head.length);
          for (let j = head[cell]; j !== -1; j = next[j]) {
            if (j === i) continue;
            const dx = this.px[j] - x;
            const dz = this.pz[j] - z;
            const d2 = dx * dx + dz * dz;
            if (d2 > neiR2 || d2 < 1e-6) continue;
            neighbours++;
            cohX += this.px[j];
            cohZ += this.pz[j];
            aliX += this.vx[j];
            aliZ += this.vz[j];
            if (d2 < sepR2) {
              const d = Math.sqrt(d2);
              const w = (sepR - d) / d;
              sepX -= dx * w;
              sepZ -= dz * w;
            }
          }
        }
      }

      let ax = 0;
      let az = 0;
      if (neighbours > 0) {
        const invN = 1 / neighbours;
        ax += (cohX * invN - x) * cohesion * 0.35;
        az += (cohZ * invN - z) * cohesion * 0.35;
        ax += aliX * invN * alignment;
        az += aliZ * invN * alignment;
      }
      ax += clamp(sepX * separation, -driveForce * 3, driveForce * 3);
      az += clamp(sepZ * separation, -driveForce * 3, driveForce * 3);
      /* the anchor pull is capped so a huge swarm pressed against the kerb keeps marching
         forward instead of spending every unit's budget on lateral squeeze */
      ax += clamp((anchorX + lateralLead - x) * cohesion * 0.9, -driveForce * 1.5, driveForce * 1.5);
      az += clamp((anchorZ - z) * cohesion * 0.25, -driveForce * 1.2, driveForce * 1.2);

      if (this.hold) {
        ax += (this.rand() - 0.5) * jitter * 14;
        az += (this.rand() - 0.5) * jitter * 6;
      } else {
        ax += (this.rand() - 0.5) * jitter * 10;
        az += driveForce;
      }

      this.vx[i] += ax * dt;
      this.vz[i] += az * dt;
      const sp = Math.hypot(this.vx[i], this.vz[i]);
      const limit = maxSpeed * (this.hold ? 0.4 : 1);
      if (sp > limit) { const k = limit / sp; this.vx[i] *= k; this.vz[i] *= k; }
      const dk = Math.max(0, 1 - (this.hold ? 3.4 : 1.6) * dt);
      this.vx[i] *= dk;
      this.vz[i] *= dk;
      this.px[i] += this.vx[i] * dt;
      this.pz[i] += this.vz[i] * dt;
    }

    this.recomputeCentroid();
    if (bobAmp) this.writeMatrices(bobAmp);
  }

  writeMatrices(bobAmp = 1) {
    const arr = this.view.body.instanceMatrix.array;
    for (let i = 0; i < this.n; i++) {
      const speed = Math.hypot(this.vx[i], this.vz[i]);
      const yaw = Math.atan2(this.vx[i], this.vz[i]);
      const tilt = Math.min(0.26, speed * 0.032) * (this.hold ? 0.25 : 1);
      const s = this.scaleJit[i];
      const y = Math.abs(Math.sin(this.time * (6.5 + speed * 1.2) + this.phase[i])) * 0.06 * bobAmp * (this.hold ? 0.45 : 1);
      _euler.set(tilt, yaw, 0);
      _quat.setFromEuler(_euler);
      _pos.set(this.px[i], y, this.pz[i]);
      _scale.set(s, s, s);
      _mat.compose(_pos, _quat, _scale);
      _mat.toArray(arr, i * 16);
    }
    this.view.setCount(this.n);
    this.view.body.instanceMatrix.needsUpdate = true;
  }
}

function cellOf(gx, gz, size) {
  return (((gx & GRID_MASK) * 73) ^ (gz & GRID_MASK)) & (size - 1);
}

function seedRand(seed) {
  let a = (seed || 1) >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export { AXIS_Y };
export default Crowd;
