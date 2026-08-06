// Funkel-Flotte — app shell: screens, rendering, interactions,
// hot-seat / robo / two-device play.

import * as E from "./engine.js";
import { createAiState, noteResult, nextShot } from "./ai.js";
import { WORLDS, getWorld } from "./worlds.js";
import * as SND from "./sound.js";
import * as FX from "./particles.js";
import { Net, makeCode, normalizeCode, joinUrl } from "./net.js";

const $ = (sel) => document.querySelector(sel);

const AVATARS = ["🦊", "🐻"];
const ROBO = "🤖";

const S = {
  mode: null, // 'ai' | 'hotseat' | 'online'
  isHost: false,
  world: getWorld("ozean"),
  // boards[0], boards[1]. online: 0 = mine (engine), 1 = shadow of opponent
  boards: [null, null],
  shadow: null, // online only: { size, marks:{}, found:[] }
  turn: 0,
  placingPlayer: 0,
  phase: "title",
  aiState: null,
  net: null,
  myReady: false,
  oppReady: false,
  rematchMine: false,
  rematchTheirs: false,
  inputLocked: false,
  passAction: null,
};

// ---------------------------------------------------------------- helpers

function show(screenId) {
  document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active"));
  $(`#${screenId}`).classList.add("active");
  $("#btn-home").hidden = screenId === "screen-title";
}

let toastTimer = null;
function toast(text, ms = 1800) {
  const el = $("#toast");
  el.textContent = text;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), ms);
}

function applyWorld(world) {
  S.world = world;
  const c = world.colors;
  const root = document.documentElement.style;
  root.setProperty("--bg1", c.bg1);
  root.setProperty("--bg2", c.bg2);
  root.setProperty("--cell", c.cell);
  root.setProperty("--cell-found", c.cellFound);
  root.setProperty("--accent", c.accent);
  root.setProperty("--text", c.text);
  document.querySelector('meta[name="theme-color"]').setAttribute("content", c.bg1);
  FX.setAmbient(world.ambient);
}

function goFullscreen() {
  const el = document.documentElement;
  if (!document.fullscreenElement && el.requestFullscreen) {
    el.requestFullscreen().catch(() => {});
  }
}

function creatureFor(ship) {
  return S.world.creatures[ship.id] || { name: "??", icon: "❓", size: ship.size };
}

function cellEl(boardEl, x, y) {
  return boardEl.querySelector(`[data-x="${x}"][data-y="${y}"]`);
}

function cellCenter(boardEl, x, y) {
  const el = cellEl(boardEl, x, y);
  if (!el) return { x: window.innerWidth / 2, y: window.innerHeight / 2 };
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

// ------------------------------------------------------------- rendering

function buildGrid(boardEl, size) {
  boardEl.innerHTML = "";
  boardEl.style.setProperty("--n", size);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const c = document.createElement("div");
      c.className = "cell";
      c.dataset.x = x;
      c.dataset.y = y;
      boardEl.appendChild(c);
    }
  }
}

function positionCapsule(el, ship, size) {
  const pct = 100 / size;
  el.classList.toggle("v", ship.dir === "v");
  el.style.left = `${ship.x * pct}%`;
  el.style.top = `${ship.y * pct}%`;
  el.style.width = `${(ship.dir === "h" ? ship.size : 1) * pct}%`;
  el.style.height = `${(ship.dir === "v" ? ship.size : 1) * pct}%`;
}

function capsuleContent(ship) {
  const creature = creatureFor(ship);
  let inner = "";
  for (let i = 0; i < ship.size; i += 1) {
    inner += `<span>${i === 0 ? creature.icon : "·"}</span>`;
  }
  return inner;
}

function renderCreatures(boardEl, board, { onlySunk = false, cls = "" } = {}) {
  boardEl.querySelectorAll(".creature").forEach((n) => n.remove());
  for (const ship of board.ships) {
    if (onlySunk && !E.isSunk(ship)) continue;
    const el = document.createElement("div");
    el.className = `creature ${cls}${E.isSunk(ship) ? " found" : ""}`;
    el.dataset.ship = ship.id;
    el.innerHTML = capsuleContent(ship);
    positionCapsule(el, ship, board.size);
    boardEl.appendChild(el);
  }
}

