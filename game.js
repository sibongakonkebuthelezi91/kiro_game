'use strict';

/* ═══════════════════════════════════════════════════════════
   BEAT HOP 3D  –  Rhythm Tile Game
   ─────────────────────────────────────────────────────────
   - 3D perspective rendering (vanishing point, depth-scaled tiles)
   - Points on every tile touch (+10 base × combo)
   - Instant game over when a tile is missed
   - Ball bounces continuously with drag-to-fling
   - Synthesized audio beats via Web Audio API
   ═══════════════════════════════════════════════════════════ */

/* ── CONSTANTS ────────────────────────────────────────────── */
const LANES          = 4;
const TILE_SPEED     = 0.0004;  // depth units per ms (tiles take ~2s to reach player)
const HIT_ZONE_DEPTH = 0.82;   // depth at which tiles should be tapped
const HIT_TOLERANCE  = 0.18;   // ± depth window for a valid hit (generous for responsive feel)
const SPAWN_INTERVAL_BASE = 500; // ms between tile spawns (scales with BPM)

/* 3D Perspective */
const VP_X = 0.5;   // vanishing point X (fraction of canvas width)
const VP_Y = 0.18;  // vanishing point Y (fraction of canvas height)
const ROAD_TOP    = 0.22;  // where road starts (fraction)
const ROAD_BOTTOM = 0.95;  // where road ends (fraction)
const ROAD_WIDTH_TOP    = 0.15;  // road width at vanishing point
const ROAD_WIDTH_BOTTOM = 0.92;  // road width at bottom

/* ── SONGS ────────────────────────────────────────────────── */
const SONGS = {
  bounce: {
    name: 'Bounce Beat', bpm: 120,
    color: ['#7c3aed','#06b6d4','#f472b6','#22d3ee'],
    pattern: [0,2,1,3, 0,2,1,3, 0,1,2,3, 3,2,1,0,
              0,3,1,2, 2,0,3,1, 0,0,2,2, 1,1,3,3,
              0,2,0,2, 1,3,1,3, 0,1,2,3, 3,2,1,0,
              0,2,1,3, 0,2,1,3, 2,3,0,1, 0,1,2,3],
  },
  groove: {
    name: 'Night Groove', bpm: 100,
    color: ['#f59e0b','#10b981','#3b82f6','#ec4899'],
    pattern: [0,2,1,3, 2,0,3,1, 1,3,0,2, 3,1,2,0,
              0,0,2,2, 1,1,3,3, 0,3,0,3, 1,2,1,2,
              0,1,2,3, 0,1,2,3, 3,2,1,0, 3,2,1,0,
              0,2,3,1, 2,0,1,3, 0,1,2,3, 1,0,3,2],
  },
  rush: {
    name: 'Drum Rush', bpm: 145,
    color: ['#ef4444','#f97316','#eab308','#84cc16'],
    pattern: [0,1,2,3,0,1,2,3, 0,2,1,3,2,0,3,1,
              0,0,1,1,2,2,3,3, 3,3,2,2,1,1,0,0,
              0,1,0,1,2,3,2,3, 0,3,1,2,0,3,1,2,
              0,1,2,3,3,2,1,0, 0,2,0,2,1,3,1,3],
  },
};

/* ── AUDIO ENGINE ─────────────────────────────────────────── */
class AudioEngine {
  constructor() {
    this.ctx = null;
  }

  init() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  playHit(lane) {
    if (!this.ctx) return;
    const freq = [261.63, 329.63, 392.00, 523.25][lane];
    const t = this.ctx.currentTime;

    const osc = this.ctx.createOscillator();
    const env = this.ctx.createGain();
    osc.connect(env); env.connect(this.ctx.destination);
    osc.type = 'sine';
    osc.frequency.value = freq;
    env.gain.setValueAtTime(0.22, t);
    env.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
    osc.start(t); osc.stop(t + 0.22);

    // Click
    const buf = this.ctx.createBuffer(1, this.ctx.sampleRate * 0.03, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (this.ctx.sampleRate * 0.005));
    }
    const src = this.ctx.createBufferSource();
    const g = this.ctx.createGain();
    src.buffer = buf; src.connect(g); g.connect(this.ctx.destination);
    g.gain.setValueAtTime(0.1, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.03);
    src.start(t);
  }

  playPerfect() {
    if (!this.ctx) return;
    [523.25, 659.25, 783.99].forEach((f, i) => {
      const t = this.ctx.currentTime + i * 0.04;
      const osc = this.ctx.createOscillator();
      const env = this.ctx.createGain();
      osc.connect(env); env.connect(this.ctx.destination);
      osc.type = 'triangle';
      osc.frequency.value = f;
      env.gain.setValueAtTime(0.1, t);
      env.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
      osc.start(t); osc.stop(t + 0.26);
    });
  }

  playMiss() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const env = this.ctx.createGain();
    osc.connect(env); env.connect(this.ctx.destination);
    osc.type = 'sawtooth';
    osc.frequency.value = 65;
    env.gain.setValueAtTime(0.2, t);
    env.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    osc.start(t); osc.stop(t + 0.32);
  }

  playGameOver() {
    if (!this.ctx) return;
    [180, 150, 120, 80].forEach((f, i) => {
      const t = this.ctx.currentTime + i * 0.12;
      const osc = this.ctx.createOscillator();
      const env = this.ctx.createGain();
      osc.connect(env); env.connect(this.ctx.destination);
      osc.type = 'sawtooth';
      osc.frequency.value = f;
      env.gain.setValueAtTime(0.12, t);
      env.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
      osc.start(t); osc.stop(t + 0.16);
    });
  }
}

