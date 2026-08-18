import { CFG } from './config.js';
import { missionFor } from './missions.js';
import { clamp, rand, chance, ringDelta, hypot, wrapX } from './util.js';
import { Plane } from './plane.js';
import { Pilot } from './ai.js';
import { Bullet, Bomb } from './projectiles.js';
import { Effects } from './effects.js';
import { World } from './world.js';
import { Renderer } from './render.js';
import { Sfx } from './audio.js';
import { initInput, resetInput, state as input, takeBomb } from './input.js';

const STEP = 1 / 60;
const el = (id) => document.getElementById(id);

class Game {
  constructor() {
    this.canvas = el('game');
    this.renderer = new Renderer(this.canvas);
    this.audio = new Sfx();
    this.fx = new Effects();
    this.world = new World();

    this.state = 'menu';                 // menu | playing | dying | paused | over
    this.time = 0;
    this.acc = 0;
    this.last = performance.now();

    this.player = null;
    this.enemies = [];
    this.bullets = [];
    this.bombs = [];
    this.flak = [];

    this.level = 1;
    this.mission = missionFor(1);
    this.spec = this.mission.skill;
    this.score = 0;
    this.kills = 0;
    this.toSpawn = 0;
    this.spawnTimer = 0;
    this.missionEnd = 0;
    this.deathTimer = 0;
    this.deathReason = '';
    this.msgTimer = 0;

    this.hud = {
      score: el('hud-score'), wave: el('hud-wave'), alt: el('hud-alt'),
      hp: el('hud-hp'), bombs: el('hud-bombs'), msg: el('hud-msg'),
      obj: el('hud-obj'), prog: el('hud-prog'),
      shown: { score: -1, wave: -1, alt: -1, hp: -1, bombs: -1, obj: '', prog: '' },
    };

    this.best = Number(localStorage.getItem('pf-best') || 0);
    el('best-score').textContent = this.best;

    this.bindUi();
    initInput();

    addEventListener('resize', () => this.renderer.resize());
    addEventListener('orientationchange', () => setTimeout(() => this.renderer.resize(), 250));
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.state === 'playing') this.pause();
    });

    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
  }

  // ── UI plumbing ───────────────────────────────────────────

  bindUi() {
    el('btn-start').addEventListener('click', () => this.start());
    el('btn-again').addEventListener('click', () => this.start());
    el('btn-resume').addEventListener('click', () => this.resume());
    el('btn-quit').addEventListener('click', () => this.toMenu());
    el('btn-pause').addEventListener('click', () => this.pause());
    const mute = el('btn-mute');
    const paint = () => mute.classList.toggle('off', this.audio.muted);
    paint();
    mute.addEventListener('click', () => { this.audio.unlock(); this.audio.toggleMute(); paint(); });

    addEventListener('keydown', (e) => {
      if (e.code === 'KeyP' || e.code === 'Escape') {
        if (this.state === 'playing') this.pause();
        else if (this.state === 'paused') this.resume();
      }
      if (e.code === 'Enter' || e.code === 'NumpadEnter') {
        if (this.state === 'menu' || this.state === 'over') this.start();
      }
    });
  }

  show(id, on) { el(id).classList.toggle('hide', !on); }

  screens({ overlay = false, pause = false, over = false, playing = false }) {
    this.show('overlay', overlay);
    this.show('pause-screen', pause);
    this.show('over-screen', over);
    this.show('hud', playing);
    this.show('controls', playing);
  }

  message(text, seconds = 2) {
    this.hud.msg.textContent = text;
    this.hud.msg.classList.add('show');
    this.msgTimer = seconds;
  }

  // ── Lifecycle ─────────────────────────────────────────────

  start() {
    this.audio.unlock();
    this.audio.startEngine();
    this.world.reset();
    this.fx.clear();
    this.enemies.length = 0;
    this.bullets.length = 0;
    this.bombs.length = 0;
    this.flak.length = 0;
    resetInput();

    this.score = 0;
    this.kills = 0;
    this.level = 0;
    this.time = 0;
    this.acc = 0;
    this.deathTimer = 0;

    const x = rand(0, CFG.world.width);
    this.player = new Plane({
      x, y: this.world.groundAt(x) - 560, angle: 0, side: 'player', kind: 'player',
      bombs: CFG.bomb.max,
    });
    this.renderer.camX = this.player.x;
    this.renderer.camY = this.player.y;

    this.state = 'playing';
    this.screens({ playing: true });
    this.nextLevel();
    this.syncHud(true);
  }

  toMenu() {
    this.state = 'menu';
    this.audio.stopEngine();
    resetInput();
    el('best-score').textContent = this.best;
    this.screens({ overlay: true });
  }

  pause() {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.audio.stopEngine();
    resetInput();
    this.screens({ pause: true, playing: true });
  }

  resume() {
    if (this.state !== 'paused') return;
    this.state = 'playing';
    this.audio.unlock();
    this.audio.startEngine();
    this.last = performance.now();
    this.screens({ playing: true });
  }

  gameOver(reason) {
    this.state = 'over';
    this.audio.stopEngine();
    resetInput();
    const isBest = this.score > this.best;
    if (isBest) {
      this.best = this.score;
      localStorage.setItem('pf-best', String(this.best));
    }
    el('over-title').textContent =
      reason === 'crash' ? 'CRASHED' : reason === 'failed' ? 'MISSION FAILED' : 'SHOT DOWN';
    el('over-sub').textContent = reason === 'failed' ? this.mission.title : '';
    el('over-score').textContent = this.score;
    el('over-wave').textContent = this.level;
    el('over-kills').textContent = this.kills;
    this.show('over-best', isBest);
    this.screens({ over: true });
  }

  // ── Missions ──────────────────────────────────────────────

  nextLevel() {
    this.level++;
    const m = missionFor(this.level);
    this.mission = m;
    this.spec = m.skill;

    // Make sure the sector actually holds what the objective asks for.
    this.world.reinforce(2);
    if (m.needs) for (const [type, n] of Object.entries(m.needs)) this.world.ensure(type, n);

    this.progress = 0;
    this.escaped = 0;
    this.missionTime = 0;
    this.missionEnd = 0;
    this.missionBonus = false;
    this.acesLeft = m.aces;
    this.bombersLeft = m.bombers;
    // Primary opposition that has to be spawned. Ground objectives spawn none
    // up front; they get a standing patrol instead.
    this.toSpawn = m.type === 'sweep' ? Math.max(0, m.goal - m.aces) : 0;
    this.spawnTimer = 1.1;

    this.message(m.title, 2.4);
    this.briefAt = this.time + 2.5;
    this.briefFor = m.level;
  }

  /** Objective progress, and the win/lose test. Called once per step. */
  updateMission(dt) {
    const m = this.mission;
    this.missionTime += dt;

    if (this.briefFor === m.level && this.briefAt && this.time >= this.briefAt) {
      this.briefAt = 0;
      this.message(m.brief, 2.6);
    }

    if (m.isTimed) this.progress = Math.min(m.goal, this.missionTime);

    // ── Bombers reaching their target ──
    if (m.bombers) {
      for (const e of this.enemies) {
        if (e.kind !== 'bomber' || !e.ai || !e.ai.escaped || e.counted) continue;
        e.counted = true;
        e.alive = false;
        this.escaped++;
        this.fx.smoke(e.x, e.y, 0, -20);
        this.message('BOMBER ESCAPED', 1.4);
      }
    }

    // ── Failure ──
    if (m.timeLimit && this.missionTime > m.timeLimit && this.progress < m.goal) {
      this.message('OUT OF TIME', 2);
      this.playerDown('failed');
      return;
    }
    if (m.type === 'intercept' && this.escaped > m.allowEscape) {
      this.message('BOMBERS GOT THROUGH', 2);
      this.playerDown('failed');
      return;
    }

    // ── Spawning ──
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      const fighters = this.enemies.filter((e) => e.kind !== 'bomber').length;
      if (this.toSpawn > 0 && fighters < this.spec.maxAlive) {
        this.spawnTimer = CFG.enemy.spawnGap * rand(0.7, 1.3);
        this.spawnFighter();
      } else if (this.acesLeft > 0 && this.enemies.length < this.spec.maxAlive) {
        this.spawnTimer = CFG.enemy.spawnGap * rand(0.9, 1.6);
        this.acesLeft--;
        this.spawnFighter(true);
      } else if (this.bombersLeft > 0) {
        this.spawnTimer = rand(3.5, 6);
        this.bombersLeft--;
        this.spawnBomber();
      } else if (m.fighters && fighters < m.fighters && this.progress < m.goal) {
        // Standing patrol: keeps pressure on during ground objectives.
        this.spawnTimer = CFG.enemy.spawnGap * rand(1.4, 2.4);
        this.spawnFighter();
      }
    }

    // ── Completion ──
    const cleared = this.progress >= m.goal
      && !(m.type === 'intercept' && this.enemies.some((e) => e.kind === 'bomber'));
    if (!cleared) return;

    this.missionEnd += dt;
    if (!this.missionBonus) {
      this.missionBonus = true;
      const bonus = CFG.score.mission + this.level * 25;
      this.score += bonus;
      this.message(`OBJECTIVE COMPLETE  +${bonus}`, 2.4);
      this.audio.chime();
    }
    if (this.missionEnd > 2.8) {
      const p = this.player;
      if (p) {
        p.hp = Math.min(p.maxHp, p.hp + 28);
        p.bombs = CFG.bomb.max;
      }
      this.nextLevel();
    }
  }

  /** Credit objective progress for a kill or a demolished structure. */
  credit(what, kind) {
    const m = this.mission;
    if (this.progress >= m.goal) return;
    const hit =
      (m.type === 'sweep' && what === 'plane' && kind !== 'bomber') ||
      (m.type === 'duel' && what === 'plane' && kind === 'ace') ||
      (m.type === 'intercept' && what === 'plane' && kind === 'bomber') ||
      (m.type === 'balloons' && what === 'balloon') ||
      (m.type === 'raid' && (what === 'depot' || what === 'hangar')) ||
      (m.type === 'flak' && what === 'aa');
    if (hit) this.progress++;
  }

  spawnFighter(forceAce = false) {
    const p = this.player;
    const side = chance(0.5) ? 1 : -1;
    const dist = this.renderer.viewW * 0.55 + rand(80, 260);
    const x = wrapX(p.x + side * dist, CFG.world.width);
    const ground = this.world.groundAt(x);
    const y = clamp(p.y + rand(-260, 200), CFG.world.ceiling + 60, ground - 220);
    const ace = forceAce;

    const e = new Plane({
      x, y,
      angle: side > 0 ? Math.PI : 0,
      side: 'enemy',
      kind: ace ? 'ace' : 'enemy',
      hp: CFG.enemy.hp * (ace ? CFG.enemy.aceHp : 1),
      speed: CFG.plane.cruise * this.spec.speed,
      power: this.spec.speed * (ace ? 1.08 : 1),
      agility: this.spec.agility * (ace ? 1.12 : 1),
      fireRate: CFG.gun.enemyFireRate * (ace ? 1.25 : 1),
    });
    e.ai = new Pilot(e, ace
      ? { ...this.spec, aim: Math.min(0.9, this.spec.aim + 0.12), reaction: this.spec.reaction * 0.7 }
      : this.spec);
    this.enemies.push(e);
    if (!forceAce && this.toSpawn > 0) this.toSpawn--;
  }

  spawnBomber() {
    const p = this.player;
    const side = chance(0.5) ? 1 : -1;
    const x = wrapX(p.x + side * (this.renderer.viewW * 0.7 + rand(120, 400)), CFG.world.width);
    const ground = this.world.groundAt(x);
    const y = clamp(p.y + rand(-320, -60), CFG.world.ceiling + 80, ground - 420);
    const heading = side > 0 ? Math.PI : 0;      // headed across the sector
    const e = new Plane({
      x, y,
      angle: heading,
      side: 'enemy',
      kind: 'bomber',
      scale: 1.6,
      hp: CFG.enemy.hp * CFG.enemy.bomberHp,
      speed: CFG.plane.cruise * 0.78,
      power: 0.85,
      agility: 0.5,
    });
    e.ai = new Pilot(e, this.spec, {
      transit: true,
      heading,
      goalX: wrapX(x + (side > 0 ? -1 : 1) * CFG.world.width * 0.45, CFG.world.width),
    });
    this.enemies.push(e);
  }

  // ── Spawning projectiles (called by planes) ───────────────

  spawnBullet(plane) {
    const n = plane.nose();
    const spread = (Math.random() - 0.5) * CFG.gun.spread * 2 + (plane.side === 'enemy' ? (Math.random() - 0.5) * 0.05 : 0);
    const a = plane.angle + spread;
    this.bullets.push(new Bullet(
      n.x, n.y,
      plane.vx + Math.cos(a) * CFG.gun.speed,
      plane.vy + Math.sin(a) * CFG.gun.speed,
      plane.side,
    ));
    this.fx.muzzle(n.x, n.y);
    if (plane.side === 'player') this.audio.gun();
    else if (this.nearPlayer(plane, 620) && chance(0.55)) this.audio.gun();
  }

  spawnBomb(plane) {
    // Off the belly, which is set by the airframe's roll rather than its
    // heading — so an inverted plane really does drop upward, then gravity wins.
    const drop = plane.angle + Math.PI / 2 * plane.roll;
    this.bombs.push(new Bomb(
      plane.x + Math.cos(drop) * 12,
      plane.y + Math.sin(drop) * 12,
      plane.vx * 0.95,
      plane.vy * 0.95 + 20,
      plane.side,
    ));
    if (plane.side === 'player') this.audio.bombDrop();
  }

  nearPlayer(obj, r) {
    const p = this.player;
    if (!p) return false;
    return hypot(ringDelta(p.x, obj.x, CFG.world.width), obj.y - p.y) < r;
  }

  // ── Simulation ────────────────────────────────────────────

  step(dt) {
    this.time += dt;
    const W = CFG.world.width;
    const p = this.player;

    if (this.state === 'playing' && p && p.alive) {
      p.controls.pitch = input.pitch;
      p.controls.fire = input.fire;
      if (takeBomb()) {
        if (p.bombs > 0) p.controls.bomb = true;
        else this.message('NO BOMBS', 0.8);
      }
      this.audio.engine(p.speed);
    }

    if (p) p.update(dt, this);
    for (const e of this.enemies) {
      if (e.ai) e.ai.update(dt, p && p.alive ? p : null, this);
      e.update(dt, this);
    }

    for (const b of this.bullets) b.update(dt);
    for (const b of this.bombs) b.update(dt);
    for (const f of this.flak) f.update(dt);
    this.world.update(dt, this);
    this.fx.update(dt);

    this.collide();

    // Reap the dead.
    this.bullets = this.bullets.filter((b) => !b.dead);
    this.bombs = this.bombs.filter((b) => !b.dead);
    this.flak = this.flak.filter((f) => !f.burst);
    this.enemies = this.enemies.filter((e) => e.alive);

    if (this.state === 'playing') this.updateMission(dt);

    if (this.state === 'dying') {
      this.deathTimer -= dt;
      if (this.deathTimer <= 0) this.gameOver(this.deathReason);
    }

    if (this.msgTimer > 0) {
      this.msgTimer -= dt;
      if (this.msgTimer <= 0) this.hud.msg.classList.remove('show');
    }
  }

  collide() {
    const W = CFG.world.width;
    const planes = this.player ? [this.player, ...this.enemies] : this.enemies;

    // ── Bullets ──
    for (const b of this.bullets) {
      if (b.dead) continue;
      if (b.y >= this.world.groundAt(b.x)) {
        b.dead = true;
        this.fx.smoke(b.x, b.y, 0, -20);
        continue;
      }
      for (const t of planes) {
        if (!t.alive || t.side === b.side) continue;
        const d = hypot(ringDelta(b.x, t.x, W), b.y - t.y);
        if (d < t.radius) {
          b.dead = true;
          const dmg = b.side === 'player' ? CFG.gun.dmg : CFG.gun.dmgEnemy;
          const killed = t.damage(dmg, this, b.side === 'player');
          if (!killed && this.nearPlayer(t, 700)) this.audio.hit();
          break;
        }
      }
      if (b.dead || b.side !== 'player') continue;
      const g = this.hitGroundTarget(b.x, b.y);
      if (g) {
        b.dead = true;
        this.damageTarget(g, CFG.gun.dmg);
      }
    }

    // ── Bombs ──
    for (const b of this.bombs) {
      if (b.dead) continue;
      let boom = b.y >= this.world.groundAt(b.x) - 2;
      if (!boom && this.hitGroundTarget(b.x, b.y, 6)) boom = true;
      if (!boom) {
        for (const t of planes) {
          if (!t.alive || t.side === b.side) continue;
          if (hypot(ringDelta(b.x, t.x, W), b.y - t.y) < t.radius + b.r) { boom = true; break; }
        }
      }
      if (boom) {
        b.dead = true;
        this.explodeBomb(b);
      }
    }

    // ── Flak bursts ──
    for (const f of this.flak) {
      if (!f.burst) continue;
      this.fx.explode(f.x, f.y, 0.7);
      if (this.nearPlayer(f, 900)) this.audio.explode(0.5);
      const p = this.player;
      if (p && p.alive) {
        const d = hypot(ringDelta(f.x, p.x, W), f.y - p.y);
        if (d < CFG.flak.blast) {
          const dmg = CFG.flak.dmg * (1 - d / CFG.flak.blast);
          if (p.damage(dmg, this, false)) this.playerDown('shot');
        }
      }
    }

    // ── Planes vs terrain, ceiling and each other ──
    for (const t of planes) {
      if (!t.alive) continue;
      if (t.y >= this.world.groundAt(t.x) - 8) {
        t.alive = false;
        this.onPlaneDown(t, false, true);
      }
    }
    const p = this.player;
    if (p && p.alive) {
      for (const e of this.enemies) {
        if (!e.alive) continue;
        if (hypot(ringDelta(p.x, e.x, W), p.y - e.y) < p.radius + e.radius - 6) {
          e.alive = false;
          this.onPlaneDown(e, true);
          if (p.damage(42, this, false)) this.playerDown('crash');
          this.fx.shake = 16;
        }
      }
      // Shooting a balloon or flying into one is a bad day for the balloon.
      const bal = this.hitGroundTarget(p.x, p.y, p.radius, ['balloon']);
      if (bal) {
        this.damageTarget(bal, 100);
        if (p.damage(18, this, false)) this.playerDown('crash');
      }
    }
  }

  /** Box/circle test against live ground installations. */
  hitGroundTarget(x, y, pad = 0, types = null) {
    const W = CFG.world.width;
    for (const t of this.world.targets) {
      if (!t.alive) continue;
      if (types && !types.includes(t.type)) continue;
      const dx = ringDelta(t.x, x, W);
      if (t.type === 'balloon') {
        if (hypot(dx, y - (t.y - 14)) < 24 + pad) return t;
        continue;
      }
      if (Math.abs(dx) < t.w / 2 + pad && y > t.y - t.h - pad && y < t.y + 6 + pad) return t;
    }
    return null;
  }

  damageTarget(t, dmg) {
    t.hp -= dmg;
    this.fx.spark(t.x + rand(-8, 8), t.y - rand(0, t.h));
    if (t.hp > 0) return;
    t.alive = false;
    const size = t.type === 'balloon' ? 1.5 : 1.7;
    this.fx.explode(t.x, t.y - (t.type === 'balloon' ? 14 : t.h / 2), size, t.type !== 'balloon');
    this.audio.explode(1.1);
    const pts = { aa: CFG.score.aa, balloon: CFG.score.balloon }[t.type] ?? CFG.score.depot;
    this.score += pts;
    this.credit(t.type);
    this.message(`+${pts}`, 0.7);
  }

  explodeBomb(b) {
    const W = CFG.world.width;
    const B = CFG.bomb;
    this.fx.explode(b.x, Math.min(b.y, this.world.groundAt(b.x)), 2, true);
    this.audio.explode(1.3);
    for (const t of this.world.targets) {
      if (!t.alive) continue;
      const d = hypot(ringDelta(b.x, t.x, W), b.y - t.y);
      if (d < B.blast) this.damageTarget(t, B.dmg * (1 - d / B.blast / 1.6));
    }
    const planes = this.player ? [this.player, ...this.enemies] : this.enemies;
    for (const t of planes) {
      if (!t.alive) continue;
      const d = hypot(ringDelta(b.x, t.x, W), b.y - t.y);
      if (d >= B.blast) continue;
      // Bombing from too low will singe your own wings, but only half as hard.
      const own = t.side === b.side ? 0.45 : 1;
      const dmg = B.dmg * (1 - d / B.blast) * own;
      const isPlayer = t === this.player;
      if (t.damage(dmg, this, !isPlayer) && isPlayer) this.playerDown('shot');
    }
  }

  /** Called from Plane.damage when hp hits zero, and on terrain impact. */
  onPlaneDown(plane, byPlayer, crashed = false) {
    this.fx.explode(plane.x, plane.y, plane.side === 'player' ? 2.4 : 1.8);
    this.audio.explode(plane.side === 'player' ? 1.4 : 1);
    if (plane.side === 'player') {
      this.playerDown(crashed ? 'crash' : 'shot');
      return;
    }
    this.kills++;
    const pts = plane.kind === 'ace' ? CFG.score.ace
      : plane.kind === 'bomber' ? CFG.score.bomber : CFG.score.plane;
    const award = Math.round(pts * (crashed ? 0.6 : 1));
    this.score += award;
    this.credit('plane', plane.kind);
    if (byPlayer || crashed) this.message(`+${award}`, 0.7);
  }

  playerDown(reason) {
    if (this.state === 'dying' || this.state === 'over') return;
    this.state = 'dying';
    this.deathReason = reason;
    this.deathTimer = 1.7;
    this.audio.stopEngine();
    resetInput();
    if (this.player) this.player.alive = false;
  }

  // ── HUD ───────────────────────────────────────────────────

  syncHud(force = false) {
    const h = this.hud;
    const s = h.shown;
    const p = this.player;
    if (force || s.score !== this.score) { h.score.textContent = this.score; s.score = this.score; }
    if (force || s.wave !== this.level) { h.wave.textContent = this.level; s.wave = this.level; }

    const m = this.mission;
    if (force || s.obj !== m.label) { h.obj.textContent = m.label; s.obj = m.label; }
    let prog;
    if (m.isTimed) {
      prog = `${Math.max(0, Math.ceil(m.goal - (this.missionTime || 0)))}s`;
    } else {
      prog = `${Math.min(this.progress || 0, m.goal)}/${m.goal}`;
      if (m.timeLimit) {
        const left = Math.max(0, Math.ceil(m.timeLimit - (this.missionTime || 0)));
        prog += `  ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
      }
      if (m.type === 'intercept' && m.allowEscape >= 0) prog += `  esc ${this.escaped || 0}/${m.allowEscape + 1}`;
    }
    if (force || s.prog !== prog) {
      h.prog.textContent = prog;
      const urgent = m.timeLimit && (m.timeLimit - (this.missionTime || 0)) < 15;
      h.prog.classList.toggle('urgent', !!urgent);
      s.prog = prog;
    }

    const alt = p ? Math.max(0, Math.round((this.world.groundAt(p.x) - p.y) / 10) * 10) : 0;
    if (force || s.alt !== alt) { h.alt.textContent = alt; s.alt = alt; }

    const hp = p ? clamp(p.hp / p.maxHp, 0, 1) : 0;
    if (force || Math.abs(hp - s.hp) > 0.005) {
      h.hp.style.width = `${(hp * 100).toFixed(1)}%`;
      h.hp.className = hp < 0.25 ? 'crit' : hp < 0.55 ? 'warn' : '';
      s.hp = hp;
    }

    const bombs = p ? p.bombs : 0;
    if (force || s.bombs !== bombs) {
      h.bombs.innerHTML = '';
      for (let i = 0; i < CFG.bomb.max; i++) {
        const pip = document.createElement('i');
        if (i >= bombs) pip.className = 'spent';
        h.bombs.appendChild(pip);
      }
      el('ctl-bomb').classList.toggle('empty', bombs === 0);
      s.bombs = bombs;
    }
  }

  // ── Main loop ─────────────────────────────────────────────

  loop(now) {
    requestAnimationFrame(this.loop);
    const dt = clamp((now - this.last) / 1000, 0, 0.1);
    this.last = now;

    if (this.state === 'playing' || this.state === 'dying') {
      this.acc += dt;
      let guard = 4;
      while (this.acc >= STEP && guard-- > 0) {
        this.step(STEP);
        this.acc -= STEP;
      }
      if (this.acc > STEP) this.acc = 0;
      if (this.player) this.renderer.updateCamera(this.player, dt, this.fx);
      this.renderer.draw(this);
      this.syncHud();
    } else if (this.state === 'menu') {
      // Slow attract-mode pan behind the title card.
      this.time += dt;
      this.fx.update(dt);
      this.renderer.camX = wrapX(this.renderer.camX + 42 * dt, CFG.world.width);
      this.renderer.camY = this.renderer.camBottom;
      this.renderer.shake = 0;
      this.renderer.draw(this);
    } else if (this.state === 'over') {
      this.time += dt;
      this.fx.update(dt);
      if (this.player) this.renderer.updateCamera(this.player, dt, this.fx);
      this.renderer.draw(this);
    }
  }
}

// Kick off once the DOM is parsed (module scripts are deferred already).
window.game = new Game();
