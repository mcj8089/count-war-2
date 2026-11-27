/* Simulation + rules. States: preview | playing | paused | won | lost */
import THREE from '../three.js';
import { Crowd } from './Crowd.js';
import { CrowdView, creatureGeometries, crowdMaterials } from './Models.js';
import { Level } from './Level.js';
import { World } from './World.js';
import { Input } from './Input.js';
import { clamp, formatCount, store } from '../util.js';
import { t } from '../i18n.js';
import { SDK, shieldSave } from '../sdk-bridge.js';

const FALLBACK_LEVEL = { id: 1, name: 'Track', theme: 'grass', length: 260, gates: 9, neutrals: 6, towers: 3, boss: false, difficulty: 1 };

export class Game {
  constructor({ canvas, cfg, hud, audio, ads, assets }) {
    this.cfg = cfg;
    this.hud = hud;
    this.audio = audio;
    this.ads = ads;
    this.assets = assets;
    this.g = cfg.gameplay;
    this.world = new World(canvas, cfg);
    this.level = new Level(cfg, this.world.scene, assets);
    this.input = new Input(canvas);
    this.state = 'preview';
    this.running = false;
    this.time = 0;
    this.prevZ = 0;
    this.rafId = 0;
    this.lastFrame = 0;
    this.progress = this.loadProgress();
    this.levelIndex = 0;
    this.reviveUsed = false;
    this.bestThisRun = 0;
    this.afterAd = null;
    this.finishZ = FALLBACK_LEVEL.length;
    this.dodgeHintShown = false; // 大怪躲避提示只弹一次

    const maxInstances = Math.max(40, Math.round(this.g.maxCount ?? 600));
    const player = creatureGeometries('player');
    const playerMats = crowdMaterials({ faceTexture: assets.faces });
    this.playerView = new CrowdView({
      geometry: player.body, faceGeometry: player.face, material: playerMats.body,
      faceMaterial: playerMats.face, maxInstances
    });
    this.playerView.addTo(this.world.scene);
    this.crowd = new Crowd({
      view: this.playerView, radius: this.g.sim.unitRadius ?? 0.34,
      spacing: this.g.sim.spacing ?? 0.62, seed: 4
    });
  }

  get levels() {
    const list = this.g.levels;
    return list && list.length ? list : [FALLBACK_LEVEL];
  }

  levelDef(index) { return this.levels[clamp(index, 0, this.levels.length - 1)]; }

  /* ---------- progress ---------- */
  loadProgress() {
    const key = this.g.persistence?.localStorageKey || 'count-war.progress';
    const p = store.get(key, { highest: 1, bestCount: 0, lastLevel: 1 });
    return {
      highest: Math.max(1, Number(p.highest) || 1),
      bestCount: Math.max(0, Number(p.bestCount) || 0),
      lastLevel: Number(p.lastLevel) || 1
    };
  }

  saveProgress() {
    const key = this.g.persistence?.localStorageKey || 'count-war.progress';
    store.set(key, this.progress);
    shieldSave(this.progress);
  }

  /* ---------- level lifecycle ---------- */
  async startLevel(index, { preview = false } = {}) {
    this.levelIndex = clamp(index, 0, this.levels.length - 1);
    const def = this.levelDef(this.levelIndex);
    /* 'building' 中间态：重建场景期间旧人群可能仍站在上一关终点线上，
       若此刻已是 'playing'，checkFinish 会立刻误判胜利（第 2 关"自动胜利、
       无法操控"的根因）。构建完成、人群重置后再切换到 preview/playing。 */
    this.state = 'building';
    this.input.enabled = false;
    this.crowd.hold = true;
    this.reviveUsed = false;
    this.bestThisRun = 0;
    this.afterAd = null;
    const halfWidth = this.g.player.halfWidth ?? 6.2;

    this.input.setBounds(halfWidth);

    await this.world.build(def.theme || 'grass', { halfWidth, length: def.length ?? 260 });
    this.level.build(def, this.levelIndex);
    this.finishZ = this.level.finishZ || def.length || 260;

    const startCount = Math.round((this.g.startCount ?? 6) + (this.g.progression?.startCountBonusPerLevel ?? 0) * this.levelIndex);
    this.crowd.reset(0, 6, preview ? Math.min(startCount, 16) : startCount);
    this.input.snapTo(0);
    this.prevZ = this.crowd.cz;
    this.time = 0;
    this.world.camPos.set(0, this.g.camera.height ?? 15.5, -8);
    this.hud.labels.clear();

    this.crowd.hold = preview;
    if (preview) {
      this.state = 'preview';
      this.crowd.targetX = 0;
      this.crowd.targetZ = this.crowd.cz + 1.2;
    } else {
      this.state = 'playing';
      this.input.enabled = true;
      this.hud.show('hud');
      this.hud.update({ count: this.crowd.n, level: def.id ?? this.levelIndex + 1, ratio: 0 });
      this.hud.hint('hint.drag', 4200);
      this.audio.play('levelStart', { volume: 0.9 });
      this.audio.playMusic('musicPlay');
      this.ads.gameplayStarted();
      this.ads.showBanner('playBanner');
      SDK.start({ level: def.id ?? this.levelIndex + 1 });
    }
  }

