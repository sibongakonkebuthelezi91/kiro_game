'use strict';

/* ═══════════════════════════════════════════════════════════
   BEAT HOP  –  Tile Rhythm Game
   ─────────────────────────────────────────────────────────
   Architecture:
     AudioEngine  – Web Audio API: synth beats + beat clock
     BeatMap      – song definitions (beat patterns)
     TileManager  – spawns & moves tiles
     Ball         – the bouncing player ball
     ParticlePool – visual effects
     Game         – main loop, input, scoring, screens
   ═══════════════════════════════════════════════════════════ */

/* ── CONSTANTS ────────────────────────────────────────────── */
const LANES       = 4;
const TILE_HEIGHT = 90;      // px
const TILE_GAP    = 6;       // px between lanes
const HIT_ZONE_Y  = 0.78;    // fraction of canvas height
const HIT_WINDOW  = 110;     // ms ± perfect window
const MISS_WINDOW = 220;     // ms ± good-enough window
const TILE_SPEED_BASE = 260; // px/s at start
const SPEED_RAMP  = 8;       // px/s per 10 tiles hit

/* ── SONGS / BEAT MAPS ────────────────────────────────────── */
/* Each beat is [beat_index, lane(0-3)]
   Lane -1 means "any" (double/wide tile — not used here for simplicity) */
const SONGS = {
  bounce: {
    name:  'Bounce Beat',
    bpm:   120,
    /* 64 beats laid out as a fun left-right pattern */
    beats: generatePattern('bounce'),
    color: ['#7c3aed','#06b6d4','#f472b6','#22d3ee'],
  },
  groove: {
    name:  'Night Groove',
    bpm:   100,
    beats: generatePattern('groove'),
    color: ['#f59e0b','#10b981','#3b82f6','#ec4899'],
  },
  rush: {
    name:  'Drum Rush',
    bpm:   145,
    beats: generatePattern('rush'),
    color: ['#ef4444','#f97316','#eab308','#84cc16'],
  },
};

function generatePattern(type) {
  const beats = [];
  if (type === 'bounce') {
    // Alternating left / right groups with occasional fills
    const pattern = [0,2,1,3, 0,2,1,3, 0,1,2,3, 3,2,1,0,
                     0,3,1,2, 2,0,3,1, 0,0,2,2, 1,1,3,3,
                     0,2,0,2, 1,3,1,3, 0,1,2,3, 3,2,1,0,
                     0,2,1,3, 0,2,1,3, 2,3,0,1, 0,1,2,3];
    pattern.forEach((lane, i) => beats.push([i, lane]));
  } else if (type === 'groove') {
    // Slower, more deliberate steps
    const pattern = [0,2,1,3, 2,0,3,1, 1,3,0,2, 3,1,2,0,
                     0,0,2,2, 1,1,3,3, 0,3,0,3, 1,2,1,2,
                     0,1,2,3, 0,1,2,3, 3,2,1,0, 3,2,1,0,
                     0,2,3,1, 2,0,1,3, 0,1,2,3, 1,0,3,2];
    pattern.forEach((lane, i) => beats.push([i, lane]));
  } else {
    // rush – fast, dense
    const pattern = [0,1,2,3,0,1,2,3, 0,2,1,3,2,0,3,1,
                     0,0,1,1,2,2,3,3, 3,3,2,2,1,1,0,0,
                     0,1,0,1,2,3,2,3, 0,3,1,2,0,3,1,2,
                     0,1,2,3,3,2,1,0, 0,2,0,2,1,3,1,3];
    pattern.forEach((lane, i) => beats.push([i, lane]));
  }
  return beats;
}

/* ── AUDIO ENGINE ─────────────────────────────────────────── */
class AudioEngine {
  constructor() {
    this.ctx       = null;
    this.startTime = 0;
    this.bpm       = 120;
    this.beatSched = [];   // scheduled beat times (seconds)
    this._schedTimer = null;
  }

  init() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  /** Start beat clock for a song */
  start(song) {
    this.init();
    this.bpm      = song.bpm;
    this.startTime = this.ctx.currentTime + 0.1;
    this.beatInterval = 60 / this.bpm;          // seconds per beat
    this.totalBeats   = song.beats.length;
    this.beatTimes    = song.beats.map(([beatIdx]) =>
      this.startTime + beatIdx * this.beatInterval
    );
    this._scheduleBeats(song);
  }

