// Tiny WebAudio kit — everything is synthesised, so there are no assets to load.
import { clamp } from './util.js';

export class Sfx {
  constructor() {
    this.ctx = null;
    this.noise = null;
    this.muted = localStorage.getItem('pf-muted') === '1';
    this.engineOn = false;
  }

  /** Must be called from a user gesture the first time. */
  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.7;
    this.master.connect(this.ctx.destination);

    // One second of white noise, reused by guns and explosions.
    const len = Math.floor(this.ctx.sampleRate);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noise = buf;
  }

  toggleMute() {
    this.muted = !this.muted;
    localStorage.setItem('pf-muted', this.muted ? '1' : '0');
    if (this.master) this.master.gain.value = this.muted ? 0 : 0.7;
    return this.muted;
  }

  get t() { return this.ctx ? this.ctx.currentTime : 0; }

  burst({ dur = 0.2, from = 1200, to = 200, gain = 0.3, type = 'lowpass' }) {
    if (!this.ctx || this.muted) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(from, this.t);
    f.frequency.exponentialRampToValueAtTime(Math.max(40, to), this.t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, this.t);
    g.gain.exponentialRampToValueAtTime(0.0008, this.t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start();
    src.stop(this.t + dur + 0.02);
  }

  tone({ f0 = 300, f1 = 120, dur = 0.15, gain = 0.2, type = 'square' }) {
    if (!this.ctx || this.muted) return;
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, this.t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), this.t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, this.t);
    g.gain.exponentialRampToValueAtTime(0.0008, this.t + dur);
    o.connect(g).connect(this.master);
    o.start();
    o.stop(this.t + dur + 0.02);
  }

  gun() { this.burst({ dur: 0.07, from: 2600, to: 700, gain: 0.16, type: 'bandpass' }); }
  hit() { this.tone({ f0: 900, f1: 260, dur: 0.07, gain: 0.1, type: 'triangle' }); }
  thump() { this.tone({ f0: 150, f1: 48, dur: 0.22, gain: 0.16, type: 'sine' }); }
  bombDrop() { this.tone({ f0: 700, f1: 180, dur: 0.5, gain: 0.05, type: 'sine' }); }
  explode(big = 1) {
    this.burst({ dur: 0.55 * big, from: 900, to: 60, gain: 0.34 });
    this.tone({ f0: 120, f1: 34, dur: 0.5 * big, gain: 0.22, type: 'sine' });
  }
  chime() {
    this.tone({ f0: 660, f1: 990, dur: 0.18, gain: 0.12, type: 'triangle' });
    setTimeout(() => this.tone({ f0: 990, f1: 1320, dur: 0.22, gain: 0.1, type: 'triangle' }), 120);
  }

  // ── Engine drone ──
  startEngine() {
    if (!this.ctx || this.engineOn) return;
    this.engineOn = true;
    this.eg = this.ctx.createGain();
    this.eg.gain.value = 0;
    this.ef = this.ctx.createBiquadFilter();
    this.ef.type = 'lowpass';
    this.ef.frequency.value = 620;
    this.eo = [];
    for (const [type, det] of [['sawtooth', 0], ['square', 7]]) {
      const o = this.ctx.createOscillator();
      o.type = type;
      o.frequency.value = 70 + det;
      o.connect(this.ef);
      o.start();
      this.eo.push(o);
    }
    this.ef.connect(this.eg).connect(this.master);
    this.eg.gain.linearRampToValueAtTime(0.075, this.t + 0.4);
  }

  stopEngine() {
    if (!this.ctx || !this.engineOn) return;
    this.engineOn = false;
    const end = this.t + 0.3;
    this.eg.gain.linearRampToValueAtTime(0, end);
    for (const o of this.eo) o.stop(end + 0.05);
  }

  engine(speed, throttle = 1) {
    if (!this.engineOn || !this.ctx) return;
    const f = 46 + clamp(speed, 0, 420) * 0.19;
    for (let i = 0; i < this.eo.length; i++) {
      this.eo[i].frequency.setTargetAtTime(f + i * 7, this.t, 0.08);
    }
    this.ef.frequency.setTargetAtTime(380 + f * 5 * throttle, this.t, 0.1);
  }
}