  toMenu() {
    this.hud.show('menu');
    this.hud.bestLine(this.progress);
    this.ads.hideBanner();
    this.ads.gameplayEnded();
    this.audio.stopMusic(0.25);
    this.audio.playMusic('musicMenu');
    return this.startLevel(0, { preview: true });
  }

  pause() {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.input.enabled = false;
    this.ads.gameplayEnded();
    this.audio.play('uiBack', { volume: 0.7 });
    this.hud.show('pause');
  }

  resume() {
    if (this.state !== 'paused') return;
    this.state = 'playing';
    this.input.enabled = true;
    this.ads.gameplayStarted();
    this.audio.play('uiClick', { volume: 0.7 });
    this.hud.show('hud');
    this.lastFrame = performance.now();
  }

  retry() {
    this.hud.show('hud');
    return this.startLevel(this.levelIndex);
  }

  next() {
    return this.startLevel(Math.min(this.levels.length - 1, this.levelIndex + 1));
  }

  async revive() {
    const res = await this.ads.rewarded('revive');
    if (res !== 'rewarded') return false;
    SDK.revive({ level: this.levelDef(this.levelIndex).id });
    this.crowd.setCount(Math.max(20, (this.g.startCount ?? 6) * 3), this.crowd.cx, this.crowd.cz);
    this.state = 'playing';
    this.input.enabled = true;
    this.reviveUsed = true;
    this.hud.show('hud');
    this.audio.play('gateGood', { volume: 0.9 });
    this.ads.gameplayStarted();
    this.lastFrame = performance.now();
    return true;
  }

  /* ---------- per frame ---------- */
  step(dt) {
    this.time += dt;
    this.world.update(dt);
    const sim = this.g.sim;
    const playing = this.state === 'playing';
    const driveSpeed = this.g.player.forwardSpeed ?? 6.4;

    if (playing) {
      const lane = this.input.update(dt, this.g.player.laneSpeed ?? 13);
      this.crowd.targetX = lane;
      this.crowd.targetZ = this.crowd.cz + driveSpeed * 0.5;
    } else if (this.state === 'preview') {
      this.crowd.targetX = Math.sin(this.time * 0.35) * 2.6;
      this.crowd.targetZ = this.crowd.cz + 0.3;
    }

    this.prevZ = this.crowd.cz;
    const drive = { x: clamp((this.crowd.targetX - this.crowd.cx) * 1.4, -6, 6), laneOffset: 0 };
    this.crowd.update(dt, sim, drive);
    this.crowd.clampTo((this.g.player.halfWidth ?? 6.2) - 0.7);
    if (this.crowd.n === 0) this.playerView.setCount(0);

    if (playing) {
      this.resolveGates();
      this.resolveNeutrals(dt);
      this.resolveTowers(dt);
      this.resolveBoss(dt);
      this.resolveMonsters(dt);
      this.checkFinish();
      this.audio.crowdLevel(this.crowd.n > 140);
    } else {
      for (const n of this.level.neutralGroups) n.update(dt);
    }

    if (this.crowd.n > this.bestThisRun) this.bestThisRun = this.crowd.n;
    const ratio = clamp(this.crowd.cz / Math.max(1, this.finishZ), 0, 1);
    this.world.follow(dt, this.crowd.cx, this.crowd.cz, playing ? 1 : 0.2);
    if (playing) this.hud.update({ count: this.crowd.n, level: this.levelDef(this.levelIndex).id ?? this.levelIndex + 1, ratio, maxCount: this.g.maxCount });
    this.drawLabels();
  }