  stop() {
    clearTimeout(this._schedTimer);
  }

  /** Current time in seconds since song started */
  songTime() {
    if (!this.ctx) return 0;
    return Math.max(0, this.ctx.currentTime - this.startTime);
  }

  /** Schedule all synthesised sounds */
  _scheduleBeats(song) {
    const ctx = this.ctx;
    song.beats.forEach(([beatIdx, lane]) => {
      const t = this.startTime + beatIdx * this.beatInterval;
      this._playTick(t, lane, song.color);
    });
  }

  _playTick(time, lane, colors) {
    const ctx  = this.ctx;
    const freq = [261.63, 329.63, 392.00, 523.25][lane]; // C4 E4 G4 C5

    /* Soft sine + quick decay */
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.connect(env); env.connect(ctx.destination);

    osc.type      = 'sine';
    osc.frequency.value = freq;
    env.gain.setValueAtTime(0.18, time);
    env.gain.exponentialRampToValueAtTime(0.0001, time + 0.18);
    osc.start(time);
    osc.stop(time + 0.2);

    /* Subtle click for rhythm clarity */
    const buf  = ctx.createBuffer(1, ctx.sampleRate * 0.05, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.008));
    }
    const src  = ctx.createBufferSource();
    const gClick = ctx.createGain();
    src.buffer = buf;
    src.connect(gClick); gClick.connect(ctx.destination);
    gClick.gain.setValueAtTime(0.07, time);
    gClick.gain.exponentialRampToValueAtTime(0.0001, time + 0.05);
    src.start(time);
  }

  /** Play a "miss" buzzer */
  playMiss() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t   = ctx.currentTime;
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.connect(env); env.connect(ctx.destination);
    osc.type = 'sawtooth';
    osc.frequency.value = 80;
    env.gain.setValueAtTime(0.12, t);
    env.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    osc.start(t); osc.stop(t + 0.13);
  }

  /** Play a satisfying "perfect" chime */
  playPerfect() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    [523.25, 659.25, 783.99].forEach((f, i) => {
      const t   = ctx.currentTime + i * 0.04;
      const osc = ctx.createOscillator();
      const env = ctx.createGain();
      osc.connect(env); env.connect(ctx.destination);
      osc.type = 'triangle';
      osc.frequency.value = f;
      env.gain.setValueAtTime(0.09, t);
      env.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
      osc.start(t); osc.stop(t + 0.26);
    });
  }
}

/* ── PARTICLE POOL ────────────────────────────────────────── */
class ParticlePool {
  constructor() { this.particles = []; }

  emit(x, y, color, count = 12) {
    for (let i = 0; i < count; i++) {
      const angle  = (Math.PI * 2 * i) / count + Math.random() * 0.5;
      const speed  = 80 + Math.random() * 160;
      this.particles.push({
        x, y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 60,
        alpha: 1,
        size:  3 + Math.random() * 4,
        color,
        life:  0.5 + Math.random() * 0.3,
        age:   0,
      });
    }
  }

  update(dt) {
    this.particles = this.particles.filter(p => {
      p.age += dt;
      p.x   += p.vx * dt;
      p.y   += p.vy * dt;
      p.vy  += 300 * dt; // gravity
      p.alpha = 1 - p.age / p.life;
      return p.age < p.life;
    });
  }

  draw(ctx) {
    this.particles.forEach(p => {
      ctx.save();
      ctx.globalAlpha = Math.max(0, p.alpha);
      ctx.fillStyle   = p.color;
      ctx.shadowColor = p.color;
      ctx.shadowBlur  = 8;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    });
  }
}

/* ── BALL ─────────────────────────────────────────────────── */
class Ball {
  constructor() {
    this.lane      = 0;
    this.x         = 0;
    this.y         = 0;
    this.vx        = 0;   // horizontal velocity (used during drag fling)
    this.vy        = 0;   // vertical velocity
    this.radius    = 18;
    this.glowColor = '#7c3aed';
    this.trail     = [];

    /* Physics constants */
    this.GRAVITY     = 1800;  // px/s²
    this.RESTITUTION = 0.72;  // energy kept on floor bounce (0-1)
    this.FLOOR_VY    = -460;  // minimum upward vel to keep auto-bounce alive
    this.FRICTION    = 0.88;  // horizontal damping per bounce

    /* Squash/stretch */
    this._bounceAnim = 0;
    this._squashDir  = 1;     // +1 = squash on land, -1 = stretch on launch

    /* Drag state */
    this.dragging    = false;
    this.dragStartX  = 0;
    this.dragStartY  = 0;
    this.dragCurX    = 0;
    this.dragCurY    = 0;

    /* Floor / ceiling */
    this._floorY   = 0;
    this._ceilingY = 0;
  }

