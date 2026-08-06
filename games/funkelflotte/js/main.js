// Funkel-Flotte — game flow. Rules live in engine.js, presentation in
// scene.js (three.js). Each player plays from their OWN world: your
// board is your world's diorama, the opponent's board is theirs.

import * as E from "./engine.js";
import { createAiState, noteResult, nextShot } from "./ai.js";
import { WORLDS, getWorld, randomOtherWorld } from "./worlds.js";
import { TINTS, ACCESSORIES, ACCESSORY_NAMES } from "./models.js";
import * as PROG from "./progress.js";
import { flag, setFlag, allFlags } from "./flags.js";
import { generatePuzzle, PUZZLE_SPADES } from "./puzzle.js";
import * as CHASE from "./chase.js";
import * as BOSS from "./boss.js";
import * as SND from "./sound.js";
import * as SCENE from "./scene.js";
import { Net, makeCode, normalizeCode, joinUrl } from "./net.js";

const $ = (sel) => document.querySelector(sel);

const S = {
  mode: null, // 'ai' | 'hotseat' | 'online'
  isHost: false,
  worlds: ["ozean", "ozean"], // world per board index
  boards: [null, null], // engine boards; online: [mine, shadow]
  shadow: null,
  turn: 0,
  viewer: 0, // whose eyes we render through (hotseat switches)
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
  worldPickAction: null,
  customs: [{}, {}], // per board index: shipId -> { tint, hat }
  oppCustom: null, // online: opponent's map (arrives with their "ready")
  rules: { decoy: false, sonar: false, ghost: false }, // extra rules
  gameMode: "classic", // 'classic' | 'chase' | 'boss' — what an online session plays
  chase: null, // chase-mode state (see startChase)
  boss: null, // boss-mode state (see startBoss)
  extraTurn: null, // player index that may keep shooting after a miss
  ghostTrack: [null, null], // per board: { count, queue } for fading marks
  sonarMap: [{}, {}], // per board: "x,y" -> sonar distance (for replay)
};

const GHOST_FADE = 5; // a miss mark fades after this many further shots

const slotFor = (index) => (index === 0 ? "mine" : "enemy");
let FAST = false; // shortened delays for automated tests
const other = (i) => 1 - i;

// ------------------------------------------------------------------ UI

function show(screenId) {
  document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active"));
  if (screenId) $(`#${screenId}`).classList.add("active");
  $("#btn-home").hidden = screenId === "screen-title";
  $("#hud").hidden = !!screenId && screenId !== "screen-win";
}

let toastTimer = null;
function toast(text, ms = 2000) {
  const el = $("#toast");
  el.textContent = text;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), ms);
}

function applyUiWorld(worldId) {
  const w = getWorld(worldId);
  const root = document.documentElement.style;
  root.setProperty("--ui", w.colors.ui);
  root.setProperty("--ui2", w.colors.ui2);
  root.setProperty("--text", w.colors.text);
  document.querySelector('meta[name="theme-color"]').setAttribute("content", w.colors.ui);
}

function status(text) {
  $("#status").textContent = text;
}

function goFullscreen() {
  const el = document.documentElement;
  if (!document.fullscreenElement && el.requestFullscreen) {
    el.requestFullscreen().catch(() => {});
  }
}

// ---------------------------------------------------------- customization

function loadCustom(worldId) {
  try {
    const map = JSON.parse(localStorage.getItem(`ff-custom-${worldId}`) || "{}");
    return sanitizeCustomMap(map);
  } catch {
    return {};
  }
}

function saveCustom(worldId, map) {
  try {
    localStorage.setItem(`ff-custom-${worldId}`, JSON.stringify(map));
  } catch {
    /* private mode etc. */
  }
}

// keep only well-formed entries (also guards data arriving over the wire)
function sanitizeCustomMap(map) {
  const out = {};
  if (!map || typeof map !== "object") return out;
  for (const [id, c] of Object.entries(map)) {
    if (!c || typeof c !== "object") continue;
    const tint = Number.isInteger(c.tint) && c.tint > 0 && c.tint < TINTS.length ? c.tint : 0;
    const hat = Number.isInteger(c.hat) && c.hat > 0 && c.hat < ACCESSORIES.length ? c.hat : 0;
    if (tint || hat) out[id] = { tint, hat };
  }
  return out;
}

// which customization applies to board `index` right now?
function customFor(index) {
  if (S.mode === "online" && index === 1) return S.oppCustom || {};
  return S.customs[index] || {};
}

// world picker cards with live 3D thumbnails
const thumbCache = new Map();
function creatureThumb(worldId, idx, custom = null) {
  const key = `${worldId}-${idx}-${custom ? `${custom.tint || 0}.${custom.hat || 0}` : "0.0"}`;
  if (!thumbCache.has(key)) {
    thumbCache.set(key, SCENE.creatureThumb(worldId, idx, idx === 0 ? 4 : 3, 128, custom));
  }
  return thumbCache.get(key);
}

function buildWorldPicker(gridEl, onPick, selected) {
  gridEl.innerHTML = "";
  for (const world of Object.values(WORLDS)) {
    const card = document.createElement("button");
    card.className = `world-card${world.id === selected ? " selected" : ""}`;
    card.dataset.world = world.id;
    card.innerHTML = `<div class="ph"></div>${world.name}`;
    card.addEventListener("click", () => {
      SND.unlock();
      SND.tap();
      gridEl.querySelectorAll(".world-card").forEach((c) => c.classList.remove("selected"));
      card.classList.add("selected");
      onPick(world.id);
    });
    gridEl.appendChild(card);
  }
  // fill in 3D thumbnails lazily so the first paint is instant
  setTimeout(() => {
    gridEl.querySelectorAll(".world-card").forEach((card) => {
      const img = document.createElement("img");
      img.alt = "";
      img.src = creatureThumb(card.dataset.world, 0, loadCustom(card.dataset.world)[0]);
      card.querySelector(".ph")?.replaceWith(img);
    });
  }, 30);
}

function renderChips(targetIndex) {
  const box = $("#chips");
  box.innerHTML = "";
  if (S.phase !== "battle" && S.phase !== "puzzle") return;
  const worldId = S.worlds[targetIndex];
  const found = foundIdsOn(targetIndex);
  const custom = customFor(targetIndex);
  const creatures = getWorld(worldId).creatures;
  const ids =
    S.phase === "puzzle"
      ? S.puzzle.board.ships.map((s) => s.id)
      : creatures.map((_, i) => i);
  for (const id of ids) {
    const chip = document.createElement("div");
    chip.className = `chip${found.has(id) ? " done" : ""}`;
    const img = document.createElement("img");
    img.alt = creatures[id]?.name ?? "";
    img.src = creatureThumb(worldId, id, custom[id]);
    chip.appendChild(img);
    box.appendChild(chip);
  }
}

function foundIdsOn(index) {
  if (S.mode === "online" && index === 1) {
    return new Set(S.shadow.found.map((s) => s.id));
  }
  return new Set(S.boards[index].ships.filter(E.isSunk).map((s) => s.id));
}

// --------------------------------------------------------------- helpers

function newBoardWithFleet() {
  const b = E.createBoard();
  E.randomFleet(b);
  if (S.rules.decoy) E.randomDecoy(b);
  return b;
}

// ----------------------------------------------------------- extra rules

function loadRules() {
  try {
    const r = JSON.parse(localStorage.getItem("ff-rules") || "{}");
    return { decoy: !!r.decoy, sonar: !!r.sonar, ghost: !!r.ghost };
  } catch {
    return { decoy: false, sonar: false, ghost: false };
  }
}

function saveRules() {
  try {
    localStorage.setItem("ff-rules", JSON.stringify(S.rules));
  } catch {
    /* private mode etc. */
  }
}

function syncRuleChips() {
  $("#rule-decoy").checked = S.rules.decoy;
  $("#rule-sonar").checked = S.rules.sonar;
  $("#rule-ghost").checked = S.rules.ghost;
}

function rulesSummary(rules) {
  const parts = [];
  if (rules.decoy) parts.push("🎈 Ballon-Schwindel");
  if (rules.sonar) parts.push("🐬 Sonar");
  if (rules.ghost) parts.push("👻 Geisterstunde");
  return parts.join(" · ");
}

// the decoy rendered like a 1-cell creature for the 3D scene
function decoyShipOf(board) {
  return { id: "decoy", size: 1, x: board.decoy.x, y: board.decoy.y, dir: "h", decoy: true, hits: [] };
}

function decoyPopped(board) {
  return board.decoy && board.shots[E.key(board.decoy.x, board.decoy.y)] === E.DECOY;
}

function shipsWithDecoy(board) {
  return board.decoy && !decoyPopped(board) ? [...board.ships, decoyShipOf(board)] : board.ships;
}

function resetRuleState() {
  S.extraTurn = null;
  S.ghostTrack = [
    { count: 0, queue: [] },
    { count: 0, queue: [] },
  ];
  S.sonarMap = [{}, {}];
}

// ghost rule: count shots per board, fade old miss marks
function ghostTick(idx, x, y, result) {
  if (!S.rules.ghost) return;
  const g = S.ghostTrack[idx];
  if (!g) return;
  g.count += 1;
  if (result === E.MISS) g.queue.push({ x, y, at: g.count });
  while (g.queue.length && g.count - g.queue[0].at >= GHOST_FADE) {
    const c = g.queue.shift();
    forgetCell(idx, c.x, c.y);
  }
}

function forgetCell(idx, x, y) {
  if (S.mode === "online" && idx === 1) {
    delete S.shadow.marks[E.key(x, y)];
  } else if (S.boards[idx]) {
    E.forgetShot(S.boards[idx], x, y);
  }
  delete S.sonarMap[idx][E.key(x, y)];
  SCENE.clearMark(slotFor(idx), x, y);
}

function creatureName(index, shipId) {
  return getWorld(S.worlds[index]).creatures[shipId]?.name ?? "";
}

// creatures visible: viewer's own board fully, other board only sunk
function syncCreatureVisibility() {
  for (const idx of [0, 1]) {
    const slot = slotFor(idx);
    const board = S.boards[idx];
    if (S.mode === "online" && idx === 1) {
      SCENE.placeCreatures(slot, S.shadow.found);
      continue;
    }
    if (!board) continue;
    const ships =
      idx === S.viewer ? shipsWithDecoy(board) : board.ships.filter(E.isSunk);
    SCENE.placeCreatures(slot, ships);
  }
}