  resolveGates() {
    for (const gate of this.level.gates) {
      if (gate.used || !(this.prevZ < gate.z && this.crowd.cz >= gate.z)) continue;
      gate.used = true;
      const door = gate.doors.find((d) => Math.abs(this.crowd.cx - d.x) <= d.halfW) || gate.doors[0];
      for (const d of gate.doors) d.mesh.material.opacity = d === door ? 0.92 : 0.1;
      this.applyGate(door);
    }
  }

  applyGate(door) {
    const before = this.crowd.n;
    let after = before;
    if (door.op === 'add') after = before + door.value;
    else if (door.op === 'sub') after = before - door.value;
    else if (door.op === 'mul') after = Math.round(before * door.value);
    else after = Math.round(before / Math.max(2, door.value));
    this.crowd.setCount(clamp(after, 0, this.crowd.max), this.crowd.cx, this.crowd.cz);
    const gained = this.crowd.n - before;
    if (gained > 0) {
      this.audio.play(door.op === 'mul' ? 'gateMultiply' : 'gateGood', { volume: 0.85 });
      if (door.op === 'mul') this.hud.toast(t('toast.multiplied', { factor: door.value }), 'label-good');
    } else if (gained < 0) {
      this.audio.play('gateBad', { volume: 0.9 });
      this.audio.play('loseUnits', { volume: 0.6, throttleMs: 120 });
      this.world.kick(this.g.camera.shakeOnHit ?? 0.35);
      this.hud.toast(t('toast.lost', { count: -gained }), 'label-bad');
    } else {
      this.audio.play('gateGood', { volume: 0.6 });
    }
    if (this.crowd.n <= 0) this.gameOver();
  }

  resolveNeutrals(dt) {
    for (const n of this.level.neutralGroups) {
      n.update(dt);
      if (n.dead) continue;
      const dx = n.x - this.crowd.cx;
      const dz = n.z - this.crowd.cz;
      const reach = n.radius + this.crowd.radiusOfGroup;
      if (dx * dx + dz * dz > reach * reach) continue;
      const before = this.crowd.n;
      if (before >= n.count) {
        const worth = Math.round(n.count * (this.g.neutrals.rewardRatio ?? 1));
        this.crowd.setCount(clamp(before + worth, 0, this.crowd.max), n.x, n.z);
        n.shrink();
        this.audio.play('absorb', { volume: 0.85 });
        const added = this.crowd.n - before;
        if (added > 0) this.hud.toast(t('toast.absorbed', { count: formatCount(added) }), 'label-good');
      } else {
        this.crowd.setCount(clamp(before - n.count, 0, this.crowd.max), this.crowd.cx, this.crowd.cz);
        n.shrink();
        this.audio.play('loseUnits', { volume: 0.9 });
        this.world.kick(0.5);
        this.hud.toast(t('toast.lost', { count: before - this.crowd.n }), 'label-bad');
        if (this.crowd.n <= 0) this.gameOver();
      }
    }
  }

  resolveTowers(dt) {
    const cfgT = this.g.towers;
    const range = cfgT.range ?? 30;
    const crowdRange = this.crowd.radiusOfGroup;
    for (const tower of this.level.towers) {
      if (tower.captured) continue;
      const dz = tower.z - this.crowd.cz;
      if (dz > range || dz < -14) continue;
      const dx = tower.x - this.crowd.cx;
      const captureReach = 2.0 + crowdRange;
      if (dx * dx + dz * dz < captureReach * captureReach) {
        tower.hp -= (cfgT.damagePerUnitPerSecond ?? 0.55) * this.crowd.n * dt;
        if (tower.hp <= 0) this.captureTower(tower);
        continue;
      }
      tower.cooldown -= dt;
      if (tower.cooldown <= 0) {
        const [lo, hi] = cfgT.fireInterval || [0.7, 1.4];
        tower.cooldown = lo + Math.random() * (hi - lo);
        this.level.spawnProjectile(
          tower.x, 2.2, tower.z,
          this.crowd.cx + (Math.random() - 0.5) * crowdRange,
          this.crowd.cz + (Math.random() - 0.5) * crowdRange
        );
        this.audio.play('towerShot', { volume: 0.45, throttleMs: 70, rate: 0.92 + Math.random() * 0.24, /* 屏幕左右与世界 X 相反（见 Input.js 注释），pan 取反保持声像与画面一致 */ pan: clamp((this.crowd.cx - tower.x) / 12, -1, 1) });
      }
    }

    const hits = this.level.updateProjectiles(dt, this.crowd.cx, this.crowd.cz);
    for (const h of hits) {
      if (!h.arrived) continue;
      const removed = this.crowd.killNear(h.x, h.z, Math.random() < 0.3 ? 2 : 1, 2.2);
      if (removed > 0) {
        this.audio.play('unitHit', { volume: 0.7, throttleMs: 45 });
        this.world.kick(this.g.camera.shakeOnHit ?? 0.35);
      } else this.audio.play('towerHit', { volume: 0.45, throttleMs: 60 });
    }
    if (this.crowd.n <= 0 && this.state === 'playing') this.gameOver();
  }

