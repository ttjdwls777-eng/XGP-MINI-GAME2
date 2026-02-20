(() => {
  // ====== DOM ======
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");

  const timeText = document.getElementById("timeText");
  const scoreText = document.getElementById("scoreText");
  const bestText = document.getElementById("bestText");

  const overlay = document.getElementById("overlay");
  const startBtn = document.getElementById("startBtn");
  const resetBestBtn = document.getElementById("resetBestBtn");

  const diffHint = document.getElementById("diffHint");
  const diffButtons = [...document.querySelectorAll(".chip")];

  // ====== Utils ======
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

  function drawGlowText(text, x, y, size, color, glowColor, align = "center") {
    ctx.save();
    ctx.font = `${size}px "Press Start 2P", system-ui, sans-serif`;
    ctx.textAlign = align;
    ctx.textBaseline = "middle";
    ctx.shadowColor = glowColor;
    ctx.shadowBlur = 12;
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
    ctx.shadowBlur = 0;
    ctx.restore();
  }

  // ====== Canvas size ======
  const W = canvas.width;
  const H = canvas.height;

  // ====== Difficulty ======
  const DIFF = {
    EASY:   { targetSpeed: 110, arrowCd: 220, wind: 0.0, bonus: 1.00 },
    NORMAL: { targetSpeed: 140, arrowCd: 280, wind: 0.8, bonus: 1.08 },
    HARD:   { targetSpeed: 175, arrowCd: 320, wind: 1.5, bonus: 1.15 },
  };

  let difficulty = "EASY";

  const DIFF_HINT = {
    EASY:   "EASY: 조준만 / 파워 고정 / 타겟 조금 빠름",
    NORMAL: "NORMAL: 타겟 더 빠름 + 약간의 바람",
    HARD:   "HARD: 타겟 매우 빠름 + 강한 바람",
  };

  // ====== Persistent best ======
  const BEST_KEY = "xgp_archery_best_v2";
  let best = Number(localStorage.getItem(BEST_KEY) || 0);
  bestText.textContent = String(best);

  // ====== State ======
  let running = false;
  let lastTs = 0;

  let elapsed = 0; // seconds
  let score = 0;

  // Aim state (ANGLE ONLY)
  let aim = {
    angle: -Math.PI / 2, // straight up
  };

  // Player
  const player = {
    x: W / 2,
    y: H - 90,
    r: 18,
  };

  // Entities
  let arrows = [];
  let targets = [];
  let particles = [];

  let arrowCooldown = 0; // ms

  // ====== Input ======
  const keys = new Set();

  window.addEventListener("keydown", (e) => {
    if (["ArrowLeft", "ArrowRight", " ", "Space"].includes(e.key)) e.preventDefault();
    keys.add(e.key);

    if (e.key === "r" || e.key === "R") resetRound(true);
    if (!running) return;

    if (e.key === " " || e.key === "Space") shoot();
  });

  window.addEventListener("keyup", (e) => keys.delete(e.key));

  function canvasToLocal(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const sx = (clientX - rect.left) / rect.width;
    const sy = (clientY - rect.top) / rect.height;
    return { x: sx * W, y: sy * H };
  }

  // Pointer aim: wherever you point, you aim that direction (UP ONLY)
  function updateAimFromPointer(clientX, clientY) {
    const p = canvasToLocal(clientX, clientY);
    const dx = p.x - player.x;
    const dy = p.y - player.y;

    // Do not allow aiming downward
    if (dy > 0) return;

    aim.angle = Math.atan2(dy, dx);
    aim.angle = clamp(aim.angle, -Math.PI + 0.25, -0.25);
  }

  canvas.addEventListener("pointerdown", (e) => {
    updateAimFromPointer(e.clientX, e.clientY);
    canvas.setPointerCapture(e.pointerId);
  });

  canvas.addEventListener("pointermove", (e) => {
    updateAimFromPointer(e.clientX, e.clientY);
  });

  canvas.addEventListener("pointerup", () => {
    if (running) shoot();
  });

  // ====== UI: difficulty ======
  function setDifficulty(d) {
    difficulty = d;
    diffButtons.forEach((b) => b.classList.toggle("is-on", b.dataset.diff === d));
    if (diffHint) diffHint.textContent = DIFF_HINT[d] || "";
  }

  diffButtons.forEach((btn) => {
    btn.addEventListener("click", () => setDifficulty(btn.dataset.diff));
  });
  setDifficulty(difficulty);

  resetBestBtn.addEventListener("click", () => {
    localStorage.removeItem(BEST_KEY);
    best = 0;
    bestText.textContent = "0";
  });

  startBtn.addEventListener("click", () => {
    overlay.style.display = "none";
    startRound();
  });

  // ====== Game flow ======
  function startRound() {
    running = true;
    lastTs = performance.now();

    elapsed = 0;
    score = 0;

    arrows = [];
    targets = [];
    particles = [];
    arrowCooldown = 0;

    spawnTargets();
    updateHud();

    requestAnimationFrame(loop);
  }

  function resetRound(backToOverlay) {
    running = false;
    if (backToOverlay) overlay.style.display = "flex";
  }

  function updateHud() {
    if (timeText) timeText.textContent = elapsed.toFixed(1);
    if (scoreText) scoreText.textContent = String(score);
    if (bestText) bestText.textContent = String(best);
  }

  // ====== Targets ======
  function spawnTargets() {
    // scoreboards near the top
    const y0 = 120;
    const gap = 70;

    const base = [
      { points: 10, w: 150, core: 10 },
      { points: 25, w: 170, core: 11 },
      { points: 50, w: 190, core: 12 },
    ];

    targets = base.map((t, i) => ({
      x: lerp(90, W - 90, (i + 1) / 4),
      y: y0 + i * gap,
      w: t.w,
      h: 38,
      vx: (i % 2 === 0 ? 1 : -1) * (DIFF[difficulty].targetSpeed + i * 14),
      points: t.points,
      core: t.core,
      hitFlash: 0,
    }));
  }

  // ====== Particles ======
  function burst(x, y, n, kind) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 60 + Math.random() * 200;
      particles.push({
        x, y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        life: 0.5 + Math.random() * 0.45,
        t: 0,
        kind,
      });
    }
  }

  // ====== Collisions ======
  function arrowHitsTarget(ar, t) {
    const left = t.x - t.w / 2;
    const right = t.x + t.w / 2;
    const top = t.y - t.h / 2;
    const bottom = t.y + t.h / 2;

    const px = ar.x;
    const py = ar.y;

    return !(px < left || px > right || py < top || py > bottom);
  }

  function coreBonus(ar, t) {
    const dx = ar.x - t.x;
    const dy = ar.y - t.y;
    return Math.hypot(dx, dy) <= t.core;
  }

  // ====== Shooting (POWER FIXED) ======
  function shoot() {
    if (arrowCooldown > 0) return;

    // ✅ Always strong enough for top targets
    const power = 1500;

    let angle = aim.angle;
    angle = clamp(angle, -Math.PI + 0.25, -0.25);

    const vx = Math.cos(angle) * power;
    const vy = Math.sin(angle) * power;

    arrows.push({
      x: player.x,
      y: player.y - 18,
      vx, vy,
      rot: angle,
      alive: true,
      t: 0,
      hit: false,
    });

    arrowCooldown = DIFF[difficulty].arrowCd;
    burst(player.x, player.y - 22, 10, "mint");
  }

  // ====== Loop ======
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

    // keyboard aim (fine adjust)
    const left = keys.has("ArrowLeft") || keys.has("a") || keys.has("A");
    const right = keys.has("ArrowRight") || keys.has("d") || keys.has("D");

    if (left) aim.angle -= dt * 1.6;
    if (right) aim.angle += dt * 1.6;
    aim.angle = clamp(aim.angle, -Math.PI + 0.25, -0.25);

    // targets
    const wind = DIFF[difficulty].wind;
    for (const t of targets) {
      t.x += t.vx * dt;

      const pad = t.w / 2 + 14;
      if (t.x < pad) { t.x = pad; t.vx *= -1; }
      if (t.x > W - pad) { t.x = W - pad; t.vx *= -1; }

      t.hitFlash = Math.max(0, t.hitFlash - dt * 3);
    }

    // arrows physics
    const g = 780; // lower gravity -> longer arc
    for (const ar of arrows) {
      ar.t += dt;

      ar.vy += g * dt;
      ar.vx += wind * dt * 35;

      ar.x += ar.vx * dt;
      ar.y += ar.vy * dt;

      ar.rot = Math.atan2(ar.vy, ar.vx);

      // out of bounds
      if (ar.y > H + 60 || ar.x < -60 || ar.x > W + 60) ar.alive = false;

      // hit targets
      if (ar.alive) {
        for (const t of targets) {
          if (arrowHitsTarget(ar, t)) {
            ar.alive = false;
            ar.hit = true;
            t.hitFlash = 1;

            let add = t.points;
            const bonus = coreBonus(ar, t);
            if (bonus) add = Math.round(add * 2.0);

            add = Math.round(add * DIFF[difficulty].bonus);
            score += add;

            burst(ar.x, ar.y, bonus ? 26 : 16, bonus ? "gold" : "red");

            if (score > best) {
              best = score;
              localStorage.setItem(BEST_KEY, String(best));
            }
            break;
          }
        }
      }
    }

    // remove dead arrows
    arrows = arrows.filter((a) => a.alive);

    // particles
    for (const p of particles) {
      p.t += dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= (1 - dt * 2.2);
      p.vy *= (1 - dt * 2.2);
    }
    particles = particles.filter((p) => p.t < p.life);

    updateHud();
  }

  // ====== Render ======
  function render() {
    ctx.clearRect(0, 0, W, H);

    // star-ish noise
    ctx.save();
    ctx.globalAlpha = 0.25;
    for (let i = 0; i < 70; i++) {
      const x = (i * 73) % W;
      const y = (i * 191) % H;
      ctx.fillStyle = "rgba(255,255,255,0.35)";
      ctx.fillRect(x, y, 2, 2);
    }
    ctx.restore();

    // title
    drawGlowText("SCORE BOARDS", W / 2, 58, 14, "rgba(215,227,255,.9)", "rgba(255,213,74,.25)");

    // targets
    for (const t of targets) {
      const x = t.x - t.w / 2;
      const y = t.y - t.h / 2;

      ctx.save();
      const flash = t.hitFlash;

      ctx.fillStyle = `rgba(14,23,48,${0.95 - flash * 0.25})`;
      ctx.strokeStyle = flash > 0 ? "rgba(255,213,74,.85)" : "rgba(31,46,85,.9)";
      ctx.lineWidth = 2;

      drawRoundedRect(x, y, t.w, t.h, 10);
      ctx.fill();
      ctx.stroke();

      // core
      ctx.fillStyle = flash > 0 ? "rgba(255,213,74,.95)" : "rgba(255,213,74,.8)";
      ctx.beginPath();
      ctx.arc(t.x, t.y, t.core, 0, Math.PI * 2);
      ctx.fill();

      // points text
      ctx.shadowColor = "rgba(0,0,0,.5)";
      ctx.shadowBlur = 8;
      ctx.fillStyle = "rgba(215,227,255,.9)";
      ctx.font = `12px "Press Start 2P", system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(`${t.points}`, t.x, t.y + 1);
      ctx.shadowBlur = 0;

      ctx.restore();
    }

    // ground / player
    ctx.save();
    ctx.fillStyle = "rgba(255,255,255,.06)";
    ctx.fillRect(0, H - 70, W, 70);

    ctx.fillStyle = "rgba(46,242,194,.16)";
    ctx.strokeStyle = "rgba(46,242,194,.55)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(player.x, player.y, player.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // bow line
    const bowLen = 46;
    const ax = Math.cos(aim.angle), ay = Math.sin(aim.angle);
    const bx = player.x + ax * bowLen;
    const by = player.y + ay * bowLen;

    ctx.strokeStyle = "rgba(255,213,74,.9)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(player.x, player.y);
    ctx.lineTo(bx, by);
    ctx.stroke();

    // aim guide
    ctx.globalAlpha = 0.6;
    ctx.strokeStyle = "rgba(215,227,255,.35)";
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 6]);
    ctx.beginPath();
    ctx.moveTo(bx, by);
    ctx.lineTo(bx + ax * 240, by + ay * 240);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;

    ctx.restore();

    // arrows
    for (const ar of arrows) {
      ctx.save();
      ctx.translate(ar.x, ar.y);
      ctx.rotate(ar.rot);

      ctx.fillStyle = "rgba(215,227,255,.9)";
      ctx.fillRect(-18, -2, 26, 4);

      ctx.fillStyle = "rgba(255,213,74,.95)";
      ctx.beginPath();
      ctx.moveTo(10, 0);
      ctx.lineTo(18, -6);
      ctx.lineTo(18, 6);
      ctx.closePath();
      ctx.fill();

      ctx.fillStyle = "rgba(46,242,194,.9)";
      ctx.fillRect(-22, -5, 4, 10);

      ctx.restore();
    }

    // particles
    for (const p of particles) {
      const a = 1 - (p.t / p.life);
      ctx.save();
      ctx.globalAlpha = a;

      if (p.kind === "gold") ctx.fillStyle = "rgba(255,213,74,.95)";
      else if (p.kind === "red") ctx.fillStyle = "rgba(255,59,92,.9)";
      else ctx.fillStyle = "rgba(46,242,194,.9)";

      ctx.fillRect(p.x, p.y, 3, 3);
      ctx.restore();
    }

    // footer inside canvas
    ctx.save();
    ctx.globalAlpha = 0.75;
    ctx.fillStyle = "rgba(215,227,255,.55)";
    ctx.font = `10px "Press Start 2P", system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(`DIFF: ${difficulty}  |  SPACE: SHOOT`, W / 2, H - 22);
    ctx.restore();
  }

  // overlay visible initially
  overlay.style.display = "flex";
})();