// replay all recorded shots onto a freshly built diorama
function replayMarks(idx) {
  const slot = slotFor(idx);
  const marks = S.mode === "online" && idx === 1 ? S.shadow.marks : S.boards[idx]?.shots;
  if (!marks) return;
  for (const [key, result] of Object.entries(marks)) {
    const [x, y] = key.split(",").map(Number);
    SCENE.applyShotQuiet(slot, Number(x), Number(y), result, {
      sonarDist: S.sonarMap[idx][key] ?? null,
    });
  }
}

// ------------------------------------------------------------- title flow

function startMode(mode) {
  SND.unlock();
  SND.whoosh();
  goFullscreen();
  S.mode = mode;
  S.gameMode = "classic";
  S.chase = null;
  S.boss = null;
  S.turn = 0;
  S.viewer = 0;
  S.rematchMine = false;
  S.rematchTheirs = false;
  S.inputLocked = false;
  resetRuleState();

  if (mode === "ai") {
    S.worlds[1] = randomOtherWorld(S.worlds[0]);
    S.boards = [newBoardWithFleet(), newBoardWithFleet()];
    S.aiState = createAiState("leicht");
    startPlacement(0);
  } else if (mode === "hotseat") {
    S.boards = [newBoardWithFleet(), newBoardWithFleet()];
    startPlacement(0);
  } else {
    show("screen-online");
  }
}

// ------------------------------------------------------------- placement

function startPlacement(player) {
  S.phase = "place";
  S.placingPlayer = player;
  const idx = player;
  const slot = slotFor(idx);
  applyUiWorld(S.worlds[idx]);
  SCENE.setupBoard(slot, S.worlds[idx]);
  S.customs[idx] = loadCustom(S.worlds[idx]);
  SCENE.setCustomization(slot, S.customs[idx]);
  SCENE.placeCreatures(slot, shipsWithDecoy(S.boards[idx]), { popIn: true });
  SCENE.focusBoard(slot, { immediate: S.phase === "title" });
  SCENE.clearInteraction();
  SCENE.setPlacementMode({
    slot,
    canPlaceAt: (id, x, y, dir) => {
      const board = S.boards[idx];
      if (id === "decoy") return E.canPlaceDecoy(board, x, y);
      const ship = board.ships.find((s) => s.id === id);
      return E.canPlace(board, { ...ship, x, y, dir }, id);
    },
    onMove: (id, x, y, dir) => {
      const board = S.boards[idx];
      if (id === "decoy") {
        if (E.placeDecoy(board, x, y)) SND.tap();
        else SND.sad();
        SCENE.moveCreature(slot, decoyShipOf(board));
        return;
      }
      if (E.moveShip(board, id, x, y, dir)) {
        SND.tap();
        SCENE.moveCreature(slot, board.ships.find((s) => s.id === id));
      } else {
        SND.sad();
        SCENE.moveCreature(slot, board.ships.find((s) => s.id === id));
        SCENE.shakeCreature(slot, id);
      }
    },
    onRotate: (id) => {
      const board = S.boards[idx];
      if (id === "decoy") {
        SND.plop();
        SCENE.shakeCreature(slot, id);
        return;
      }
      const ship = board.ships.find((s) => s.id === id);
      const dir = ship.dir === "h" ? "v" : "h";
      const maxX = board.size - (dir === "h" ? ship.size : 1);
      const maxY = board.size - (dir === "v" ? ship.size : 1);
      const nx = Math.max(0, Math.min(maxX, ship.x));
      const ny = Math.max(0, Math.min(maxY, ship.y));
      if (E.moveShip(board, id, nx, ny, dir)) {
        SND.tap();
        SCENE.moveCreature(slot, board.ships.find((s) => s.id === id));
      } else {
        SND.sad();
        SCENE.shakeCreature(slot, id);
      }
    },
  });

  SND.startAmbient(S.worlds[idx]);
  const who = S.mode === "hotseat" ? `Spieler ${player + 1}` : "Du";
  status(`${who}: Versteck deine Freunde! Ziehen = verschieben, Tippen = drehen.`);
  show(null);
  $("#btn-shuffle").hidden = false;
  $("#btn-style").hidden = !flag("styles");
  $("#btn-place-done").hidden = false;
  $("#btn-place-done").disabled = false;
  $("#btn-place-done").textContent = "Fertig!";
  $("#btn-endturn").hidden = true;
  renderChips(other(S.viewer));
}

// ----------------------------------------------------------- style panel

function hatLabel(hatIdx) {
  const kind = ACCESSORIES[hatIdx];
  return kind ? `🎩 ${ACCESSORY_NAMES[kind]}` : "Ohne Hut";
}

function setShipCustom(shipId, patch) {
  const idx = S.placingPlayer;
  const cur = S.customs[idx][shipId] || { tint: 0, hat: 0 };
  const next = { ...cur, ...patch };
  if (!next.tint && !next.hat) delete S.customs[idx][shipId];
  else S.customs[idx][shipId] = next;
  saveCustom(S.worlds[idx], S.customs[idx]);
  SCENE.setCustomization(slotFor(idx), S.customs[idx]);
  SCENE.placeCreatures(slotFor(idx), S.boards[idx].ships);
}

function openStylePanel() {
  SND.tap();
  const idx = S.placingPlayer;
  const worldId = S.worlds[idx];
  const world = getWorld(worldId);
  const rows = $("#style-rows");
  rows.innerHTML = "";

  for (const ship of S.boards[idx].ships) {
    const row = document.createElement("div");
    row.className = "style-row";
    const img = document.createElement("img");
    img.className = "style-thumb";
    img.alt = "";
    const info = document.createElement("div");
    info.className = "style-info";
    const name = document.createElement("div");
    name.className = "style-name";
    name.textContent = world.creatures[ship.id]?.name ?? "";
    const dots = document.createElement("div");
    dots.className = "tint-dots";
    const hatBtn = document.createElement("button");
    hatBtn.className = "hat-btn";

    const sync = () => {
      const cur = S.customs[idx][ship.id] || { tint: 0, hat: 0 };
      img.src = creatureThumb(worldId, ship.id, cur.tint || cur.hat ? cur : null);
      hatBtn.textContent = hatLabel(cur.hat);
      dots.querySelectorAll(".tint-dot").forEach((dot, ti) => {
        dot.classList.toggle("selected", ti === cur.tint);
      });
    };

    TINTS.forEach((hex, ti) => {
      const dot = document.createElement("button");
      dot.className = `tint-dot${hex === null ? " none" : ""}`;
      dot.setAttribute("aria-label", ti === 0 ? "Naturfarbe" : `Farbe ${ti}`);
      if (hex !== null) dot.style.background = `#${hex.toString(16).padStart(6, "0")}`;
      dot.addEventListener("click", () => {
        SND.tap();
        setShipCustom(ship.id, { tint: ti });
        sync();
      });
      dots.appendChild(dot);
    });
    hatBtn.addEventListener("click", () => {
      SND.sparkle();
      const cur = S.customs[idx][ship.id] || { tint: 0, hat: 0 };
      // cycle through unlocked hats only (stickers unlock more);
      // with the sticker feature off, every hat is available
      let h = cur.hat;
      do {
        h = (h + 1) % ACCESSORIES.length;
      } while (flag("stickers") && !PROG.isHatUnlocked(h) && h !== cur.hat);
      setShipCustom(ship.id, { hat: h });
      sync();
    });

    sync();
    info.appendChild(name);
    info.appendChild(dots);
    row.appendChild(img);
    row.appendChild(info);
    row.appendChild(hatBtn);
    rows.appendChild(row);
  }
  const nu = flag("stickers") ? PROG.nextUnlock() : null;
  $("#style-hint").textContent = nu
    ? `Noch ${nu.remaining} Sticker bis zum nächsten Hut: ${ACCESSORY_NAMES[nu.kind]}!`
    : "";
  $("#style-hint").hidden = !nu;
  $("#style-panel").hidden = false;
}

function closeStylePanel() {
  $("#style-panel").hidden = true;
}

function shuffleFleet() {
  SND.whoosh();
  const idx = S.placingPlayer;
  const board = S.boards[idx];
  board.decoy = null;
  E.randomFleet(board);
  if (S.rules.decoy) E.randomDecoy(board);
  SCENE.placeCreatures(slotFor(idx), shipsWithDecoy(board), { popIn: true });
}

function placementDone() {
  SND.tap();
  if (S.mode === "chase") {
    chaseHidingDone();
    return;
  }
  if (S.mode === "boss") {
    bossPlacingDone();
    return;
  }
  SCENE.clearInteraction();
  closeStylePanel();
  $("#btn-shuffle").hidden = true;
  $("#btn-style").hidden = true;
  $("#btn-place-done").hidden = true;

  if (S.mode === "hotseat") {
    if (S.placingPlayer === 0) {
      showPass({
        title: "Gib das Gerät an Spieler 2!",
        sub: "Nicht spicken! Spieler 2 sucht sich jetzt eine Welt aus und versteckt seine Freunde.",
        btn: "Ich bin Spieler 2!",
        action: () => {
          showWorldPick({
            title: "Spieler 2: Wähl deine Welt!",
            selected: S.worlds[1],
            onDone: (worldId) => {
              S.worlds[1] = worldId;
              startPlacement(1);
            },
          });
        },
      });
    } else {
      showPass({
        title: "Alles versteckt! Gib das Gerät an Spieler 1!",
        sub: "Spieler 1 fängt an zu suchen.",
        btn: "Los geht die Suche!",
        action: () => {
          S.viewer = 0;
          startBattle(0);
        },
      });
    }
  } else if (S.mode === "ai") {
    startBattle(0);
  } else {
    S.myReady = true;
    $("#btn-place-done").hidden = false;
    $("#btn-place-done").disabled = true;
    $("#btn-place-done").textContent = "Warte auf Mitspieler …";
    status("Gleich geht es los!");
    S.net.send({ t: "ready", custom: S.customs[0] });
    maybeStartOnline();
  }
}

// ------------------------------------------------------------ pass/world

function showPass({ title, sub, btn, action }) {
  $("#pass-title").textContent = title;
  $("#pass-sub").textContent = sub;
  $("#btn-pass-go").textContent = btn;
  S.passAction = action;
  show("screen-pass");
}

function showWorldPick({ title, selected, onDone }) {
  $("#worldpick-title").textContent = title;
  let chosen = selected;
  buildWorldPicker($("#world-grid-2"), (id) => {
    chosen = id;
  }, selected);
  S.worldPickAction = () => onDone(chosen);
  show("screen-worldpick");
}

// ---------------------------------------------------------------- battle