function renderFoundShadow(boardEl, shadow) {
  boardEl.querySelectorAll(".creature").forEach((n) => n.remove());
  for (const ship of shadow.found) {
    const el = document.createElement("div");
    el.className = "creature found";
    el.innerHTML = capsuleContent(ship);
    positionCapsule(el, ship, shadow.size);
    boardEl.appendChild(el);
  }
}

function renderMarks(boardEl, marks, animateKey = null) {
  const w = S.world;
  boardEl.querySelectorAll(".cell").forEach((cell) => {
    const k = E.key(cell.dataset.x, cell.dataset.y);
    const mark = marks[k];
    cell.classList.toggle("mark-miss", mark === E.MISS);
    cell.classList.toggle("mark-hit", mark === E.HIT);
    let mk = cell.querySelector(".mk");
    if (mark) {
      const icon = mark === E.MISS ? w.missIcon : w.hitIcon;
      if (!mk) {
        mk = document.createElement("span");
        mk.className = "mk";
        cell.appendChild(mk);
      }
      if (mk.textContent !== icon) mk.textContent = icon;
      if (k === animateKey) {
        cell.classList.remove("pop");
        void cell.offsetWidth;
        cell.classList.add("pop");
      }
    } else if (mk) {
      mk.remove();
    }
  });
}

function renderFleetChips(found) {
  const box = $("#fleet-status");
  box.innerHTML = "";
  S.world.creatures.forEach((c, id) => {
    const chip = document.createElement("span");
    chip.className = `fleet-chip${found.has(id) ? " done" : ""}`;
    chip.innerHTML = `${c.icon} <small>${"◦".repeat(c.size)}</small>`;
    box.appendChild(chip);
  });
}

// ------------------------------------------------------------- title flow

function buildWorldPicker() {
  const grid = $("#world-grid");
  grid.innerHTML = "";
  for (const world of Object.values(WORLDS)) {
    const card = document.createElement("button");
    card.className = "world-card";
    card.dataset.world = world.id;
    card.innerHTML = `<span class="wicon">${world.icon}</span>${world.name}`;
    card.addEventListener("click", () => {
      SND.unlock();
      SND.tap();
      applyWorld(world);
      grid.querySelectorAll(".world-card").forEach((c) => c.classList.remove("selected"));
      card.classList.add("selected");
    });
    grid.appendChild(card);
  }
  grid.querySelector('[data-world="ozean"]').classList.add("selected");
}

function newBoardWithFleet() {
  const b = E.createBoard();
  E.randomFleet(b);
  return b;
}

function startMode(mode) {
  SND.unlock();
  SND.whoosh();
  goFullscreen();
  S.mode = mode;
  S.turn = 0;
  S.rematchMine = false;
  S.rematchTheirs = false;
  S.inputLocked = false;

  if (mode === "ai") {
    S.boards = [newBoardWithFleet(), newBoardWithFleet()];
    S.aiState = createAiState("leicht");
    S.placingPlayer = 0;
    showPlacement(0);
  } else if (mode === "hotseat") {
    S.boards = [newBoardWithFleet(), newBoardWithFleet()];
    S.placingPlayer = 0;
    showPlacement(0);
  } else {
    show("screen-online");
  }
}

// ------------------------------------------------------------- placement

let drag = null;
let selectedShip = null;

function showPlacement(player) {
  S.phase = "place";
  S.placingPlayer = player;
  selectedShip = null;
  const who =
    S.mode === "hotseat" ? `${AVATARS[player]} Spieler ${player + 1}` : `${AVATARS[0]} Du`;
  $("#place-status").innerHTML = `<span class="avatar">${S.world.icon}</span> ${who}: Verstecke deine Freunde!`;
  const boardEl = $("#place-board");
  buildGrid(boardEl, S.boards[player].size);
  renderCreatures(boardEl, S.boards[player], { cls: "bob" });
  $("#btn-place-done").disabled = false;
  $("#btn-place-done").textContent = "✅ Fertig!";
  show("screen-place");
}

