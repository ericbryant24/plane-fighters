import { CFG } from './config.js';
import { wrapX } from './util.js';

export class Bullet {
  constructor(x, y, vx, vy, side) {
    this.x = x; this.y = y; this.vx = vx; this.vy = vy;
    this.px = x; this.py = y;           // previous position, for tracer segments
    this.side = side;                    // 'player' | 'enemy'
    this.life = CFG.gun.life;
    this.dead = false;
  }
  update(dt) {
    this.px = this.x; this.py = this.y;
    this.vy += CFG.plane.gravity * 0.35 * dt;   // a little droop keeps range honest
    this.x = wrapX(this.x + this.vx * dt, CFG.world.width);
    this.y += this.vy * dt;
    this.life -= dt;
    if (this.life <= 0) this.dead = true;
  }
}

export class Bomb {
  constructor(x, y, vx, vy, side) {
    this.x = x; this.y = y; this.vx = vx; this.vy = vy;
    this.side = side;
    this.angle = Math.atan2(vy, vx);
    this.life = 12;
    this.dead = false;
    this.r = CFG.bomb.radius;
  }
  update(dt) {
    const B = CFG.bomb;
    this.vy += B.gravity * dt;
    const s = Math.hypot(this.vx, this.vy);
    const d = B.dragK * s * dt;
    this.vx -= this.vx * d;
    this.vy -= this.vy * d;
    // Fins swing the bomb nose-first into the airflow.
    this.angle = Math.atan2(this.vy, this.vx);
    this.x = wrapX(this.x + this.vx * dt, CFG.world.width);
    this.y += this.vy * dt;
    this.life -= dt;
    if (this.life <= 0) this.dead = true;
  }
}

/** Anti-aircraft shell: flies up, bursts near its fuse altitude. */
export class Flak {
  constructor(x, y, vx, vy, fuseY) {
    this.x = x; this.y = y; this.vx = vx; this.vy = vy;
    this.fuseY = fuseY;
    this.life = CFG.flak.life;
    this.dead = false;
    this.burst = false;
  }
  update(dt) {
    this.vy += CFG.plane.gravity * 0.5 * dt;
    this.x = wrapX(this.x + this.vx * dt, CFG.world.width);
    this.y += this.vy * dt;
    this.life -= dt;
    if (this.vy >= 0 || this.y <= this.fuseY || this.life <= 0) this.burst = true;
  }
}