function startBattle(firstTurn) {
  S.phase = "battle";
  S.turn = firstTurn;
  S.inputLocked = false;
  closeStylePanel();
  $("#btn-endturn").hidden = true;
  $("#btn-shuffle").hidden = true;
  $("#btn-style").hidden = true;
  $("#btn-place-done").hidden = true;

  // make sure both dioramas exist (enemy diorama may not yet)
  if (S.mode === "online" || S.mode === "ai") {
    SCENE.setupBoard("enemy", S.worlds[1]);
  }
  SCENE.setCustomization("mine", customFor(0));
  SCENE.setCustomization("enemy", customFor(1));
  syncCreatureVisibility();
  replayMarks(0);
  replayMarks(1);

  show(null);
  beginTurn();
  if (S.mode === "ai" && firstTurn === 1) scheduleRoboTurn();
}

// set up camera + interaction for the current turn (from viewer's seat)
function beginTurn() {
  if (S.phase !== "battle") return;
  const target = other(S.turn);
  applyUiWorld(S.worlds[S.mode === "hotseat" ? S.turn : 0]);
  renderChips(other(S.viewer));

  if (S.turn === S.viewer) {
    SND.startAmbient(S.worlds[target]);
    SCENE.focusBoard(slotFor(target));
    SCENE.clearInteraction();
    SCENE.setTapMode(slotFor(target), (x, y) => handleTap(x, y));
    const world = getWorld(S.worlds[target]);
    status(
      S.mode === "hotseat"
        ? `Spieler ${S.turn + 1}: Such ${world.words.boardIn} von Spieler ${target + 1}!`
        : `Du bist dran! Such ${world.words.boardIn}!`
    );
  } else {
    SND.startAmbient(S.worlds[S.viewer]);
    SCENE.clearInteraction();
    SCENE.focusBoard(slotFor(S.viewer));
    status(S.mode === "ai" ? "Robo sucht gerade …" : "Dein Mitspieler sucht gerade …");
  }
}

function handleTap(x, y) {
  if (S.phase !== "battle" || S.inputLocked || S.turn !== S.viewer) return;
  if (S.mode === "online") {
    onlineShoot(x, y);
    return;
  }
  const targetIdx = other(S.turn);
  const res = E.fire(S.boards[targetIdx], x, y);
  if (res.result === E.REPEAT) {
    SND.tap();
    return;
  }
  showShotResult(targetIdx, x, y, res, () => afterMyShot(res));
}

// visualize a shot on board `idx`; then continue. The status wording
// depends on who is looking: the shooter sees "Nochmal!", the defender
// sees what happened to their own creatures.
function showShotResult(idx, x, y, res, done) {
  const slot = slotFor(idx);
  const viewerIsShooter = idx !== S.viewer;
  const sonarDist =
    S.rules.sonar && res.result === E.MISS
      ? res.dist ?? (S.boards[idx] ? E.sonarDistance(S.boards[idx], x, y) : null)
      : null;
  if (sonarDist != null) S.sonarMap[idx][E.key(x, y)] = sonarDist;
  SCENE.applyShot(
    slot,
    x,
    y,
    res.result === E.MISS ? "miss" : res.result === E.DECOY ? "decoy" : "hit",
    { sonarDist }
  );
  ghostTick(idx, x, y, res.result);
  if (navigator.vibrate) {
    navigator.vibrate(res.result === E.SUNK ? [60, 40, 90] : res.result === E.HIT ? 40 : 15);
  }
  const world = getWorld(S.worlds[idx]);
  const opp = S.mode === "ai" ? "Robo" : "Dein Mitspieler";
  if (res.result === E.DECOY) {
    SND.plop();
    SND.whoosh();
    if (idx === S.viewer) SCENE.removeCreature(slot, "decoy");
    status(
      viewerIsShooter
        ? "🎈 PENG! Nur ein Schwindel-Ballon — dein Gegner darf extra suchen!"
        : `🎈 PENG! ${opp} ist auf deinen Schwindel-Ballon reingefallen!`
    );
  } else if (res.result === E.MISS) {
    SND.plop();
    status(
      viewerIsShooter
        ? sonarDist != null
          ? `${world.words.miss} Sonar piept: ${sonarDist} Felder entfernt!`
          : world.words.miss
        : `Puh! ${opp} hat nichts gefunden.`
    );
  } else if (res.result === E.HIT) {
    SND.sparkle();
    status(viewerIsShooter ? `${world.words.hit} Nochmal!` : `Oh nein! ${opp} hat was entdeckt …`);
  } else if (res.result === E.SUNK) {
    SND.fanfare();
    SCENE.revealShip(slot, res.ship);
    SCENE.revealWater(slot, res.revealed);
    status(
      viewerIsShooter
        ? `${creatureName(idx, res.ship.id)} ${world.words.sunk} Nochmal!`
        : `${opp} hat ${creatureName(idx, res.ship.id)} gefunden!`
    );
    renderChips(other(S.viewer));
  }
  setTimeout(done, FAST ? 50 : res.result === E.SUNK ? 1200 : 500);
}

function afterMyShot(res) {
  if (S.phase !== "battle") return;
  if (res.gameOver) {
    finishGame(S.turn);
    return;
  }
  if (res.result === E.HIT || res.result === E.SUNK) return; // same player continues
  if (res.result === E.DECOY) S.extraTurn = other(S.turn); // balloon owner earns a bonus

  // a miss normally ends the turn — unless this player earned an extra one
  if (res.result === E.MISS && S.extraTurn === S.turn) {
    S.extraTurn = null;
    toast("🎈 Extra-Zug! Such gleich nochmal!");
    return;
  }

  if (S.mode === "hotseat") {
    S.inputLocked = true;
    SCENE.clearInteraction();
    $("#btn-endturn").hidden = false;
  } else {
    // robo's turn
    S.turn = 1;
    S.inputLocked = true;
    SCENE.clearInteraction();
    setTimeout(() => {
      beginTurn();
      scheduleRoboTurn();
    }, FAST ? 60 : 900);
  }
}

function hotseatEndTurn() {
  SND.tap();
  $("#btn-endturn").hidden = true;
  const next = other(S.turn);
  showPass({
    title: `Gib das Gerät an Spieler ${next + 1}!`,
    sub: "Jetzt darf der andere suchen.",
    btn: "Ich bin dran!",
    action: () => {
      S.turn = next;
      S.viewer = next;
      S.inputLocked = false;
      syncCreatureVisibility();
      show(null);
      beginTurn();
    },
  });
}

// ------------------------------------------------------------------ robo

function scheduleRoboTurn() {
  if (S.phase !== "battle" || S.mode !== "ai" || S.turn !== 1) return;
  setTimeout(() => {
    if (S.phase !== "battle" || S.mode !== "ai" || S.turn !== 1) return;
    const myBoard = S.boards[0];
    const shot = nextShot(S.aiState, myBoard);
    if (!shot) return;
    const res = E.fire(myBoard, shot.x, shot.y);
    noteResult(S.aiState, shot.x, shot.y, res.result, res.ship ? E.shipCells(res.ship) : null);
    showShotResult(0, shot.x, shot.y, res, () => {
      if (S.phase !== "battle") return;
      if (res.gameOver) {
        finishGame(1);
        return;
      }
      if (res.result === E.DECOY) S.extraTurn = 0; // robo popped my balloon
      if (res.result === E.MISS && S.extraTurn === 1) {
        S.extraTurn = null;
        status("Robo hat einen Extra-Zug und sucht weiter …");
        scheduleRoboTurn();
      } else if (res.result === E.MISS || res.result === E.DECOY) {
        S.turn = 0;
        S.inputLocked = false;
        beginTurn();
      } else {
        status(
          res.result === E.SUNK
            ? `Robo hat ${creatureName(0, res.ship.id)} gefunden! Er sucht weiter …`
            : "Robo hat was gefunden! Er sucht weiter …"
        );
        scheduleRoboTurn();
      }
    });
  }, FAST ? 70 : 1300);
}

// ---------------------------------------------------------------- online

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
      toast("Ohje, das hat nicht geklappt. Probier es nochmal!");
      goHome();
    });
}

function joinGame(code) {
  SND.tap();
  $("#join-error").textContent = "";
  const btn = $("#btn-join-go");
  btn.disabled = true;
  btn.textContent = "Verbinde …";
  S.isHost = false;
  S.net = new Net();
  wireNet();
  S.net
    .join(code)
    .then(() => {
      let tries = 0;
      const ping = setInterval(() => {
        if (S.phase !== "title" || !S.net) {
          clearInterval(ping);
          return;
        }
        tries += 1;
        if (tries > 8) {
          clearInterval(ping);
          toast("Verbindung klappt nicht. Probiert es nochmal!", 2600);
          goHome();
          return;
        }
        S.net.send({ t: "hi", world: S.worlds[0] });
      }, 1500);
      S.net.send({ t: "hi", world: S.worlds[0] });
    })
    .catch((err) => {
      btn.disabled = false;
      btn.textContent = "Los!";
      $("#join-error").textContent =
        err.message === "not-found"
          ? "Kein Spiel mit diesem Code gefunden. Stimmt der Code?"
          : "Verbindung klappt nicht. Haben beide Geräte Internet?";
      S.net.destroy();
      S.net = null;
    });
}

function wireNet() {
  S.net.onStatus = (st) => {
    if (st === "connected" && S.isHost) {
      $("#host-status").textContent = "Verbunden!";
    }
  };
  S.net.onMessage = (msg) => handleNetMessage(msg);
  S.net.onClose = () => {
    if (S.phase === "over") return;
    toast("Die Verbindung ist weg.", 2600);
    goHome();
  };
}

function beginOnlinePlacement() {
  resetRuleState();
  S.boards = [newBoardWithFleet(), null];
  S.shadow = newShadow();
  S.myReady = false;
  S.oppReady = false;
  S.oppCustom = null;
  S.rematchMine = false;
  S.rematchTheirs = false;
  $("#btn-rematch").disabled = false;
  $("#btn-rematch").textContent = "Nochmal spielen";
  goFullscreen();
  startPlacement(0);
}