function placementBoard() {
  return S.boards[S.placingPlayer];
}

function refreshPlacement() {
  const boardEl = $("#place-board");
  renderCreatures(boardEl, placementBoard(), { cls: "bob" });
  if (selectedShip !== null) {
    const el = boardEl.querySelector(`.creature[data-ship="${selectedShip}"]`);
    if (el) el.classList.add("selected");
  }
}

function setupPlacementInput() {
  const boardEl = $("#place-board");
  boardEl.addEventListener("contextmenu", (e) => e.preventDefault());

  boardEl.addEventListener("pointerdown", (e) => {
    const capsule = e.target.closest(".creature");
    if (!capsule || S.phase !== "place") return;
    e.preventDefault();
    const board = placementBoard();
    const ship = board.ships.find((s) => s.id === Number(capsule.dataset.ship));
    if (!ship) return;
    const rect = boardEl.getBoundingClientRect();
    const cellSize = rect.width / board.size;
    const px = Math.floor((e.clientX - rect.left) / cellSize);
    const py = Math.floor((e.clientY - rect.top) / cellSize);
    drag = {
      ship,
      capsule,
      grabDx: px - ship.x,
      grabDy: py - ship.y,
      startClientX: e.clientX,
      startClientY: e.clientY,
      moved: false,
      previewX: ship.x,
      previewY: ship.y,
    };
    capsule.setPointerCapture(e.pointerId);
  });

  boardEl.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.startClientX;
    const dy = e.clientY - drag.startClientY;
    if (!drag.moved && Math.hypot(dx, dy) < 9) return;
    drag.moved = true;
    drag.capsule.classList.add("dragging");
    const board = placementBoard();
    const rect = boardEl.getBoundingClientRect();
    const cellSize = rect.width / board.size;
    const px = Math.floor((e.clientX - rect.left) / cellSize);
    const py = Math.floor((e.clientY - rect.top) / cellSize);
    const maxX = board.size - (drag.ship.dir === "h" ? drag.ship.size : 1);
    const maxY = board.size - (drag.ship.dir === "v" ? drag.ship.size : 1);
    drag.previewX = Math.max(0, Math.min(maxX, px - drag.grabDx));
    drag.previewY = Math.max(0, Math.min(maxY, py - drag.grabDy));
    const candidate = { ...drag.ship, x: drag.previewX, y: drag.previewY };
    positionCapsule(drag.capsule, candidate, board.size);
    const ok = E.canPlace(board, candidate, drag.ship.id);
    drag.capsule.classList.toggle("invalid", !ok);
  });

  const finishDrag = (e) => {
    if (!drag) return;
    const board = placementBoard();
    const { ship, capsule, moved, previewX, previewY } = drag;
    drag = null;
    capsule.classList.remove("dragging", "invalid");
    let ok;
    if (moved) {
      ok = E.moveShip(board, ship.id, previewX, previewY, ship.dir);
    } else {
      // tap = rotate (around head cell, clamped into the board)
      const dir = ship.dir === "h" ? "v" : "h";
      const maxX = board.size - (dir === "h" ? ship.size : 1);
      const maxY = board.size - (dir === "v" ? ship.size : 1);
      const nx = Math.max(0, Math.min(maxX, ship.x));
      const ny = Math.max(0, Math.min(maxY, ship.y));
      ok = E.moveShip(board, ship.id, nx, ny, dir);
    }
    selectedShip = ship.id;
    refreshPlacement();
    if (ok) {
      SND.tap();
    } else {
      SND.sad();
      // shake the freshly rendered capsule so the kid sees "that
      // spot doesn't work"
      const fresh = boardEl.querySelector(`.creature[data-ship="${ship.id}"]`);
      if (fresh) {
        fresh.classList.add("shake");
        setTimeout(() => fresh.classList.remove("shake"), 500);
      }
    }
  };

  boardEl.addEventListener("pointerup", finishDrag);
  boardEl.addEventListener("pointercancel", finishDrag);
}