  captureTower(tower) {
    tower.captured = true;
    tower.mesh.geometry = tower.allyGeo;
    const before = this.crowd.n;
    this.crowd.setCount(clamp(this.crowd.n + (tower.reward ?? this.g.towers.captureReward ?? 8), 0, this.crowd.max), tower.x, tower.z);
    this.audio.play('towerCapture', { volume: 0.95 });
    this.hud.toast(t('toast.captured', { reward: this.crowd.n - before }), 'label-good');
  }

  resolveBoss(dt) {
    const boss = this.level.boss;
    if (!boss || !boss.alive) return;
    const cfgB = this.g.boss;
    const limit = boss.z - boss.radius - this.crowd.radiusOfGroup * 0.55;
    if (this.crowd.cz > limit) this.crowd.teleport(this.crowd.cx, limit);

    /* the boss only swings once the swarm is actually pressed against it */
    if (limit - this.crowd.cz > 2.2) {
      boss.timer = cfgB.attackInterval ?? 1.3;
      return;
    }

    boss.hp -= this.crowd.n * (cfgB.dpsPerUnit ?? 0.5) * dt;
    if (boss.hp <= 0) {
      boss.alive = false;
      boss.body.visible = false;
      boss.face.visible = false;
      this.audio.play('win', { volume: 0.95 });
      this.world.kick(0.7);
      this.hud.toast(t('result.win'), 'label-good');
      SDK.boss({ result: 'kill', level: this.levelDef(this.levelIndex).id });
      return;
    }
    this.audio.play('bossHit', { volume: 0.45, throttleMs: 260 });

    boss.timer -= dt;
    if (boss.timer <= 0) {
      boss.timer = cfgB.attackInterval ?? 1.3;
      const removed = this.crowd.killNear(this.crowd.cx, this.crowd.cz, Math.round(cfgB.damage ?? 12), (cfgB.sweepWidth ?? 7) * 0.6);
      this.audio.play('bossRoar', { volume: 0.85 });
      this.world.kick(0.55);
      if (removed) this.hud.toast(t('toast.lost', { count: removed }), 'label-bad');
      if (this.crowd.n <= 0) this.gameOver();
    }
  }

  checkFinish() {
    if (this.crowd.cz < this.finishZ) return;
    if (this.level.boss?.alive) return;
    this.win();
  }