function maybeStartOnline() {
  if (!(S.myReady && S.oppReady)) return;
  if (S.isHost) {
    const hostStarts = Math.random() < 0.5;
    S.net.send({ t: "start", youStart: !hostStarts });
    startBattle(hostStarts ? 0 : 1);
    toast(hostStarts ? "Du fängst an!" : "Dein Mitspieler fängt an!");
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
    case "hi": {
      // guest announces itself (+ its world); host answers idempotently
      if (msg.world) S.worlds[1] = msg.world;
      if (S.isHost) {
        S.net.send({ t: "hello", v: 2, world: S.worlds[0], rules: S.rules, mode: S.gameMode });
        if (["title", "over", "chase", "boss"].includes(S.phase)) {
          if (S.gameMode === "chase") beginChaseOnlineHider();
          else if (S.gameMode === "boss") beginBossOnlineMonster();
          else beginOnlinePlacement();
        }
      }
      break;
    }
    case "hello": {
      if (!["title", "over", "chase", "boss"].includes(S.phase)) break;
      S.worlds[1] = msg.world || "ozean";
      if (msg.mode === "chase") {
        S.gameMode = "chase";
        beginChaseOnlineSeeker();
        break;
      }
      if (msg.mode === "boss") {
        S.gameMode = "boss";
        beginBossOnlineHunter();
        break;
      }
      S.gameMode = "classic";
      // the host decides the extra rules for both players
      S.rules = {
        decoy: !!msg.rules?.decoy,
        sonar: !!msg.rules?.sonar,
        ghost: !!msg.rules?.ghost,
      };
      syncRuleChips();
      const summary = rulesSummary(S.rules);
      if (summary) toast(`Extra-Regeln: ${summary}`, 3200);
      beginOnlinePlacement();
      break;
    }
    case "ready": {
      S.oppReady = true;
      S.oppCustom = sanitizeCustomMap(msg.custom);
      maybeStartOnline();
      break;
    }
    case "start": {
      startBattle(msg.youStart ? 0 : 1);
      toast(msg.youStart ? "Du fängst an!" : "Dein Mitspieler fängt an!");
      break;
    }
    case "shot": {
      const res = E.fire(S.boards[0], msg.x, msg.y);
      S.net.send({
        t: "result",
        x: msg.x,
        y: msg.y,
        result: res.result,
        ship:
          res.result === E.SUNK
            ? { id: res.ship.id, size: res.ship.size, x: res.ship.x, y: res.ship.y, dir: res.ship.dir }
            : null,
        revealed: res.revealed,
        gameOver: res.gameOver,
        dist:
          S.rules.sonar && res.result === E.MISS
            ? E.sonarDistance(S.boards[0], msg.x, msg.y)
            : null,
      });
      if (res.result === E.REPEAT) break;
      showShotResult(0, msg.x, msg.y, res, () => {
        if (S.phase !== "battle") {
          if (res.gameOver) finishGame(1);
          return;
        }
        if (res.gameOver) {
          finishGame(1);
        } else if (res.result === E.DECOY) {
          S.extraTurn = 0; // they popped my balloon — I get a bonus turn
          S.turn = 0;
          S.inputLocked = false;
          beginTurn();
          toast("🎈 Du bist dran — mit Extra-Zug!");
        } else if (res.result === E.MISS) {
          if (S.extraTurn === 1) {
            S.extraTurn = null;
            status("🎈 Dein Mitspieler hat einen Extra-Zug und sucht weiter …");
          } else {
            S.turn = 0;
            S.inputLocked = false;
            beginTurn();
            toast("Du bist dran!");
          }
        } else {
          status("Dein Mitspieler hat was gefunden und sucht weiter …");
        }
      });
      break;
    }
    case "result": {
      S.inputLocked = false;
      if (msg.result === E.REPEAT) break;
      const k = E.key(msg.x, msg.y);
      S.shadow.marks[k] =
        msg.result === E.MISS ? E.MISS : msg.result === E.DECOY ? E.DECOY : E.HIT;
      const fakeRes = {
        result: msg.result,
        ship: msg.ship,
        revealed: msg.revealed || [],
        gameOver: msg.gameOver,
        dist: msg.dist ?? null,
      };
      if (msg.result === E.SUNK && msg.ship) {
        S.shadow.found.push(msg.ship);
        for (const c of fakeRes.revealed) S.shadow.marks[E.key(c.x, c.y)] = E.MISS;
      }
      showShotResult(1, msg.x, msg.y, fakeRes, () => {
        if (msg.gameOver) {
          finishGame(0);
          return;
        }
        if (msg.result === E.DECOY) {
          S.extraTurn = 1; // their balloon → they get the bonus turn
          S.turn = 1;
          beginTurn();
          return;
        }
        if (msg.result === E.MISS) {
          if (S.extraTurn === 0) {
            S.extraTurn = null;
            S.inputLocked = false;
            toast("🎈 Extra-Zug! Such gleich nochmal!");
            return;
          }
          S.turn = 1;
          beginTurn();
        }
      });
      break;
    }
    case "rematch": {
      S.rematchTheirs = true;
      maybeRematch();
      break;
    }
    case "c-ready":
    case "c-shot":
    case "c-res":
    case "c-moved":
      handleChaseMessage(msg);
      break;
    case "b-ready":
    case "b-shot":
    case "b-res":
    case "b-moved":
      handleBossMessage(msg);
      break;
    default:
      break;
  }
}

function maybeRematch() {
  if (!(S.rematchMine && S.rematchTheirs)) return;
  if (S.isHost) {
    S.net.send({ t: "hello", v: 2, world: S.worlds[0], rules: S.rules, mode: S.gameMode });
    if (S.gameMode === "chase") beginChaseOnlineHider();
    else if (S.gameMode === "boss") beginBossOnlineMonster();
    else beginOnlinePlacement();
  }
}

// --------------------------------------------------------------- chase

function fridoShip(x, y) {
  return { id: 4, size: 1, x, y, dir: "h", hits: [] };
}

function fridoName() {
  return getWorld(S.worlds[0]).creatures[4]?.name ?? "Frido";
}

function chaseStatus(prefix = "") {
  const lead = prefix ? `${prefix} ` : "";
  const st = S.chase?.st;
  status(`${lead}Fang ${fridoName()}! 🔦 ${st ? st.shotsLeft : ""} Schüsse übrig`);
}

function setupChaseBoard() {
  S.viewer = 0;
  applyUiWorld(S.worlds[0]);
  SCENE.setupBoard("mine", S.worlds[0]);
  SCENE.placeCreatures("mine", []);
  SCENE.focusBoard("mine");
  SCENE.clearInteraction();
  SND.startAmbient(S.worlds[0]);
  show(null);
  $("#btn-shuffle").hidden = true;
  $("#btn-style").hidden = true;
  $("#btn-endturn").hidden = true;
  $("#btn-place-done").hidden = true;
  renderChips(0);
}

function startChase(kind) {
  SND.unlock();
  SND.whoosh();
  goFullscreen();
  S.mode = "chase";
  S.phase = "chase";
  S.gameMode = "chase";
  S.chase = { kind, st: CHASE.createChase(), role: "seeker", waiting: false, marks: {} };
  if (kind === "online") {
    show("screen-online");
    return;
  }
  setupChaseBoard();
  if (kind === "ai") {
    chaseStatus("Ein frecher Freund hat sich versteckt.");
    SCENE.setTapMode("mine", (x, y) => chaseSeekTap(x, y));
  } else {
    // hotseat: player 1 hides first
    CHASE.placeFrido(S.chase.st, 3, 4);
    showPass({
      title: "Spieler 1 versteckt — Spieler 2 schaut weg!",
      sub: `Setz ${fridoName()} auf ein Feld. Danach wird gesucht!`,
      btn: "Verstecken!",
      action: () => beginChaseHiding(),
    });
  }
}

function beginChaseHiding() {
  const st = S.chase.st;
  show(null);
  SCENE.placeCreatures("mine", [fridoShip(st.frido.x, st.frido.y)], { popIn: true });
  SCENE.setTapMode("mine", (x, y) => {
    if (CHASE.placeFrido(st, x, y)) {
      SND.tap();
      SCENE.moveCreature("mine", fridoShip(x, y));
    }
  });
  status(`Tipp ein Feld an: Wo versteckt sich ${fridoName()}?`);
  const done = $("#btn-place-done");
  done.hidden = false;
  done.disabled = false;
  done.textContent = "Versteckt!";
}

function chaseHidingDone() {
  SCENE.clearInteraction();
  // hotseat must hide the creature (shared screen); online hiders keep
  // seeing their own creature — their device is secret anyway
  if (S.chase.kind === "hotseat") SCENE.placeCreatures("mine", []);
  $("#btn-place-done").hidden = true;
  if (S.chase.kind === "hotseat") {
    showPass({
      title: "Gib das Gerät an Spieler 2!",
      sub: `Spieler 2 hat 🔦 ${S.chase.st.shotsLeft} Schüsse, um ${fridoName()} zu fangen.`,
      btn: "Ich suche jetzt!",
      action: () => {
        show(null);
        chaseStatus();
        SCENE.setTapMode("mine", (x, y) => chaseSeekTap(x, y));
      },
    });
  } else {
    // online hider: tell the seeker we are ready
    S.net.send({ t: "c-ready" });
    status(`Der Sucher legt los. Halt die Ohren steif, ${fridoName()}!`);
  }
}

// seeker taps (solo + hotseat — the full state is local)
function chaseSeekTap(x, y) {
  if (S.phase !== "chase" || S.inputLocked) return;
  const st = S.chase.st;
  if (st.marks[E.key(x, y)]) {
    SND.tap();
    return;
  }
  const res = CHASE.chaseShoot(st, x, y);
  if (res.result === "over") return;
  if (navigator.vibrate) navigator.vibrate(res.result === "caught" ? [60, 40, 90] : 15);

  if (res.result === "caught") {
    SND.fanfare();
    SCENE.applyShot("mine", x, y, "hit");
    SCENE.addCreature("mine", { ...fridoShip(x, y), hits: [{ x, y }] }, { popIn: true, found: true });
    chaseEnd(true);
    return;
  }
  SND.plop();
  SCENE.applyShot("mine", x, y, "miss", { sonarDist: res.dist });
  for (const k of res.faded) {
    const [fx, fy] = k.split(",").map(Number);
    SCENE.clearMark("mine", fx, fy);
  }
  if (res.escaped) {
    SCENE.addCreature("mine", fridoShip(st.frido.x, st.frido.y), { popIn: true });
    chaseEnd(false);
    return;
  }
  if (S.chase.kind === "ai") {
    CHASE.roboMove(st, { x, y });
    SND.whoosh();
    chaseStatus("Husch — weitergeflitzt!");
  } else {
    // hotseat: the hider secretly moves via the eyes-closed overlay
    S.inputLocked = true;
    setTimeout(() => openMoveOverlay("chase"), FAST ? 50 : 900);
  }
}

