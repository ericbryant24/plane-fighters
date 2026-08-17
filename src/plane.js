import { CFG } from './config.js';
import { TAU, clamp, angleDelta, rand, wrapX, hypot } from './util.js';

const P = CFG.plane;

export const LIVERY = {
  player: { body: '#7f8f5a', wing: '#94a566', trim: '#3f4a2c', mark: '#3f6fa8', pilot: '#c8a878' },
  enemy: { body: '#6c4340', wing: '#8a5450', trim: '#2f1f1e', mark: '#1a1a1a', pilot: '#b09070' },
  ace: { body: '#a8322a', wing: '#c24036', trim: '#3a1310', mark: '#f0e0d0', pilot: '#d0b090' },
};

export class Plane {
  constructor(opts) {
    this.x = opts.x;
    this.y = opts.y;
    this.angle = opts.angle ?? 0;
    const s = opts.speed ?? P.cruise;
    this.vx = Math.cos(this.angle) * s;
    this.vy = Math.sin(this.angle) * s;

    this.side = opts.side ?? 'enemy';           // 'player' | 'enemy'
    this.kind = opts.kind ?? (this.side === 'player' ? 'player' : 'enemy');
    this.livery = LIVERY[this.kind] ?? LIVERY.enemy;

    this.maxHp = opts.hp ?? (this.side === 'player' ? P.hp : CFG.enemy.hp);
    this.hp = this.maxHp;
    this.radius = P.radius;
    this.power = opts.power ?? 1;               // thrust multiplier
    this.agility = opts.agility ?? 1;
    this.fireRate = opts.fireRate ?? 1;

    this.alive = true;
    this.gunCool = 0;
    this.bombs = opts.bombs ?? 0;
    this.bombCool = 0;
    this.propPhase = 0;
    this.muzzle = 0;                            // flash timer
    this.smokeAcc = 0;
    this.stalling = false;
    this.ai = null;
    // `pitch` is the human-facing stick (+1 = pull back / climb). `turn` is a
    // direct screen-space rotation channel (+1 = clockwise) used by the AI.
    this.controls = { pitch: 0, turn: null, fire: false, bomb: false };
    this.turnLatch = 0;
    this.age = 0;
  }

  get speed() { return hypot(this.vx, this.vy); }
  get altitude() { return CFG.world.groundY - this.y; }
  /** +1 when the nose points right, -1 when it points left. */
  get facing() { return Math.cos(this.angle) < 0 ? -1 : 1; }

  /**
   * Screen-space turn command that swings the nose toward `target`. Feed this
   * into controls.turn — it has no orientation singularity, unlike the stick.
   */
  steerTo(target, gain = 2.2) {
    return clamp(angleDelta(this.angle, target) * gain, -1, 1);
  }

  /**
   * Resolve the stick into a screen rotation direction. The direction is
   * latched on press so a held stick keeps rotating the same way all the way
   * around a loop; re-deriving it every frame pins the plane at vertical,
   * because that is exactly where `facing` flips sign.
   */
  turnInput() {
    const c = this.controls;
    if (c.turn !== null && c.turn !== undefined) return c.turn;
    if (!c.pitch) { this.turnLatch = 0; return 0; }
    if (!this.turnLatch) this.turnLatch = -Math.sign(c.pitch) * this.facing;
    return this.turnLatch * Math.abs(c.pitch);
  }