/* ── PARTICLE SYSTEM ──────────────────────────────────────── */
class Particles {
  constructor() { this.list = []; }

  emit(x, y, color, count = 10) {
    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / count + Math.random() * 0.4;
      const speed = 60 + Math.random() * 140;
      this.list.push({
        x, y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 80,
        alpha: 1, size: 2 + Math.random() * 4,
        color, life: 0.4 + Math.random() * 0.3, age: 0,
      });
    }
  }

  update(dt) {
    this.list = this.list.filter(p => {
      p.age += dt; p.x += p.vx * dt; p.y += p.vy * dt;
      p.vy += 400 * dt;
      p.alpha = 1 - p.age / p.life;
      return p.age < p.life;
    });
  }

  draw(ctx) {
    this.list.forEach(p => {
      ctx.save();
      ctx.globalAlpha = Math.max(0, p.alpha);
      ctx.fillStyle = p.color;
      ctx.shadowColor = p.color;
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    });
  }
}

/* ── 3D TILE ──────────────────────────────────────────────── */
class Tile3D {
  constructor(lane, color) {
    this.lane  = lane;
    this.depth = 0;        // 0 = horizon, 1 = player
    this.color = color;
    this.hit   = false;
    this.flash = 0;
    this.missed = false;
  }
}

/* ── 3D BALL ──────────────────────────────────────────────── */
class Ball3D {
  constructor() {
    this.lane = 0;
    this.screenX = 0;
    this.screenY = 0;
    this.targetX = 0;
    this.bounceY = 0;     // offset from baseline
    this.vy = -400;
    this.radius = 20;
    this.glowColor = '#7c3aed';
    this.trail = [];

    // Drag
    this.dragging = false;
    this.dragStartX = 0;
    this.dragStartY = 0;
    this.dragCurX = 0;
    this.dragCurY = 0;
    this.vx = 0;
  }

  hop() {
    this.vy = -750;
  }

  update(dt, baseX, baseY, canvasW) {
    const GRAVITY = 1600;
    const RESTITUTION = 0.7;

    if (this.dragging) {
      this.screenX = this.dragCurX;
      this.screenY = this.dragCurY;
    } else {
      // Smooth X (fast snap, not sluggish)
      this.screenX += (this.targetX - this.screenX) * Math.min(1, dt * 40);
      this.screenX += this.vx * dt;
      this.vx *= 0.85;

      // Bounce Y
      this.vy += GRAVITY * dt;
      this.bounceY += this.vy * dt;

      if (this.bounceY >= 0) {
        this.bounceY = 0;
        this.vy = -Math.abs(this.vy) * RESTITUTION;
        if (Math.abs(this.vy) < 200) this.vy = -500;
      }

      this.screenY = baseY + this.bounceY;

      // Walls
      if (this.screenX < this.radius) { this.screenX = this.radius; this.vx = Math.abs(this.vx) * 0.5; }
      if (this.screenX > canvasW - this.radius) { this.screenX = canvasW - this.radius; this.vx = -Math.abs(this.vx) * 0.5; }
    }

    this.trail.unshift({ x: this.screenX, y: this.screenY });
    if (this.trail.length > 12) this.trail.pop();
  }

  startDrag(px, py) {
    const dist = Math.hypot(px - this.screenX, py - this.screenY);
    if (dist > this.radius * 4) return false;
    this.dragging = true;
    this.dragStartX = this.screenX;
    this.dragStartY = this.screenY;
    this.dragCurX = px;
    this.dragCurY = py;
    this.vx = 0; this.vy = 0;
    return true;
  }

  moveDrag(px, py) {
    if (!this.dragging) return;
    this.dragCurX = px;
    this.dragCurY = py;
  }

  endDrag(px, py) {
    if (!this.dragging) return;
    this.dragging = false;
    const dx = this.dragStartX - px;
    const dy = this.dragStartY - py;
    this.vx = dx * 3.5;
    this.vy = Math.min(-100, dy * 3.5);
    this.bounceY = -10;
  }