function placementDone() {
  SND.tap();
  if (S.mode === "hotseat") {
    if (S.placingPlayer === 0) {
      showPass({
        emoji: "🙈",
        title: `Gib das Gerät an ${AVATARS[1]} Spieler 2!`,
        sub: "Nicht spicken! Spieler 2 versteckt jetzt seine Freunde.",
        btn: "Ich bin Spieler 2! 👋",
        action: () => showPlacement(1),
      });
    } else {
      showPass({
        emoji: "🎉",
        title: `Alles versteckt! Gib das Gerät an ${AVATARS[0]} Spieler 1!`,
        sub: "Spieler 1 fängt an zu suchen.",
        btn: "Los geht die Suche! 🔍",
        action: () => startBattle(0),
      });
    }
  } else if (S.mode === "ai") {
    startBattle(0);
  } else if (S.mode === "online") {
    S.myReady = true;
    $("#btn-place-done").disabled = true;
    $("#btn-place-done").textContent = "⏳ Warte auf Mitspieler …";
    S.net.send({ t: "ready" });
    maybeStartOnline();
  }
}

// ------------------------------------------------------------- pass screen

function showPass({ emoji, title, sub, btn, action }) {
  $("#pass-emoji").textContent = emoji;
  $("#pass-title").textContent = title;
  $("#pass-sub").textContent = sub;
  $("#btn-pass-go").textContent = btn;
  S.passAction = action;
  show("screen-pass");
}

// ------------------------------------------------------------- battle

function enemyIndexFor(shooter) {
  return 1 - shooter;
}

function viewMarks(index) {
  // marks made ON board `index`
  if (S.mode === "online" && index === 1) return S.shadow.marks;
  return S.boards[index].shots;
}

function foundSetOnEnemy(shooter) {
  const idx = enemyIndexFor(shooter);
  if (S.mode === "online" && idx === 1) {
    return new Set(S.shadow.found.map((s) => s.id));
  }
  return new Set(S.boards[idx].ships.filter(E.isSunk).map((s) => s.id));
}

function startBattle(firstTurn) {
  S.phase = "battle";
  S.turn = firstTurn;
  S.inputLocked = false;
  $("#btn-endturn").hidden = true;
  buildGrid($("#enemy-board"), E.DEFAULT_GRID);
  buildGrid($("#own-board"), E.DEFAULT_GRID);
  renderBattle();
  show("screen-battle");
  if (S.mode === "ai" && firstTurn === 1) {
    scheduleRoboTurn();
  }
}

// Which player is looking at the screen right now?
function viewer() {
  if (S.mode === "hotseat") return S.turn;
  return 0;
}

function renderBattle(animateEnemyKey = null, animateOwnKey = null) {
  const me = viewer();
  const enemyIdx = enemyIndexFor(me);
  const enemyBoardEl = $("#enemy-board");
  const ownBoardEl = $("#own-board");

  // enemy board: marks + only found creatures
  renderMarks(enemyBoardEl, viewMarks(enemyIdx), animateEnemyKey);
  if (S.mode === "online") {
    renderFoundShadow(enemyBoardEl, S.shadow);
  } else {
    renderCreatures(enemyBoardEl, S.boards[enemyIdx], { onlySunk: true });
  }

  // own mini board: all my creatures + enemy's marks on me
  renderMarks(ownBoardEl, viewMarks(me), animateOwnKey);
  renderCreatures(ownBoardEl, S.boards[me]);

  renderFleetChips(foundSetOnEnemy(me));
  updateStatus();
  syncEnemyLock();
}

// Dim the enemy board whenever tapping it can't do anything, so kids
// always see where the action is.
function syncEnemyLock() {
  let locked;
  if (S.mode === "hotseat") {
    locked = S.inputLocked; // waiting for "Weitergeben"
  } else {
    locked = S.turn !== 0;
  }
  $("#enemy-wrap").classList.toggle("locked", locked && S.phase === "battle");
  $("#enemy-label").textContent = locked ? "Gleich bist du dran …" : "Hier suchen! 👇";
}

