import { CFG } from './config.js';
import { rand, randInt, chance, clamp, wrapX, ringDelta, lerp } from './util.js';
import { Flak } from './projectiles.js';

const STEP = 60;                       // terrain sample spacing

/** Seamlessly wrapping heightmap built from a few sine layers. */
class Terrain {
  constructor(baseY, amp, layers) {
    this.baseY = baseY;
    this.n = Math.round(CFG.world.width / STEP);
    this.h = new Float32Array(this.n);
    for (let i = 0; i < this.n; i++) {
      const t = (i / this.n) * Math.PI * 2;
      let v = 0;
      for (const L of layers) v += Math.sin(t * L.k + L.phase) * L.a;
      this.h[i] = baseY - v * amp;
    }
  }
  /** Ground y at world x (linear interpolation between samples). */
  at(x) {
    const f = (wrapX(x, CFG.world.width) / STEP);
    const i = Math.floor(f);
    const a = this.h[i % this.n];
    const b = this.h[(i + 1) % this.n];
    return lerp(a, b, f - i);
  }
}

function makeLayers(count) {
  const layers = [];
  for (let i = 0; i < count; i++) {
    layers.push({ k: randInt(1, 3) + i * 2, a: 1 / (i + 1), phase: rand(0, Math.PI * 2) });
  }
  return layers;
}

export class World {
  constructor() { this.reset(); }

  reset() {
    const G = CFG.world.groundY;
    this.terrain = new Terrain(G, 46, makeLayers(4));
    this.far = new Terrain(G - 40, 120, makeLayers(3));
    this.targets = [];
    this.clouds = [];
    this.scenery = [];

    // ── Ground installations, spaced out around the ring. ──
    const slots = 12;
    for (let i = 0; i < slots; i++) {
      const x = ((i + rand(0.15, 0.85)) / slots) * CFG.world.width;
      const type = i % 3 === 0 ? 'aa' : chance(0.55) ? 'depot' : 'hangar';
      this.addGroundTarget(type, x);
    }
    for (let i = 0; i < 5; i++) {
      const x = rand(0, CFG.world.width);
      this.targets.push({
        type: 'balloon', x,
        y: this.terrain.at(x) - rand(230, 420),
        anchorY: this.terrain.at(x),
        w: 34, h: 46, hp: 18, maxHp: 18, alive: true, cool: 0,
        bob: rand(0, 6.3),
      });
    }

    // ── Trees and huts for parallax texture. ──
    for (let i = 0; i < 90; i++) {
      const x = rand(0, CFG.world.width);
      this.scenery.push({ x, y: this.terrain.at(x), k: chance(0.75) ? 'tree' : 'rock', s: rand(0.7, 1.4) });
    }

    // ── Clouds at several depths. ──
    for (let i = 0; i < 26; i++) {
      const depth = rand(0.35, 0.95);
      const blobs = [];
      const n = randInt(3, 6);
      for (let b = 0; b < n; b++) {
        blobs.push({ dx: rand(-1, 1) * 40, dy: rand(-0.5, 0.4) * 16, r: rand(16, 34) });
      }
      this.clouds.push({
        x: rand(0, CFG.world.width),
        y: rand(CFG.world.topY + 20, CFG.world.groundY - 260),
        depth, blobs,
      });
    }
  }

  addGroundTarget(type, x) {
    const y = this.terrain.at(x);
    const base = {
      aa: { w: 40, h: 30, hp: 34 },
      depot: { w: 52, h: 34, hp: 26 },
      hangar: { w: 74, h: 42, hp: 32 },
    }[type];
    this.targets.push({
      type, x, y, ...base, maxHp: base.hp, alive: true, cool: rand(1, 4), recoil: 0,
      tilt: rand(-0.5, -0.15),
    });
  }

  groundAt(x) { return this.terrain.at(x); }

  /**
   * Between waves the enemy rebuilds a few installations, so bombs always have
   * somewhere to go and the AA threat never disappears for good.
   */
  reinforce(count = 3) {
    const dead = this.targets.filter((t) => !t.alive);
    // Prefer bringing AA back first — it is what makes low passes dangerous.
    dead.sort((a, b) => (b.type === 'aa') - (a.type === 'aa') || Math.random() - 0.5);
    let n = 0;
    for (const t of dead) {
      if (n >= count) break;
      t.alive = true;
      t.hp = t.maxHp;
      t.cool = rand(1.5, 4);
      t.recoil = 0;
      if (t.type === 'balloon') {
        t.x = rand(0, CFG.world.width);
        t.anchorY = this.terrain.at(t.x);
        t.y = t.anchorY - rand(230, 420);
      }
      n++;
    }
    return n;
  }

  /** Live targets left — used for the wave bonus tally. */
  get liveTargets() { return this.targets.filter((t) => t.alive).length; }

  update(dt, game) {
    const player = game.player;
    const spec = game.spec;
    for (const t of this.targets) {
      if (!t.alive) continue;
      t.recoil = Math.max(0, (t.recoil || 0) - dt * 4);

      if (t.type === 'balloon') {
        t.bob += dt;
        t.y += Math.sin(t.bob * 0.8) * 6 * dt;
        continue;
      }
      if (t.type !== 'aa' || !player || !player.alive) continue;

      t.cool -= dt;
      const dx = ringDelta(t.x, player.x, CFG.world.width);
      const alt = t.y - player.y;
      if (t.cool <= 0 && Math.abs(dx) < 820 && alt > 130) {
        t.cool = rand(1.7, 3.2) * (1.25 - spec.aim * 0.4);
        t.recoil = 1;
        // Lead the player, badly at first and better as waves climb.
        const flight = clamp(alt / CFG.flak.speed, 0.4, 2.4);
        const err = (1 - spec.aim) * 260;
        const aimX = t.x + dx + player.vx * flight * spec.lead + rand(-err, err);
        const aimY = player.y + rand(-60, 60);
        const vx = ringDelta(t.x, aimX, CFG.world.width) / flight;
        game.flak.push(new Flak(t.x, t.y - 20, vx, -CFG.flak.speed, aimY));
        if (Math.abs(dx) < 700) game.audio.thump();
      }
    }
  }
}