  update(dt, game) {
    if (!this.alive) return;
    this.age += dt;
    const W = CFG.world.width;

    // ── Rotation: pull/push is relative to the airframe, so loops work. ──
    // Rate is near-constant above stall, so turn *radius* is what speed buys
    // you: fast means wide arcs, slow means tight ones — right up until the
    // wings quit. (Scaling the rate itself makes loops impossible: rotation
    // slows as the climb bleeds speed and the plane spirals up into a stall.)
    const spd = this.speed;
    const authority = clamp(spd / (P.stallSpeed * 1.35), 0.15, 1);
    const rate = P.turn * this.agility * authority;
    this.angle += this.turnInput() * rate * dt;

    // Below stall speed the wings let go and the nose falls through. Capped so
    // it can never completely overpower the stick.
    this.stalling = spd < P.stallSpeed;
    if (this.stalling) {
      const droop = (1 - spd / P.stallSpeed) * P.stallDroop;
      this.angle += clamp(angleDelta(this.angle, Math.PI / 2) * droop, -1.3, 1.3) * dt;
    }
    this.angle %= TAU;

    // ── Flight path ──
    // Worked in (speed, path-angle) rather than as an xy force sum, because
    // lift does no work: the wings bend the flight path toward the nose without
    // destroying momentum, and turning is paid for with induced drag instead.
    let spd2 = spd;
    let path = Math.atan2(this.vy, this.vx);

    // How hard the wings can bite. Stalled wings barely steer the path, which
    // is what makes a stall look and feel like falling out of the sky.
    const bite = clamp(spd2 / P.stallSpeed, 0, 1.3);
    const lag = angleDelta(path, this.angle);
    const swing = lag * (1 - Math.exp(-P.align * bite * dt));
    path += swing;
    spd2 -= Math.abs(swing) * spd2 * P.inducedK;   // hard turns cost speed

    // Gravity: the along-path component trades height for speed, and whatever
    // lift can't carry bends the path downward.
    const lift = Math.min(1, (spd2 / P.cruise) ** 2) * Math.min(1, bite);
    spd2 += P.gravity * Math.sin(path) * dt;
    path += (P.gravity * Math.cos(path) * (1 - lift)) / Math.max(spd2, 45) * dt;

    // Thrust (only what points along the path) and parasitic drag.
    const thin = clamp((this.y - CFG.world.topY) / (CFG.world.ceiling - CFG.world.topY), 0.15, 1);
    spd2 += P.thrust * this.power * thin * Math.cos(lag) * dt;
    spd2 -= P.dragK * spd2 * Math.abs(spd2) * dt;
    spd2 = Math.max(spd2, 0);

    this.vx = Math.cos(path) * spd2;
    this.vy = Math.sin(path) * spd2;

    this.x = wrapX(this.x + this.vx * dt, W);
    this.y += this.vy * dt;

    if (this.y < CFG.world.topY) {              // bounce off the hard ceiling
      this.y = CFG.world.topY;
      if (this.vy < 0) this.vy *= -0.25;
    }

    // ── Weapons ──
    this.gunCool -= dt;
    this.bombCool -= dt;
    this.muzzle = Math.max(0, this.muzzle - dt);
    if (this.controls.fire && this.gunCool <= 0) {
      this.gunCool = CFG.gun.cooldown / this.fireRate;
      this.muzzle = 0.05;
      game.spawnBullet(this);
    }
    if (this.controls.bomb && this.bombs > 0 && this.bombCool <= 0) {
      this.bombs--;
      this.bombCool = 0.28;
      game.spawnBomb(this);
    }
    this.controls.bomb = false;

    // ── Cosmetics ──
    this.propPhase = (this.propPhase + dt * 42) % TAU;
    if (this.hp < this.maxHp * 0.45) {
      this.smokeAcc += dt;
      const every = this.hp < this.maxHp * 0.2 ? 0.035 : 0.08;
      const tx = Math.cos(this.angle) * 16;
      const ty = Math.sin(this.angle) * 16;
      while (this.smokeAcc > every) {
        this.smokeAcc -= every;
        game.fx.smoke(this.x - tx, this.y - ty, this.vx * 0.2, this.vy * 0.2, this.hp < this.maxHp * 0.2);
      }
    }
  }

  /** Muzzle position in world space. */
  nose(out = {}) {
    out.x = this.x + Math.cos(this.angle) * CFG.gun.muzzle;
    out.y = this.y + Math.sin(this.angle) * CFG.gun.muzzle;
    return out;
  }

  damage(amount, game, byPlayer) {
    if (!this.alive) return false;
    this.hp -= amount;
    game.fx.spark(this.x + rand(-8, 8), this.y + rand(-8, 8));
    if (this.hp <= 0) {
      this.alive = false;
      game.onPlaneDown(this, byPlayer);
      return true;
    }
    return false;
  }
}
