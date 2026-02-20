(() => {
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

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;

  const W = canvas.width;
  const H = canvas.height;

  const DIFF = {
    EASY: { targetSpeed: 110, arrowCd: 220, wind: 0.0, bonus: 1.0 },
    NORMAL: { targetSpeed: 140, arrowCd: 280, wind: 0.8, bonus: 1.08 },
    HARD: { targetSpeed: 175, arrowCd: 320, wind: 1.5, bonus: 1.15 },
  };

  let difficulty = "EASY";

  const BEST_KEY = "xgp_archery_best_v3";
  let best = Number(localStorage.getItem(BEST_KEY) || 0);
  bestText.textContent = best;

  let running = false;
  let lastTs = 0;
  let elapsed = 0;
  let score = 0;

  let aim = { angle: -Math.PI / 2 };

  const player = { x: W / 2, y: H - 90, r: 18 };

  let arrows = [];
  let targets = [];
  let particles = [];

  let arrowCooldown = 0;

  // ===== XGP COIN DRAW =====
  function drawXGPCoin(x, y, r, spinT = 0) {
    const wobble = 0.92 + 0.08 * Math.sin(spinT * Math.PI * 2);
    const rx = r * wobble;
    const ry = r;

    ctx.save();
    ctx.translate(x, y);

    ctx.globalAlpha = 0.55;
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.beginPath();
    ctx.ellipse(2, 3, rx * 1.02, ry * 1.02, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;

    const g = ctx.createRadialGradient(-rx * 0.35, -ry * 0.35, r * 0.2, 0, 0, r * 1.2);
    g.addColorStop(0, "#fff8d0");
    g.addColorStop(0.35, "#ffd54a");
    g.addColorStop(0.75, "#ffb300");
    g.addColorStop(1, "#a65b00");

    ctx.fillStyle = g;
    ctx.strokeStyle = "rgba(255,235,180,0.6)";
    ctx.lineWidth = Math.max(2, r * 0.12);
    ctx.beginPath();
    ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = "rgba(255,235,180,0.85)";
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      ctx.fillRect(Math.cos(a) * rx * 0.78 - 1, Math.sin(a) * ry * 0.78 - 1, 2, 2);
    }

    const g2 = ctx.createRadialGradient(0, 0, r * 0.1, 0, 0, r);
    g2.addColorStop(0, "#fff8e0");
    g2.addColorStop(1, "#ffbe14");

    ctx.fillStyle = g2;
    ctx.beginPath();
    ctx.ellipse(0, 0, rx * 0.62, ry * 0.62, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.font = `${Math.max(8, r * 0.62)}px "Press Start 2P", system-ui`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    ctx.fillStyle = "rgba(120,60,0,0.55)";
    ctx.fillText("XGP", 1, 2);

    ctx.fillStyle = "#3a1800";
    ctx.fillText("XGP", 0, 0);

    ctx.restore();
  }

  // ===== INPUT =====
  function canvasToLocal(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((clientX - rect.left) / rect.width) * W,
      y: ((clientY - rect.top) / rect.height) * H,
    };
  }

  function updateAim(clientX, clientY) {
    const p = canvasToLocal(clientX, clientY);
    const dx = p.x - player.x;
    const dy = p.y - player.y;
    if (dy > 0) return;
    aim.angle = Math.atan2(dy, dx);
    aim.angle = clamp(aim.angle, -Math.PI + 0.25, -0.25);
  }

  canvas.addEventListener("pointermove", (e) => updateAim(e.clientX, e.clientY));
  canvas.addEventListener("pointerdown", (e) => updateAim(e.clientX, e.clientY));
  canvas.addEventListener("pointerup", () => running && shoot());

  window.addEventListener("keydown", (e) => {
    if (e.key === " ") shoot();
  });

  // ===== GAME FLOW =====
  startBtn.onclick = () => {
    overlay.style.display = "none";
    startRound();
  };

  resetBestBtn.onclick = () => {
    localStorage.removeItem(BEST_KEY);
    best = 0;
    bestText.textContent = 0;
  };

  function startRound() {
    running = true;
    elapsed = 0;
    score = 0;
    arrows = [];
    particles = [];
    spawnTargets();
    lastTs = performance.now();
    requestAnimationFrame(loop);
  }

  function spawnTargets() {
    targets = [
      { x: 120, y: 140, w: 150, h: 40, vx: 120, points: 10, core: 10, hitFlash: 0 },
      { x: 240, y: 210, w: 170, h: 40, vx: -140, points: 25, core: 11, hitFlash: 0 },
      { x: 360, y: 280, w: 190, h: 40, vx: 160, points: 50, core: 12, hitFlash: 0 },
    ];
  }

  function shoot() {
    if (arrowCooldown > 0) return;
    const power = 1500;
    const angle = aim.angle;

    arrows.push({
      x: player.x,
      y: player.y,
      vx: Math.cos(angle) * power,
      vy: Math.sin(angle) * power,
      rot: angle,
      alive: true,
    });

    arrowCooldown = DIFF[difficulty].arrowCd;
  }

  function loop(ts) {
    const dt = (ts - lastTs) / 1000;
    lastTs = ts;
    elapsed += dt;
    arrowCooldown -= dt * 1000;

    update(dt);
    render();
    requestAnimationFrame(loop);
  }

  function update(dt) {
    const g = 780;

    arrows.forEach((a) => {
      a.vy += g * dt;
      a.x += a.vx * dt;
      a.y += a.vy * dt;
      a.rot = Math.atan2(a.vy, a.vx);

      targets.forEach((t) => {
        if (
          a.x > t.x - t.w / 2 &&
          a.x < t.x + t.w / 2 &&
          a.y > t.y - t.h / 2 &&
          a.y < t.y + t.h / 2
        ) {
          score += t.points;
          best = Math.max(best, score);
          localStorage.setItem(BEST_KEY, best);
          a.alive = false;
        }
      });

      if (a.y > H) a.alive = false;
    });

    arrows = arrows.filter((a) => a.alive);

    targets.forEach((t) => {
      t.x += t.vx * dt;
      if (t.x < 80 || t.x > W - 80) t.vx *= -1;
    });

    timeText.textContent = elapsed.toFixed(1);
    scoreText.textContent = score;
    bestText.textContent = best;
  }

  // ===== RENDER =====
  function render() {
    ctx.clearRect(0, 0, W, H);

    targets.forEach((t) => {
      ctx.fillStyle = "#111a40";
      ctx.fillRect(t.x - t.w / 2, t.y - t.h / 2, t.w, t.h);

      drawXGPCoin(t.x, t.y, 16, (elapsed * 0.7) % 1);

      ctx.fillStyle = "#fff";
      ctx.font = "10px Press Start 2P";
      ctx.textAlign = "center";
      ctx.fillText(`+${t.points}`, t.x, t.y + 24);
    });

    ctx.fillStyle = "#2ef2c2";
    ctx.beginPath();
    ctx.arc(player.x, player.y, player.r, 0, Math.PI * 2);
    ctx.fill();

    const ax = Math.cos(aim.angle);
    const ay = Math.sin(aim.angle);
    ctx.strokeStyle = "#ffd54a";
    ctx.beginPath();
    ctx.moveTo(player.x, player.y);
    ctx.lineTo(player.x + ax * 60, player.y + ay * 60);
    ctx.stroke();

    arrows.forEach((a) => {
      ctx.save();
      ctx.translate(a.x, a.y);
      ctx.rotate(a.rot);
      ctx.fillStyle = "#fff";
      ctx.fillRect(-12, -2, 24, 4);
      ctx.restore();
    });
  }

  overlay.style.display = "flex";
})();
