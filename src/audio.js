/* Web Audio mixer for the generated wav pack (assets/sfx). Decodes once, plays with
   pitch/volume randomisation, voice-limited. Missing files are skipped, never fatal. */
import { readFileBytes } from './assets.js';

export class AudioEngine {
  constructor(cfg) {
    this.cfg = cfg;
    this.audioCfg = cfg?.audio || {};
    this.ctx = null;
    this.buffers = new Map();
    this.missing = new Set();
    this.master = null;
    this.sfxGain = null;
    this.musicGain = null;
    this.musicSource = null;
    this.musicName = null;
    this.muted = this.audioCfg.startMuted === true || this.audioCfg.master === 0;
    this.ducked = false;
    this.activeVoices = 0;
    this.lastPlayed = new Map();
    this.ready = false;
  }

  get unlocked() { return Boolean(this.ctx) && this.ctx.state !== 'closed'; }

  ensureContext() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
      return this.ctx;
    }
    const Ctor = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!Ctor) { console.warn('[audio] Web Audio unavailable'); return null; }
    this.ctx = new Ctor();
    this.master = this.ctx.createGain();
    this.sfxGain = this.ctx.createGain();
    this.musicGain = this.ctx.createGain();
    const headroom = this.ducked ? 0.25 : 1;
    this.master.gain.value = (this.muted ? 0 : 1) * (this.audioCfg.master ?? 0.9) * headroom;
    this.sfxGain.gain.value = this.audioCfg.sfx ?? 0.85;
    this.musicGain.gain.value = (this.audioCfg.music ?? 0.45) * 0.85;
    this.sfxGain.connect(this.master);
    this.musicGain.connect(this.master);
    this.master.connect(this.ctx.destination);
    return this.ctx;
  }

  async load(names = Object.keys(this.audioCfg.sounds || {})) {
    if (!this.ensureContext()) return;
    await Promise.all(names.map(async (name) => {
      const path = this.audioCfg.sounds[name];
      if (!path || this.buffers.has(name) || this.missing.has(name)) return;
      try {
        const bytes = await readFileBytes(path);
        const buf = await this.ctx.decodeAudioData(bytes);
        this.buffers.set(name, buf);
      } catch (err) {
        this.missing.add(name);
        console.warn('[audio] missing sfx:', name, path);
      }
    }));
    this.ready = this.buffers.size > 0;
    return this.buffers.size;
  }

  play(name, { volume = 1, rate = 1, rateJitter = 0.08, pan = 0, throttleMs = 0, music = false } = {}) {
    if (this.muted || !this.buffers.has(name)) return null;
    if (throttleMs) {
      const last = this.lastPlayed.get(name) || 0;
      if (performance.now() - last < throttleMs) return null;
      this.lastPlayed.set(name, performance.now());
    }
    const ctx = this.ensureContext();
    if (!ctx || ctx.state === 'suspended') return null;
    if (!music && this.activeVoices >= (this.audioCfg.maxSimultaneous || 12)) return null;
    const buf = this.buffers.get(name);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const r = rate * (1 + (Math.random() * 2 - 1) * rateJitter);
    src.playbackRate.value = Math.max(0.4, Math.min(2.2, r));
    const gain = ctx.createGain();
    gain.gain.value = volume;
    src.connect(gain);
    let dest = music ? this.musicGain : this.sfxGain;
    if (!music && pan && ctx.createStereoPanner) {
      const panner = ctx.createStereoPanner();
      panner.pan.value = Math.max(-1, Math.min(1, pan));
      gain.connect(panner);
      panner.connect(dest);
    } else gain.connect(dest);
    if (music) {
      src.loop = true;
      this.stopMusic(0.0);
      this.musicSource = src;
      this.musicName = name;
    } else {
      const protect = setTimeout(() => { this.activeVoices = Math.max(0, this.activeVoices - 1); }, 8000);
      src.onended = () => { clearTimeout(protect); this.activeVoices = Math.max(0, this.activeVoices - 1); };
      this.activeVoices++;
    }
    src.start();
    return src;
  }

  playMusic(name, volume = 1) {
    if (!this.buffers.has(name)) return;
    if (this.musicName === name && this.musicSource) return;
    this.play(name, { music: true, volume, rate: 1, rateJitter: 0 });
  }

  stopMusic(fade = 0.35) {
    const src = this.musicSource;
    this.musicSource = null;
    this.musicName = null;
    if (!src || !this.ctx) return;
    try {
      src.stop(this.ctx.currentTime + fade);
      setTimeout(() => { try { src.disconnect(); } catch {} }, (fade + 0.1) * 1000);
    } catch { try { src.stop(); } catch {} }
  }

  setMuted(muted) {
    this.muted = Boolean(muted);
    if (this.master && this.ctx) {
      const headroom = this.ducked ? 0.25 : 1;
      this.master.gain.setTargetAtTime(this.muted ? 0 : (this.audioCfg.master ?? 0.9) * headroom, this.ctx.currentTime, 0.05);
    }
    return this.muted;
  }

  /* used by the ad layer so a mid-level ad does not blast music behind it */
  setDuck(on) {
    this.ducked = Boolean(on);
    if (!this.master || !this.ctx) return;
    const headroom = this.ducked ? 0.25 : 1;
    this.master.gain.setTargetAtTime(this.muted ? 0 : (this.audioCfg.master ?? 0.9) * headroom, this.ctx.currentTime, 0.08);
  }

  setVolume(kind, value) {
    this.audioCfg[kind] = value;
    const node = kind === 'music' ? this.musicGain : kind === 'sfx' ? this.sfxGain : this.master;
    if (node && this.ctx) node.gain.value = value;
  }

  /* continuous swarm chatter whose level tracks the crowd size */
  crowdLevel(set) {
    if (!this.audioCfg.crowdDenoise) return;
    if (set) this.play('crowdMurmur', { volume: 0.32, rate: 1, throttleMs: 2200 });
  }

  dispose() {
    this.stopMusic(0);
    try { this.ctx?.close(); } catch {}
    this.ctx = null;
  }
}

export default AudioEngine;