  /* 大怪结算：与 Boss 类似，但每只独立、可中途出现；击溃给奖励、放行前进。
     攻击带前摇预警（windup）：落点瞄准人群中心附近，玩家在前摇期间横向移开
     即可基本无损躲过——这是本游戏的核心互动点之一。 */
  resolveMonsters(dt) {
    const cfgM = this.g.monsters || {};
    const halfWidth = this.g.player.halfWidth ?? 6.2;
    for (const m of this.level.monsters) {
      if (!m.alive) continue;
      const limit = m.z - m.radius - this.crowd.radiusOfGroup * 0.55;
      if (this.crowd.cz > limit) this.crowd.teleport(this.crowd.cx, limit);

      if (limit - this.crowd.cz > 2.2) {
        m.timer = cfgM.attackInterval ?? 1.5;
        m.windup = 0;
        continue;
      }

      m.hp -= this.crowd.n * (cfgM.dpsPerUnit ?? 0.8) * dt;
      if (m.hp <= 0) {
        m.alive = false;
        m.mesh.visible = false;
        const before = this.crowd.n;
        this.crowd.setCount(clamp(before + m.reward, 0, this.crowd.max), this.crowd.cx, this.crowd.cz);
        this.audio.play('monsterDie', { volume: 0.9 });
        this.hud.toast(t('toast.monsterDown', { count: this.crowd.n - before }), 'label-good');
        this.world.kick(0.5);
        SDK.monster({ tier: m.tier, result: 'kill', level: this.levelDef(this.levelIndex).id });
        continue;
      }
      this.audio.play('monsterHit', { volume: 0.4, throttleMs: 280 });

      /* 前摇阶段：倒计时结束就在 aimX 处横扫一条竖带，躲开落点即无伤 */
      if (m.windup > 0) {
        m.windup -= dt;
        if (m.windup <= 0) {
          m.windup = 0;
          const removed = this.crowd.killNear(m.aimX, this.crowd.cz, Math.round(cfgM.damage ?? 6), (m.width ?? 6) * 0.32);
          this.audio.play('monsterRoar', { volume: 0.85 });
          this.world.kick(0.45);
          if (removed) this.hud.toast(t('toast.lost', { count: removed }), 'label-bad');
          if (this.crowd.n <= 0) this.gameOver();
          m.timer = cfgM.attackInterval ?? 1.8;
        }
        continue;
      }

      m.timer -= dt;
      if (m.timer <= 0) {
        m.windup = cfgM.windup ?? 0.75;
        /* 落点取人群中心附近：不躲就挨打，横向移开即可躲 */
        m.aimX = clamp(this.crowd.cx + (Math.random() - 0.5) * 2.0, -halfWidth + 1, halfWidth - 1);
        this.audio.play('monsterRoar', { volume: 0.55, rate: 1.25 });
        if (!this.dodgeHintShown) {
          this.dodgeHintShown = true;
          this.hud.hint('hint.dodge', 2800);
        }
        m.timer = (cfgM.windup ?? 0.75) + 0.1; // 前摇期间不再重复触发
      }
    }
  }

  /* ---------- endings ---------- */
  win() {
    if (this.state !== 'playing') return;
    this.state = 'won';
    this.input.enabled = false;
    this.audio.stopMusic(0.2);
    this.audio.play('win', { volume: 1 });
    this.ads.gameplayEnded();
    this.ads.hideBanner();
    SDK.win({ level: this.levelDef(this.levelIndex).id, count: this.crowd.n });
    const isLast = this.levelIndex >= this.levels.length - 1;
    const nextId = this.levelDef(Math.min(this.levels.length - 1, this.levelIndex + 1)).id;
    this.progress.highest = Math.max(this.progress.highest, Number(nextId) || 1, isLast ? this.progress.highest : 1);
    const newBest = this.bestThisRun > this.progress.bestCount;
    if (newBest) this.progress.bestCount = this.bestThisRun;
    this.progress.lastLevel = this.levelDef(this.levelIndex).id;
    this.saveProgress();
    this.hud.result({
      win: true, count: this.crowd.n, ratio: 1,
      nextLabel: isLast ? t('menu.play') : t('result.next'),
      canRevive: false, newBest
    });
    /* 胜利后停留在结算弹框，不自动进入下一关；
       插屏广告与跳关都推迟到玩家点击「下一关」按钮（confirmNext）时执行。 */
    this.afterAd = () => this.startLevel(isLast ? 0 : this.levelIndex + 1);
  }

  /* 玩家在胜利弹框点击「下一关」：先展示插屏广告（若有），再进入下一关。 */
  async confirmNext() {
    if (this.state !== 'won' || !this.afterAd) return;
    const go = this.afterAd;
    this.afterAd = null;
    SDK.ad({ placement: 'levelComplete', format: 'interstitial', level: this.levelDef(this.levelIndex).id });
    try {
      await this.ads.interstitial('levelComplete');
    } catch { /* 广告失败不阻断跳关 */ }
    go();
  }

  gameOver() {
    if (this.state !== 'playing') return;
    this.state = 'lost';
    this.input.enabled = false;
    this.audio.stopMusic(0.2);
    this.audio.play('lose', { volume: 1 });
    SDK.fail({ level: this.levelDef(this.levelIndex).id, cz: Math.round(this.crowd.cz), best: this.bestThisRun });
    this.ads.gameplayEnded();
    this.ads.hideBanner();
    if (this.bestThisRun > this.progress.bestCount) {
      this.progress.bestCount = this.bestThisRun;
      this.saveProgress();
    }
    this.hud.result({
      win: false, count: 0,
      ratio: clamp(this.crowd.cz / Math.max(1, this.finishZ), 0, 1),
      canRevive: !this.reviveUsed && this.ads.active && this.ads.behavior.rewardedForRevive !== false,
      newBest: false
    });
  }