// shared eyes-closed overlay for the chase hider and the boss monster
function openMoveOverlay(mode) {
  if (mode === "boss") {
    $("#chase-move-sub").textContent = `Monster: Wohin stapft ${bossName()}?`;
    $("#btn-peek").hidden = S.boss.kind === "online";
  } else {
    $("#chase-move-sub").textContent = `Verstecker: Wohin huscht ${fridoName()}?`;
    $("#btn-peek").hidden = S.chase.kind === "online";
  }
  $("#chase-move").hidden = false;
}

function moveOverlayTap(dx, dy) {
  if (S.mode === "boss") bossMoveTap(dx, dy);
  else if (S.mode === "chase") chaseMoveTap(dx, dy);
}

function chaseMoveTap(dx, dy) {
  const st = S.chase.st;
  if (CHASE.moveFrido(st, dx, dy)) {
    SND.whoosh();
    closeChaseMove();
    return;
  }
  if (CHASE.legalMoves(st).length === 0) {
    toast(`${fridoName()} ist eingeklemmt und bleibt sitzen! 🙊`);
    closeChaseMove();
    return;
  }
  SND.sad();
  toast("Da geht es nicht lang!");
}

function closeChaseMove() {
  $("#chase-move").hidden = true;
  if (S.chase.kind === "online") {
    // the hider's board shows the creature — animate the sneak
    SCENE.moveCreature("mine", fridoShip(S.chase.st.frido.x, S.chase.st.frido.y));
    S.net.send({ t: "c-moved" });
    chaseHiderStatus();
    return;
  }
  S.inputLocked = false;
  chaseStatus("Weitersuchen!");
}

function chaseHiderStatus() {
  status(`🙈 Versteck dich gut! Der Sucher hat noch 🔦 ${S.chase.st.shotsLeft} Schüsse.`);
}

function chaseEnd(caught) {
  S.phase = "over";
  S.inputLocked = false;
  SCENE.clearInteraction();
  $("#chase-move").hidden = true; // never via closeChaseMove — that would send c-moved
  const stickerBox = $("#win-sticker");
  stickerBox.hidden = true;
  const kind = S.chase.kind;
  const iAmSeeker = S.chase.role === "seeker";
  const seekerWon = caught;
  let iWon = true;
  if (kind === "ai") {
    iWon = caught;
    $("#win-title").textContent = caught ? `${fridoName()} gefangen!` : `${fridoName()} ist entwischt!`;
    $("#win-sub").textContent = caught
      ? "Gute Nase! Das war flink."
      : "So ein Schlingel. Gleich nochmal?";
  } else if (kind === "hotseat") {
    $("#win-title").textContent = seekerWon
      ? `Spieler 2 hat ${fridoName()} gefangen!`
      : `${fridoName()} ist entwischt — Spieler 1 gewinnt!`;
    $("#win-sub").textContent = "Tauscht die Rollen und spielt nochmal!";
  } else {
    iWon = iAmSeeker === seekerWon;
    $("#win-title").textContent = iWon ? "Du hast gewonnen!" : "Dein Mitspieler hat gewonnen!";
    $("#win-sub").textContent = seekerWon
      ? iAmSeeker
        ? `${fridoName()} gefangen! Tauscht die Geräte für den Rollentausch.`
        : "Erwischt! Tauscht die Geräte für den Rollentausch."
      : iAmSeeker
        ? "Entwischt! Tauscht die Geräte für den Rollentausch."
        : "Stark versteckt! Tauscht die Geräte für den Rollentausch.";
  }
  if (iWon && flag("stickers")) {
    const r = PROG.awardSticker(S.worlds[0]);
    const creature = getWorld(r.worldId).creatures[r.idx];
    stickerBox.innerHTML = "";
    const img = document.createElement("img");
    img.alt = creature?.name ?? "";
    img.src = creatureThumb(r.worldId, r.idx);
    const label = document.createElement("div");
    label.className = "sticker-label";
    label.textContent = r.isNew
      ? `Neuer Sticker: ${creature?.name}!`
      : `Sticker: ${creature?.name} (schon im Album)`;
    stickerBox.appendChild(img);
    stickerBox.appendChild(label);
    stickerBox.hidden = false;
  }
  $("#btn-rematch").textContent = "Nochmal spielen";
  show("screen-win");
  if (iWon) {
    SND.bigWin();
    SCENE.confettiRain("mine");
  } else {
    SND.sad();
  }
}

// ---- online chase ----------------------------------------------------

function beginChaseOnlineHider() {
  S.mode = "chase";
  S.phase = "chase";
  S.chase = { kind: "online", st: CHASE.createChase(), role: "hider", marks: {} };
  CHASE.placeFrido(S.chase.st, 3, 4);
  setupChaseBoard();
  beginChaseHiding();
  $("#btn-place-done").textContent = "Versteckt!";
}

function beginChaseOnlineSeeker() {
  S.mode = "chase";
  S.phase = "chase";
  S.chase = { kind: "online", st: null, role: "seeker", marks: {}, ready: false, shotsLeft: CHASE.CHASE_SHOTS };
  setupChaseBoard();
  S.inputLocked = true;
  status("Dein Mitspieler versteckt sich gerade … 🙈");
  SCENE.setTapMode("mine", (x, y) => chaseOnlineSeekTap(x, y));
}

function chaseOnlineSeekTap(x, y) {
  if (S.phase !== "chase" || S.inputLocked || !S.chase.ready) return;
  if (S.chase.marks[E.key(x, y)]) {
    SND.tap();
    return;
  }
  S.inputLocked = true;
  if (!S.net.send({ t: "c-shot", x, y })) S.inputLocked = false;
}

function handleChaseMessage(msg) {
  switch (msg.t) {
    case "c-ready": {
      if (S.chase?.role !== "seeker") break;
      S.chase.ready = true;
      S.inputLocked = false;
      status(`Los! Fang ${fridoName()}! 🔦 ${S.chase.shotsLeft} Schüsse`);
      break;
    }
    case "c-shot": {
      // I am the hider — resolve the shot against the real state
      if (S.chase?.role !== "hider") break;
      const st = S.chase.st;
      const res = CHASE.chaseShoot(st, msg.x, msg.y);
      if (res.result === "over") break;
      S.net.send({
        t: "c-res",
        x: msg.x,
        y: msg.y,
        result: res.result,
        dist: res.dist,
        faded: res.faded || [],
        escaped: !!res.escaped,
        shotsLeft: st.shotsLeft,
        frido: res.result === "caught" || res.escaped ? st.frido : null,
      });
      if (res.result === "caught") {
        SCENE.applyShot("mine", msg.x, msg.y, "hit");
        chaseEnd(true);
        break;
      }
      SND.plop();
      SCENE.applyShot("mine", msg.x, msg.y, "miss", { sonarDist: res.dist });
      for (const k of res.faded) {
        const [fx, fy] = k.split(",").map(Number);
        SCENE.clearMark("mine", fx, fy);
      }
      if (res.escaped) {
        chaseEnd(false);
        break;
      }
      openMoveOverlay("chase");
      break;
    }
    case "c-res": {
      if (S.chase?.role !== "seeker") break;
      S.chase.shotsLeft = msg.shotsLeft;
      if (msg.result === "caught") {
        SND.fanfare();
        SCENE.applyShot("mine", msg.x, msg.y, "hit");
        SCENE.addCreature(
          "mine",
          { ...fridoShip(msg.x, msg.y), hits: [{ x: msg.x, y: msg.y }] },
          { popIn: true, found: true }
        );
        chaseEnd(true);
        break;
      }
      SND.plop();
      S.chase.marks[E.key(msg.x, msg.y)] = true;
      SCENE.applyShot("mine", msg.x, msg.y, "miss", { sonarDist: msg.dist });
      for (const k of msg.faded || []) {
        delete S.chase.marks[k];
        const [fx, fy] = k.split(",").map(Number);
        SCENE.clearMark("mine", fx, fy);
      }
      if (msg.escaped) {
        if (msg.frido) SCENE.addCreature("mine", fridoShip(msg.frido.x, msg.frido.y), { popIn: true });
        chaseEnd(false);
        break;
      }
      status(`Er huscht gerade weiter … 🔦 ${msg.shotsLeft} Schüsse übrig`);
      break;
    }
    case "c-moved": {
      if (S.chase?.role !== "seeker") break;
      S.inputLocked = false;
      status(`Weitersuchen! 🔦 ${S.chase.shotsLeft} Schüsse übrig`);
      break;
    }
    default:
      break;
  }
}

// ---------------------------------------------------------------- boss

const BOSS_IDX = { ozean: 1, weltraum: 2, dino: 1, teich: 3 }; // Oktopus, UFO, Rexi, Frosch

function bossIdx() {
  return BOSS_IDX[S.worlds[0]] ?? 1;
}

function bossName() {
  return `König ${getWorld(S.worlds[0]).creatures[bossIdx()]?.name ?? "Monster"}`;
}

function bossShipOf(st) {
  return { id: bossIdx(), size: BOSS.BOSS_SIZE, x: st.boss.x, y: st.boss.y, dir: st.boss.dir, hits: [] };
}

function bossHunterStatus(wounds, shotsLeft, prefix = "") {
  const lead = prefix ? `${prefix} ` : "";
  status(`${lead}${bossName()}: ${"❤️".repeat(BOSS.BOSS_SIZE - wounds)} · 🔦 ${shotsLeft}`);
}

function setupBossBoard() {
  S.viewer = 0;
  applyUiWorld(S.worlds[0]);
  SCENE.setupBoard("mine", S.worlds[0]);
  // the monster wears the king look: menacing tint + crown
  SCENE.setCustomization("mine", { [bossIdx()]: { tint: 4, hat: 2 } });
  SCENE.placeCreatures("mine", []);
  SCENE.focusBoard("mine");
  SCENE.clearInteraction();
  SND.startAmbient(S.worlds[0]);
  show(null);
  $("#btn-shuffle").hidden = true;
  $("#btn-style").hidden = true;
  $("#btn-endturn").hidden = true;
  $("#btn-place-done").hidden = true;
  renderChips(0);
}

