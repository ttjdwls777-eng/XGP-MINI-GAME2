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

  const ovTitle = document.getElementById("ovTitle");
  const ovDesc = document.getElementById("ovDesc");
  const ovFinal = document.getElementById("ovFinal");

  const diffHint = document.getElementById("diffHint");
  const diffButtons = [...document.querySelectorAll(".chip")];

  // ===== Utils =====
  const W = canvas.width;
  const H = canvas.height;

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;

  // playfield (HUD 아래 ~ 바닥 위)
  const TOP = 88;
  const BOTTOM = H - 110;
  const LEFT = 26;
  const RIGHT = W - 26;

  // ===== Audio (no files) =====
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
      o.connect(g); g.connect(audioCtx.destination);
      o.start(t); o.stop(t + dur + 0.02);
    } catch {}
  }
  const sfx = {
    shoot() { beep({ type: "square", f0: 520, f1: 260, dur: 0.07, gain: 0.05 }); },
    hit()   { beep({ type: "triangle", f0: 980, f1: 520, dur: 0.09, gain: 0.06 }); },
    crit()  { beep({ type: "sawtooth", f0: 1400, f1: 700, dur: 0.11, gain: 0.06 }); },
    boom()  { beep({ type: "sawtooth", f0: 220, f1: 70, dur: 0.14, gain: 0.07 }); },
    timeup(){ beep({ type: "triangle", f0: 420, f1: 140, dur: 0.18, gain: 0.06 }); },
  };

  // ===== Difficulty =====
  const DIFF = {
    EASY:   { coins: 3, hazards: 4, move: 1.00, wind: 0.0, arrowCd: 210, bonus: 1.00, time: 30 },
    NORMAL: { coins: 4, hazards: 6, move: 1.25, wind: 0.9, arrowCd: 250, bonus: 1.08, time: 30 },
    HARD:   { coins: 5, hazards: 8, move: 1.45, wind: 1.6, arrowCd: 300, bonus: 1.15, time: 30 },
  };
  const DIFF_HINTS = {
    EASY:   "EASY: 코인/장애물 기본 속도",
    NORMAL: "NORMAL: 더 빠름 + 바람",
    HARD:   "HARD: 매우 빠름 + 강한 바람",
  };

  let difficulty = "EASY";
  function setDifficulty(d) {
    difficulty = d;
    diffButtons.forEach(b => b.classList.toggle("is-on", b.dataset.diff === d));
    diffHint.textContent = DIFF_HINTS[d] || "";
    diffText.textContent = d;
  }
  diffButtons.forEach(btn => btn.addEventListener("click", () => setDifficulty(btn.dataset.diff)));
  setDifficulty("EASY");

  // ===== Best =====
  const BEST_KEY = "xgp_archery_best_v5";
  let best = Number(localStorage.getItem(BEST_KEY) || 0);

  // ===== Game State =====
  let running = false;
  let lastTs = 0;

  let elapsed = 0;
  let score = 0;
  let remaining = DIFF[difficulty].time;

  const player = { x: W / 2, y: H - 92, r: 18 };
  const aim = { angle: -Math.PI / 2 };

  let arrows = [];
  let coins = [];
  let hazards = [];
  let particles = [];
  let popups = [];

  let arrowCooldown = 0;

  // ===== Helpers =====
  function rnd(min, max) { return min + Math.random() * (max - min); }

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
  function addPopup(x, y, text, isCrit, colorKind = "gold") {
    popups.push({
      x, y,
      vy: -70 - Math.random() * 35,
      t: 0,
      life: 0.8,
      text,
      isCrit,
      colorKind,
    });
  }

  // ===== Draw: XGP Coin =====
  function drawXGPCoin(x, y, r, spinT = 0) {
    const wobble = 0.80 + 0.20 * Math.sin(spinT * Math.PI * 2);
    const rx = r * wobble;
    const ry = r;

    ctx.save();
    ctx.translate(x, y);

    // shadow
    ctx.globalAlpha = 0.45;
    ctx.fillStyle = "rgba(0,0,0,0.45)";
    ctx.beginPath();
    ctx.ellipse(3, 6, rx * 1.05, ry * 0.85, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;

    // thickness
    ctx.fillStyle = "rgba(140,70,0,0.55)";
    ctx.beginPath();
    ctx.ellipse(0, 5, rx, ry * 0.98, 0, 0, Math.PI * 2);
    ctx.fill();

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

    // sparkle stripe
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

  // ===== Draw: Warning Hazard (triangle) =====
  function drawWarning(x, y, r, blinkT) {
    const blink = 0.55 + 0.45 * Math.sin(blinkT * Math.PI * 2);
    ctx.save();
    ctx.translate(x, y);

    // glow
    ctx.globalAlpha = 0.25 + 0.25 * blink;
    ctx.fillStyle = "rgba(255,59,92,0.85)";
    ctx.beginPath();
    ctx.arc(0, 0, r * 1.35, 0, Math.PI * 2);
    ctx.fill();

    // triangle body
    ctx.globalAlpha = 1;
    ctx.fillStyle = "rgba(255,59,92,0.95)";
    ctx.strokeStyle = "rgba(255,230,230,0.75)";
    ctx.lineWidth = 3;

    ctx.beginPath();
    ctx.moveTo(0, -r);
    ctx.lineTo(r * 0.9, r * 0.8);
    ctx.lineTo(-r * 0.9, r * 0.8);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // exclamation
    ctx.fillStyle = "rgba(255,255,255,0.92)";
    ctx.fillRect(-2, -r * 0.35, 4, r * 0.55);
    ctx.fillRect(-2, r * 0.35, 4, 4);

    ctx.restore();
  }

  // ===== Spawn =====
  function spawnEntities() {
    const cfg = DIFF[difficulty];
    coins = [];
    hazards = [];

    // coins
    for (let i = 0; i < cfg.coins; i++) {
      const r = 18 + i * 1.5;
      const points = i === cfg.coins - 1 ? 50 : (i === 0 ? 10 : 25);
      const core = 10 + i * 0.8;
      coins.push({
        x: rnd(LEFT + r, RIGHT - r),
        y: rnd(TOP + r, BOTTOM - 180),
        r,
        core,
        points,
        vx: rnd(-120, 120) * cfg.move,
        vy: rnd(-90, 90) * cfg.move,
        spin: Math.random(),
      });
    }

    // hazards
    for (let i = 0; i < cfg.hazards; i++) {
      const r = 16 + (i % 3);
      hazards.push({
        x: rnd(LEFT + r, RIGHT - r),
        y: rnd(TOP + r, BOTTOM - 140),
        r,
        vx: rnd(-150, 150) * cfg.move,
        vy: rnd(-120, 120) * cfg.move,
        blink: Math.random(),
      });
    }
  }

  // ===== Collisions =====
  function hitCircle(ax, ay, bx, by, br) {
    const dx = ax - bx;
    const dy = ay - by;
    return (dx * dx + dy * dy) <= (br * br);
  }

  // ===== Shooting =====
  function shoot() {
    if (!running) return;
    if (arrowCooldown > 0) return;

    const power = 1500; // 항상 강함
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

  // ===== Game Flow =====
  function showStartOverlay() {
    ovTitle.textContent = "XGP 양궁 미니게임";
    ovDesc.innerHTML =
      `파워는 자동(항상 강함)이고 <b>조준만</b> 하면 됩니다.<br/>
       코인 중앙을 맞추면 <span class="gold">보너스</span>!<br/>
       <span class="warn">⚠️ 경고(장애물)</span>을 맞추면 게임 오버!`;
    ovFinal.style.display = "none";
    startBtn.textContent = "START";
    overlay.style.display = "flex";
  }

  function gameOver(reason) {
    running = false;

    if (reason === "TIME") sfx.timeup();
    else sfx.boom();

    const rText = reason === "TIME" ? "시간 종료!" : "⚠️ 경고를 맞췄습니다!";
    ovTitle.textContent = "GAME OVER";
    ovDesc.innerHTML =
      `<span class="warn">${rText}</span><br/>
       최종 점수와 최고기록을 확인하세요.`;

    ovFinal.style.display = "block";
    ovFinal.innerHTML =
      `최종 점수: <span class="gold">${score}</span><br/>` +
      `최고 기록: <span class="gold">${best}</span>`;

    startBtn.textContent = "RETRY";
    overlay.style.display = "flex";
  }

  function startRound() {
    ensureAudio();
    running = true;
    lastTs = performance.now();

    elapsed = 0;
    score = 0;
    remaining = DIFF[difficulty].time;

    arrows = [];
    particles = [];
    popups = [];
    arrowCooldown = 0;

    spawnEntities();
    updateHud();
    overlay.style.display = "none";
    requestAnimationFrame(loop);
  }

  function resetRoundToOverlay() {
    running = false;
    showStartOverlay();
  }

  function updateHud() {
    timeText.textContent = remaining.toFixed(1);
    scoreText.textContent = String(score);
    bestText.textContent = String(best);
  }

  // ===== Input =====
  canvas.addEventListener("pointerdown", (e) => {
    ensureAudio();
    updateAimFromPointer(e.clientX, e.clientY);
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener("pointermove", (e) => updateAimFromPointer(e.clientX, e.clientY));
  canvas.addEventListener("pointerup", () => shoot());

  const keys = new Set();
  window.addEventListener("keydown", (e) => {
    if (["ArrowLeft","ArrowRight"," ","Space"].includes(e.key)) e.preventDefault();
    keys.add(e.key);

    if (e.key === " " || e.key === "Space") shoot();
    if (e.key === "r" || e.key === "R") resetRoundToOverlay();
  });
  window.addEventListener("keyup", (e) => keys.delete(e.key));

  // ===== UI =====
  startBtn.addEventListener("click", () => startRound());
  resetBtn.addEventListener("click", () => resetRoundToOverlay());

  resetBestBtn.addEventListener("click", () => {
    localStorage.removeItem(BEST_KEY);
    best = 0;
    bestText.textContent = "0";
  });

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
    remaining = Math.max(0, DIFF[difficulty].time - elapsed);

    if (remaining <= 0) {
      if (score > best) {
        best = score;
        localStorage.setItem(BEST_KEY, String(best));
      }
      updateHud();
      gameOver("TIME");
      return;
    }

    arrowCooldown = Math.max(0, arrowCooldown - dtMs);

    // keyboard fine aim
    const left = keys.has("ArrowLeft") || keys.has("a") || keys.has("A");
    const right = keys.has("ArrowRight") || keys.has("d") || keys.has("D");
    if (left) aim.angle -= dt * 1.7;
    if (right) aim.angle += dt * 1.7;
    aim.angle = clamp(aim.angle, -Math.PI + 0.25, -0.25);

    const cfg = DIFF[difficulty];
    const wind = cfg.wind;

    // coins move & bounce
    for (const c of coins) {
      c.spin = (c.spin + dt * 0.85) % 1;
      c.x += c.vx * dt;
      c.y += c.vy * dt;

      if (c.x < LEFT + c.r) { c.x = LEFT + c.r; c.vx *= -1; }
      if (c.x > RIGHT - c.r) { c.x = RIGHT - c.r; c.vx *= -1; }
      if (c.y < TOP + c.r) { c.y = TOP + c.r; c.vy *= -1; }
      if (c.y > BOTTOM - c.r) { c.y = BOTTOM - c.r; c.vy *= -1; }
    }

    // hazards move & bounce
    for (const h of hazards) {
      h.blink = (h.blink + dt * 1.4) % 1;
      h.x += h.vx * dt;
      h.y += h.vy * dt;

      if (h.x < LEFT + h.r) { h.x = LEFT + h.r; h.vx *= -1; }
      if (h.x > RIGHT - h.r) { h.x = RIGHT - h.r; h.vx *= -1; }
      if (h.y < TOP + h.r) { h.y = TOP + h.r; h.vy *= -1; }
      if (h.y > BOTTOM - h.r) { h.y = BOTTOM - h.r; h.vy *= -1; }
    }

    // arrows physics
    const g = 780;
    for (const ar of arrows) {
      ar.vy += g * dt;
      ar.vx += wind * dt * 35;

      ar.x += ar.vx * dt;
      ar.y += ar.vy * dt;

      ar.rot = Math.atan2(ar.vy, ar.vx);

      if (ar.y > H + 80 || ar.x < -80 || ar.x > W + 80) ar.alive = false;

      if (!ar.alive) continue;

      // hit hazard -> GAME OVER
      for (const h of hazards) {
        if (hitCircle(ar.x, ar.y, h.x, h.y, h.r * 0.95)) {
          ar.alive = false;
          burst(h.x, h.y, 36, "red");
          addPopup(h.x, h.y - 6, "BOOM", true, "red");

          if (score > best) {
            best = score;
            localStorage.setItem(BEST_KEY, String(best));
          }
          updateHud();
          gameOver("HAZARD");
          return;
        }
      }

      // hit coin -> score
      for (const c of coins) {
        if (hitCircle(ar.x, ar.y, c.x, c.y, c.r * 0.95)) {
          ar.alive = false;

          const crit = hitCircle(ar.x, ar.y, c.x, c.y, c.core);
          let add = c.points;
          if (crit) add = Math.round(add * 2);
          add = Math.round(add * cfg.bonus);

          score += add;
          if (score > best) {
            best = score;
            localStorage.setItem(BEST_KEY, String(best));
          }

          burst(c.x, c.y, crit ? 30 : 18, crit ? "gold" : "mint");
          addPopup(c.x, c.y - 6, `+${add}`, crit, "gold");
          if (crit) sfx.crit(); else sfx.hit();

          // coin reposition (계속 게임 진행)
          c.x = rnd(LEFT + c.r, RIGHT - c.r);
          c.y = rnd(TOP + c.r, BOTTOM - 180);
          c.vx = rnd(-140, 140) * cfg.move;
          c.vy = rnd(-110, 110) * cfg.move;
          c.spin = Math.random();

          break;
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

    // star dust
    ctx.save();
    ctx.globalAlpha = 0.18;
    for (let i = 0; i < 90; i++) {
      const x = (i * 79) % W;
      const y = (i * 211) % H;
      ctx.fillStyle = "rgba(255,255,255,0.35)";
      ctx.fillRect(x, y, 2, 2);
    }
    ctx.restore();

    // subtle playfield border
    ctx.save();
    ctx.strokeStyle = "rgba(255,210,120,0.14)";
    ctx.lineWidth = 2;
    drawRoundedRect(LEFT, TOP, RIGHT - LEFT, BOTTOM - TOP, 18);
    ctx.stroke();
    ctx.restore();

    // hazards
    for (const h of hazards) {
      drawWarning(h.x, h.y, h.r, h.blink);
    }

    // coins
    for (const c of coins) {
      drawXGPCoin(c.x, c.y, c.r, c.spin);
    }

    // popups
    for (const s of popups) {
      const a = 1 - (s.t / s.life);
      ctx.save();
      ctx.globalAlpha = a;
      ctx.font = `12px "Press Start 2P", system-ui`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

      ctx.fillStyle = "rgba(0,0,0,0.55)";
      ctx.fillText(s.text, s.x + 1, s.y + 2);

      if (s.colorKind === "red") ctx.fillStyle = "rgba(255,59,92,0.95)";
      else ctx.fillStyle = s.isCrit ? "rgba(255,213,74,0.95)" : "rgba(255,243,215,0.92)";
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

    // bow + aim guide
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

    // particles
    for (const p of particles) {
      const a = 1 - (p.t / p.life);
      ctx.save();
      ctx.globalAlpha = a;

      if (p.kind === "gold") ctx.fillStyle = "rgba(255,213,74,0.95)";
      else if (p.kind === "red") ctx.fillStyle = "rgba(255,59,92,0.90)";
      else if (p.kind === "mint") ctx.fillStyle = "rgba(46,242,194,0.90)";
      else ctx.fillStyle = "rgba(255,255,255,0.75)";

      ctx.fillRect(p.x, p.y, 3, 3);
      ctx.restore();
    }
  }

  // ===== Init =====
  bestText.textContent = String(best);
  scoreText.textContent = "0";
  timeText.textContent = String(DIFF[difficulty].time.toFixed(1));
  showStartOverlay();

  // Keep hint/diff text updated if user changes difficulty before start
  diffButtons.forEach(btn => {
    btn.addEventListener("click", () => {
      // if not running, update displayed time (still 30s but keep consistent)
      if (!running) timeText.textContent = String(DIFF[difficulty].time.toFixed(1));
    });
  });
})();