function updateStatus() {
  const el = $("#battle-status");
  const w = S.world;
  if (S.mode === "hotseat") {
    el.innerHTML = `<span class="avatar">${AVATARS[S.turn]}</span> Spieler ${S.turn + 1}, such ${w.name === "Ozean" ? "im Wasser" : "gut"}! Tippe auf ein Feld.`;
  } else if (S.mode === "ai") {
    el.innerHTML =
      S.turn === 0
        ? `<span class="avatar">${AVATARS[0]}</span> Du bist dran! Tippe auf ein Feld.`
        : `<span class="avatar">${ROBO}</span> Robo sucht gerade …`;
  } else {
    el.innerHTML =
      S.turn === 0
        ? `<span class="avatar">${AVATARS[S.isHost ? 0 : 1]}</span> Du bist dran! Tippe auf ein Feld.`
        : `<span class="avatar">${AVATARS[S.isHost ? 1 : 0]}</span> Dein Freund sucht gerade …`;
  }
}

function fxForResult(result, boardEl, x, y) {
  const pos = cellCenter(boardEl, x, y);
  const w = S.world;
  if (navigator.vibrate) {
    navigator.vibrate(result === E.SUNK ? [60, 40, 90] : result === E.HIT ? 40 : 15);
  }
  if (result === E.MISS) {
    SND.plop();
    FX.splash(pos.x, pos.y, w.id === "ozean" ? "#8fd8ff" : w.colors.cellFound);
  } else if (result === E.HIT) {
    SND.sparkle();
    FX.sparkle(pos.x, pos.y, w.colors.accent);
  } else if (result === E.SUNK) {
    SND.fanfare();
    FX.sparkle(pos.x, pos.y, w.colors.accent);
    FX.confetti(pos.x, pos.y);
  }
}

function statusFlash(text) {
  $("#battle-status").innerHTML = text;
}

// -- hot-seat + AI: shooter taps enemy board ------------------------------

function setupBattleInput() {
  $("#enemy-board").addEventListener("click", (e) => {
    const cell = e.target.closest(".cell");
    if (!cell || S.phase !== "battle" || S.inputLocked) return;
    const x = Number(cell.dataset.x);
    const y = Number(cell.dataset.y);

    if (S.mode === "online") {
      onlineShoot(x, y);
      return;
    }
    if (S.mode === "ai" && S.turn !== 0) return;

    const shooter = S.turn;
    const targetBoard = S.boards[enemyIndexFor(shooter)];
    const res = E.fire(targetBoard, x, y);
    if (res.result === E.REPEAT) {
      SND.tap();
      return;
    }
    handleLocalResult(shooter, x, y, res);
  });
}

function handleLocalResult(shooter, x, y, res) {
  const enemyBoardEl = $("#enemy-board");
  renderBattle(E.key(x, y));
  fxForResult(res.result, enemyBoardEl, x, y);
  const w = S.world;

  if (res.gameOver) {
    finishGame(shooter);
    return;
  }

  if (res.result === E.MISS) {
    statusFlash(`${w.words.miss}`);
    if (S.mode === "hotseat") {
      S.inputLocked = true;
      $("#btn-endturn").hidden = false;
      syncEnemyLock();
    } else {
      // robo's turn
      S.turn = 1;
      S.inputLocked = true;
      syncEnemyLock();
      setTimeout(() => {
        updateStatus();
        scheduleRoboTurn();
      }, 900);
    }
  } else if (res.result === E.HIT) {
    statusFlash(`${w.words.hit} Nochmal! 🎯`);
  } else if (res.result === E.SUNK) {
    const creature = creatureFor(res.ship);
    statusFlash(`${creature.icon} ${creature.name} ${w.words.sunk} Nochmal! 🎯`);
  }
}

function hotseatEndTurn() {
  SND.tap();
  $("#btn-endturn").hidden = true;
  const next = enemyIndexFor(S.turn);
  showPass({
    emoji: "🔄",
    title: `Gib das Gerät an ${AVATARS[next]} Spieler ${next + 1}!`,
    sub: "Jetzt darf der andere suchen.",
    btn: "Ich bin dran! 👋",
    action: () => {
      S.turn = next;
      S.inputLocked = false;
      startBattleViewRefresh();
    },
  });
}