function startBoss(kind) {
  SND.unlock();
  SND.whoosh();
  goFullscreen();
  S.mode = "boss";
  S.phase = "boss";
  S.gameMode = "boss";
  S.boss = { kind, st: BOSS.createBoss(), role: "hunter", marks: {}, shotsLeft: BOSS.BOSS_SHOTS, wounds: 0 };
  if (kind === "online") {
    show("screen-online");
    return;
  }
  setupBossBoard();
  if (kind === "ai") {
    bossHunterStatus(0, S.boss.st.shotsLeft, `${bossName()} stapft irgendwo herum!`);
    SCENE.setTapMode("mine", (x, y) => bossSeekTap(x, y));
  } else {
    showPass({
      title: "Spieler 1 ist das Monster — Spieler 2 schaut weg!",
      sub: `Setz ${bossName()} aufs Brett. Tipp aufs Monster zum Drehen.`,
      btn: "Monster aufstellen!",
      action: () => beginBossPlacing(),
    });
  }
}

function beginBossPlacing() {
  const st = S.boss.st;
  show(null);
  SCENE.placeCreatures("mine", [bossShipOf(st)], { popIn: true });
  SCENE.setTapMode("mine", (x, y) => {
    if (BOSS.segmentAt(st, x, y) >= 0) {
      const dir = st.boss.dir === "h" ? "v" : "h";
      BOSS.placeBoss(st, st.boss.x, st.boss.y, dir);
    } else {
      const ax = st.boss.dir === "h" ? x - 2 : x;
      const ay = st.boss.dir === "v" ? y - 2 : y;
      BOSS.placeBoss(st, ax, ay);
    }
    SND.tap();
    SCENE.moveCreature("mine", bossShipOf(st));
  });
  status(`Wo lauert ${bossName()}? Tipp ein Feld an — aufs Monster tippen dreht es.`);
  const done = $("#btn-place-done");
  done.hidden = false;
  done.disabled = false;
  done.textContent = "Bereit!";
}

function bossPlacingDone() {
  SCENE.clearInteraction();
  if (S.boss.kind === "hotseat") SCENE.placeCreatures("mine", []);
  $("#btn-place-done").hidden = true;
  if (S.boss.kind === "hotseat") {
    showPass({
      title: "Gib das Gerät an Spieler 2!",
      sub: `Spieler 2 jagt mit 🔦 ${S.boss.st.shotsLeft} Schüssen. Fünf Treffer besiegen das Monster!`,
      btn: "Auf die Jagd!",
      action: () => {
        show(null);
        bossHunterStatus(0, S.boss.st.shotsLeft);
        SCENE.setTapMode("mine", (x, y) => bossSeekTap(x, y));
      },
    });
  } else {
    S.net.send({ t: "b-ready" });
    status(`Der Jäger legt los. Stapf clever, ${bossName()}!`);
  }
}

// hunter taps — solo + hotseat (full state is local)
function bossSeekTap(x, y) {
  if (S.phase !== "boss" || S.inputLocked) return;
  const st = S.boss.st;
  const res = BOSS.bossShoot(st, x, y);
  if (res.result === "over") return;
  if (navigator.vibrate) navigator.vibrate(res.result === "hit" ? [50, 30, 70] : 15);
  SCENE.clearMark("mine", x, y); // the monster may prowl over old marks

  if (res.result === "hit") {
    SND.fanfare();
    SCENE.applyShot("mine", x, y, "hit");
    if (res.defeated) {
      const ship = bossShipOf(st);
      SCENE.addCreature("mine", ship, { popIn: true, found: true });
      st.wounds.forEach((seg) => SCENE.markWound("mine", ship.id, seg, BOSS.BOSS_SIZE));
      bossEnd(true);
      return;
    }
    if (res.escaped) {
      SCENE.addCreature("mine", bossShipOf(st), { popIn: true });
      bossEnd(false);
      return;
    }
    bossHunterStatus(res.wounds, st.shotsLeft, "Getroffen! Es brüllt und stapft weiter …");
  } else {
    SND.plop();
    SCENE.applyShot("mine", x, y, "miss", { sonarDist: res.dist });
    for (const k of res.faded) {
      const [fx, fy] = k.split(",").map(Number);
      SCENE.clearMark("mine", fx, fy);
    }
    if (res.escaped) {
      SCENE.addCreature("mine", bossShipOf(st), { popIn: true });
      bossEnd(false);
      return;
    }
    bossHunterStatus(res.wounds, st.shotsLeft, "Daneben!");
  }

  if (S.boss.kind === "ai") {
    BOSS.roboBossMove(st, { x, y });
    SND.whoosh();
  } else {
    S.inputLocked = true;
    setTimeout(() => openMoveOverlay("boss"), FAST ? 50 : 900);
  }
}

function bossMoveTap(dx, dy) {
  const st = S.boss.st;
  if (BOSS.moveBoss(st, dx, dy)) {
    SND.whoosh();
    $("#chase-move").hidden = true;
    if (S.boss.kind === "online") {
      SCENE.moveCreature("mine", bossShipOf(st));
      S.net.send({ t: "b-moved" });
      status(`🙈 Stapf clever! Der Jäger hat noch 🔦 ${st.shotsLeft} Schüsse.`);
    } else {
      S.inputLocked = false;
      bossHunterStatus(st.wounds.length, st.shotsLeft, "Weiterjagen!");
    }
    return;
  }
  if (BOSS.legalBossMoves(st).length === 0) {
    toast(`${bossName()} ist eingeklemmt und bleibt stehen! 🙊`);
    $("#chase-move").hidden = true;
    if (S.boss.kind === "online") {
      S.net.send({ t: "b-moved" });
    } else {
      S.inputLocked = false;
    }
    return;
  }
  SND.sad();
  toast("Da passt das Monster nicht hin!");
}

function bossEnd(hunterWon) {
  S.phase = "over";
  S.inputLocked = false;
  SCENE.clearInteraction();
  $("#chase-move").hidden = true;
  const stickerBox = $("#win-sticker");
  stickerBox.hidden = true;
  const kind = S.boss.kind;
  const iAmHunter = S.boss.role === "hunter";
  let iWon = true;
  if (kind === "ai") {
    iWon = hunterWon;
    $("#win-title").textContent = hunterWon ? `${bossName()} besiegt!` : `${bossName()} ist entkommen!`;
    $("#win-sub").textContent = hunterWon
      ? "Was für eine Jagd! Stark."
      : "Es stapft davon … Gleich nochmal?";
  } else if (kind === "hotseat") {
    $("#win-title").textContent = hunterWon
      ? `Spieler 2 hat ${bossName()} besiegt!`
      : `${bossName()} ist entkommen — Spieler 1 gewinnt!`;
    $("#win-sub").textContent = "Tauscht die Rollen und spielt nochmal!";
  } else {
    iWon = iAmHunter === hunterWon;
    $("#win-title").textContent = iWon ? "Du hast gewonnen!" : "Dein Mitspieler hat gewonnen!";
    $("#win-sub").textContent = "Tauscht die Geräte für den Rollentausch!";
  }
  if (iWon && flag("stickers")) {
    const r = PROG.awardSticker(S.worlds[0]);
    const creature = getWorld(r.worldId).creatures[r.idx];
    stickerBox.innerHTML = "";
    const img = document.createElement("img");
    img.alt = creature?.name ?? "";
    img.src = creatureThumb(r.worldId, r.idx);
    const label = document.createElement("div");
    label.className = "sticker-label";
    label.textContent = r.isNew
      ? `Neuer Sticker: ${creature?.name}!`
      : `Sticker: ${creature?.name} (schon im Album)`;
    stickerBox.appendChild(img);
    stickerBox.appendChild(label);
    stickerBox.hidden = false;
  }
  $("#btn-rematch").textContent = "Nochmal spielen";
  show("screen-win");
  if (iWon) {
    SND.bigWin();
    SCENE.confettiRain("mine");
  } else {
    SND.sad();
  }
}

// ---- online boss -------------------------------------------------------

function beginBossOnlineMonster() {
  S.mode = "boss";
  S.phase = "boss";
  S.boss = { kind: "online", st: BOSS.createBoss(), role: "monster", marks: {} };
  setupBossBoard();
  beginBossPlacing();
}

function beginBossOnlineHunter() {
  S.mode = "boss";
  S.phase = "boss";
  S.boss = {
    kind: "online",
    st: null,
    role: "hunter",
    marks: {},
    ready: false,
    shotsLeft: BOSS.BOSS_SHOTS,
    wounds: 0,
  };
  setupBossBoard();
  S.inputLocked = true;
  status("Das Monster sucht sich einen Platz … 🙈");
  SCENE.setTapMode("mine", (x, y) => bossOnlineSeekTap(x, y));
}

function bossOnlineSeekTap(x, y) {
  if (S.phase !== "boss" || S.inputLocked || !S.boss.ready) return;
  S.inputLocked = true;
  if (!S.net.send({ t: "b-shot", x, y })) S.inputLocked = false;
}

function handleBossMessage(msg) {
  switch (msg.t) {
    case "b-ready": {
      if (S.boss?.role !== "hunter") break;
      S.boss.ready = true;
      S.inputLocked = false;
      bossHunterStatus(0, S.boss.shotsLeft, "Die Jagd beginnt!");
      break;
    }
    case "b-shot": {
      if (S.boss?.role !== "monster") break;
      const st = S.boss.st;
      const res = BOSS.bossShoot(st, msg.x, msg.y);
      if (res.result === "over") break;
      S.net.send({
        t: "b-res",
        x: msg.x,
        y: msg.y,
        result: res.result,
        dist: res.dist ?? null,
        faded: res.faded || [],
        wounds: res.wounds,
        defeated: !!res.defeated,
        escaped: !!res.escaped,
        shotsLeft: st.shotsLeft,
        boss: res.defeated || res.escaped ? st.boss : null,
        woundSegs: res.defeated || res.escaped ? st.wounds : null,
      });
      SCENE.clearMark("mine", msg.x, msg.y);
      if (res.result === "hit") {
        SND.sad();
        SCENE.applyShot("mine", msg.x, msg.y, "hit");
        SCENE.markWound("mine", bossIdx(), res.seg, BOSS.BOSS_SIZE);
        if (res.defeated) {
          bossEnd(true);
          break;
        }
        if (res.escaped) {
          bossEnd(false);
          break;
        }
      } else {
        SND.plop();
        SCENE.applyShot("mine", msg.x, msg.y, "miss", { sonarDist: res.dist });
        for (const k of res.faded) {
          const [fx, fy] = k.split(",").map(Number);
          SCENE.clearMark("mine", fx, fy);
        }
        if (res.escaped) {
          bossEnd(false);
          break;
        }
      }
      openMoveOverlay("boss");
      break;
    }
    case "b-res": {
      if (S.boss?.role !== "hunter") break;
      S.boss.shotsLeft = msg.shotsLeft;
      S.boss.wounds = msg.wounds;
      SCENE.clearMark("mine", msg.x, msg.y);
      if (msg.result === "hit") {
        SND.fanfare();
        SCENE.applyShot("mine", msg.x, msg.y, "hit");
      } else {
        SND.plop();
        SCENE.applyShot("mine", msg.x, msg.y, "miss", { sonarDist: msg.dist });
        for (const k of msg.faded || []) {
          const [fx, fy] = k.split(",").map(Number);
          SCENE.clearMark("mine", fx, fy);
        }
      }
      if (msg.defeated || msg.escaped) {
        if (msg.boss) {
          const ship = { id: bossIdx(), size: BOSS.BOSS_SIZE, x: msg.boss.x, y: msg.boss.y, dir: msg.boss.dir, hits: [] };
          SCENE.addCreature("mine", ship, { popIn: true, found: msg.defeated });
          for (const seg of msg.woundSegs || []) SCENE.markWound("mine", ship.id, seg, BOSS.BOSS_SIZE);
        }
        bossEnd(!!msg.defeated);
        break;
      }
      bossHunterStatus(msg.wounds, msg.shotsLeft, msg.result === "hit" ? "Getroffen! Es brüllt …" : "Daneben!");
      break;
    }
    case "b-moved": {
      if (S.boss?.role !== "hunter") break;
      S.inputLocked = false;
      bossHunterStatus(S.boss.wounds, S.boss.shotsLeft, "Es ist weitergestapft — jag es!");
      break;
    }
    default:
      break;
  }
}

