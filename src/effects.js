import { rand, wrapX, clamp } from './util.js';
import { CFG } from './config.js';

const MAX = 420;

/**
 * One flat pool of particles, drawn back-to-front by type. Kinds:
 * 'smoke' | 'fire' | 'spark' | 'debris' | 'ring' | 'flash'
 */
export class Effects {
  constructor() {
    this.list = [];
    this.shake = 0;
  }

  clear() { this.list.length = 0; this.shake = 0; }

  add(p) {
    if (this.list.length >= MAX) this.list.shift();
    this.list.push(p);
    return p;
  }

  smoke(x, y, vx = 0, vy = 0, black = false) {
    this.add({
      kind: 'smoke', x, y,
      vx: vx + rand(-14, 14), vy: vy + rand(-30, -6),
      r: rand(4, 8), grow: rand(16, 30),
      life: rand(0.8, 1.6), max: 1.6,
      tone: black ? 34 : 150,
    });
  }

  spark(x, y) {
    for (let i = 0; i < 3; i++) {
      this.add({
        kind: 'spark', x, y,
        vx: rand(-140, 140), vy: rand(-140, 140),
        r: rand(1, 2.2), grow: -1,
        life: rand(0.1, 0.25), max: 0.25, tone: 0,
      });
    }
  }

  muzzle(x, y) {
    this.add({
      kind: 'flash', x, y,
      vx: 0, vy: 0, r: rand(6, 9), grow: -20,
      life: 0.06, max: 0.06, tone: 0,
    });
  }

  explode(x, y, size = 1, ground = false) {
    this.add({ kind: 'ring', x, y, vx: 0, vy: 0, r: 6 * size, grow: 300 * size, life: 0.3, max: 0.3, tone: 0 });
    const n = Math.round(10 * size);
    for (let i = 0; i < n; i++) {
      this.add({
        kind: 'fire', x: x + rand(-8, 8) * size, y: y + rand(-8, 8) * size,
        vx: rand(-90, 90) * size, vy: rand(-110, 40) * size,
        r: rand(6, 15) * size, grow: rand(10, 40) * size,
        life: rand(0.25, 0.6), max: 0.6, tone: 0,
      });
    }
    for (let i = 0; i < n; i++) {
      this.add({
        kind: 'smoke', x, y,
        vx: rand(-70, 70) * size, vy: rand(-120, -10) * size,
        r: rand(6, 16) * size, grow: rand(20, 46) * size,
        life: rand(0.9, 2.1), max: 2.1, tone: ground ? 96 : 60,
      });
    }
    for (let i = 0; i < Math.round(8 * size); i++) {
      this.add({
        kind: 'debris', x, y,
        vx: rand(-220, 220) * size, vy: rand(-260, 60) * size,
        r: rand(1.5, 3.5), grow: 0, spin: rand(-14, 14), ang: rand(0, 6.3),
        life: rand(0.5, 1.4), max: 1.4, tone: 0,
      });
    }
    this.shake = Math.min(18, this.shake + 7 * size);
  }

  update(dt) {
    const g = CFG.plane.gravity;
    const list = this.list;
    for (let i = list.length - 1; i >= 0; i--) {
      const p = list[i];
      p.life -= dt;
      if (p.life <= 0) { list.splice(i, 1); continue; }
      p.x = wrapX(p.x + p.vx * dt, CFG.world.width);
      p.y += p.vy * dt;
      p.r = Math.max(0.4, p.r + p.grow * dt);
      if (p.kind === 'debris') {
        p.vy += g * 0.9 * dt;
        p.ang += p.spin * dt;
      } else if (p.kind === 'smoke') {
        p.vy -= 26 * dt;                 // hot smoke rises
        p.vx *= 1 - 1.4 * dt;
      } else if (p.kind === 'fire' || p.kind === 'spark') {
        p.vx *= 1 - 2.4 * dt;
        p.vy *= 1 - 2.4 * dt;
      }
    }
    this.shake = Math.max(0, this.shake - dt * 34);
  }

  get shakeAmount() { return clamp(this.shake, 0, 18); }
}
