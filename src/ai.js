import { CFG } from './config.js';
import { clamp, rand, chance, ringDelta, angleDelta, hypot } from './util.js';

const GROUND_MARGIN = 240;
const CEIL_MARGIN = 90;
const UP = -Math.PI / 2;
const DOWN = Math.PI / 2;

/**
 * Enemy pilot. Steers with the same flight model the player uses, so anything
 * it does the player can do too. Decisions refresh on a reaction timer, which
 * is what makes early waves feel clumsy and late waves feel sharp.
 */
export class Pilot {
  constructor(plane, spec) {
    this.p = plane;
    this.spec = spec;
    this.state = 'engage';
    this.stateTime = 0;
    this.think = 0;
    this.desired = plane.angle;
    this.wantFire = false;
    this.weave = rand(0, 6);
    this.side = chance(0.5) ? 1 : -1;   // which way it prefers to break
  }

  update(dt, target, game) {
    const p = this.p;
    if (!p.alive) return;
    const c = p.controls;
    const spec = this.spec;
    this.stateTime += dt;
    this.weave += dt;

    // ── Reflexes that override the plan: don't fly into the dirt or the ceiling.
    const alt = p.altitude;
    if (alt < GROUND_MARGIN && p.vy > -40) {
      c.turn = p.steerTo(UP, 3);
      c.fire = false;
      if (this.state !== 'pullup') { this.state = 'pullup'; this.stateTime = 0; }
      return;
    }
    if (p.y < CFG.world.topY + CEIL_MARGIN && p.vy < 40) {
      c.turn = p.steerTo(DOWN, 2.4);
      c.fire = false;
      return;
    }
    if (this.state === 'pullup') { this.state = 'engage'; this.stateTime = 0; }

    if (!target || !target.alive) {
      c.turn = p.steerTo(p.facing > 0 ? 0 : Math.PI, 1.4);
      c.fire = false;
      return;
    }

    const W = CFG.world.width;
    const dx = ringDelta(p.x, target.x, W);
    const dy = target.y - p.y;
    const dist = hypot(dx, dy);

    // Are we in front of the enemy's guns? Break if so.
    const toSelf = Math.atan2(-dy, -dx);
    const threat = Math.abs(angleDelta(target.angle, toSelf)) < 0.5 && dist < 420;

    this.think -= dt;
    if (this.think <= 0) {
      this.think = spec.reaction * rand(0.7, 1.35);
      this.decide(dx, dy, dist, target, threat);
    }

    c.turn = p.steerTo(this.desired, 2.4 * spec.agility);
    c.fire = this.state === 'engage' && this.wantFire;
  }

  decide(dx, dy, dist, target, threat) {
    const p = this.p;
    const spec = this.spec;
    const hurt = p.hp < p.maxHp * 0.35;

    // ── State transitions ──
    if (this.state === 'break' || this.state === 'extend') {
      if (this.stateTime > (hurt ? 2.6 : 1.5) || dist > 700) {
        this.state = 'engage';
        this.stateTime = 0;
      }
    } else if (dist < 110 || (threat && chance(0.5 + (hurt ? 0.3 : 0))) || (hurt && chance(0.25))) {
      this.state = dist < 110 ? 'break' : 'extend';
      this.stateTime = 0;
      this.side = -this.side;
    }

    if (this.state === 'break') {
      // Hard turn across the attacker — a classic defensive barrel.
      this.desired = Math.atan2(-dy, -dx) + this.side * 1.1;
      this.wantFire = false;
      return;
    }
    if (this.state === 'extend') {
      // Run out, gain a little height, then come back around.
      this.desired = Math.atan2(-dy, -dx) - 0.35;
      this.wantFire = false;
      return;
    }

    // ── Pursuit with lead, degraded by wave skill. ──
    const t = clamp(dist / CFG.gun.speed, 0, 0.6) * spec.lead;
    const aimX = dx + (target.vx - p.vx) * t;
    const aimY = dy + (target.vy - p.vy) * t;
    let aim = Math.atan2(aimY, aimX);

    // Sloppier pilots wander around the solution instead of sitting on it.
    aim += Math.sin(this.weave * 1.7) * (1 - spec.aim) * 0.5;

    // Too slow to fight: trade height for speed before pressing the attack.
    if (p.speed < CFG.plane.stallSpeed * 1.6) {
      const sag = clamp(1 - p.speed / (CFG.plane.stallSpeed * 1.6), 0, 1);
      aim += angleDelta(aim, DOWN) * sag * 0.8;
    }

    this.desired = aim;

    const err = Math.abs(angleDelta(p.angle, Math.atan2(dy, dx)));
    const cone = 0.34 * (1.25 - spec.aim);
    this.wantFire = err < cone && dist < 560 && dist > 60;
  }
}