// -------------------------------------------------------------- puzzle

function startPuzzle() {
  SND.unlock();
  SND.whoosh();
  goFullscreen();
  S.mode = "puzzle";
  S.phase = "puzzle";
  S.viewer = 0;
  const worldId = S.worlds[0];
  applyUiWorld(worldId);

  const { board, rows, cols, hints } = generatePuzzle();
  S.puzzle = { board, rows, cols, spades: PUZZLE_SPADES };
  S.boards = [board, null];

  SCENE.setupBoard("mine", worldId);
  SCENE.placeCreatures("mine", []); // everything stays hidden
  SCENE.setEdgeCounts("mine", rows, cols);
  // truthful pre-revealed hint cells
  for (const h of hints) {
    const res = E.fire(board, h.x, h.y);
    SCENE.applyShotQuiet("mine", h.x, h.y, res.result === E.MISS ? "miss" : "hit");
    if (res.result === E.SUNK) {
      SCENE.addCreature("mine", res.ship, { found: true });
      for (const c of res.revealed) SCENE.applyShotQuiet("mine", c.x, c.y, "miss");
    }
  }
  if (board.ships.every(E.isSunk)) {
    // hints solved the whole thing (vanishingly rare) — deal a new one
    startPuzzle();
    return;
  }
  updatePuzzleClues();
  SCENE.focusBoard("mine", { immediate: S.phase === "title" });
  SCENE.clearInteraction();
  SCENE.setTapMode("mine", puzzleTap);
  SND.startAmbient(worldId);
  show(null);
  $("#btn-shuffle").hidden = true;
  $("#btn-style").hidden = true;
  $("#btn-place-done").hidden = true;
  puzzleStatus();
  renderChips(0);
}

function puzzleStatus(prefix = "") {
  const lead = prefix ? `${prefix} ` : "";
  status(`${lead}Die Zahlen verraten die Verstecke! ${"⛏️".repeat(S.puzzle.spades)}`);
}

// dim row/col clues that are fully found
function updatePuzzleClues() {
  const { board, rows, cols } = S.puzzle;
  const foundRows = Array(board.size).fill(0);
  const foundCols = Array(board.size).fill(0);
  for (const s of board.ships) {
    for (const h of s.hits) {
      foundRows[h.y] += 1;
      foundCols[h.x] += 1;
    }
  }
  rows.forEach((n, y) => {
    if (foundRows[y] >= n) SCENE.dimEdgeCount("mine", "rows", y);
  });
  cols.forEach((n, x) => {
    if (foundCols[x] >= n) SCENE.dimEdgeCount("mine", "cols", x);
  });
}

function puzzleTap(x, y) {
  if (S.phase !== "puzzle" || S.inputLocked) return;
  const { board } = S.puzzle;
  const res = E.fire(board, x, y);
  if (res.result === E.REPEAT) {
    SND.tap();
    return;
  }
  const world = getWorld(S.worlds[0]);
  SCENE.applyShot("mine", x, y, res.result === E.MISS ? "miss" : "hit");
  if (navigator.vibrate) navigator.vibrate(res.result === E.MISS ? 15 : 40);

  if (res.result === E.MISS) {
    SND.plop();
    S.puzzle.spades -= 1;
    if (S.puzzle.spades <= 0) {
      puzzleEnd(false);
      return;
    }
    puzzleStatus("Hier ist nichts …");
  } else if (res.result === E.HIT) {
    SND.sparkle();
    updatePuzzleClues();
    puzzleStatus(world.words.hit);
  } else if (res.result === E.SUNK) {
    SND.fanfare();
    SCENE.revealShip("mine", res.ship);
    SCENE.revealWater("mine", res.revealed);
    updatePuzzleClues();
    renderChips(0);
    if (res.gameOver) {
      S.inputLocked = true;
      setTimeout(() => puzzleEnd(true), FAST ? 60 : 1400);
      return;
    }
    puzzleStatus(`${creatureName(0, res.ship.id)} ${world.words.sunk}`);
  }
}

function puzzleEnd(won) {
  S.phase = "over";
  S.inputLocked = false;
  SCENE.clearInteraction();
  const world = getWorld(S.worlds[0]);
  const stickerBox = $("#win-sticker");
  stickerBox.hidden = true;
  if (won) {
    $("#win-title").textContent = "Rätsel gelöst!";
    $("#win-sub").textContent = world.words.win;
    if (flag("stickers")) {
      const r = PROG.awardSticker(S.worlds[0]);
      const creature = getWorld(r.worldId).creatures[r.idx];
      stickerBox.innerHTML = "";
      const img = document.createElement("img");
      img.alt = creature?.name ?? "";
      img.src = creatureThumb(r.worldId, r.idx);
      const label = document.createElement("div");
      label.className = "sticker-label";
      label.textContent = r.isNew
        ? `Neuer Sticker: ${creature?.name}!`
        : `Sticker: ${creature?.name} (schon im Album)`;
      stickerBox.appendChild(img);
      stickerBox.appendChild(label);
      stickerBox.hidden = false;
    }
    SND.bigWin();
    SCENE.confettiRain("mine");
  } else {
    // reveal the hiding spots so the kid learns the layout
    SCENE.placeCreatures("mine", S.puzzle.board.ships, { popIn: true });
    $("#win-title").textContent = "Die Schaufeln sind alle!";
    $("#win-sub").textContent = "Schau, hier waren die Verstecke. Gleich nochmal?";
    SND.sad();
  }
  $("#btn-rematch").textContent = "Neues Rätsel";
  show("screen-win");
}

// -------------------------------------------------------------- game over

function finishGame(winner) {
  S.phase = "over";
  SCENE.clearInteraction();
  $("#btn-rematch").textContent = "Nochmal spielen";
  const loserIdx = other(winner);
  const world = getWorld(S.worlds[loserIdx]);
  const iWon = S.mode === "hotseat" || winner === S.viewer;
  SCENE.focusBoard(slotFor(loserIdx));
  if (S.mode === "hotseat") {
    $("#win-title").textContent = `Spieler ${winner + 1} hat gewonnen!`;
    $("#win-sub").textContent = world.words.win;
  } else if (S.mode === "ai") {
    $("#win-title").textContent = winner === 0 ? "Du hast gewonnen!" : "Robo war schneller!";
    $("#win-sub").textContent =
      winner === 0 ? world.words.win : "Beim nächsten Mal schaffst du es bestimmt!";
  } else {
    $("#win-title").textContent = winner === 0 ? "Du hast gewonnen!" : "Dein Mitspieler hat gewonnen!";
    $("#win-sub").textContent = winner === 0 ? world.words.win : "Fast! Gleich nochmal?";
  }
  const stickerBox = $("#win-sticker");
  stickerBox.hidden = true;
  if (iWon && flag("stickers")) {
    const winnersWorld = S.worlds[loserIdx]; // the world they searched in
    const r = PROG.awardSticker(winnersWorld);
    const creature = getWorld(r.worldId).creatures[r.idx];
    stickerBox.innerHTML = "";
    const img = document.createElement("img");
    img.alt = creature?.name ?? "";
    img.src = creatureThumb(r.worldId, r.idx);
    const label = document.createElement("div");
    label.className = "sticker-label";
    label.textContent = r.isNew
      ? `Neuer Sticker: ${creature?.name}!`
      : `Sticker: ${creature?.name} (schon im Album)`;
    stickerBox.appendChild(img);
    stickerBox.appendChild(label);
    if (r.newHats.length) {
      const unlock = document.createElement("div");
      unlock.className = "sticker-unlock";
      unlock.textContent = `Neu freigeschaltet: ${r.newHats
        .map((k) => ACCESSORY_NAMES[k])
        .join(" & ")}! 🎉`;
      stickerBox.appendChild(unlock);
    }
    stickerBox.hidden = false;
  }
  show("screen-win");
  if (iWon) {
    SND.bigWin();
    SCENE.confettiRain(slotFor(loserIdx));
  } else {
    SND.sad();
  }
}

// ------------------------------------------------------------ aquarium

function openAquarium() {
  SND.unlock();
  SND.whoosh();
  goFullscreen();
  S.mode = "aquarium";
  S.phase = "aquarium";
  S.viewer = 0;
  applyUiWorld(S.worlds[0]);
  SCENE.setupBoard("mine", S.worlds[0]);

  const p = PROG.loadProgress();
  const list = [];
  for (const world of Object.values(WORLDS)) {
    world.creatures.forEach((c, i) => {
      if (PROG.stickerCount(world.id, i, p) > 0) {
        list.push({
          key: `${world.id}-${i}`,
          worldId: world.id,
          idx: i,
          custom: loadCustom(world.id)[i] ?? null,
          name: c.name,
        });
      }
    });
  }
  S.aquarium = list;
  SCENE.populateAquarium("mine", list);
  SCENE.focusBoard("mine");
  SCENE.clearInteraction();
  S.aquariumTap = (x, y) => {
    const key = SCENE.nearestAquariumKey("mine", x, y);
    if (!key) return;
    SND.sparkle();
    SCENE.hopCreature("mine", key);
    const item = list.find((e) => e.key === key);
    if (item) toast(`${item.name} freut sich! 💛`, 1400);
  };
  SCENE.setTapMode("mine", S.aquariumTap);
  SND.startAmbient(S.worlds[0]);
  show(null);
  $("#btn-shuffle").hidden = true;
  $("#btn-style").hidden = true;
  $("#btn-endturn").hidden = true;
  $("#btn-place-done").hidden = true;
  renderChips(0);
  status(
    list.length
      ? `Dein Aquarium: ${list.length} ${list.length === 1 ? "Freund" : "Freunde"} — tipp sie an!`
      : "Noch ganz leer! Gewinne Spiele und sammle Sticker-Freunde."
  );
}

