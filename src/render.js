import { CFG } from './config.js';
import { TAU, clamp, lerp, ringDelta, wrapX } from './util.js';

const W = () => CFG.world.width;

// Sky ramp, sampled by world y (index 0 = ceiling, last = ground haze).
const SKY = [
  [22, 52, 92],
  [46, 104, 156],
  [104, 160, 190],
  [176, 202, 208],
  [206, 200, 176],
];

function mix(a, b, t) {
  return [
    Math.round(lerp(a[0], b[0], t)),
    Math.round(lerp(a[1], b[1], t)),
    Math.round(lerp(a[2], b[2], t)),
  ];
}

function skyAt(y) {
  const t = clamp((y - CFG.world.topY) / (CFG.world.groundY - CFG.world.topY), 0, 1) * (SKY.length - 1);
  const i = Math.min(SKY.length - 2, Math.floor(t));
  return mix(SKY[i], SKY[i + 1], t - i);
}

const rgb = (c, a = 1) => (a >= 1 ? `rgb(${c[0]},${c[1]},${c[2]})` : `rgba(${c[0]},${c[1]},${c[2]},${a})`);

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.dpr = 1;
    this.cw = 0;
    this.ch = 0;
    this.scale = 1;
    this.camX = 0;
    this.camY = 0;
    this.viewW = 0;
    this.viewH = 0;
    this.shake = 0;
    this.resize();
  }

  resize() {
    const dpr = Math.min(devicePixelRatio || 1, 2.5);
    const cw = this.canvas.clientWidth || innerWidth;
    const ch = this.canvas.clientHeight || innerHeight;
    this.dpr = dpr;
    this.cw = cw;
    this.ch = ch;
    this.canvas.width = Math.round(cw * dpr);
    this.canvas.height = Math.round(ch * dpr);

    // Fit the intended vertical field of view, but never squeeze the
    // horizontal view below a usable width on very tall screens.
    let scale = ch / CFG.view.height;
    if (cw / scale < CFG.view.minWidth) scale = cw / CFG.view.minWidth;
    this.scale = scale;
    this.viewW = cw / scale;
    this.viewH = ch / scale;
  }

  /** Follow the player: lead the camera in the direction of flight. */
  updateCamera(player, dt, fx) {
    const lead = 0.45;
    const tx = player.x + player.vx * lead;
    // Sit the plane above centre. What matters is below it — ground targets,
    // falling bombs, enemies climbing at you — and the thumb controls live in
    // the bottom corners, so the extra room has to come from the middle band.
    const ty = player.y + player.vy * lead * 0.7 + this.viewH * 0.1;

    if (this.camX === 0 && this.camY === 0) { this.camX = tx; this.camY = ty; }
    const k = 1 - Math.exp(-4.5 * dt);
    this.camX += ringDelta(this.camX, tx, W()) * k;
    this.camY += (ty - this.camY) * k;
    this.camX = wrapX(this.camX, W());
    this.camY = clamp(this.camY, this.camTop, this.camBottom);
    this.shake = fx.shakeAmount;
  }

  /** Lowest the camera goes: keeps the horizon around 80% of screen height. */
  get camBottom() { return CFG.world.groundY - this.viewH * 0.3; }
  get camTop() { return Math.min(CFG.world.topY + this.viewH * 0.35, this.camBottom); }

  /** Screen-space x of a wrapped world x. */
  sx(x) { return (ringDelta(this.camX, x, W())) * this.scale + this.cw / 2; }
  sy(y) { return (y - this.camY) * this.scale + this.ch / 2; }

  begin() {
    const { ctx } = this;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.imageSmoothingEnabled = true;
  }

  /** Enter world space (call inside begin/end). */
  world() {
    const { ctx } = this;
    ctx.save();
    let sxo = 0, syo = 0;
    if (this.shake > 0.2) {
      sxo = (Math.random() - 0.5) * this.shake;
      syo = (Math.random() - 0.5) * this.shake;
    }
    ctx.translate(this.cw / 2 + sxo, this.ch / 2 + syo);
    ctx.scale(this.scale, this.scale);
    ctx.translate(-this.camX, -this.camY);
  }

  endWorld() { this.ctx.restore(); }

  // ── Background ───────────────────────────────────────────

  drawSky() {
    const { ctx } = this;
    const top = this.camY - this.viewH / 2;
    const bot = this.camY + this.viewH / 2;
    const g = ctx.createLinearGradient(0, 0, 0, this.ch);
    for (let i = 0; i <= 4; i++) {
      const t = i / 4;
      g.addColorStop(t, rgb(skyAt(lerp(top, bot, t))));
    }
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, this.cw, this.ch);

    // Sun with a lazy parallax so it reads as far away.
    const sunX = this.cw * 0.74 - (this.camX % W()) * 0.004 * this.scale;
    const sunY = this.sy(CFG.world.topY + 40) * 0.35 + 40;
    const gr = ctx.createRadialGradient(sunX, sunY, 4, sunX, sunY, 120);
    gr.addColorStop(0, 'rgba(255,246,214,0.95)');
    gr.addColorStop(0.25, 'rgba(255,232,170,0.35)');
    gr.addColorStop(1, 'rgba(255,232,170,0)');
    ctx.fillStyle = gr;
    ctx.fillRect(sunX - 130, sunY - 130, 260, 260);
  }

  /** Draw a terrain layer with parallax factor p (1 = same plane as play). */
  terrainLayer(terrain, p, py, fill, stroke) {
    const { ctx } = this;
    const span = this.viewW / p / 2 + 120;
    const step = 34 / p;
    ctx.beginPath();
    let first = true;
    for (let d = -span; d <= span; d += step) {
      const wx = this.camX + d;
      const x = this.camX + d * p;
      const y = this.camY + (terrain.at(wx) - this.camY) * py;
      if (first) { ctx.moveTo(x, y); first = false; } else ctx.lineTo(x, y);
    }
    const deep = this.camY + this.viewH;
    ctx.lineTo(this.camX + span * p, deep + 400);
    ctx.lineTo(this.camX - span * p, deep + 400);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 2 / this.scale;
      ctx.stroke();
    }
  }

  drawClouds(clouds) {
    const { ctx } = this;
    for (const c of clouds) {
      const p = c.depth;
      const dx = ringDelta(this.camX, c.x, W());
      const x = this.camX + dx * p;
      const y = this.camY + (c.y - this.camY) * p;
      if (Math.abs(dx * p) > this.viewW / 2 + 160) continue;
      ctx.globalAlpha = 0.16 + p * 0.5;
      ctx.fillStyle = '#ffffff';
      // One path for the whole cloud: filling blobs separately makes the
      // overlaps show as seams.
      ctx.beginPath();
      for (const b of c.blobs) {
        const bx = x + b.dx * p * 1.6;
        const by = y + b.dy * p * 1.6;
        const r = b.r * (0.6 + p);
        ctx.moveTo(bx + r, by);
        ctx.arc(bx, by, r, 0, TAU);
      }
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  drawGround(world) {
    const { ctx } = this;
    this.terrainLayer(world.far, 0.45, 0.82, 'rgba(96,120,120,0.55)');

    // Haze over the far ridge line pushes it back behind the playfield.
    const hz = ctx.createLinearGradient(0, CFG.world.groundY - 420, 0, CFG.world.groundY + 40);
    hz.addColorStop(0, 'rgba(206,208,196,0)');
    hz.addColorStop(1, 'rgba(210,206,186,0.5)');
    ctx.fillStyle = hz;
    ctx.fillRect(this.camX - this.viewW, CFG.world.groundY - 420, this.viewW * 2, 460);

    this.terrainLayer(world.terrain, 1, 1, '#5b6b46', '#404d31');

    // A band of lighter grass along the surface.
    const span = this.viewW / 2 + 80;
    ctx.beginPath();
    let first = true;
    for (let d = -span; d <= span; d += 30) {
      const wx = this.camX + d;
      const y = world.terrain.at(wx);
      if (first) { ctx.moveTo(this.camX + d, y); first = false; } else ctx.lineTo(this.camX + d, y);
    }
    for (let d = span; d >= -span; d -= 30) {
      ctx.lineTo(this.camX + d, world.terrain.at(this.camX + d) + 13);
    }
    ctx.closePath();
    ctx.fillStyle = '#6f8150';
    ctx.fill();

    // Shell craters / texture ticks.
    ctx.strokeStyle = 'rgba(40,50,30,0.35)';
    ctx.lineWidth = 1.4 / this.scale;
    for (let d = -span; d <= span; d += 24) {
      const wx = Math.floor((this.camX + d) / 24) * 24;
      if ((wx / 24) % 3) continue;
      const y = world.terrain.at(wx);
      ctx.beginPath();
      ctx.moveTo(wx, y + 4);
      ctx.lineTo(wx + 9, y + 4);
      ctx.stroke();
    }

    for (const s of world.scenery) {
      const dx = ringDelta(this.camX, s.x, W());
      if (Math.abs(dx) > span) continue;
      const x = this.camX + dx;
      if (s.k === 'tree') {
        ctx.fillStyle = '#3c4a2c';
        ctx.beginPath();
        ctx.moveTo(x - 6 * s.s, s.y + 2);
        ctx.lineTo(x, s.y - 26 * s.s);
        ctx.lineTo(x + 6 * s.s, s.y + 2);
        ctx.closePath();
        ctx.fill();
      } else {
        ctx.fillStyle = '#6a6f63';
        ctx.beginPath();
        ctx.ellipse(x, s.y, 7 * s.s, 4 * s.s, 0, 0, TAU);
        ctx.fill();
      }
    }
  }

  // ── Ground targets ───────────────────────────────────────

  drawTargets(world, time) {
    const { ctx } = this;
    for (const t of world.targets) {
      const dx = ringDelta(this.camX, t.x, W());
      if (Math.abs(dx) > this.viewW / 2 + 140) continue;
      const x = this.camX + dx;
      ctx.save();
      ctx.translate(x, t.y);
      if (!t.alive) this.drawWreck(t);
      else if (t.type === 'aa') this.drawAA(t);
      else if (t.type === 'depot') this.drawDepot(t);
      else if (t.type === 'hangar') this.drawHangar(t);
      else if (t.type === 'balloon') this.drawBalloon(t, time);
      ctx.restore();
    }
  }

  drawWreck(t) {
    const { ctx } = this;
    if (t.type === 'balloon') return;
    ctx.fillStyle = 'rgba(30,26,22,0.75)';
    ctx.beginPath();
    ctx.ellipse(0, 0, t.w * 0.6, 7, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#2b2622';
    for (let i = -2; i <= 2; i++) {
      ctx.fillRect(i * t.w * 0.2, -6 - (i % 2 ? 3 : 0), 5, 8);
    }
  }

  drawAA(t) {
    const { ctx } = this;
    ctx.fillStyle = '#5a5142';
    ctx.beginPath();
    ctx.moveTo(-t.w / 2, 0);
    ctx.lineTo(-t.w / 2 + 6, -14);
    ctx.lineTo(t.w / 2 - 6, -14);
    ctx.lineTo(t.w / 2, 0);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.3)';
    ctx.lineWidth = 1;
    ctx.stroke();
    // Barrel, kicking back when it fires.
    ctx.save();
    ctx.translate(0, -13);
    ctx.rotate(t.tilt - (t.recoil || 0) * 0.12);
    ctx.fillStyle = '#3b3a36';
    ctx.fillRect(-3, -4 - (t.recoil || 0) * 3, 30, 6);
    ctx.restore();
    ctx.fillStyle = '#464033';
    ctx.fillRect(-9, -18, 18, 6);
  }

  drawDepot(t) {
    const { ctx } = this;
    ctx.fillStyle = '#7a6a4e';
    ctx.fillRect(-t.w / 2, -t.h, t.w, t.h);
    ctx.fillStyle = '#8d7c5c';
    ctx.fillRect(-t.w / 2, -t.h, t.w, 5);
    ctx.strokeStyle = 'rgba(0,0,0,0.28)';
    ctx.lineWidth = 1;
    for (let i = 1; i < 3; i++) {
      ctx.beginPath();
      ctx.moveTo(-t.w / 2, -t.h + (t.h / 3) * i);
      ctx.lineTo(t.w / 2, -t.h + (t.h / 3) * i);
      ctx.stroke();
    }
    ctx.fillStyle = '#4b4030';
    ctx.fillRect(-t.w / 2 - 4, -6, t.w + 8, 6);
  }

  drawHangar(t) {
    const { ctx } = this;
    ctx.fillStyle = '#5f6660';
    ctx.beginPath();
    ctx.moveTo(-t.w / 2, 0);
    ctx.lineTo(-t.w / 2, -t.h * 0.55);
    ctx.quadraticCurveTo(0, -t.h * 1.5, t.w / 2, -t.h * 0.55);
    ctx.lineTo(t.w / 2, 0);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#2f3531';
    ctx.fillRect(-10, -t.h * 0.7, 20, t.h * 0.7);
    ctx.strokeStyle = 'rgba(0,0,0,0.25)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  drawBalloon(t, time) {
    const { ctx } = this;
    const sway = Math.sin(time * 0.7 + t.bob) * 5;
    ctx.strokeStyle = 'rgba(40,40,40,0.5)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(-sway * 0.5, t.anchorY - t.y);
    ctx.stroke();
    ctx.save();
    ctx.translate(sway * 0.2, 0);
    ctx.fillStyle = '#8d8f76';
    ctx.beginPath();
    ctx.ellipse(0, -14, 17, 25, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.beginPath();
    ctx.ellipse(-5, -20, 6, 12, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#4a4034';
    ctx.fillRect(-6, 6, 12, 8);
    ctx.restore();
  }

  // ── Aircraft ─────────────────────────────────────────────

  drawPlane(p) {
    const { ctx } = this;
    const dx = ringDelta(this.camX, p.x, W());
    if (Math.abs(dx) > this.viewW / 2 + 90 * (p.scale || 1)) return;
    const L = p.livery;
    ctx.save();
    ctx.translate(this.camX + dx, p.y);
    ctx.rotate(p.angle);
    // Fixed roll, so the aircraft genuinely flies inverted when it is inverted.
    // Mirroring on heading instead would right the plane as it crossed vertical
    // and invert the apparent control sense with it.
    ctx.scale(1, p.roll);
    if (p.scale !== 1) ctx.scale(p.scale, p.scale);

    // Propeller disc.
    const blur = 0.5 + 0.5 * Math.abs(Math.sin(p.propPhase));
    ctx.strokeStyle = `rgba(30,28,24,${0.35 + blur * 0.35})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(21, -11 * blur);
    ctx.lineTo(21, 11 * blur);
    ctx.stroke();

    // Tail feathers.
    ctx.fillStyle = L.wing;
    ctx.beginPath();
    ctx.moveTo(-16, -1);
    ctx.lineTo(-25, -11);
    ctx.lineTo(-19, -1);
    ctx.closePath();
    ctx.fill();
    ctx.fillRect(-26, -1.5, 14, 3);

    // Lower wing, then struts, then upper wing (reads as depth).
    ctx.fillStyle = L.wing;
    ctx.fillRect(-9, 5.5, 20, 3);
    ctx.strokeStyle = L.trim;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(-6, 5.5); ctx.lineTo(-7, -10);
    ctx.moveTo(8, 5.5); ctx.lineTo(9, -10);
    ctx.stroke();

    // Undercarriage.
    ctx.strokeStyle = L.trim;
    ctx.beginPath();
    ctx.moveTo(0, 6); ctx.lineTo(3, 13);
    ctx.moveTo(8, 6); ctx.lineTo(4, 13);
    ctx.stroke();
    ctx.fillStyle = '#26221c';
    ctx.beginPath();
    ctx.arc(3.5, 14, 3, 0, TAU);
    ctx.fill();

    // Fuselage.
    ctx.fillStyle = L.body;
    ctx.beginPath();
    ctx.moveTo(20, -3.5);
    ctx.lineTo(20, 3.5);
    ctx.lineTo(-4, 4.5);
    ctx.lineTo(-17, 2);
    ctx.lineTo(-17, -2);
    ctx.lineTo(-4, -5);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.fillRect(-17, 1.5, 37, 3);

    // Cowling + pilot.
    ctx.fillStyle = L.trim;
    ctx.fillRect(14, -4.5, 6, 9);
    ctx.fillStyle = '#1c1a16';
    ctx.beginPath();
    ctx.ellipse(1, -5.5, 3.4, 3, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = L.pilot;
    ctx.beginPath();
    ctx.arc(0.5, -7.5, 2.2, 0, TAU);
    ctx.fill();

    // Upper wing above the pilot's head.
    ctx.fillStyle = L.wing;
    ctx.fillRect(-11, -12.5, 24, 3.2);
    ctx.fillStyle = 'rgba(255,255,255,0.14)';
    ctx.fillRect(-11, -12.5, 24, 1.2);

    // National marking on the upper wing.
    ctx.fillStyle = L.mark;
    if (p.kind === 'player') {
      ctx.beginPath();
      ctx.arc(-4, -11, 2.6, 0, TAU);
      ctx.fill();
    } else {
      ctx.fillRect(-6.5, -12.2, 5.5, 1.4);
      ctx.fillRect(-4.6, -14, 1.6, 5);
    }

    if (p.muzzle > 0) {
      ctx.fillStyle = 'rgba(255,226,140,0.95)';
      ctx.beginPath();
      ctx.moveTo(21, -2.5);
      ctx.lineTo(32, 0);
      ctx.lineTo(21, 2.5);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  /** Dashed line showing roughly where the guns are pointing. */
  drawAimLine(p) {
    const { ctx } = this;
    const dx = ringDelta(this.camX, p.x, W());
    ctx.save();
    ctx.translate(this.camX + dx, p.y);
    ctx.rotate(p.angle);
    ctx.strokeStyle = 'rgba(255,255,255,0.22)';
    ctx.lineWidth = 1.2 / 1;
    ctx.setLineDash([5, 9]);
    ctx.beginPath();
    ctx.moveTo(26, 0);
    ctx.lineTo(150, 0);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  // ── Ordnance & particles ─────────────────────────────────

  drawBullets(bullets) {
    const { ctx } = this;
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    for (const b of bullets) {
      const dx = ringDelta(this.camX, b.x, W());
      if (Math.abs(dx) > this.viewW / 2 + 40) continue;
      const x = this.camX + dx;
      const pdx = ringDelta(b.x, b.px, W());
      ctx.strokeStyle = b.side === 'player' ? 'rgba(255,236,168,0.95)' : 'rgba(255,150,120,0.95)';
      ctx.beginPath();
      ctx.moveTo(x, b.y);
      ctx.lineTo(x + pdx, b.py);
      ctx.stroke();
    }
    ctx.lineCap = 'butt';
  }

  drawBombs(bombs) {
    const { ctx } = this;
    for (const b of bombs) {
      const dx = ringDelta(this.camX, b.x, W());
      if (Math.abs(dx) > this.viewW / 2 + 40) continue;
      ctx.save();
      ctx.translate(this.camX + dx, b.y);
      ctx.rotate(b.angle);
      ctx.fillStyle = '#3d3a33';
      ctx.beginPath();
      ctx.ellipse(0, 0, 8, 3.4, 0, 0, TAU);
      ctx.fill();
      ctx.fillStyle = '#6a6558';
      ctx.beginPath();
      ctx.moveTo(-7, 0);
      ctx.lineTo(-11, -4);
      ctx.lineTo(-11, 4);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }

  drawFlak(flak) {
    const { ctx } = this;
    for (const f of flak) {
      const dx = ringDelta(this.camX, f.x, W());
      if (Math.abs(dx) > this.viewW / 2 + 40) continue;
      const x = this.camX + dx;
      ctx.fillStyle = 'rgba(60,55,48,0.9)';
      ctx.beginPath();
      ctx.arc(x, f.y, 2.6, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = 'rgba(200,200,200,0.25)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x, f.y);
      ctx.lineTo(x - f.vx * 0.03, f.y - f.vy * 0.03);
      ctx.stroke();
    }
  }

  drawParticles(fx) {
    const { ctx } = this;
    for (const p of fx.list) {
      const dx = ringDelta(this.camX, p.x, W());
      if (Math.abs(dx) > this.viewW / 2 + 80) continue;
      const x = this.camX + dx;
      const t = clamp(p.life / p.max, 0, 1);
      switch (p.kind) {
        case 'smoke':
          ctx.fillStyle = `rgba(${p.tone},${p.tone},${p.tone - 6},${0.32 * t})`;
          ctx.beginPath();
          ctx.arc(x, p.y, p.r, 0, TAU);
          ctx.fill();
          break;
        case 'fire': {
          const c = t > 0.6 ? '255,238,170' : t > 0.3 ? '250,170,60' : '190,90,40';
          ctx.fillStyle = `rgba(${c},${0.75 * t})`;
          ctx.beginPath();
          ctx.arc(x, p.y, p.r, 0, TAU);
          ctx.fill();
          break;
        }
        case 'spark':
          ctx.fillStyle = `rgba(255,240,190,${t})`;
          ctx.fillRect(x - p.r / 2, p.y - p.r / 2, p.r, p.r);
          break;
        case 'debris':
          ctx.save();
          ctx.translate(x, p.y);
          ctx.rotate(p.ang);
          ctx.fillStyle = `rgba(46,42,36,${0.85 * t})`;
          ctx.fillRect(-p.r, -p.r * 0.5, p.r * 2, p.r);
          ctx.restore();
          break;
        case 'ring':
          ctx.strokeStyle = `rgba(255,240,200,${0.8 * t})`;
          ctx.lineWidth = 3 * t;
          ctx.beginPath();
          ctx.arc(x, p.y, p.r, 0, TAU);
          ctx.stroke();
          break;
        case 'flash':
          ctx.fillStyle = `rgba(255,230,150,${t})`;
          ctx.beginPath();
          ctx.arc(x, p.y, p.r, 0, TAU);
          ctx.fill();
          break;
      }
    }
  }

  // ── Screen-space overlays ────────────────────────────────

  /** Edge arrows for enemies outside the viewport. */
  drawOffscreenMarkers(game) {
    const { ctx } = this;
    const player = game.player;
    if (!player || !player.alive) return;
    const m = 26;
    for (const e of game.enemies) {
      if (!e.alive) continue;
      let x = this.sx(e.x);
      let y = this.sy(e.y);
      const inside = x > m && x < this.cw - m && y > m && y < this.ch - m;
      if (inside) continue;
      const cx = this.cw / 2;
      const cy = this.ch / 2;
      let ax = x - cx;
      let ay = y - cy;
      const len = Math.hypot(ax, ay) || 1;
      const limX = (this.cw / 2 - m) / Math.abs(ax || 0.001);
      const limY = (this.ch / 2 - m) / Math.abs(ay || 0.001);
      const k = Math.min(limX, limY);
      ax *= k; ay *= k;
      const dist = Math.hypot(ringDelta(player.x, e.x, W()), e.y - player.y);
      const a = clamp(1 - dist / 2200, 0.2, 0.85);
      ctx.save();
      ctx.translate(cx + ax, cy + ay);
      ctx.rotate(Math.atan2(ay, ax));
      ctx.fillStyle = e.kind === 'ace' ? `rgba(240,90,70,${a})` : `rgba(255,190,150,${a})`;
      ctx.beginPath();
      ctx.moveTo(9, 0);
      ctx.lineTo(-6, -6);
      ctx.lineTo(-6, 6);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      ctx.font = '700 9px ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = `rgba(20,28,36,${a * 0.55})`;
      ctx.fillText(Math.round(dist / 10), cx + ax + 1, cy + ay + 19);
      ctx.fillStyle = `rgba(255,225,205,${a})`;
      ctx.fillText(Math.round(dist / 10), cx + ax, cy + ay + 18);
    }
    ctx.textAlign = 'left';
  }

  drawWarnings(game) {
    const { ctx } = this;
    const p = game.player;
    if (!p || !p.alive) return;
    const alt = game.world.groundAt(p.x) - p.y;
    const msgs = [];
    if (p.stalling) msgs.push(['STALL', '#f0c05a']);
    if (alt < 180 && p.vy > 20) msgs.push(['PULL UP', '#e2543c']);
    if (p.y < CFG.world.ceiling + 40) msgs.push(['THIN AIR', '#9fd0e8']);
    if (!msgs.length) return;
    ctx.save();
    ctx.font = '700 13px ui-monospace, monospace';
    ctx.textAlign = 'center';
    const blink = 0.55 + 0.45 * Math.sin(game.time * 12);
    let y = this.ch * 0.62;
    for (const [text, color] of msgs) {
      ctx.globalAlpha = blink;
      ctx.fillStyle = color;
      ctx.fillText(text, this.cw / 2, y);
      y += 18;
    }
    ctx.restore();
  }

  /** Full frame. */
  draw(game) {
    this.begin();
    this.drawSky();
    this.world();
    this.drawClouds(game.world.clouds);
    this.drawGround(game.world);
    this.drawTargets(game.world, game.time);
    this.drawBombs(game.bombs);
    if (game.player && game.player.alive) this.drawAimLine(game.player);
    for (const e of game.enemies) if (e.alive) this.drawPlane(e);
    if (game.player && game.player.alive) this.drawPlane(game.player);
    this.drawFlak(game.flak);
    this.drawBullets(game.bullets);
    this.drawParticles(game.fx);
    this.endWorld();
    this.drawOffscreenMarkers(game);
    this.drawWarnings(game);
  }
}
