(() => {
  // ===== DOM =====
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");

  const timeText = document.getElementById("timeText");
  const scoreText = document.getElementById("scoreText");
  const bestText = document.getElementById("bestText");
  const diffText = document.getElementById("diffText");

  const overlay = document.getElementById("overlay");
  const startBtn = document.getElementById("startBtn");
  const resetBestBtn = document.getElementById("resetBestBtn");
  const resetBtn = document.getElementById("resetBtn");

  const diffHint = document.getElementById("diffHint");
  const diffButtons = [...document.querySelectorAll(".chip")];

  // ===== Utils =====
  const W = canvas.width;
  const H = canvas.height;

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;

  function drawRoundedRect(x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // ===== Audio (no files, GitHub Pages friendly) =====
  let audioCtx = null;
  function ensureAudio() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === "suspended") audioCtx.resume().catch(() => {});
  }

  function beep({ type = "square", f0 = 700, f1 = 420, dur = 0.08, gain = 0.06 }) {
    try {
      ensureAudio();
      if (!audioCtx) return;

      const t = audioCtx.currentTime;
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();

      o.type = type;
      o.frequency.setValueAtTime(f0, t);
      o.frequency.exponentialRampToValueAtTime(Math.max(40, f1), t + dur);

      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);

      o.connect(g);
      g.connect(audioCtx.destination);

      o.start(t);
      o.stop(t + dur + 0.02);
    } catch {}
  }

  const sfx = {
    shoot() { beep({ type: "square", f0: 520, f1: 260, dur: 0.07, gain: 0.05 }); },
    hit()   { beep({ type: "triangle", f0: 980, f1: 520, dur: 0.09, gain: 0.06 }); },
    crit()  { beep({ type: "sawtooth", f0: 1400, f1: 700, dur: 0.11, gain: 0.06 }); },
  };

  // ===== Difficulty =====
  const DIFF = {
    EASY:   { targetSpeed: 120, arrowCd: 210, wind: 0.0, bonus: 1.00 },
    NORMAL: { targetSpeed: 155, arrowCd: 260, wind: 0.9, bonus: 1.08 },
    HARD:   { targetSpeed: 190, arrowCd: 310, wind: 1.6, bonus: 1.15 },
  };
  const DIFF_HINT = {
    EASY:   "EASY: 타겟 빠름(기본) + 바람 없음",
    NORMAL: "NORMAL: 타겟 더 빠름 + 약간의 바람",
    HARD:   "HARD: 타겟 매우 빠름 + 강한 바람",
  };

  let difficulty = "EASY";

  function setDifficulty(d) {
    difficulty = d;
    diffButtons.forEach(b => b.classList.toggle("is-on", b.dataset.diff === d));
    if (diffHint) diffHint.textContent = DIFF_HINT[d] || "";
    if (diffText) diffText.textContent = d;
  }
  diffButtons.forEach(btn => btn.addEventListener("click", () => setDifficulty(btn.dataset.diff)));
  setDifficulty("EASY");

  // ===== Best Score =====
  const BEST_KEY = "xgp_archery_best_v4";
  let best = Number(localStorage.getItem(BEST_KEY) || 0);

  // ===== Game State =====
  let running = false;
  let lastTs = 0;
  let elapsed = 0;
  let score = 0;

  const player = { x: W / 2, y: H - 96, r: 18 };
  const aim = { angle: -Math.PI / 2 };

  let arrows = [];
  let targets = [];
  let particles = []; // small spark pixels
  let popups = [];    // floating score text

  let arrowCooldown = 0;

  // ===== Aim: pointer + keyboard =====
  function canvasToLocal(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const sx = (clientX - rect.left) / rect.width;
    const sy = (clientY - rect.top) / rect.height;
    return { x: sx * W, y: sy * H };
  }

  function updateAimFromPointer(clientX, clientY) {
    const p = canvasToLocal(clientX, clientY);
    const dx = p.x - player.x;
    const dy = p.y - player.y;
    if (dy > 0) return; // 아래쪽 조준 금지
    aim.angle = Math.atan2(dy, dx);
    aim.angle = clamp(aim.angle, -Math.PI + 0.25, -0.25);
  }

  canvas.addEventListener("pointerdown", (e) => {
    ensureAudio(); // 모바일 오디오 잠금 해제
    updateAimFromPointer(e.clientX, e.clientY);
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener("pointermove", (e) => updateAimFromPointer(e.clientX, e.clientY));
  canvas.addEventListener("pointerup", () => { if (running) shoot(); });

  const keys = new Set();
  window.addEventListener("keydown", (e) => {
    if (["ArrowLeft","ArrowRight"," ","Space"].includes(e.key)) e.preventDefault();
    keys.add(e.key);

    if (e.key === " " || e.key === "Space") {
      ensureAudio();
      if (running) shoot();
    }
    if (e.key === "r" || e.key === "R") resetRound();
  });
  window.addEventListener("keyup", (e) => keys.delete(e.key));

  // ===== UI Buttons =====
  startBtn.addEventListener("click", () => {
    overlay.style.display = "none";
    startRound();
  });

  resetBestBtn.addEventListener("click", () => {
    localStorage.removeItem(BEST_KEY);
    best = 0;
    bestText.textContent = "0";
  });

  resetBtn.addEventListener("click", () => resetRound());

  // ===== Targets =====
  function spawnTargets() {
    const y0 = 150;
    const gap = 92;
    const base = [
      { points: 10, core: 11, r: 18 },
      { points: 25, core: 12, r: 19 },
      { points: 50, core: 13, r: 20 },
    ];

    targets = base.map((t, i) => ({
      x: lerp(110, W - 110, (i + 1) / 4),
      y: y0 + i * gap,
      w: 210,
      h: 52,
      r: t.r,
      core: t.core,
      points: t.points,
      vx: (i % 2 === 0 ? 1 : -1) * (DIFF[difficulty].targetSpeed + i * 16),
      hitFlash: 0,
      spin: Math.random(),
    }));
  }

  // ===== FX =====
  function burst(x, y, n, kind) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 70 + Math.random() * 220;
      particles.push({
        x, y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        life: 0.35 + Math.random() * 0.45,
        t: 0,
        kind,
      });
    }
  }

  function addPopup(x, y, text, isCrit) {
    popups.push({
      x, y,
      vy: -60 - Math.random() * 30,
      t: 0,
      life: 0.75,
      text,
      isCrit,
    });
  }

  // ===== XGP Coin Draw (enhanced) =====
  function drawXGPCoin(x, y, r, spinT = 0) {
    // fake 3D thickness by vertical offset + ellipse wobble
    const wobble = 0.80 + 0.20 * Math.sin(spinT * Math.PI * 2);
    const rx = r * wobble;
    const ry = r;

    ctx.save();
    ctx.translate(x, y);

    // drop shadow
    ctx.globalAlpha = 0.45;
    ctx.fillStyle = "rgba(0,0,0,0.45)";
    ctx.beginPath();
    ctx.ellipse(3, 6, rx * 1.05, ry * 0.85, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;

    // thickness (side)
    ctx.fillStyle = "rgba(140,70,0,0.55)";
    ctx.beginPath();
    ctx.ellipse(0, 5, rx, ry * 0.98, 0, 0, Math.PI * 2);
    ctx.fill();

    // main face gradient
    const g = ctx.createRadialGradient(-rx * 0.35, -ry * 0.35, r * 0.18, 0, 0, r * 1.25);
    g.addColorStop(0, "rgba(255,250,210,0.98)");
    g.addColorStop(0.35, "rgba(255,213,74,0.98)");
    g.addColorStop(0.75, "rgba(255,170,0,0.98)");
    g.addColorStop(1, "rgba(160,80,0,0.98)");

    ctx.fillStyle = g;
    ctx.strokeStyle = "rgba(255,235,180,0.60)";
    ctx.lineWidth = Math.max(2, r * 0.12);
    ctx.beginPath();
    ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // rim dots
    ctx.save();
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = "rgba(255,235,180,0.85)";
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2;
      ctx.fillRect(Math.cos(a) * rx * 0.78 - 1, Math.sin(a) * ry * 0.78 - 1, 2, 2);
    }
    ctx.restore();

    // inner plate
    const g2 = ctx.createRadialGradient(-rx * 0.15, -ry * 0.15, r * 0.1, 0, 0, r);
    g2.addColorStop(0, "rgba(255,250,230,0.98)");
    g2.addColorStop(1, "rgba(255,190,20,0.98)");
    ctx.fillStyle = g2;
    ctx.strokeStyle = "rgba(100,45,0,0.35)";
    ctx.lineWidth = Math.max(1, r * 0.06);
    ctx.beginPath();
    ctx.ellipse(0, 0, rx * 0.62, ry * 0.62, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // sparkle stripe (animated)
    ctx.save();
    ctx.globalAlpha = 0.18 + 0.22 * (0.5 + 0.5 * Math.sin(spinT * Math.PI * 2));
    ctx.fillStyle = "rgba(255,255,255,0.95)";
    ctx.beginPath();
    ctx.ellipse(-rx * 0.20, -ry * 0.20, rx * 0.18, ry * 0.58, -0.35, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // XGP emboss
    ctx.save();
    ctx.font = `${Math.max(9, r * 0.62)}px "Press Start 2P", system-ui`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    ctx.fillStyle = "rgba(120,60,0,0.55)";
    ctx.fillText("XGP", 1, 2);

    ctx.fillStyle = "rgba(58,24,0,0.92)";
    ctx.fillText("XGP", 0, 0);

    ctx.restore();
    ctx.restore();
  }

  // ===== Collision =====
  function arrowHitsTarget(ar, t) {
    const left = t.x - t.w / 2;
    const right = t.x + t.w / 2;
    const top = t.y - t.h / 2;
    const bottom = t.y + t.h / 2;
    return !(ar.x < left || ar.x > right || ar.y < top || ar.y > bottom);
  }

  function isCriticalHit(ar, t) {
    // critical if arrow hits near coin center
    const dx = ar.x - t.x;
    const dy = ar.y - t.y;
    return Math.hypot(dx, dy) <= t.core;
  }

  // ===== Shooting (fixed power) =====
  function shoot() {
    if (arrowCooldown > 0) return;

    const power = 1500; // always strong
    let angle = aim.angle;
    angle = clamp(angle, -Math.PI + 0.25, -0.25);

    arrows.push({
      x: player.x,
      y: player.y - 18,
      vx: Math.cos(angle) * power,
      vy: Math.sin(angle) * power,
      rot: angle,
      alive: true,
    });

    arrowCooldown = DIFF[difficulty].arrowCd;
    sfx.shoot();
  }

  // ===== Game flow =====
  function startRound() {
    running = true;
    elapsed = 0;
    score = 0;

    arrows = [];
    particles = [];
    popups = [];
    arrowCooldown = 0;

    spawnTargets();
    lastTs = performance.now();

    updateHud();
    requestAnimationFrame(loop);
  }

  function resetRound() {
    running = false;
    overlay.style.display = "flex";
    // keep best
  }

  function updateHud() {
    timeText.textContent = elapsed.toFixed(1);
    scoreText.textContent = String(score);
    bestText.textContent = String(best);
  }

  // ===== Loop =====
  function loop(ts) {
    if (!running) return;

    const dtMs = clamp(ts - lastTs, 0, 34);
    const dt = dtMs / 1000;
    lastTs = ts;

    update(dt, dtMs);
    render();

    requestAnimationFrame(loop);
  }

  function update(dt, dtMs) {
    elapsed += dt;
    arrowCooldown = Math.max(0, arrowCooldown - dtMs);

    // keyboard fine aim
    const left = keys.has("ArrowLeft") || keys.has("a") || keys.has("A");
    const right = keys.has("ArrowRight") || keys.has("d") || keys.has("D");
    if (left) aim.angle -= dt * 1.7;
    if (right) aim.angle += dt * 1.7;
    aim.angle = clamp(aim.angle, -Math.PI + 0.25, -0.25);

    // targets
    const wind = DIFF[difficulty].wind;
    for (const t of targets) {
      t.spin = (t.spin + dt * 0.7) % 1;
      t.x += t.vx * dt;

      const pad = t.w / 2 + 16;
      if (t.x < pad) { t.x = pad; t.vx *= -1; }
      if (t.x > W - pad) { t.x = W - pad; t.vx *= -1; }

      t.hitFlash = Math.max(0, t.hitFlash - dt * 3);
    }

    // arrows
    const g = 780;
    for (const ar of arrows) {
      ar.vy += g * dt;
      ar.vx += wind * dt * 35;

      ar.x += ar.vx * dt;
      ar.y += ar.vy * dt;

      ar.rot = Math.atan2(ar.vy, ar.vx);

      if (ar.y > H + 80 || ar.x < -80 || ar.x > W + 80) ar.alive = false;

      if (ar.alive) {
        for (const t of targets) {
          if (arrowHitsTarget(ar, t)) {
            ar.alive = false;
            t.hitFlash = 1;

            const crit = isCriticalHit(ar, t);
            let add = t.points;
            if (crit) add = Math.round(add * 2);

            add = Math.round(add * DIFF[difficulty].bonus);
            score += add;

            // FX
            burst(ar.x, ar.y, crit ? 30 : 18, crit ? "gold" : "red");
            addPopup(ar.x, ar.y - 6, `+${add}`, crit);
            if (crit) sfx.crit(); else sfx.hit();

            if (score > best) {
              best = score;
              localStorage.setItem(BEST_KEY, String(best));
            }
            break;
          }
        }
      }
    }
    arrows = arrows.filter(a => a.alive);

    // particles
    for (const p of particles) {
      p.t += dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= (1 - dt * 2.2);
      p.vy *= (1 - dt * 2.2);
    }
    particles = particles.filter(p => p.t < p.life);

    // popups
    for (const s of popups) {
      s.t += dt;
      s.y += s.vy * dt;
      s.vy *= (1 - dt * 2.0);
    }
    popups = popups.filter(s => s.t < s.life);

    updateHud();
  }

  // ===== Render =====
  function render() {
    ctx.clearRect(0, 0, W, H);

    // subtle star dust
    ctx.save();
    ctx.globalAlpha = 0.18;
    for (let i = 0; i < 90; i++) {
      const x = (i * 79) % W;
      const y = (i * 211) % H;
      ctx.fillStyle = "rgba(255,255,255,0.35)";
      ctx.fillRect(x, y, 2, 2);
    }
    ctx.restore();

    // targets as boards + XGP coins
    for (const t of targets) {
      const x = t.x - t.w / 2;
      const y = t.y - t.h / 2;

      // board
      ctx.save();
      const flash = t.hitFlash;
      ctx.fillStyle = `rgba(8,8,20,${0.55 + flash * 0.10})`;
      ctx.strokeStyle = flash > 0 ? "rgba(255,213,74,0.85)" : "rgba(255,210,120,0.22)";
      ctx.lineWidth = 3;

      drawRoundedRect(x, y, t.w, t.h, 16);
      ctx.fill();
      ctx.stroke();

      // coin center
      drawXGPCoin(t.x, t.y, t.r, t.spin);

      // points label
      ctx.globalAlpha = 0.75;
      ctx.fillStyle = "rgba(255,243,215,0.85)";
      ctx.font = `10px "Press Start 2P", system-ui`;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillText(`+${t.points}`, t.x, t.y + 26);

      ctx.restore();
    }

    // popups (floating score)
    for (const s of popups) {
      const a = 1 - (s.t / s.life);
      ctx.save();
      ctx.globalAlpha = a;
      ctx.font = `12px "Press Start 2P", system-ui`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

      // outline
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      ctx.fillText(s.text, s.x + 1, s.y + 2);

      ctx.fillStyle = s.isCrit ? "rgba(255,213,74,0.95)" : "rgba(255,243,215,0.92)";
      ctx.fillText(s.text, s.x, s.y);
      ctx.restore();
    }

    // ground strip
    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,0.14)";
    ctx.fillRect(0, H - 90, W, 90);
    ctx.restore();

    // player
    ctx.save();
    ctx.fillStyle = "rgba(46,242,194,0.20)";
    ctx.strokeStyle = "rgba(46,242,194,0.65)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(player.x, player.y, player.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    // bow + aim line
    const bowLen = 54;
    const ax = Math.cos(aim.angle), ay = Math.sin(aim.angle);
    const bx = player.x + ax * bowLen;
    const by = player.y + ay * bowLen;

    ctx.save();
    ctx.strokeStyle = "rgba(255,213,74,0.92)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(player.x, player.y);
    ctx.lineTo(bx, by);
    ctx.stroke();

    ctx.globalAlpha = 0.55;
    ctx.strokeStyle = "rgba(255,243,215,0.35)";
    ctx.setLineDash([6, 6]);
    ctx.beginPath();
    ctx.moveTo(bx, by);
    ctx.lineTo(bx + ax * 260, by + ay * 260);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();

    // arrows
    for (const ar of arrows) {
      ctx.save();
      ctx.translate(ar.x, ar.y);
      ctx.rotate(ar.rot);
      ctx.fillStyle = "rgba(255,243,215,0.92)";
      ctx.fillRect(-18, -2, 28, 4);

      ctx.fillStyle = "rgba(255,213,74,0.95)";
      ctx.beginPath();
      ctx.moveTo(12, 0);
      ctx.lineTo(22, -6);
      ctx.lineTo(22, 6);
      ctx.closePath();
      ctx.fill();

      ctx.fillStyle = "rgba(46,242,194,0.95)";
      ctx.fillRect(-24, -5, 4, 10);
      ctx.restore();
    }

    // spark particles
    for (const p of particles) {
      const a = 1 - (p.t / p.life);
      ctx.save();
      ctx.globalAlpha = a;

      if (p.kind === "gold") ctx.fillStyle = "rgba(255,213,74,0.95)";
      else if (p.kind === "red") ctx.fillStyle = "rgba(255,59,92,0.90)";
      else ctx.fillStyle = "rgba(46,242,194,0.90)";

      ctx.fillRect(p.x, p.y, 3, 3);
      ctx.restore();
    }
  }

  // ===== Init =====
  bestText.textContent = String(best);
  scoreText.textContent = "0";
  timeText.textContent = "0.0";
  overlay.style.display = "flex";
})();