  runAfterAd() {
    const fn = this.afterAd;
    this.afterAd = null;
    if (fn) fn();
  }

  /* ---------- world-anchored numbers ---------- */
  drawLabels() {
    const L = this.hud.labels;
    const near = this.crowd.cz;
    L.set('player', { x: this.crowd.cx, y: 2.5, z: this.crowd.cz }, formatCount(this.crowd.n), 'label-player', 30);

    for (const gate of this.level.gates) {
      if (gate.used || gate.z < near - 14 || gate.z > near + 72) continue;
      gate.doors.forEach((d, i) => {
        L.set(`g${gate.index}-${i}`, { x: d.x, y: 1.75, z: gate.z }, d.text, d.good ? 'label-good' : 'label-bad', 27);
      });
    }

    for (let i = 0; i < this.level.neutralGroups.length; i++) {
      const n = this.level.neutralGroups[i];
      if (n.dead || n.z < near - 14 || n.z > near + 72) continue;
      L.set(`n${i}`, { x: n.x, y: 1.7, z: n.z }, formatCount(n.count), 'label-neutral', 25);
    }

    this.level.towers.forEach((tw, i) => {
      if (tw.z < near - 12 || tw.z > near + 72) return;
      L.set(`t${i}`, { x: tw.x, y: 3.2, z: tw.z }, tw.captured ? '✓' : String(tw.level), tw.captured ? 'label-good' : 'label-enemy', 22);
    });

    const boss = this.level.boss;
    if (boss && boss.alive && boss.z < near + 90) {
      L.set('boss', { x: boss.x, y: 5.6, z: boss.z }, String(Math.max(0, Math.ceil(boss.hp))), 'label-enemy', 33);
    } else L.remove('boss');

    for (let mi = 0; mi < this.level.monsters.length; mi++) {
      const m = this.level.monsters[mi];
      if (!m.alive || m.z < near - 14 || m.z > near + 90) { L.remove(`m${mi}`); L.remove(`mw${mi}`); continue; }
      L.set(`m${mi}`, { x: m.x, y: 3.4 * (1 + (m.tier - 1) * 0.25), z: m.z }, String(Math.max(0, Math.ceil(m.hp))), 'label-enemy', 30);
      /* 前摇预警：在落点位置显示 ⚠，玩家据此横向躲避 */
      if (m.windup > 0) L.set(`mw${mi}`, { x: m.aimX, y: 1.5, z: this.crowd.cz + 1.2 }, '⚠', 'label-bad', 40);
      else L.remove(`mw${mi}`);
    }

    const dom = this.world.renderer.domElement;
    L.render(this.world.camera, dom.clientWidth, dom.clientHeight);
  }

  render() { this.world.render(); }

  start() {
    if (this.running) return;
    this.running = true;
    this.lastFrame = performance.now();
    /* Fixed 1/60 simulation steps. Feeding the frame's raw dt straight into step() means the
       crowd (which guards its own step size for separation stability) and the damage clocks
       (gates/towers/boss) advance at different rates on a slow device: the swarm crawls while
       towers keep firing at full wall-clock speed, and the same level becomes unwinnable. */
    const FIXED = 1 / 60;
    const MAX_STEPS = 5;
    let acc = 0;
    const tick = (now) => {
      if (!this.running) return;
      this.rafId = requestAnimationFrame(tick);
      const dt = Math.max(0, (now - this.lastFrame) / 1000);
      this.lastFrame = now;
      if (this.state === 'paused') {
        acc = 0;
        this.world.update(Math.min(dt, 0.1) * 0.2);
      } else {
        acc += Math.min(dt, 0.25);
        let steps = 0;
        while (acc >= FIXED && steps < MAX_STEPS) {
          this.step(FIXED);
          acc -= FIXED;
          steps++;
        }
        /* give up the backlog rather than try to simulate it after a tab-switch hitch */
        if (steps === MAX_STEPS) acc = 0;
      }
      this.render();
    };
    this.rafId = requestAnimationFrame(tick);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.rafId);
  }
}

export default Game;