  /** Called at game start or retry */
  reset(lane, canvasH, laneCX) {
    this.lane      = lane;
    this.x         = laneCX;
    this.y         = canvasH * HIT_ZONE_Y;
    this.vx        = 0;
    this.vy        = this.FLOOR_VY;   // start with an upward kick
    this._floorY   = canvasH * HIT_ZONE_Y;
    this._ceilingY = 60;
    this.trail     = [];
    this.dragging  = false;
    this._bounceAnim = 0;
  }

  /** External hop called when a tile is hit */
  hop() {
    this.vy = this.FLOOR_VY;
    this._bounceAnim = 0.14;
    this._squashDir  = -1; // stretch upward on launch
  }

  /** Begin a drag gesture (pointer coords in canvas space) */
  startDrag(px, py) {
    // Only allow drag when ball is near the hit zone (on the ground)
    const dist = Math.hypot(px - this.x, py - this.y);
    if (dist > this.radius * 3.5) return false;
    this.dragging   = true;
    this.dragStartX = this.x;
    this.dragStartY = this.y;
    this.dragCurX   = px;
    this.dragCurY   = py;
    this.vx = 0;
    this.vy = 0;
    return true;
  }

  moveDrag(px, py) {
    if (!this.dragging) return;
    this.dragCurX = px;
    this.dragCurY = py;
    // Follow finger but clamp to canvas area
    this.x = px;
    this.y = Math.min(this._floorY, Math.max(this._ceilingY, py));
  }

  /** Release drag — compute fling velocity from drag vector */
  endDrag(px, py) {
    if (!this.dragging) return;
    this.dragging = false;

    const dx = this.dragStartX - px;  // reversed: pull-back = forward launch
    const dy = this.dragStartY - py;
    const FLING_SCALE = 4.5;

    this.vx = dx * FLING_SCALE;
    this.vy = dy * FLING_SCALE;

    // Clamp max fling speed
    const speed = Math.hypot(this.vx, this.vy);
    const MAX   = 1400;
    if (speed > MAX) {
      this.vx = (this.vx / speed) * MAX;
      this.vy = (this.vy / speed) * MAX;
    }

    // Ensure at least some upward component so it doesn't fling downward
    if (this.vy > -80) this.vy = -80;

    this._bounceAnim = 0.1;
    this._squashDir  = -1;
  }

  update(dt, targetLaneX, hitZoneY, canvasW) {
    this._floorY = hitZoneY;

    if (this.dragging) {
      // Position is driven by moveDrag — just update trail
      this._updateTrail();
      return;
    }

    /* ── Gravity ── */
    this.vy += this.GRAVITY * dt;

    /* ── Horizontal drift toward target lane (relaxed when vx is large) */
    const laneAttract = Math.max(0, 1 - Math.abs(this.vx) / 800);
    this.x += (targetLaneX - this.x) * Math.min(1, dt * 14 * laneAttract);
    this.x += this.vx * dt;

    /* ── Vertical movement ── */
    this.y += this.vy * dt;

    /* ── Floor bounce ── */
    if (this.y >= this._floorY) {
      this.y  = this._floorY;
      this.vy = -Math.abs(this.vy) * this.RESTITUTION;
      this.vx *= this.FRICTION;
      this._bounceAnim = 0.13;
      this._squashDir  = 1;

      // Keep ball alive — give a minimum upward kick if it's dying out
      if (Math.abs(this.vy) < 120) {
        this.vy = this.FLOOR_VY * 0.55;
      }
    }

    /* ── Ceiling bounce ── */
    if (this.y <= this._ceilingY) {
      this.y  = this._ceilingY;
      this.vy = Math.abs(this.vy) * this.RESTITUTION;
    }

    /* ── Side wall bounce ── */
    if (this.x - this.radius < 0) {
      this.x  = this.radius;
      this.vx = Math.abs(this.vx) * 0.6;
    }
    if (this.x + this.radius > canvasW) {
      this.x  = canvasW - this.radius;
      this.vx = -Math.abs(this.vx) * 0.6;
    }

    /* ── Squash/stretch cooldown ── */
    if (this._bounceAnim > 0) this._bounceAnim -= dt;

    this._updateTrail();
  }

