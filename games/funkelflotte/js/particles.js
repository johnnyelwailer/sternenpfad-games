// Fullscreen canvas particle system with simple physics
// (gravity, drag, sway, rotation) for splashes, sparkles,
// confetti and per-world ambient effects.

const GRAVITY = 1400; // px/s²

let canvas = null;
let ctx = null;
let particles = [];
let ambientKind = null;
let ambientTimer = 0;
let running = false;
let lastT = 0;

export function init() {
  canvas = document.getElementById("fx");
  ctx = canvas.getContext("2d");
  resize();
  window.addEventListener("resize", resize);
  if (!running) {
    running = true;
    requestAnimationFrame(loop);
  }
}

function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.floor(window.innerWidth * dpr);
  canvas.height = Math.floor(window.innerHeight * dpr);
  canvas.style.width = `${window.innerWidth}px`;
  canvas.style.height = `${window.innerHeight}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

export function setAmbient(kind) {
  ambientKind = kind;
  ambientTimer = 0;
}

function rnd(a, b) {
  return a + Math.random() * (b - a);
}

function push(p) {
  if (particles.length < 900) particles.push(p);
}

// ---- bursts -------------------------------------------------------------

export function splash(x, y, color = "#8fd8ff") {
  for (let i = 0; i < 26; i += 1) {
    const a = rnd(-Math.PI * 0.9, -Math.PI * 0.1);
    const v = rnd(180, 520);
    push({
      kind: "drop",
      x, y,
      vx: Math.cos(a) * v,
      vy: Math.sin(a) * v,
      r: rnd(2, 6),
      color,
      life: rnd(0.5, 0.9),
      age: 0,
      g: 1,
    });
  }
}

export function sparkle(x, y, color = "#ffd447") {
  for (let i = 0; i < 30; i += 1) {
    const a = rnd(0, Math.PI * 2);
    const v = rnd(60, 420);
    push({
      kind: "star",
      x, y,
      vx: Math.cos(a) * v,
      vy: Math.sin(a) * v,
      r: rnd(3, 8),
      rot: rnd(0, Math.PI * 2),
      vr: rnd(-6, 6),
      color: Math.random() < 0.4 ? "#ffffff" : color,
      life: rnd(0.4, 1),
      age: 0,
      g: 0.25,
    });
  }
}

export function confetti(x, y, colors) {
  const palette = colors || ["#ff5f7e", "#ffd447", "#5be7a9", "#5bb2ff", "#c58bff"];
  for (let i = 0; i < 60; i += 1) {
    const a = rnd(-Math.PI, 0);
    const v = rnd(250, 750);
    push({
      kind: "confetti",
      x, y,
      vx: Math.cos(a) * v * rnd(0.4, 1),
      vy: Math.sin(a) * v,
      w: rnd(6, 12),
      h: rnd(4, 8),
      rot: rnd(0, Math.PI * 2),
      vr: rnd(-12, 12),
      sway: rnd(2, 6),
      color: palette[Math.floor(Math.random() * palette.length)],
      life: rnd(1.6, 3),
      age: 0,
      g: 0.55,
      drag: 0.99,
    });
  }
}

export function confettiRain(colors) {
  const w = window.innerWidth;
  for (let i = 0; i < 8; i += 1) {
    confetti(rnd(0, w), rnd(-40, 0), colors);
  }
}

export function emojiBurst(x, y, emoji, count = 10) {
  for (let i = 0; i < count; i += 1) {
    const a = rnd(-Math.PI, 0);
    const v = rnd(200, 600);
    push({
      kind: "emoji",
      x, y,
      vx: Math.cos(a) * v * rnd(0.3, 1),
      vy: Math.sin(a) * v,
      size: rnd(16, 30),
      rot: rnd(-0.6, 0.6),
      vr: rnd(-4, 4),
      emoji,
      life: rnd(1, 1.8),
      age: 0,
      g: 0.8,
    });
  }
}

// ---- ambient ------------------------------------------------------------

function spawnAmbient(dt) {
  if (!ambientKind) return;
  ambientTimer -= dt;
  if (ambientTimer > 0) return;
  ambientTimer = rnd(0.25, 0.7);
  const w = window.innerWidth;
  const h = window.innerHeight;
  if (ambientKind === "bubbles") {
    push({
      kind: "bubble",
      x: rnd(0, w), y: h + 20,
      vx: rnd(-15, 15), vy: rnd(-90, -40),
      r: rnd(4, 14), sway: rnd(1, 3), phase: rnd(0, 6),
      color: "rgba(255,255,255,0.35)",
      life: rnd(5, 9), age: 0, g: 0,
    });
  } else if (ambientKind === "stars") {
    push({
      kind: "twinkle",
      x: rnd(0, w), y: rnd(0, h * 0.9),
      vx: 0, vy: 0, r: rnd(1.5, 4), phase: rnd(0, 6),
      color: "#ffffff",
      life: rnd(2, 4), age: 0, g: 0,
    });
  } else if (ambientKind === "sprinkles") {
    push({
      kind: "confetti",
      x: rnd(0, w), y: -12,
      vx: rnd(-10, 10), vy: rnd(30, 80),
      w: rnd(3, 6), h: rnd(6, 12),
      rot: rnd(0, Math.PI * 2), vr: rnd(-3, 3), sway: rnd(1, 3),
      color: ["#fff3a3", "#ffd1e8", "#a3f7ff", "#caffb3"][Math.floor(rnd(0, 4))],
      life: rnd(6, 10), age: 0, g: 0.02, drag: 1,
    });
  } else if (ambientKind === "leaves") {
    push({
      kind: "emoji",
      x: rnd(0, w), y: -20,
      vx: rnd(-20, 20), vy: rnd(35, 70),
      size: rnd(12, 22), rot: rnd(0, 6), vr: rnd(-2, 2), sway: rnd(2, 5), phase: rnd(0, 6),
      emoji: Math.random() < 0.5 ? "🍃" : "🌿",
      life: rnd(7, 12), age: 0, g: 0.02,
    });
  }
}

// ---- simulation ---------------------------------------------------------

function loop(t) {
  const dt = Math.min(0.05, (t - lastT) / 1000 || 0.016);
  lastT = t;
  spawnAmbient(dt);

  ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
  const alive = [];
  for (const p of particles) {
    p.age += dt;
    if (p.age >= p.life) continue;
    p.vy += GRAVITY * (p.g || 0) * dt;
    if (p.drag) {
      p.vx *= p.drag;
      p.vy *= p.drag;
    }
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    if (p.sway) p.x += Math.sin(p.age * p.sway + (p.phase || 0)) * 30 * dt;
    if (p.vr) p.rot += p.vr * dt;
    draw(p);
    alive.push(p);
  }
  particles = alive;
  requestAnimationFrame(loop);
}

function draw(p) {
  const fade = 1 - p.age / p.life;
  ctx.globalAlpha = Math.min(1, fade * 2);
  if (p.kind === "drop" || p.kind === "bubble") {
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    if (p.kind === "bubble") {
      ctx.strokeStyle = p.color;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    } else {
      ctx.fillStyle = p.color;
      ctx.fill();
    }
  } else if (p.kind === "twinkle") {
    const tw = 0.5 + 0.5 * Math.sin(p.age * 6 + p.phase);
    ctx.globalAlpha = fade * tw;
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    ctx.fill();
  } else if (p.kind === "star") {
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rot);
    ctx.fillStyle = p.color;
    starPath(p.r);
    ctx.fill();
    ctx.restore();
  } else if (p.kind === "confetti") {
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rot);
    // fake 3D flutter by squashing on a sine
    ctx.scale(1, Math.max(0.15, Math.abs(Math.sin(p.age * 8 + p.rot))));
    ctx.fillStyle = p.color;
    ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
    ctx.restore();
  } else if (p.kind === "emoji") {
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rot);
    ctx.font = `${p.size}px system-ui`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(p.emoji, 0, 0);
    ctx.restore();
  }
  ctx.globalAlpha = 1;
}

function starPath(r) {
  ctx.beginPath();
  for (let i = 0; i < 10; i += 1) {
    const rad = i % 2 === 0 ? r : r * 0.45;
    const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
    const x = Math.cos(a) * rad;
    const y = Math.sin(a) * rad;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}