function startBattleViewRefresh() {
  S.phase = "battle";
  renderBattle();
  show("screen-battle");
}

// -- robo -----------------------------------------------------------------

function scheduleRoboTurn() {
  if (S.phase !== "battle" || S.mode !== "ai" || S.turn !== 1) return;
  setTimeout(() => {
    if (S.phase !== "battle" || S.mode !== "ai" || S.turn !== 1) return;
    const myBoard = S.boards[0];
    const shot = nextShot(S.aiState, myBoard);
    if (!shot) return;
    const res = E.fire(myBoard, shot.x, shot.y);
    noteResult(S.aiState, shot.x, shot.y, res.result, res.ship ? E.shipCells(res.ship) : null);
    renderBattle(null, E.key(shot.x, shot.y));
    fxForResult(res.result, $("#own-board"), shot.x, shot.y);

    if (res.gameOver) {
      finishGame(1);
      return;
    }
    if (res.result === E.MISS) {
      S.turn = 0;
      S.inputLocked = false;
      updateStatus();
      syncEnemyLock();
    } else {
      const creature = res.ship ? creatureFor(res.ship) : null;
      statusFlash(
        res.result === E.SUNK && creature
          ? `${ROBO} Robo hat ${creature.name} gefunden! 😮`
          : `${ROBO} Robo hat was gefunden! Er sucht weiter …`
      );
      scheduleRoboTurn();
    }
  }, 1100);
}

// -- online ---------------------------------------------------------------

function newShadow() {
  return { size: E.DEFAULT_GRID, marks: {}, found: [] };
}

function hostGame() {
  SND.tap();
  const code = makeCode();
  S.isHost = true;
  S.net = new Net();
  wireNet();
  $("#host-code").textContent = "····";
  $("#qr-box").innerHTML = "";
  $("#host-status").textContent = "Verbinde mit dem Zauber-Server …";
  show("screen-host");
  S.net
    .host(code)
    .then(() => {
      $("#host-code").textContent = code;
      $("#host-status").textContent = "Warte auf Mitspieler …";
      const qr = qrcode(0, "M");
      qr.addData(joinUrl(code));
      qr.make();
      $("#qr-box").innerHTML = qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
    })
    .catch(() => {
      toast("Ohje, das hat nicht geklappt. Probier es nochmal! 🙈");
      goHome();
    });
}

function joinGame(code) {
  SND.tap();
  $("#join-error").textContent = "";
  const btn = $("#btn-join-go");
  btn.disabled = true;
  btn.textContent = "⏳ Verbinde …";
  S.isHost = false;
  S.net = new Net();
  wireNet();
  S.net
    .join(code)
    .then(() => {
      // wait for hello (world info) — handled in wireNet
    })
    .catch((err) => {
      btn.disabled = false;
      btn.textContent = "Los! 🚀";
      $("#join-error").textContent =
        err.message === "not-found"
          ? "Kein Spiel mit diesem Code gefunden. Stimmt der Code?"
          : "Verbindung klappt nicht. Haben beide Geräte Internet?";
      S.net.destroy();
      S.net = null;
    });
}

function wireNet() {
  S.net.onStatus = (status) => {
    if (status === "connected" && S.isHost) {
      $("#host-status").textContent = "Verbunden! 🎉";
      S.net.send({ t: "hello", v: 1, world: S.world.id });
      beginOnlinePlacement();
    }
  };
  S.net.onMessage = (msg) => handleNetMessage(msg);
  S.net.onClose = () => {
    if (S.phase === "over") return;
    toast("Die Verbindung ist weg. 😢", 2600);
    goHome();
  };
}

function beginOnlinePlacement() {
  S.boards = [newBoardWithFleet(), null];
  S.shadow = newShadow();
  S.myReady = false;
  S.oppReady = false;
  S.rematchMine = false;
  S.rematchTheirs = false;
  $("#btn-rematch").disabled = false;
  $("#btn-rematch").textContent = "🔁 Nochmal spielen";
  showPlacement(0);
}