  _updateTrail() {
    this.trail.unshift({ x: this.x, y: this.y });
    if (this.trail.length > 14) this.trail.pop();
  }

  draw(ctx) {
    /* ── Trail ── */
    this.trail.forEach((t, i) => {
      const alpha = (1 - i / this.trail.length) * 0.3;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle   = this.glowColor;
      ctx.shadowColor = this.glowColor;
      ctx.shadowBlur  = 6;
      ctx.beginPath();
      ctx.arc(t.x, t.y, this.radius * (1 - i * 0.055), 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    });

    /* ── Drag slingshot arrow ── */
    if (this.dragging) {
      const dx = this.dragStartX - this.dragCurX;
      const dy = this.dragStartY - this.dragCurY;
      const len = Math.hypot(dx, dy);
      if (len > 8) {
        ctx.save();
        ctx.strokeStyle = 'rgba(255,255,255,0.5)';
        ctx.lineWidth   = 2;
        ctx.setLineDash([6, 4]);
        ctx.beginPath();
        ctx.moveTo(this.x, this.y);
        ctx.lineTo(this.x + dx * 0.9, this.y + dy * 0.9);
        ctx.stroke();
        ctx.setLineDash([]);

        /* Arrowhead */
        const angle = Math.atan2(dy, dx);
        const ax    = this.x + dx * 0.9;
        const ay    = this.y + dy * 0.9;
        ctx.fillStyle = 'rgba(255,255,255,0.7)';
        ctx.beginPath();
        ctx.moveTo(ax + Math.cos(angle) * 10, ay + Math.sin(angle) * 10);
        ctx.lineTo(ax + Math.cos(angle + 2.4) * 7, ay + Math.sin(angle + 2.4) * 7);
        ctx.lineTo(ax + Math.cos(angle - 2.4) * 7, ay + Math.sin(angle - 2.4) * 7);
        ctx.closePath();
        ctx.fill();

        /* Force indicator circle */
        const force = Math.min(1, len / 200);
        ctx.strokeStyle = `hsl(${120 - force * 120}, 100%, 60%)`;
        ctx.lineWidth   = 2;
        ctx.setLineDash([]);
        ctx.globalAlpha = 0.5;
        ctx.beginPath();
        ctx.arc(this.dragStartX, this.dragStartY, 6 + force * 18, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
    }

    /* ── Squash / stretch ── */
    const bounce = Math.max(0, this._bounceAnim);
    const sx = this._squashDir === 1 ? 1 + bounce * 0.45 : 1 - bounce * 0.2;
    const sy = this._squashDir === 1 ? 1 - bounce * 0.3  : 1 + bounce * 0.35;

    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.scale(sx, sy);

    /* Glow */
    ctx.shadowColor = this.glowColor;
    ctx.shadowBlur  = 26;

    /* Main body */
    const grad = ctx.createRadialGradient(-5, -5, 2, 0, 0, this.radius);
    grad.addColorStop(0,   '#ffffff');
    grad.addColorStop(0.35, this.glowColor);
    grad.addColorStop(1,   '#000000');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(0, 0, this.radius, 0, Math.PI * 2);
    ctx.fill();

    /* Specular highlight */
    ctx.globalAlpha = 0.55;
    ctx.fillStyle   = 'rgba(255,255,255,0.9)';
    ctx.beginPath();
    ctx.ellipse(-5, -5, this.radius * 0.35, this.radius * 0.22, -0.5, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }
}

/* ── TILE ─────────────────────────────────────────────────── */
class Tile {
  constructor(lane, beatTime, laneX, laneW, canvasH, color) {
    this.lane     = lane;
    this.beatTime = beatTime;   // seconds when this tile should be at hit zone
    this.x        = laneX;
    this.w        = laneW;
    this.h        = TILE_HEIGHT;
    this.y        = -TILE_HEIGHT;
    this.color    = color;
    this.hit      = false;
    this.missed   = false;
    this.flash    = 0;           // hit flash timer
    this._canvasH = canvasH;
  }

  /** Position tile so it arrives at hitZoneY exactly at beatTime */
  setSpeedAndY(speed, songTime, hitZoneY) {
    // distance to travel = time remaining × speed
    const timeLeft = this.beatTime - songTime;
    // Tile centre should land at hitZoneY + h/2
    const targetY  = hitZoneY + this.h / 2;
    this.y         = targetY - timeLeft * speed;
  }

  update(dt, speed) {
    if (!this.hit) this.y += speed * dt;
    if (this.flash > 0) this.flash -= dt;
  }

  draw(ctx, laneX) {
    if (this.hit && this.flash <= 0) return;  // fully consumed

    ctx.save();

    const alpha = this.missed
      ? Math.max(0, 0.3 - (this.y - this._canvasH) / 60)
      : 1;
    ctx.globalAlpha = alpha;

    /* Tile body */
    const rx = 8;
    ctx.fillStyle = this.missed ? '#333' : this.color;

    if (this.flash > 0) {
      ctx.fillStyle = '#fff';
      ctx.shadowColor = this.color;
      ctx.shadowBlur  = 30;
    }

    roundRect(ctx, this.x + TILE_GAP / 2, this.y - this.h / 2,
      this.w - TILE_GAP, this.h, rx);
    ctx.fill();

    /* Shine stripe */
    if (!this.missed && this.flash <= 0) {
      const shine = ctx.createLinearGradient(this.x, this.y - this.h / 2,
        this.x, this.y - this.h / 2 + this.h * 0.4);
      shine.addColorStop(0,   'rgba(255,255,255,0.18)');
      shine.addColorStop(1,   'rgba(255,255,255,0)');
      ctx.fillStyle = shine;
      roundRect(ctx, this.x + TILE_GAP / 2, this.y - this.h / 2,
        this.w - TILE_GAP, this.h * 0.45, rx);
      ctx.fill();
    }

    ctx.restore();
  }
}

/* ── HELPERS ──────────────────────────────────────────────── */
function roundRect(ctx, x, y, w, h, r) {
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

/* ═══════════════════════════════════════════════════════════
   MAIN GAME
   ═══════════════════════════════════════════════════════════ */
class Game {
  constructor() {
    /* Canvas */
    this.canvas  = document.getElementById('game-canvas');
    this.ctx     = this.canvas.getContext('2d');

    /* Subsystems */
    this.audio   = new AudioEngine();
    this.particles = new ParticlePool();
    this.ball    = new Ball();

    /* State */
    this.state   = 'menu';  // menu | playing | paused | gameover
    this.song    = null;
    this.selectedSongKey = 'bounce';

    /* Gameplay */
    this.tiles      = [];
    this.tileSpeed  = TILE_SPEED_BASE;
    this.score      = 0;
    this.combo      = 1;
    this.bestCombo  = 1;
    this.hits       = 0;
    this.misses     = 0;
    this.nextBeatIdx = 0;  // index into song.beats for tile spawning
    this.spawnAheadSec = 2.5; // spawn tiles this many seconds ahead

    /* Timing */
    this._lastTime  = 0;
    this._rafId     = null;

    /* DOM refs */
    this._scoreEl   = document.getElementById('score-val');
    this._comboEl   = document.getElementById('combo-val');
    this._songHudEl = document.getElementById('song-title-hud');
    this._beatBarEl = document.getElementById('beat-indicator');
    this._feedbackEl = document.getElementById('feedback-container');

    this._bindUI();
    this._resize();
    window.addEventListener('resize', () => this._resize());
  }

  /* ── UI BINDINGS ──────────────────────────────────────────── */
  _bindUI() {
    /* Song selection */
    document.querySelectorAll('.song-card').forEach(card => {
      card.addEventListener('click', () => {
        document.querySelectorAll('.song-card').forEach(c => c.classList.remove('selected'));
        card.classList.add('selected');
        this.selectedSongKey = card.dataset.song;
      });
    });

    document.getElementById('btn-play')
      .addEventListener('click', () => this._startGame());
    document.getElementById('btn-pause')
      .addEventListener('click', () => this._pause());
    document.getElementById('btn-resume')
      .addEventListener('click', () => this._resume());
    document.getElementById('btn-menu-from-pause')
      .addEventListener('click', () => this._goMenu());
    document.getElementById('btn-retry')
      .addEventListener('click', () => this._startGame());
    document.getElementById('btn-menu-from-go')
      .addEventListener('click', () => this._goMenu());

    /* Tile tap + ball drag */
    this.canvas.addEventListener('pointerdown', e => this._onPointerDown(e));
    this.canvas.addEventListener('pointermove', e => this._onPointerMove(e));
    this.canvas.addEventListener('pointerup',   e => this._onPointerUp(e));
    this.canvas.addEventListener('pointerleave', e => this._onPointerUp(e));

    /* Keyboard (lane keys: A S D F or ← ↓ → ↑ arrows) */
    window.addEventListener('keydown', e => this._onKey(e));
  }

  _resize() {
    this.canvas.width  = this.canvas.offsetWidth;
    this.canvas.height = this.canvas.offsetHeight;
    this._computeLanes();
  }

  _computeLanes() {
    const W = this.canvas.width;
    this.laneW    = W / LANES;
    this.laneXs   = Array.from({ length: LANES }, (_, i) => i * this.laneW);
    this.laneCXs  = Array.from({ length: LANES }, (_, i) => (i + 0.5) * this.laneW);
    this.hitZoneY = this.canvas.height * HIT_ZONE_Y;
  }

  /* ── SCREENS ──────────────────────────────────────────────── */
  _showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(id).classList.add('active');
  }

  /* ── START / STOP ─────────────────────────────────────────── */
  _startGame() {
    this.song       = SONGS[this.selectedSongKey];
    this.tiles      = [];
    this.score      = 0;
    this.combo      = 1;
    this.bestCombo  = 1;
    this.hits       = 0;
    this.misses     = 0;
    this.nextBeatIdx = 0;
    this.tileSpeed  = TILE_SPEED_BASE;
    this.state      = 'playing';

    this._scoreEl.textContent = '0';
    this._comboEl.textContent = 'x1';
    this._songHudEl.textContent = this.song.name;

    this.ball.reset(0, this.canvas.height, this.laneCXs[0]);
    this.ball.glowColor = this.song.color[0];

    this.audio.start(this.song);
    this._showScreen('screen-game');

    cancelAnimationFrame(this._rafId);
    this._lastTime = performance.now();
    this._rafId    = requestAnimationFrame(t => this._loop(t));
  }

  _pause() {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.audio.ctx && this.audio.ctx.suspend();
    this._showScreen('screen-pause');
  }

  _resume() {
    if (this.state !== 'paused') return;
    this.state = 'playing';
    this.audio.ctx && this.audio.ctx.resume();
    this._showScreen('screen-game');
    this._lastTime = performance.now();
    this._rafId    = requestAnimationFrame(t => this._loop(t));
  }

  _goMenu() {
    this.state = 'menu';
    this.audio.stop();
    cancelAnimationFrame(this._rafId);
    this._showScreen('screen-menu');
  }

  _gameOver() {
    this.state = 'gameover';
    this.audio.stop();
    cancelAnimationFrame(this._rafId);

    document.getElementById('go-score').textContent = this.score;
    document.getElementById('go-combo').textContent  = `Best Combo: x${this.bestCombo}`;

    const total   = this.hits + this.misses;
    const acc     = total ? this.hits / total : 0;
    const gradeEl = document.getElementById('go-grade');
    let   grade, cls;
    if (acc >= 0.95)      { grade = 'S'; cls = 'grade-S'; }
    else if (acc >= 0.80) { grade = 'A'; cls = 'grade-A'; }
    else if (acc >= 0.60) { grade = 'B'; cls = 'grade-B'; }
    else                  { grade = 'C'; cls = 'grade-C'; }
    gradeEl.textContent  = grade;
    gradeEl.className    = `grade ${cls}`;

    const title = acc >= 0.8 ? '🎉 Well Done!' : '💀 Game Over';
    document.getElementById('go-title').textContent = title;

    this._showScreen('screen-gameover');
  }

  /* ── MAIN LOOP ────────────────────────────────────────────── */
  _loop(timestamp) {
    if (this.state !== 'playing') return;

    const dt = Math.min((timestamp - this._lastTime) / 1000, 0.05); // cap at 50ms
    this._lastTime = timestamp;

    this._update(dt);
    this._draw();

    this._rafId = requestAnimationFrame(t => this._loop(t));
  }

  /* ── UPDATE ───────────────────────────────────────────────── */
  _update(dt) {
    const songTime = this.audio.songTime();

    /* ── Spawn tiles ahead of playhead ── */
    while (this.nextBeatIdx < this.song.beats.length) {
      const [beatIdx, lane] = this.song.beats[this.nextBeatIdx];
      const beatTime = beatIdx * (60 / this.song.bpm); // seconds
      if (beatTime > songTime + this.spawnAheadSec) break;

      const tile = new Tile(
        lane, beatTime,
        this.laneXs[lane], this.laneW,
        this.canvas.height,
        this.song.color[lane]
      );
      tile.setSpeedAndY(this.tileSpeed, songTime, this.hitZoneY);
      this.tiles.push(tile);
      this.nextBeatIdx++;
    }

    /* ── Update tiles ── */
    this.tiles.forEach(t => t.update(dt, this.tileSpeed));

    /* ── Auto-miss tiles that fell past hit zone ── */
    this.tiles.forEach(tile => {
      if (!tile.hit && !tile.missed) {
        const tileCY = tile.y;
        if (tileCY > this.hitZoneY + TILE_HEIGHT) {
          tile.missed = true;
          this.misses++;
          this.combo = 1;
          this._comboEl.textContent = 'x1';
          this.audio.playMiss();
          this._showFeedback('MISS', this.laneCXs[tile.lane], this.hitZoneY, '#ef4444');
        }
      }
    });

    /* ── Remove off-screen tiles ── */
    this.tiles = this.tiles.filter(t =>
      t.y < this.canvas.height + TILE_HEIGHT * 2
    );

    /* ── Ball ── */
    this.ball.update(dt, this.laneCXs[this.ball.lane], this.hitZoneY, this.canvas.width);

    /* ── Particles ── */
    this.particles.update(dt);

    /* ── Beat bar progress ── */
    const totalDuration = (this.song.beats.length - 1) * (60 / this.song.bpm);
    const progress = Math.min(1, songTime / totalDuration) * 100;
    this._beatBarEl.style.width = progress + '%';

    /* ── Song finished ── */
    if (this.nextBeatIdx >= this.song.beats.length && this.tiles.length === 0) {
      this._gameOver();
    }
  }

  /* ── DRAW ─────────────────────────────────────────────────── */
  _draw() {
    const ctx = this.ctx;
    const W   = this.canvas.width;
    const H   = this.canvas.height;

    /* Background */
    ctx.fillStyle = '#0a0a12';
    ctx.fillRect(0, 0, W, H);

    /* Lane dividers */
    ctx.strokeStyle = '#1a1a2e';
    ctx.lineWidth   = 1;
    for (let i = 1; i < LANES; i++) {
      ctx.beginPath();
      ctx.moveTo(i * this.laneW, 0);
      ctx.lineTo(i * this.laneW, H);
      ctx.stroke();
    }

    /* Lane subtle gradient tint */
    for (let i = 0; i < LANES; i++) {
      const grad = ctx.createLinearGradient(0, H * 0.6, 0, H);
      grad.addColorStop(0, 'transparent');
      grad.addColorStop(1, this.song.color[i] + '12');
      ctx.fillStyle = grad;
      ctx.fillRect(i * this.laneW, H * 0.6, this.laneW, H * 0.4);
    }

    /* Hit zone line */
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth   = 2;
    ctx.setLineDash([8, 8]);
    ctx.beginPath();
    ctx.moveTo(0, this.hitZoneY);
    ctx.lineTo(W, this.hitZoneY);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();

    /* Tiles */
    this.tiles.forEach(t => t.draw(ctx, this.laneXs[t.lane]));

    /* Particles */
    this.particles.draw(ctx);

    /* Ball */
    this.ball.draw(ctx);

    /* Hit zone glow per lane */
    for (let i = 0; i < LANES; i++) {
      const grd = ctx.createLinearGradient(
        this.laneXs[i], this.hitZoneY - 20,
        this.laneXs[i], this.hitZoneY + 20
      );
      grd.addColorStop(0, this.song.color[i] + '00');
      grd.addColorStop(0.5, this.song.color[i] + '22');
      grd.addColorStop(1,   this.song.color[i] + '00');
      ctx.fillStyle = grd;
      ctx.fillRect(this.laneXs[i], this.hitZoneY - 20, this.laneW, 40);
    }
  }

  /* ── INPUT ────────────────────────────────────────────────── */
  _canvasCoords(e) {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) * (this.canvas.width / rect.width),
      y: (e.clientY - rect.top) * (this.canvas.height / rect.height),
    };
  }

  _onPointerDown(e) {
    if (this.state !== 'playing') return;
    const { x, y } = this._canvasCoords(e);

    /* Try to grab ball for drag first */
    if (this.ball.startDrag(x, y)) {
      this.canvas.setPointerCapture(e.pointerId);
      return;
    }

    /* Otherwise treat as lane tap */
    const lane = Math.floor(x / this.laneW);
    if (lane >= 0 && lane < LANES) this._hitLane(lane);
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

    /* Determine which lane ball lands in after fling */
    const lane = Math.floor(this.ball.x / this.laneW);
    if (lane >= 0 && lane < LANES) {
      this.ball.lane      = lane;
      this.ball.glowColor = this.song.color[lane];
      this._hitLane(lane);
    }
  }

  _onKey(e) {
    if (this.state !== 'playing') return;
    const map = { 'a':0, 's':1, 'd':2, 'f':3,
                  'ArrowLeft':0, 'ArrowDown':1, 'ArrowRight':2, 'ArrowUp':3,
                  '1':0,'2':1,'3':2,'4':3 };
    const lane = map[e.key];
    if (lane !== undefined) {
      e.preventDefault();
      this._hitLane(lane);
    }
    if (e.key === 'Escape' || e.key === 'p') this._pause();
  }

  /* ── HIT DETECTION ────────────────────────────────────────── */
  _hitLane(lane) {
    const songTime = this.audio.songTime();

    /* Find the closest unhit tile in this lane */
    let best     = null;
    let bestDiff = Infinity;

    this.tiles.forEach(tile => {
      if (tile.hit || tile.missed || tile.lane !== lane) return;
      const diff = Math.abs((tile.beatTime - songTime) * 1000); // ms
      if (diff < bestDiff) {
        bestDiff = diff;
        best     = tile;
      }
    });

    if (!best || bestDiff > MISS_WINDOW) {
      /* Early/late tap — no tile nearby */
      this.audio.playMiss();
      this._showFeedback('EARLY', this.laneCXs[lane], this.hitZoneY, '#f97316');
      return;
    }

    /* Hit! */
    best.hit   = true;
    best.flash = 0.12;
    this.hits++;

    /* Score based on timing */
    let points, label, color;
    if (bestDiff < 50) {
      points = 300; label = 'PERFECT!'; color = '#fbbf24';
      this.audio.playPerfect();
    } else if (bestDiff < HIT_WINDOW) {
      points = 150; label = 'GREAT';    color = '#22d3ee';
    } else {
      points = 60;  label = 'OK';       color = '#94a3b8';
    }

    this.combo = Math.min(this.combo + 1, 16);
    if (this.combo > this.bestCombo) this.bestCombo = this.combo;

    const earned = points * this.combo;
    this.score  += earned;

    /* Tile speed scales with progress */
    this.tileSpeed = TILE_SPEED_BASE + Math.floor(this.hits / 10) * SPEED_RAMP;

    /* Update HUD */
    this._scoreEl.textContent = this.score;
    this._comboEl.textContent = `x${this.combo}`;

    /* Particles & feedback */
    const px = this.laneCXs[lane];
    const py = this.hitZoneY;
    this.particles.emit(px, py, this.song.color[lane], 14);
    this._showFeedback(label, px, py - 40, color);

    /* Move ball to this lane */
    this.ball.lane      = lane;
    this.ball.glowColor = this.song.color[lane];
    this.ball.hop();
  }

  /* ── FEEDBACK LABEL ───────────────────────────────────────── */
  _showFeedback(text, x, y, color) {
    const el = document.createElement('div');
    el.className    = 'feedback-label';
    el.textContent  = text;
    el.style.color  = color;
    el.style.left   = `${x}px`;
    el.style.top    = `${y}px`;
    el.style.transform = 'translate(-50%, -50%)';
    el.style.textShadow = `0 0 12px ${color}`;
    this._feedbackEl.appendChild(el);
    el.addEventListener('animationend', () => el.remove());
  }
}

/* ── BOOT ─────────────────────────────────────────────────── */
window.addEventListener('DOMContentLoaded', () => {
  window._game = new Game();
});