// -------------------------------------------------------------- album

function openAlbum() {
  SND.tap();
  const p = PROG.loadProgress();
  const box = $("#album-worlds");
  box.innerHTML = "";
  for (const world of Object.values(WORLDS)) {
    const sec = document.createElement("div");
    sec.className = "album-section";
    const head = document.createElement("div");
    head.className = "album-world-name";
    head.textContent = world.name;
    const grid = document.createElement("div");
    grid.className = "album-grid";
    world.creatures.forEach((c, i) => {
      const n = PROG.stickerCount(world.id, i, p);
      const slot = document.createElement("div");
      slot.className = `album-slot${n ? "" : " locked"}`;
      const img = document.createElement("img");
      img.alt = n ? c.name : "???";
      img.src = creatureThumb(world.id, i);
      slot.appendChild(img);
      const nm = document.createElement("div");
      nm.className = "album-slot-name";
      nm.textContent = n ? c.name : "???";
      slot.appendChild(nm);
      if (n > 1) {
        const badge = document.createElement("div");
        badge.className = "album-badge";
        badge.textContent = `${n}×`;
        slot.appendChild(badge);
      }
      grid.appendChild(slot);
    });
    sec.appendChild(head);
    sec.appendChild(grid);
    box.appendChild(sec);
  }
  $("#album-total").textContent = `${PROG.totalStickers(p)} Sticker gesammelt`;
  const nu = PROG.nextUnlock(p);
  $("#album-next").textContent = nu
    ? `Noch ${nu.remaining} Sticker, dann gibt es: ${ACCESSORY_NAMES[nu.kind]}! 🎩`
    : "Alle Hüte freigeschaltet! 🎉";
  show("screen-album");
}

function rematch() {
  SND.tap();
  if (S.mode === "puzzle") {
    startPuzzle();
    return;
  }
  if (S.mode === "chase" && S.chase?.kind !== "online") {
    startChase(S.chase.kind);
    return;
  }
  if (S.mode === "boss" && S.boss?.kind !== "online") {
    startBoss(S.boss.kind);
    return;
  }
  if (S.mode === "online" || S.chase?.kind === "online" || S.boss?.kind === "online") {
    S.rematchMine = true;
    S.net.send({ t: "rematch" });
    $("#btn-rematch").disabled = true;
    $("#btn-rematch").textContent = "Warte auf den anderen …";
    maybeRematch();
    return;
  }
  startMode(S.mode);
}

function goHome() {
  S.phase = "title";
  SND.stopAmbient();
  if (S.net) {
    S.net.destroy();
    S.net = null;
  }
  S.boards = [null, null];
  S.shadow = null;
  S.puzzle = null;
  S.chase = null;
  S.boss = null;
  S.aquarium = null;
  S.gameMode = "classic";
  S.customs = [{}, {}];
  S.oppCustom = null;
  $("#chase-move").hidden = true;
  SCENE.resetScene();
  closeStylePanel();
  $("#btn-rematch").disabled = false;
  $("#btn-rematch").textContent = "Nochmal spielen";
  $("#btn-endturn").hidden = true;
  $("#btn-shuffle").hidden = true;
  $("#btn-style").hidden = true;
  $("#btn-place-done").hidden = true;
  applyUiWorld(S.worlds[0]);
  show("screen-title");
}

// ------------------------------------------------------------------ boot

function boot() {
  SCENE.initScene($("#stage"));
  applyUiWorld("ozean");
  S.rules = flag("rules") ? loadRules() : { decoy: false, sonar: false, ghost: false };
  syncRuleChips();
  document.querySelector(".rules-row").hidden = !flag("rules");
  $("#btn-album").hidden = !flag("stickers");
  $("#btn-puzzle").hidden = !flag("puzzle");
  $("#btn-puzzle").addEventListener("click", startPuzzle);
  $("#btn-chase").hidden = !flag("chase");
  $("#btn-chase").addEventListener("click", () => {
    SND.tap();
    show("screen-chase");
  });
  document.querySelectorAll("[data-chase]").forEach((btn) => {
    btn.addEventListener("click", () => startChase(btn.dataset.chase));
  });
  $("#btn-aquarium").hidden = !flag("aquarium");
  $("#btn-aquarium").addEventListener("click", openAquarium);
  $("#btn-boss").hidden = !flag("boss");
  $("#btn-boss").addEventListener("click", () => {
    SND.tap();
    show("screen-boss");
  });
  document.querySelectorAll("[data-boss]").forEach((btn) => {
    btn.addEventListener("click", () => startBoss(btn.dataset.boss));
  });
  document.querySelectorAll("[data-move]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const [dx, dy] = btn.dataset.move.split(",").map(Number);
      moveOverlayTap(dx, dy);
    });
  });
  const peek = $("#btn-peek");
  peek.addEventListener("pointerdown", () => {
    if (S.mode === "boss" && S.boss?.st) {
      SCENE.placeCreatures("mine", [bossShipOf(S.boss.st)]);
    } else if (S.chase?.st) {
      SCENE.placeCreatures("mine", [fridoShip(S.chase.st.frido.x, S.chase.st.frido.y)]);
    }
  });
  const unpeek = () => {
    const active = S.mode === "boss" ? S.boss : S.chase;
    if (active && (S.phase === "chase" || S.phase === "boss") && active.kind !== "online") {
      SCENE.placeCreatures("mine", []);
    }
  };
  peek.addEventListener("pointerup", unpeek);
  peek.addEventListener("pointercancel", unpeek);
  peek.addEventListener("pointerleave", unpeek);
  for (const [id, k] of [
    ["#rule-decoy", "decoy"],
    ["#rule-sonar", "sonar"],
    ["#rule-ghost", "ghost"],
  ]) {
    $(id).addEventListener("change", (e) => {
      SND.unlock();
      SND.tap();
      S.rules[k] = e.target.checked;
      saveRules();
    });
  }
  buildWorldPicker($("#world-grid"), (id) => {
    S.worlds[0] = id;
    applyUiWorld(id);
  }, "ozean");

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

  $("#btn-shuffle").addEventListener("click", shuffleFleet);
  $("#btn-style").addEventListener("click", () => {
    if ($("#style-panel").hidden) openStylePanel();
    else closeStylePanel();
  });
  $("#btn-style-close").addEventListener("click", () => {
    SND.tap();
    closeStylePanel();
  });
  $("#btn-place-done").addEventListener("click", placementDone);
  $("#btn-pass-go").addEventListener("click", () => {
    SND.tap();
    const action = S.passAction;
    S.passAction = null;
    if (action) action();
  });
  $("#btn-worldpick-go").addEventListener("click", () => {
    SND.tap();
    const action = S.worldPickAction;
    S.worldPickAction = null;
    if (action) action();
  });
  $("#btn-endturn").addEventListener("click", hotseatEndTurn);
  $("#btn-album").addEventListener("click", openAlbum);
  $("#btn-album-back").addEventListener("click", () => {
    SND.tap();
    show("screen-title");
  });
  $("#btn-rematch").addEventListener("click", rematch);
  $("#btn-win-home").addEventListener("click", goHome);
  $("#btn-home").addEventListener("click", () => {
    SND.tap();
    goHome();
  });

  const muteBtn = $("#btn-mute");
  const syncMute = () => {
    $("#ic-waves").style.display = SND.isMuted() ? "none" : "";
    muteBtn.style.opacity = SND.isMuted() ? 0.55 : 1;
  };
  syncMute();
  muteBtn.addEventListener("click", () => {
    SND.unlock();
    SND.setMuted(!SND.isMuted());
    syncMute();
    if (SND.isMuted()) {
      SND.stopAmbient();
    } else {
      SND.tap();
      if (S.phase === "place" || S.phase === "battle") {
        SND.startAmbient(S.worlds[S.phase === "place" ? S.placingPlayer : other(S.turn)]);
      }
    }
  });

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }

  // deep link: ?join=CODE — let the guest pick their world first
  const params = new URLSearchParams(window.location.search);
  const joinCode = normalizeCode(params.get("join"));
  if (joinCode.length === 4) {
    S.mode = "online";
    showWorldPick({
      title: "Wähl deine Welt!",
      selected: S.worlds[0],
      onDone: (worldId) => {
        S.worlds[0] = worldId;
        applyUiWorld(worldId);
        show("screen-join");
        $("#join-code").value = joinCode;
        joinGame(joinCode);
      },
    });
  }

  // hooks for automated browser tests (not part of the public UI)
  window.__FF = {
    state: S,
    engine: E,
    debugCamera: SCENE.debugCamera,
    thumb: (w, i, size, px) => SCENE.creatureThumb(w, i, size, px),
    setFast: () => {
      FAST = true;
    },
    tap: (x, y) => handleTap(x, y),
    puzzleTap: (x, y) => puzzleTap(x, y),
    chaseTap: (x, y) => chaseSeekTap(x, y),
    chaseNetTap: (x, y) => chaseOnlineSeekTap(x, y),
    bossTap: (x, y) => bossSeekTap(x, y),
    bossNetTap: (x, y) => bossOnlineSeekTap(x, y),
    aquariumTap: (x, y) => S.aquariumTap?.(x, y),
    setStyle: (id, tint, hat) => setShipCustom(id, { tint, hat }),
    setRules: (r) => {
      Object.assign(S.rules, r);
      syncRuleChips();
    },
    flags: allFlags,
    setFlag,
    placementBoard: () => S.boards[S.placingPlayer],
    marksOn: (idx) => (S.mode === "online" && idx === 1 ? S.shadow.marks : S.boards[idx]?.shots),
    rotateFirst: () => {
      const b = S.boards[S.placingPlayer];
      const ship = b.ships[0];
      const dir = ship.dir === "h" ? "v" : "h";
      return E.moveShip(b, ship.id, ship.x, ship.y, dir);
    },
  };
}

boot();