function maybeStartOnline() {
  if (!(S.myReady && S.oppReady)) return;
  if (S.isHost) {
    const hostStarts = Math.random() < 0.5;
    S.net.send({ t: "start", youStart: !hostStarts });
    startBattle(hostStarts ? 0 : 1);
    toast(hostStarts ? "Du fängst an! 🍀" : "Dein Freund fängt an!");
  }
}

function onlineShoot(x, y) {
  if (S.turn !== 0 || S.inputLocked) return;
  if (S.shadow.marks[E.key(x, y)]) {
    SND.tap();
    return;
  }
  S.inputLocked = true;
  if (!S.net.send({ t: "shot", x, y })) {
    S.inputLocked = false;
  }
}

function handleNetMessage(msg) {
  switch (msg.t) {
    case "hello": {
      // guest receives world choice
      applyWorld(getWorld(msg.world));
      beginOnlinePlacement();
      break;
    }
    case "ready": {
      S.oppReady = true;
      maybeStartOnline();
      break;
    }
    case "start": {
      startBattle(msg.youStart ? 0 : 1);
      toast(msg.youStart ? "Du fängst an! 🍀" : "Dein Freund fängt an!");
      break;
    }
    case "shot": {
      // opponent shoots at my real board
      const res = E.fire(S.boards[0], msg.x, msg.y);
      S.net.send({
        t: "result",
        x: msg.x,
        y: msg.y,
        result: res.result,
        ship: res.result === E.SUNK ? { id: res.ship.id, size: res.ship.size, x: res.ship.x, y: res.ship.y, dir: res.ship.dir } : null,
        revealed: res.revealed,
        gameOver: res.gameOver,
      });
      if (res.result === E.REPEAT) break;
      renderBattle(null, E.key(msg.x, msg.y));
      fxForResult(res.result, $("#own-board"), msg.x, msg.y);
      if (res.gameOver) {
        finishGame(1);
      } else if (res.result === E.MISS) {
        S.turn = 0;
        S.inputLocked = false;
        updateStatus();
        syncEnemyLock();
        toast("Du bist dran! 🎯");
      } else {
        statusFlash("Dein Freund hat was gefunden und sucht weiter …");
      }
      break;
    }
    case "result": {
      S.inputLocked = false;
      if (msg.result === E.REPEAT) break;
      const k = E.key(msg.x, msg.y);
      S.shadow.marks[k] = msg.result === E.MISS ? E.MISS : E.HIT;
      if (msg.result === E.SUNK && msg.ship) {
        S.shadow.found.push(msg.ship);
        for (const c of msg.revealed || []) {
          S.shadow.marks[E.key(c.x, c.y)] = E.MISS;
        }
      }
      renderBattle(k);
      fxForResult(msg.result === E.SUNK ? E.SUNK : msg.result, $("#enemy-board"), msg.x, msg.y);
      if (msg.gameOver) {
        finishGame(0);
      } else if (msg.result === E.MISS) {
        S.turn = 1;
        updateStatus();
        syncEnemyLock();
      } else if (msg.result === E.SUNK && msg.ship) {
        const creature = creatureFor(msg.ship);
        statusFlash(`${creature.icon} ${creature.name} ${S.world.words.sunk} Nochmal! 🎯`);
      } else {
        statusFlash(`${S.world.words.hit} Nochmal! 🎯`);
      }
      break;
    }
    case "rematch": {
      S.rematchTheirs = true;
      maybeRematch();
      break;
    }
    default:
      break;
  }
}

function maybeRematch() {
  if (!(S.rematchMine && S.rematchTheirs)) return;
  // The host restarts and re-announces the game; the guest waits for
  // that hello (same path as the very first round) so both sides
  // restart exactly once.
  if (S.isHost) {
    S.net.send({ t: "hello", v: 1, world: S.world.id });
    beginOnlinePlacement();
  }
}

// ------------------------------------------------------------- game over