  draw(ctx) {
    // Trail
    this.trail.forEach((t, i) => {
      const alpha = (1 - i / this.trail.length) * 0.25;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = this.glowColor;
      ctx.beginPath();
      ctx.arc(t.x, t.y, this.radius * (1 - i * 0.06), 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    });

    // Drag arrow
    if (this.dragging) {
      const dx = this.dragStartX - this.dragCurX;
      const dy = this.dragStartY - this.dragCurY;
      const len = Math.hypot(dx, dy);
      if (len > 8) {
        ctx.save();
        ctx.strokeStyle = 'rgba(255,255,255,0.4)';
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 4]);
        ctx.beginPath();
        ctx.moveTo(this.screenX, this.screenY);
        ctx.lineTo(this.screenX + dx * 0.8, this.screenY + dy * 0.8);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
      }
    }

    // Shadow
    ctx.save();
    ctx.globalAlpha = 0.3;
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.ellipse(this.screenX, this.screenY + this.radius + 4, this.radius * 0.8, 4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Ball body (3D sphere gradient)
    ctx.save();
    ctx.shadowColor = this.glowColor;
    ctx.shadowBlur = 30;
    const grad = ctx.createRadialGradient(
      this.screenX - this.radius * 0.3, this.screenY - this.radius * 0.3, this.radius * 0.1,
      this.screenX, this.screenY, this.radius
    );
    grad.addColorStop(0, '#ffffff');
    grad.addColorStop(0.3, this.glowColor);
    grad.addColorStop(0.8, this._darken(this.glowColor, 0.4));
    grad.addColorStop(1, '#000000');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(this.screenX, this.screenY, this.radius, 0, Math.PI * 2);
    ctx.fill();

    // Specular
    ctx.globalAlpha = 0.6;
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.ellipse(this.screenX - 5, this.screenY - 6, this.radius * 0.3, this.radius * 0.18, -0.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  _darken(hex, amount) {
    const num = parseInt(hex.slice(1), 16);
    const r = Math.max(0, ((num >> 16) & 0xFF) * (1 - amount)) | 0;
    const g = Math.max(0, ((num >> 8) & 0xFF) * (1 - amount)) | 0;
    const b = Math.max(0, (num & 0xFF) * (1 - amount)) | 0;
    return `rgb(${r},${g},${b})`;
  }
}

/* ═══════════════════════════════════════════════════════════
   GAME – 3D Perspective Renderer
   ═══════════════════════════════════════════════════════════ */
class Game {
  constructor() {
    this.canvas = document.getElementById('game-canvas');
    this.ctx    = this.canvas.getContext('2d');

    this.audio     = new AudioEngine();
    this.particles = new Particles();
    this.ball      = new Ball3D();

    this.state          = 'menu';
    this.selectedSongKey = 'bounce';
    this.song           = null;

    // Gameplay
    this.tiles       = [];
    this.score       = 0;
    this.combo       = 1;
    this.bestCombo   = 1;
    this.totalHits   = 0;
    this.patternIdx  = 0;
    this.spawnTimer  = 0;

    // Timing
    this._lastTime = 0;
    this._rafId    = null;

    // Floating score labels
    this._floats = [];

    // DOM
    this._scoreEl    = document.getElementById('score-val');
    this._comboEl    = document.getElementById('combo-val');
    this._songHudEl  = document.getElementById('song-title-hud');
    this._beatBarEl  = document.getElementById('beat-indicator');
    this._feedbackEl = document.getElementById('feedback-container');

    this._bindUI();
    this._resize();
    window.addEventListener('resize', () => this._resize());
  }

  /* ── UI ───────────────────────────────────────────────────── */
  _bindUI() {
    document.querySelectorAll('.song-card').forEach(card => {
      card.addEventListener('click', () => {
        document.querySelectorAll('.song-card').forEach(c => c.classList.remove('selected'));
        card.classList.add('selected');
        this.selectedSongKey = card.dataset.song;
      });
    });

    document.getElementById('btn-play').addEventListener('click', () => this._startGame());
    document.getElementById('btn-pause').addEventListener('click', () => this._pause());
    document.getElementById('btn-resume').addEventListener('click', () => this._resume());
    document.getElementById('btn-menu-from-pause').addEventListener('click', () => this._goMenu());
    document.getElementById('btn-retry').addEventListener('click', () => this._startGame());
    document.getElementById('btn-menu-from-go').addEventListener('click', () => this._goMenu());

    // Pointer events for tap + drag
    this.canvas.addEventListener('pointerdown', e => this._onPointerDown(e));
    this.canvas.addEventListener('pointermove', e => this._onPointerMove(e));
    this.canvas.addEventListener('pointerup',   e => this._onPointerUp(e));
    this.canvas.addEventListener('pointerleave', e => this._onPointerUp(e));

    window.addEventListener('keydown', e => this._onKey(e));
  }

  _resize() {
    this.canvas.width  = this.canvas.offsetWidth  * window.devicePixelRatio;
    this.canvas.height = this.canvas.offsetHeight * window.devicePixelRatio;
    this.ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
    this.W = this.canvas.offsetWidth;
    this.H = this.canvas.offsetHeight;
  }

  _showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(id).classList.add('active');
  }

  /* ── GAME FLOW ────────────────────────────────────────────── */
  _startGame() {
    this.audio.init();
    this.song       = SONGS[this.selectedSongKey];
    this.tiles      = [];
    this.score      = 0;
    this.combo      = 1;
    this.bestCombo  = 1;
    this.totalHits  = 0;
    this.patternIdx = 0;
    this.spawnTimer = 0;
    this._floats    = [];
    this.state      = 'playing';

    this._scoreEl.textContent = '0';
    this._comboEl.textContent = 'x1';
    this._songHudEl.textContent = this.song.name;

    this.ball.lane = 1;
    this.ball.glowColor = this.song.color[1];
    this.ball.bounceY = 0;
    this.ball.vy = -400;
    this.ball.vx = 0;
    this.ball.trail = [];

    this._showScreen('screen-game');
    cancelAnimationFrame(this._rafId);

    // Place the first tile at the hit zone — ball starts on it, waiting for player
    const firstLane = this.song.pattern[0];
    this.patternIdx = 1;
    const firstTile = new Tile3D(firstLane, this.song.color[firstLane]);
    firstTile.depth = HIT_ZONE_DEPTH; // sits right at hit zone
    this.tiles.push(firstTile);

    // Position ball directly on the first tile
    this.ball.lane = firstLane;
    this.ball.glowColor = this.song.color[firstLane];
    const pos = this._depthToScreen(HIT_ZONE_DEPTH, firstLane);
    this.ball.targetX = pos.cx;
    this.ball.screenX = pos.cx;
    this.ball.screenY = pos.cy - 30;
    this.ball.bounceY = 0;
    this.ball.vy = -750; // start with a big hop off the first tile
    this.ball.vx = 0;

    // Don't spawn more tiles until the first one is hit — use a flag
    this._waitingForFirstHit = true;

    this._lastTime = performance.now();
    this._rafId = requestAnimationFrame(t => this._loop(t));
  }

  _pause() {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this._showScreen('screen-pause');
  }

  _resume() {
    if (this.state !== 'paused') return;
    this.state = 'playing';
    this._showScreen('screen-game');
    this._lastTime = performance.now();
    this._rafId = requestAnimationFrame(t => this._loop(t));
  }

  _goMenu() {
    this.state = 'menu';
    cancelAnimationFrame(this._rafId);
    this._showScreen('screen-menu');
  }

  _gameOver() {
    this.state = 'gameover';
    cancelAnimationFrame(this._rafId);
    this.audio.playGameOver();

    document.getElementById('go-score').textContent = this.score;
    document.getElementById('go-combo').textContent = `Best Combo: x${this.bestCombo}`;

    const gradeEl = document.getElementById('go-grade');
    let grade, cls;
    if (this.score >= 5000)      { grade = 'S'; cls = 'grade-S'; }
    else if (this.score >= 3000) { grade = 'A'; cls = 'grade-A'; }
    else if (this.score >= 1500) { grade = 'B'; cls = 'grade-B'; }
    else                         { grade = 'C'; cls = 'grade-C'; }
    gradeEl.textContent = grade;
    gradeEl.className   = `grade ${cls}`;

    document.getElementById('go-title').textContent = this.score >= 3000 ? '🎉 Well Done!' : '💀 Game Over';
    this._showScreen('screen-gameover');
  }

  /* ── MAIN LOOP ────────────────────────────────────────────── */
  _loop(timestamp) {
    if (this.state !== 'playing') return;
    const dt = Math.min((timestamp - this._lastTime) / 1000, 0.05);
    this._lastTime = timestamp;

    this._update(dt);
    this._draw();
    this._rafId = requestAnimationFrame(t => this._loop(t));
  }

  /* ── UPDATE ───────────────────────────────────────────────── */
  _update(dt) {
    const spawnInterval = (60 / this.song.bpm) * 1000; // ms per beat

    /* If waiting for first hit, hold the first tile in place and don't spawn more */
    if (this._waitingForFirstHit) {
      // Keep the first tile locked at hit zone
      if (this.tiles.length > 0 && !this.tiles[0].hit) {
        this.tiles[0].depth = HIT_ZONE_DEPTH;
      }
      // Ball still bounces
      const hitZoneScreen = this._depthToScreen(HIT_ZONE_DEPTH, this.ball.lane);
      this.ball.targetX = hitZoneScreen.cx;
      this.ball.update(dt, hitZoneScreen.cx, hitZoneScreen.cy - 30, this.W);
      this.particles.update(dt);
      this._floats = this._floats.filter(f => {
        f.age += dt; f.y -= 60 * dt; f.alpha = 1 - f.age / f.life;
        return f.age < f.life;
      });
      return;
    }

    /* Spawn tiles */
    this.spawnTimer += dt * 1000;
    while (this.spawnTimer >= spawnInterval) {
      this.spawnTimer -= spawnInterval;
      const lane = this.song.pattern[this.patternIdx % this.song.pattern.length];
      this.patternIdx++;
      const tile = new Tile3D(lane, this.song.color[lane]);
      this.tiles.push(tile);
    }

    /* Move tiles toward player */
    for (let i = this.tiles.length - 1; i >= 0; i--) {
      const tile = this.tiles[i];
      if (tile.hit) {
        tile.flash -= dt;
        if (tile.flash <= 0) { this.tiles.splice(i, 1); }
        continue;
      }
      tile.depth += TILE_SPEED * dt * 1000;

      /* MISS: tile passed hit zone → GAME OVER
         But only after player has successfully hit at least 3 tiles */
      if (tile.depth > HIT_ZONE_DEPTH + 0.22) {
        if (this.totalHits < 3) {
          // Forgive early misses — just remove the tile
          this.tiles.splice(i, 1);
        } else {
          tile.missed = true;
          this.audio.playMiss();
          this._gameOver();
          return;
        }
      }
    }

    /* Ball */
    const hitZoneScreen = this._depthToScreen(HIT_ZONE_DEPTH, this.ball.lane);
    this.ball.targetX = hitZoneScreen.cx;
    this.ball.update(dt, hitZoneScreen.cx, hitZoneScreen.cy - 30, this.W);

    /* Particles */
    this.particles.update(dt);

    /* Floating scores */
    this._floats = this._floats.filter(f => {
      f.age += dt;
      f.y -= 60 * dt;
      f.alpha = 1 - f.age / f.life;
      return f.age < f.life;
    });

    /* Progress bar */
    const progress = Math.min(100, (this.patternIdx / this.song.pattern.length) * 100);
    this._beatBarEl.style.width = progress + '%';

    /* Song finished? Repeat pattern endlessly — game only ends on miss */
  }

  /* ── 3D PROJECTION ────────────────────────────────────────── */
  _depthToScreen(depth, lane) {
    /* depth: 0 = horizon, 1 = closest to player */
    const W = this.W;
    const H = this.H;
    const vpx = W * VP_X;
    const vpy = H * VP_Y;

    // Y position interpolates from road top to road bottom
    const y = vpy + (H * ROAD_BOTTOM - vpy) * Math.pow(depth, 0.8);

    // Road width at this depth
    const widthTop = W * ROAD_WIDTH_TOP;
    const widthBot = W * ROAD_WIDTH_BOTTOM;
    const roadW = widthTop + (widthBot - widthTop) * Math.pow(depth, 0.8);

    // Lane positioning
    const laneW = roadW / LANES;
    const roadLeft = vpx - roadW / 2;
    const laneX = roadLeft + lane * laneW;

    // Tile height scales with depth (big and visible)
    const tileH = 24 + 100 * Math.pow(depth, 1.1);

    return {
      x: laneX,
      y: y - tileH / 2,
      w: laneW,
      h: tileH,
      cx: laneX + laneW / 2,
      cy: y,
      scale: Math.pow(depth, 0.8),
      roadLeft,
      roadW,
    };
  }

  /* ── DRAW ─────────────────────────────────────────────────── */
  _draw() {
    const ctx = this.ctx;
    const W = this.W;
    const H = this.H;

    // Clear
    ctx.clearRect(0, 0, W, H);

    // Sky gradient
    const skyGrad = ctx.createLinearGradient(0, 0, 0, H * 0.4);
    skyGrad.addColorStop(0, '#0a0014');
    skyGrad.addColorStop(1, '#0d0d24');
    ctx.fillStyle = skyGrad;
    ctx.fillRect(0, 0, W, H * 0.4);

    // Road / ground
    this._drawRoad(ctx, W, H);

    // Draw tiles sorted by depth (far first)
    const sorted = [...this.tiles].sort((a, b) => a.depth - b.depth);
    sorted.forEach(tile => this._drawTile3D(ctx, tile));

    // Hit zone indicator
    this._drawHitZone(ctx, W, H);

    // Particles
    this.particles.draw(ctx);

    // Ball
    this.ball.draw(ctx);

    // Floating scores
    this._floats.forEach(f => {
      ctx.save();
      ctx.globalAlpha = Math.max(0, f.alpha);
      ctx.fillStyle = f.color;
      ctx.font = `bold ${f.size}px 'Segoe UI', sans-serif`;
      ctx.textAlign = 'center';
      ctx.shadowColor = f.color;
      ctx.shadowBlur = 8;
      ctx.fillText(f.text, f.x, f.y);
      ctx.restore();
    });
  }

  _drawRoad(ctx, W, H) {
    const vpx = W * VP_X;
    const vpy = H * VP_Y;

    // Main road surface
    const roadGrad = ctx.createLinearGradient(0, H * ROAD_TOP, 0, H * ROAD_BOTTOM);
    roadGrad.addColorStop(0, '#0a0a1a');
    roadGrad.addColorStop(0.5, '#0f0f28');
    roadGrad.addColorStop(1, '#141430');
    ctx.fillStyle = roadGrad;

    // Road trapezoid
    const topW = W * ROAD_WIDTH_TOP;
    const botW = W * ROAD_WIDTH_BOTTOM;
    ctx.beginPath();
    ctx.moveTo(vpx - topW / 2, H * ROAD_TOP);
    ctx.lineTo(vpx + topW / 2, H * ROAD_TOP);
    ctx.lineTo(vpx + botW / 2, H * ROAD_BOTTOM);
    ctx.lineTo(vpx - botW / 2, H * ROAD_BOTTOM);
    ctx.closePath();
    ctx.fill();

    // Lane lines (perspective)
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 1;
    for (let i = 1; i < LANES; i++) {
      const frac = i / LANES;
      const topX = (vpx - topW / 2) + frac * topW;
      const botX = (vpx - botW / 2) + frac * botW;
      ctx.beginPath();
      ctx.moveTo(topX, H * ROAD_TOP);
      ctx.lineTo(botX, H * ROAD_BOTTOM);
      ctx.stroke();
    }

    // Road edges (neon glow)
    ctx.strokeStyle = 'rgba(124,58,237,0.25)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(vpx - topW / 2, H * ROAD_TOP);
    ctx.lineTo(vpx - botW / 2, H * ROAD_BOTTOM);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(vpx + topW / 2, H * ROAD_TOP);
    ctx.lineTo(vpx + botW / 2, H * ROAD_BOTTOM);
    ctx.stroke();

    // Depth grid lines (horizontal, perspective spaced)
    ctx.strokeStyle = 'rgba(255,255,255,0.03)';
    for (let d = 0.1; d <= 1.0; d += 0.1) {
      const p = this._depthToScreen(d, 0);
      const pEnd = this._depthToScreen(d, LANES - 1);
      ctx.beginPath();
      ctx.moveTo(p.x, p.cy);
      ctx.lineTo(pEnd.x + pEnd.w, pEnd.cy);
      ctx.stroke();
    }
  }

  _drawTile3D(ctx, tile) {
    if (tile.depth < 0 || tile.depth > 1.1) return;

    const pos = this._depthToScreen(tile.depth, tile.lane);
    const pad = 3;
    const x = pos.x + pad;
    const y = pos.y;
    const w = pos.w - pad * 2;
    const h = pos.h;

    if (w < 2 || h < 2) return;

    ctx.save();

    // Apply perspective tilt — tiles tilt toward the player as they get closer
    const tiltAmount = 0.15 * (1 - tile.depth); // more tilt when closer
    const centerX = x + w / 2;
    const centerY = y + h / 2;
    ctx.translate(centerX, centerY);
    ctx.transform(1, 0, tiltAmount, 1, 0, 0); // skewX for 3D feel
    ctx.translate(-centerX, -centerY);

    if (tile.hit) {
      ctx.globalAlpha = Math.max(0, tile.flash / 0.15);
      ctx.fillStyle = '#fff';
      ctx.shadowColor = tile.color;
      ctx.shadowBlur = 50;
      this._roundRect(ctx, x, y, w, h, 8);
      ctx.fill();
    } else if (tile.missed) {
      ctx.globalAlpha = 0.4;
      ctx.fillStyle = '#444';
      this._roundRect(ctx, x, y, w, h, 6);
      ctx.fill();
    } else {
      // 3D tile: top face + front face + side highlight
      const depth3D = h * 0.35; // extrusion height (thicker for visibility)

      // Drop shadow behind tile
      ctx.save();
      ctx.globalAlpha = 0.3 * pos.scale;
      ctx.fillStyle = '#000';
      ctx.shadowColor = 'transparent';
      this._roundRect(ctx, x + 4, y + h - depth3D + 6, w, depth3D, 4);
      ctx.fill();
      ctx.restore();

      // Front face (darker, gives depth)
      ctx.fillStyle = this._darkenColor(tile.color, 0.5);
      this._roundRect(ctx, x, y + h - depth3D, w, depth3D, 4);
      ctx.fill();

      // Right edge for 3D pop
      ctx.fillStyle = this._darkenColor(tile.color, 0.65);
      ctx.fillRect(x + w - 3, y + 4, 3, h - depth3D - 4);

      // Top face (main visible surface)
      const tileGrad = ctx.createLinearGradient(x, y, x, y + h - depth3D);
      tileGrad.addColorStop(0, this._lightenColor(tile.color, 0.4));
      tileGrad.addColorStop(0.6, tile.color);
      tileGrad.addColorStop(1, this._darkenColor(tile.color, 0.15));
      ctx.fillStyle = tileGrad;
      ctx.shadowColor = tile.color;
      ctx.shadowBlur = 16 * pos.scale;
      this._roundRect(ctx, x, y, w, h - depth3D, 8);
      ctx.fill();

      // Bright border outline for clarity
      ctx.strokeStyle = this._lightenColor(tile.color, 0.5);
      ctx.lineWidth = 1.5;
      ctx.globalAlpha = 0.6;
      this._roundRect(ctx, x, y, w, h - depth3D, 8);
      ctx.stroke();
      ctx.globalAlpha = 1;

      // Shine / gloss on top face
      ctx.globalAlpha = 0.35;
      const shine = ctx.createLinearGradient(x, y, x, y + (h - depth3D) * 0.45);
      shine.addColorStop(0, 'rgba(255,255,255,0.8)');
      shine.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = shine;
      this._roundRect(ctx, x + 3, y + 2, w - 6, (h - depth3D) * 0.4, 6);
      ctx.fill();

      // Inner icon/circle indicator to make tiles even more distinct
      ctx.globalAlpha = 0.2;
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(x + w / 2, y + (h - depth3D) / 2, Math.min(w, h - depth3D) * 0.18, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }

  _drawHitZone(ctx, W, H) {
    // Draw a glowing line at the hit zone depth
    const left = this._depthToScreen(HIT_ZONE_DEPTH, 0);
    const right = this._depthToScreen(HIT_ZONE_DEPTH, LANES - 1);

    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 2;
    ctx.setLineDash([8, 6]);
    ctx.beginPath();
    ctx.moveTo(left.x, left.cy);
    ctx.lineTo(right.x + right.w, right.cy);
    ctx.stroke();
    ctx.setLineDash([]);

    // Lane glow spots at hit zone
    for (let i = 0; i < LANES; i++) {
      const p = this._depthToScreen(HIT_ZONE_DEPTH, i);
      const grd = ctx.createRadialGradient(p.cx, p.cy, 0, p.cx, p.cy, p.w * 0.5);
      grd.addColorStop(0, this.song.color[i] + '25');
      grd.addColorStop(1, this.song.color[i] + '00');
      ctx.fillStyle = grd;
      ctx.fillRect(p.x, p.cy - 20, p.w, 40);
    }
    ctx.restore();
  }

  /* ── INPUT ────────────────────────────────────────────────── */
  _canvasCoords(e) {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
  }

  _onPointerDown(e) {
    if (this.state !== 'playing') return;
    const { x, y } = this._canvasCoords(e);

    // Try drag
    if (this.ball.startDrag(x, y)) {
      this.canvas.setPointerCapture(e.pointerId);
      return;
    }

    // Otherwise detect lane tap
    const lane = this._screenToLane(x, y);
    if (lane !== -1) this._hitLane(lane);
  }

  _onPointerMove(e) {
    if (this.state !== 'playing' || !this.ball.dragging) return;
    const { x, y } = this._canvasCoords(e);
    this.ball.moveDrag(x, y);
  }

  _onPointerUp(e) {
    if (!this.ball.dragging) return;
    const { x, y } = this._canvasCoords(e);
    this.ball.endDrag(x, y);

    const lane = this._screenToLane(this.ball.screenX, this.ball.screenY);
    if (lane !== -1) {
      this.ball.lane = lane;
      this.ball.glowColor = this.song.color[lane];
      this._hitLane(lane);
    }
  }

  _onKey(e) {
    if (this.state !== 'playing') return;

    // Left/Right arrows: move ball to adjacent lane and hit instantly
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      const newLane = Math.max(0, this.ball.lane - 1);
      this.ball.lane = newLane;
      this.ball.glowColor = this.song.color[newLane];
      // Snap ball position immediately — no lag
      const pos = this._depthToScreen(HIT_ZONE_DEPTH, newLane);
      this.ball.screenX = pos.cx;
      this.ball.targetX = pos.cx;
      this.ball.vx = 0;
      this.ball.hop();
      this._hitLane(newLane);
      return;
    }
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      const newLane = Math.min(LANES - 1, this.ball.lane + 1);
      this.ball.lane = newLane;
      this.ball.glowColor = this.song.color[newLane];
      // Snap ball position immediately — no lag
      const pos = this._depthToScreen(HIT_ZONE_DEPTH, newLane);
      this.ball.screenX = pos.cx;
      this.ball.targetX = pos.cx;
      this.ball.vx = 0;
      this.ball.hop();
      this._hitLane(newLane);
      return;
    }

    // Direct lane keys still work (also snap)
    const map = { 'a':0, 's':1, 'd':2, 'f':3,
                  '1':0, '2':1, '3':2, '4':3 };
    const lane = map[e.key];
    if (lane !== undefined) {
      e.preventDefault();
      this.ball.lane = lane;
      this.ball.glowColor = this.song.color[lane];
      const pos = this._depthToScreen(HIT_ZONE_DEPTH, lane);
      this.ball.screenX = pos.cx;
      this.ball.targetX = pos.cx;
      this.ball.vx = 0;
      this.ball.hop();
      this._hitLane(lane);
    }
    if (e.key === 'Escape' || e.key === 'p') this._pause();
  }

  _screenToLane(x, y) {
    // Find which lane a screen coordinate corresponds to at the hit zone depth
    for (let i = 0; i < LANES; i++) {
      const p = this._depthToScreen(HIT_ZONE_DEPTH, i);
      if (x >= p.x && x <= p.x + p.w && y >= p.cy - 60 && y <= p.cy + 60) {
        return i;
      }
    }
    // Fallback: just use X position ratio
    const left = this._depthToScreen(HIT_ZONE_DEPTH, 0);
    const right = this._depthToScreen(HIT_ZONE_DEPTH, LANES - 1);
    const roadLeft = left.x;
    const roadRight = right.x + right.w;
    if (x < roadLeft || x > roadRight) return -1;
    const frac = (x - roadLeft) / (roadRight - roadLeft);
    return Math.min(LANES - 1, Math.floor(frac * LANES));
  }

  /* ── HIT DETECTION ────────────────────────────────────────── */
  _hitLane(lane) {
    let best = null;
    let bestDist = Infinity;

    // Find the nearest unhit tile — prefer tiles in the requested lane
    // Use asymmetric tolerance: generous for approaching tiles, tight for passed ones
    const EARLY_TOLERANCE = 0.30;  // allow hitting tiles still approaching
    const LATE_TOLERANCE  = 0.18;  // allow hitting tiles slightly past

    this.tiles.forEach(tile => {
      if (tile.hit || tile.missed) return;
      const diff = tile.depth - HIT_ZONE_DEPTH; // negative = approaching, positive = passed
      const inWindow = diff < LATE_TOLERANCE && diff > -EARLY_TOLERANCE;
      if (!inWindow) return;

      const dist = Math.abs(diff);
      // Prefer same-lane tile, but accept any lane
      const lanePenalty = (tile.lane === lane) ? 0 : 0.001;
      const score = dist + lanePenalty;
      if (score < bestDist) { bestDist = score; best = tile; }
    });

    if (!best) return; // No tile in range at all

    // Snap ball to the tile's actual lane
    lane = best.lane;
    this.ball.lane = lane;
    this.ball.glowColor = this.song.color[lane];
    const snapPos = this._depthToScreen(HIT_ZONE_DEPTH, lane);
    this.ball.screenX = snapPos.cx;
    this.ball.targetX = snapPos.cx;
    this.ball.vx = 0;

    // HIT!
    best.hit   = true;
    best.flash = 0.15;
    this.totalHits++;

    // First tile hit — unlock the game flow with a brief delay before tiles spawn
    if (this._waitingForFirstHit) {
      this._waitingForFirstHit = false;
      this.spawnTimer = -800; // 800ms delay before next tile spawns
    }

    // Points! Every tile touch gives points
    const hitDist = Math.abs(best.depth - HIT_ZONE_DEPTH);
    let points, label, color;
    if (hitDist < 0.06) {
      points = 30; label = 'PERFECT!'; color = '#fbbf24';
      this.audio.playPerfect();
    } else if (hitDist < 0.14) {
      points = 20; label = 'GREAT'; color = '#22d3ee';
      this.audio.playHit(lane);
    } else {
      points = 10; label = 'OK'; color = '#94a3b8';
      this.audio.playHit(lane);
    }

    this.combo++;
    if (this.combo > this.bestCombo) this.bestCombo = this.combo;
    const earned = points * this.combo;
    this.score += earned;

    this._scoreEl.textContent = this.score;
    this._comboEl.textContent = `x${this.combo}`;

    // Particles
    const pos = this._depthToScreen(HIT_ZONE_DEPTH, lane);
    this.particles.emit(pos.cx, pos.cy, this.song.color[lane], 12);

    // Floating score
    this._floats.push({
      text: `+${earned}`, x: pos.cx, y: pos.cy - 20,
      color, size: 18 + Math.min(this.combo, 10) * 1.5,
      alpha: 1, age: 0, life: 0.8,
    });

    // Feedback label
    this._showFeedback(label, pos.cx, pos.cy - 50, color);

    // Ball reacts
    this.ball.lane = lane;
    this.ball.glowColor = this.song.color[lane];
    this.ball.hop();
  }

  /* ── FEEDBACK ─────────────────────────────────────────────── */
  _showFeedback(text, x, y, color) {
    const el = document.createElement('div');
    el.className = 'feedback-label';
    el.textContent = text;
    el.style.color = color;
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    el.style.transform = 'translate(-50%, -50%)';
    el.style.textShadow = `0 0 12px ${color}`;
    this._feedbackEl.appendChild(el);
    el.addEventListener('animationend', () => el.remove());
  }

  /* ── COLOR UTILS ──────────────────────────────────────────── */
  _darkenColor(hex, amount) {
    const num = parseInt(hex.slice(1), 16);
    const r = Math.max(0, ((num >> 16) & 0xFF) * (1 - amount)) | 0;
    const g = Math.max(0, ((num >> 8) & 0xFF) * (1 - amount)) | 0;
    const b = Math.max(0, (num & 0xFF) * (1 - amount)) | 0;
    return `rgb(${r},${g},${b})`;
  }

  _lightenColor(hex, amount) {
    const num = parseInt(hex.slice(1), 16);
    const r = Math.min(255, ((num >> 16) & 0xFF) + 255 * amount) | 0;
    const g = Math.min(255, ((num >> 8) & 0xFF) + 255 * amount) | 0;
    const b = Math.min(255, (num & 0xFF) + 255 * amount) | 0;
    return `rgb(${r},${g},${b})`;
  }

  _roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }
}

/* ── BOOT ─────────────────────────────────────────────────── */
window.addEventListener('DOMContentLoaded', () => {
  window._game = new Game();
});