function finishGame(winner) {
  S.phase = "over";
  const w = S.world;
  const iWon = S.mode === "hotseat" || winner === 0;
  $("#win-emoji").textContent = iWon ? "🏆" : "💪";
  if (S.mode === "hotseat") {
    $("#win-title").textContent = `${AVATARS[winner]} Spieler ${winner + 1} hat gewonnen!`;
    $("#win-sub").textContent = w.words.win;
  } else if (S.mode === "ai") {
    $("#win-title").textContent = iWon ? "Du hast gewonnen! 🎉" : "Robo war schneller!";
    $("#win-sub").textContent = iWon ? w.words.win : "Beim nächsten Mal schaffst du es bestimmt!";
  } else {
    $("#win-title").textContent = iWon ? "Du hast gewonnen! 🎉" : "Dein Freund hat gewonnen!";
    $("#win-sub").textContent = iWon ? w.words.win : "Fast! Gleich nochmal?";
  }
  show("screen-win");
  if (iWon) {
    SND.bigWin();
    let bursts = 0;
    const rain = setInterval(() => {
      FX.confettiRain();
      bursts += 1;
      if (bursts > 14 || S.phase !== "over") clearInterval(rain);
    }, 350);
    FX.emojiBurst(window.innerWidth / 2, window.innerHeight / 3, w.icon, 14);
  } else {
    SND.sad();
  }
}

function rematch() {
  SND.tap();
  if (S.mode === "online") {
    S.rematchMine = true;
    S.net.send({ t: "rematch" });
    $("#btn-rematch").disabled = true;
    $("#btn-rematch").textContent = "⏳ Warte auf den anderen …";
    maybeRematch();
    return;
  }
  startMode(S.mode);
}

function goHome() {
  S.phase = "title";
  if (S.net) {
    S.net.destroy();
    S.net = null;
  }
  S.boards = [null, null];
  S.shadow = null;
  $("#btn-rematch").disabled = false;
  $("#btn-rematch").textContent = "🔁 Nochmal spielen";
  $("#btn-endturn").hidden = true;
  show("screen-title");
}

// ------------------------------------------------------------- boot

function boot() {
  FX.init();
  buildWorldPicker();
  applyWorld(getWorld("ozean"));
  setupPlacementInput();
  setupBattleInput();

  document.querySelectorAll("[data-mode]").forEach((btn) => {
    btn.addEventListener("click", () => startMode(btn.dataset.mode));
  });

  $("#btn-host").addEventListener("click", hostGame);
  $("#btn-join").addEventListener("click", () => {
    SND.tap();
    show("screen-join");
    $("#join-code").focus();
  });
  $("#btn-join-go").addEventListener("click", () => {
    const code = normalizeCode($("#join-code").value);
    if (code.length !== 4) {
      $("#join-error").textContent = "Der Zauber-Code hat 4 Zeichen.";
      return;
    }
    joinGame(code);
  });
  $("#join-code").addEventListener("keydown", (e) => {
    if (e.key === "Enter") $("#btn-join-go").click();
  });

  $("#btn-shuffle").addEventListener("click", () => {
    SND.whoosh();
    E.randomFleet(placementBoard());
    selectedShip = null;
    refreshPlacement();
  });
  $("#btn-place-done").addEventListener("click", placementDone);
  $("#btn-pass-go").addEventListener("click", () => {
    SND.tap();
    const action = S.passAction;
    S.passAction = null;
    if (action) action();
  });
  $("#btn-endturn").addEventListener("click", hotseatEndTurn);
  $("#btn-rematch").addEventListener("click", rematch);
  $("#btn-win-home").addEventListener("click", goHome);
  $("#btn-home").addEventListener("click", () => {
    SND.tap();
    goHome();
  });

  const muteBtn = $("#btn-mute");
  const syncMute = () => {
    muteBtn.textContent = SND.isMuted() ? "🔇" : "🔊";
  };
  syncMute();
  muteBtn.addEventListener("click", () => {
    SND.unlock();
    SND.setMuted(!SND.isMuted());
    syncMute();
    if (!SND.isMuted()) SND.tap();
  });

  // deep link: ?join=CODE
  const params = new URLSearchParams(window.location.search);
  const joinCode = normalizeCode(params.get("join"));
  if (joinCode.length === 4) {
    S.mode = "online";
    show("screen-join");
    $("#join-code").value = joinCode;
    joinGame(joinCode);
  }
}

boot();
