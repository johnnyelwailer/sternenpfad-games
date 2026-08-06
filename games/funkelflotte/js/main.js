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
import * as PW from "./powers.js";
import * as CHASE from "./chase.js";
import * as BOSS from "./boss.js";
import * as SND from "./sound.js";
import * as SCENE from "./scene.js";
import { Net, makeCode, normalizeCode, joinUrl, stableId } from "./net.js";

const PID = stableId(); // this device's permanent friend address

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
  powersOn: true, // Zauber-Kräfte option (persisted)
  powers: [null, null], // per player: PW.newPowerState() during battle
  pendingPower: null, // power kind waiting for a target tap
  lastShot: [null, null], // per player: their most recent shot {x,y}
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
  if (screenId === "screen-online") {
    // visible to remembered friends while this screen is open
    renderFriends();
    startFriendListener();
  }
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

function worldThumb(worldId) {
  const map = loadCustom(worldId);
  const key = `world-${worldId}-${map[0] ? `${map[0].tint}.${map[0].hat}` : "0"}-${
    map[4] ? `${map[4].tint}.${map[4].hat}` : "0"
  }`;
  if (!thumbCache.has(key)) {
    thumbCache.set(key, SCENE.worldCardThumb(worldId, map));
  }
  return thumbCache.get(key);
}
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
  // fill in themed 3D vignettes lazily so the first paint is instant
  setTimeout(() => {
    gridEl.querySelectorAll(".world-card").forEach((card) => {
      const img = document.createElement("img");
      img.alt = "";
      img.src = worldThumb(card.dataset.world);
      card.querySelector(".ph")?.replaceWith(img);
    });
  }, 30);
}

// the found/missing chip row was UI clutter — the golden rings on the
// board already tell the story. Kept as a no-op so call sites stay.
function renderChips() {}

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

// ---------------------------------------------------------- Zauber-Kräfte

function loadPowersOpt() {
  try {
    return localStorage.getItem("ff-powers") !== "0";
  } catch {
    return true;
  }
}

function savePowersOpt() {
  try {
    localStorage.setItem("ff-powers", S.powersOn ? "1" : "0");
    localStorage.setItem("ff-cards", S.cardsOn ? "1" : "0");
  } catch {
    /* private mode etc. */
  }
}

function loadCardsOpt() {
  try {
    return localStorage.getItem("ff-cards") === "1"; // OFF by default
  } catch {
    return false;
  }
}

// powers only exist in the classic battle modes
function powersEnabled() {
  return flag("powers") && S.powersOn && S.gameMode === "classic" && S.phase === "battle";
}

// the on-demand card hand (world powers + recharges) is an extra layer
function cardsEnabled() {
  return powersEnabled() && S.cardsOn;
}

// whose hand is acting right now (hotseat swaps seats)
function me() {
  return S.mode === "hotseat" ? S.turn : 0;
}

function myPowers() {
  return S.powers[me()];
}

function resetRuleState() {
  S.powers = [null, null];
  S.pendingPower = null;
  S.lastShot = [null, null];
  S.extraTurn = null;
  S.ghostTrack = [
    { count: 0, queue: [] },
    { count: 0, queue: [] },
  ];
  S.sonarMap = [{}, {}];
}

// seed a board's treasure exactly once — positions may already have
// been announced to the opponent
function ensureTreasures(board) {
  if (!board.treasures) PW.seedTreasures(board);
  return board.treasures;
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
  S.journey = null;
  S.turn = 0;
  S.viewer = 0;
  S.rematchMine = false;
  S.rematchTheirs = false;
  S.inputLocked = false;
  resetRuleState();

  if (mode === "ai") {
    S.worlds[1] = randomOtherWorld(S.worlds[0]);
    S.boards = [newBoardWithFleet(), newBoardWithFleet()];
    S.aiState = createAiState(S.forceRoboLevel ?? S.roboLevel ?? "leicht");
    S.forceRoboLevel = null;
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
    // cells this creature must keep clear (the one-gap no-touch rule),
    // shown as a soft red wash while dragging
    blockedCells: (id) => {
      const board = S.boards[idx];
      const set = new Set();
      const markAround = (cx, cy) => {
        for (let dx = -1; dx <= 1; dx += 1) {
          for (let dy = -1; dy <= 1; dy += 1) {
            const x = cx + dx;
            const y = cy + dy;
            if (E.inBounds(board, x, y)) set.add(E.key(x, y));
          }
        }
      };
      for (const s of board.ships) {
        if (String(s.id) === String(id)) continue;
        for (const c of E.shipCells(s)) markAround(c.x, c.y);
      }
      if (board.decoy && id !== "decoy") markAround(board.decoy.x, board.decoy.y);
      return [...set].map((k) => {
        const [x, y] = k.split(",").map(Number);
        return { x, y };
      });
    },
    onMove: (id, x, y, dir) => {
      const board = S.boards[idx];
      if (id === "decoy") {
        if (E.placeDecoy(board, x, y)) {
          SND.tap();
        } else {
          SND.sad();
          toast("Der Ballon braucht ein Feld Abstand zu den Freunden!");
        }
        SCENE.moveCreature(slot, decoyShipOf(board));
        return;
      }
      if (E.moveShip(board, id, x, y, dir)) {
        SND.tap();
        SCENE.moveCreature(slot, board.ships.find((s) => s.id === id));
      } else {
        SND.sad();
        toast("Die Freunde brauchen ein Feld Abstand zueinander!");
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
  $("#btn-opts").hidden = false;
  $("#btn-place-done").hidden = false;
  $("#btn-place-done").disabled = false;
  $("#btn-place-done").textContent = "Fertig!";
  $("#btn-endturn").hidden = true;
  renderChips(other(S.viewer));
}

// swap your world any time during placement — layout and styles carry over
function changeMyWorld() {
  SND.tap();
  const idx = S.placingPlayer;
  showWorldPick({
    title: "Wähl deine Welt!",
    selected: S.worlds[idx],
    onDone: (worldId) => {
      if (worldId !== S.worlds[idx]) {
        S.worlds[idx] = worldId;
        if (S.mode === "online") S.net.send({ t: "world", world: worldId });
      }
      startPlacement(idx);
    },
  });
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

// full-view customizer: one big live 3D creature, tints + hats with
// sticker locks. Lives in the AQUARIUM — you style your collected
// friends there, and your fleet wears the styles in every battle.
let custPreview = null;
const cust = { i: 0, lockedHat: null, list: [] };

function openCustomizer(startIdx = 0) {
  SND.tap();
  cust.list = (S.aquarium ?? []).map((e) => ({
    worldId: e.worldId,
    idx: e.idx,
    name: e.name,
  }));
  if (!cust.list.length) return;
  cust.i = startIdx;
  cust.lockedHat = null;
  $("#customizer").hidden = false;
  if (!custPreview) custPreview = SCENE.createPreview($("#cust-canvas"));
  renderCustomizer();
}

function closeStylePanel() {
  // (kept name: called from placement/battle/goHome transitions)
  $("#customizer").hidden = true;
  if (custPreview) {
    custPreview.stop();
    custPreview = null;
  }
}

function currentCustItem() {
  const n = cust.list.length;
  if (!n) return null;
  cust.i = ((cust.i % n) + n) % n;
  return cust.list[cust.i];
}

function customOf(item) {
  return loadCustom(item.worldId)[item.idx] || { tint: 0, hat: 0 };
}

function applyCustomPatch(item, patch) {
  const map = loadCustom(item.worldId);
  const cur = map[item.idx] || { tint: 0, hat: 0 };
  const next = { ...cur, ...patch };
  if (!next.tint && !next.hat) delete map[item.idx];
  else map[item.idx] = next;
  saveCustom(item.worldId, map);
  refreshAquarium();
}

function renderCustomizer() {
  const item = currentCustItem();
  if (!item) return;
  const cur = customOf(item);
  $("#cust-name").textContent = item.name;
  $("#cust-count").textContent = `${cust.i + 1} / ${cust.list.length}`;
  custPreview.show(item.worldId, item.idx, item.idx === 0 ? 3.4 : 2.6, cur.tint || cur.hat ? cur : null);

  const dots = $("#cust-tints");
  dots.innerHTML = "";
  TINTS.forEach((hex, ti) => {
    const locked = flag("stickers") && !PROG.isTintUnlocked(ti);
    const dot = document.createElement("button");
    dot.className = `tint-dot${hex === null ? " none" : ""}${ti === cur.tint ? " selected" : ""}${locked ? " locked" : ""}`;
    dot.setAttribute("aria-label", ti === 0 ? "Naturfarbe" : `Farbe ${ti}`);
    if (hex !== null) dot.style.background = `#${hex.toString(16).padStart(6, "0")}`;
    dot.addEventListener("click", () => {
      if (locked) {
        SND.sad();
        toast(`🔒 Noch ${PROG.tintUnlockAt(ti) - PROG.totalStickers()} Sticker bis zu dieser Farbe!`);
        return;
      }
      SND.tap();
      cust.lockedHat = null;
      applyCustomPatch(item, { tint: ti });
      renderCustomizer();
    });
    dots.appendChild(dot);
  });

  $("#cust-hat-name").textContent = hatLabel(cur.hat);
  const nu = flag("stickers") ? PROG.nextUnlock() : null;
  $("#cust-hint").textContent = nu
    ? `Gewinne Sticker: noch ${nu.remaining} bis ${ACCESSORY_NAMES[nu.kind]}! 🎁`
    : "";
  $("#cust-hint").hidden = !nu;
}

function cycleHat(step) {
  const item = currentCustItem();
  if (!item) return;
  const cur = customOf(item);
  let h = cust.lockedHat ?? cur.hat;
  h = (h + step + ACCESSORIES.length) % ACCESSORIES.length;
  if (flag("stickers") && !PROG.isHatUnlocked(h)) {
    // browsing a still-locked hat: show what it takes, keep cycling
    cust.lockedHat = h;
    const kind = ACCESSORIES[h];
    $("#cust-hat-name").textContent = `🔒 ${ACCESSORY_NAMES[kind]} — noch ${
      PROG.hatUnlockAt(h) - PROG.totalStickers()
    } Sticker`;
    SND.tap();
    return;
  }
  cust.lockedHat = null;
  SND.sparkle();
  applyCustomPatch(item, { hat: h });
  renderCustomizer();
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
  $("#btn-opts").hidden = true;
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
    S.net.send({
      t: "ready",
      custom: S.customs[0],
      treasures: flag("powers") && S.powersOn ? ensureTreasures(S.boards[0]) : [],
    });
    maybeStartOnline();
  }
}

// ------------------------------------------------ power tray + execution

function renderPowers() {
  const box = $("#powers");
  const st = powersEnabled() ? myPowers() : null;
  const mine = S.phase === "battle" && S.turn === S.viewer && !S.inputLocked;
  if (!st || !mine) {
    box.hidden = true;
    box.innerHTML = "";
    return;
  }
  box.innerHTML = "";
  const counts = new Map();
  // hand chips exist only in card mode; passive badges always show
  if (cardsEnabled()) {
    for (const k of st.hand) counts.set(k, (counts.get(k) || 0) + 1);
  }
  for (const [kind, n] of counts) {
    const p = PW.POWERS[kind];
    const chip = document.createElement("button");
    chip.className = `power-chip${S.pendingPower === kind ? " armed" : ""}`;
    chip.dataset.power = kind;
    chip.innerHTML = `<img class="power-icon" alt="" src="${SCENE.powerIconUrl(kind)}" /><span class="power-name">${p.name}</span>${
      n > 1 ? `<span class="power-count">${n}×</span>` : ""
    }`;
    chip.addEventListener("click", () => onPowerTap(kind));
    box.appendChild(chip);
  }
  // passive badges so kids see what is active
  if (st.shield) box.appendChild(passiveBadge("schild", "Schild aktiv"));
  if (st.clover) box.appendChild(passiveBadge("klee", "Glücksklee"));
  if (st.doubleShot) box.appendChild(passiveBadge("doppel", "Doppelschuss"));
  box.hidden = box.children.length === 0;
}

function passiveBadge(kind, label) {
  const b = document.createElement("div");
  b.className = "power-chip passive";
  b.innerHTML = `<img class="power-icon" alt="" src="${SCENE.powerIconUrl(kind)}" /><span class="power-name">${label}</span>`;
  return b;
}

// reveal card whenever a power arrives — big icon + name; the effect
// itself is the explanation
let gainTimer = null;
function showPowerGain(kind, why) {
  const p = PW.POWERS[kind];
  const card = $("#power-gain");
  card.innerHTML = `<div class="gain-why">${why}</div>
    <img alt="" src="${SCENE.powerIconUrl(kind, 192)}" />
    <div class="gain-name">${p.name}</div>`;
  card.hidden = false;
  clearTimeout(gainTimer);
  gainTimer = setTimeout(() => {
    card.hidden = true;
  }, FAST ? 300 : 2600);
  card.onclick = () => {
    card.hidden = true;
  };
}

// the dug-up power sails from the chest to the middle of the screen,
// then fires on the spot
function powerFlyOut(kind, slot, x, y, onDone) {
  const from = SCENE.cellScreenPos(slot, x, y) ?? {
    x: window.innerWidth / 2,
    y: window.innerHeight * 0.6,
  };
  const img = document.createElement("img");
  img.className = "power-fly";
  img.alt = "";
  img.src = SCENE.powerIconUrl(kind, 192);
  img.style.left = `${from.x}px`;
  img.style.top = `${from.y}px`;
  document.body.appendChild(img);
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      img.style.left = `${window.innerWidth / 2}px`;
      img.style.top = `${window.innerHeight * 0.3}px`;
      img.classList.add("landed");
    });
  });
  setTimeout(() => {
    img.remove();
    onDone();
  }, FAST ? 100 : 1100);
}

// treasures cast their power immediately — cause and effect in one go
function autoUsePower(kind) {
  const p = PW.POWERS[kind];
  showPowerGain(kind, "💎 Schatz-Zauber");
  if (p.target === "none") {
    executePower(kind, null);
    return;
  }
  S.pendingPower = kind;
  S.inputLocked = false; // the next tap is the spell's target
  status(`✨ Tipp ein Feld — der Schatz-Zauber wartet!`);
}

function dispatchTreasureFollowup() {
  if (!S.treasureFollowup) return;
  const f = S.treasureFollowup;
  S.treasureFollowup = null;
  setTimeout(f, FAST ? 140 : 1700);
}

function consumePower(kind) {
  const st = myPowers();
  const i = st.hand.indexOf(kind);
  if (i >= 0) st.hand.splice(i, 1);
  S.pendingPower = null;
  renderPowers();
}

function gainPower(playerIdx, kind, why) {
  const st = S.powers[playerIdx];
  if (!st) return;
  if (st.hand.length >= PW.HAND_MAX) {
    if (playerIdx === me()) toast(`Deine Zauber-Tasche ist voll! (max. ${PW.HAND_MAX})`);
    return;
  }
  st.hand.push(kind);
  if (playerIdx === me()) {
    SND.sparkle();
    showPowerGain(kind, why);
  }
  renderPowers();
}

function onPowerTap(kind) {
  if (S.phase !== "battle" || S.turn !== S.viewer || S.inputLocked) return;
  if (S.pendingPower === kind) {
    S.pendingPower = null;
    beginTurnStatus();
    renderPowers();
    return;
  }
  const p = PW.POWERS[kind];
  if (kind === "ballon" && !PW.canExtraBalloon(S.boards[me()])) {
    SND.sad();
    toast("Dein Ballon ist ja noch versteckt!");
    return;
  }
  if (kind === "kompass" && !S.lastShot[me()]) {
    SND.sad();
    toast("Erst einmal schießen — dann weiß der Kompass, wo er suchen soll!");
    return;
  }
  SND.tap();
  if (p.target === "none") {
    executePower(kind, null);
  } else {
    S.pendingPower = kind;
    status(
      p.target === "row"
        ? `${p.emoji} ${p.name}: Tipp eine Reihe auf dem Suchbrett an!`
        : `${p.emoji} ${p.name}: Tipp ein Feld auf dem Suchbrett an!`
    );
    renderPowers();
  }
}

function beginTurnStatus() {
  const target = other(S.turn);
  const world = getWorld(S.worlds[target]);
  status(
    S.mode === "hotseat"
      ? `Spieler ${S.turn + 1}: Such ${world.words.boardIn} von Spieler ${target + 1}!`
      : `Du bist dran! Such ${world.words.boardIn}!`
  );
}

// ask the defender (engine locally, the other device online)
function resolveInfo(kind, payload, apply) {
  if (S.mode === "online") {
    S.pendingInfo = apply;
    S.net.send({ t: "pw", kind, ...payload });
    return;
  }
  const board = S.boards[other(me())];
  if (kind === "welle") apply({ cells: PW.scanCells(board, PW.rowCells(board, payload.y)) });
  else if (kind === "radar") apply({ cells: PW.scanCells(board, PW.squareCells(board, payload.x, payload.y)) });
  else if (kind === "fernglas") apply({ cells: PW.scanCells(board, [{ x: payload.x, y: payload.y }]) });
  else if (kind === "trommel" || kind === "kompass") apply({ dir: PW.directionToNearest(board, payload.x, payload.y) });
  else if (kind === "glocke") apply({ big: PW.biggestHiddenDir(board) });
}

function executePower(kind, target) {
  const my = me();
  const enemySlot = slotFor(other(my));
  const st = myPowers();
  const p = PW.POWERS[kind];
  SND.powerCast(CAST_SOUND[kind] ?? "info");

  if (kind === "welle") {
    consumePower(kind);
    SCENE.waveSweep(enemySlot, target.y);
    SND.whoosh();
    resolveInfo(kind, { y: target.y }, ({ cells }) => {
      SND.sparkle();
      cells.forEach((c, i) => setTimeout(() => SCENE.peekMarker(enemySlot, c.x, c.y, c.ship), 300 + i * 90));
      status("🌊 Die große Welle verrät ihre Geheimnisse!");
    });
  } else if (kind === "radar") {
    consumePower(kind);
    SCENE.radarPing(enemySlot, target.x, target.y);
    resolveInfo(kind, { x: target.x, y: target.y }, ({ cells }) => {
      SND.sparkle();
      cells.forEach((c, i) => setTimeout(() => SCENE.peekMarker(enemySlot, c.x, c.y, c.ship), 400 + i * 140));
      status("🛰️ Der Satellit hat alles durchleuchtet!");
    });
  } else if (kind === "fernglas") {
    consumePower(kind);
    SCENE.spotlight(enemySlot, target.x, target.y);
    resolveInfo(kind, { x: target.x, y: target.y }, ({ cells }) => {
      SND.sparkle();
      setTimeout(() => SCENE.peekMarker(enemySlot, cells[0].x, cells[0].y, cells[0].ship), 450);
      status(cells[0].ship ? "🔍 Da versteckt sich jemand!" : "🔍 Hier ist nur Wasser.");
    });
  } else if (kind === "trommel" || kind === "kompass") {
    const from = kind === "kompass" ? S.lastShot[my] : target;
    consumePower(kind);
    resolveInfo(kind, { x: from.x, y: from.y }, ({ dir }) => {
      if (!dir) {
        status("Alle Freunde sind schon gefunden!");
        return;
      }
      SND.sparkle();
      SCENE.arrowMarker(enemySlot, from.x, from.y, dir.angle);
      status(`${p.emoji} Der Pfeil zeigt zum nächsten Versteck!`);
    });
  } else if (kind === "glocke") {
    consumePower(kind);
    SCENE.bellToll(enemySlot);
    resolveInfo(kind, {}, ({ big }) => {
      SND.sparkle();
      status(
        big
          ? `🔔 Die Glocke flüstert: Der größte Freund liegt ${big === "h" ? "QUER" : "HOCHKANT"}!`
          : "🔔 Die Glocke schweigt — alle sind gefunden!"
      );
    });
  } else if (kind === "klee") {
    consumePower(kind);
    st.clover = true;
    SCENE.cloverRain(enemySlot);
    SND.fanfare();
    status("🍀 Glücksklee! Jedes Daneben zeigt jetzt die Entfernung.");
  } else if (kind === "doppel") {
    consumePower(kind);
    st.doubleShot = true;
    status("🎯 Doppelschuss bereit: Dein nächstes Daneben zählt nicht!");
  } else if (kind === "zeit") {
    consumePower(kind);
    S.extraTurn = my;
    if (S.mode === "online") S.net.send({ t: "pw", kind: "zeit" });
    SCENE.clockRipple(enemySlot);
    SND.sparkle();
    status("⏳ Zeitzauber! Nach deinem nächsten Daneben darfst du gleich weitersuchen.");
  } else if (kind === "schild") {
    consumePower(kind);
    st.shield = true;
    SCENE.shieldFlash(slotFor(my));
    SND.sparkle();
    status("🪷 Seerosen-Schild aktiv: Der nächste Treffer prallt ab!");
  } else if (kind === "wirbel") {
    const moved = PW.whirlwindMove(S.boards[my]);
    if (!moved) {
      SND.sad();
      toast("Kein Platz zum Wirbeln!");
      S.pendingPower = null;
      renderPowers();
      dispatchTreasureFollowup();
      return;
    }
    consumePower(kind);
    syncCreatureVisibility();
    const mid = moved.dir === "h" ? moved.x + Math.floor(moved.size / 2) : moved.x;
    const midY = moved.dir === "v" ? moved.y + Math.floor(moved.size / 2) : moved.y;
    SCENE.tornadoAt(slotFor(my), mid, midY);
    if (S.mode === "online") S.net.send({ t: "pw", kind: "wirbel" });
    SND.whoosh();
    status("🌪️ Wusch! Ein Freund hat heimlich das Versteck gewechselt.");
  } else if (kind === "ballon") {
    if (!PW.extraBalloon(S.boards[my])) {
      SND.sad();
      toast("Kein freies Plätzchen für den Ballon!");
      S.pendingPower = null;
      renderPowers();
      dispatchTreasureFollowup();
      return;
    }
    consumePower(kind);
    syncCreatureVisibility();
    if (S.mode === "online") S.net.send({ t: "pw", kind: "ballon" });
    SND.plop();
    status("🎈 Ein neuer Schwindel-Ballon ist versteckt!");
  } else if (kind === "salve") {
    consumePower(kind);
    runSalvo(target);
  }
  renderPowers();
  dispatchTreasureFollowup();
}

// activation timbre by temperament
const CAST_SOUND = {
  welle: "info",
  radar: "info",
  fernglas: "info",
  trommel: "info",
  kompass: "info",
  glocke: "info",
  klee: "defense",
  doppel: "attack",
  zeit: "defense",
  schild: "defense",
  wirbel: "move",
  ballon: "move",
  salve: "attack",
};

// three shots at once, then the turn passes — the defender resolves
function runSalvo(target) {
  S.inputLocked = true;
  if (S.mode === "online") {
    S.net.send({ t: "pw", kind: "salve", x: target.x, y: target.y });
    status("⭐ Sternschnuppen unterwegs …");
    return;
  }
  const targetIdx = other(me());
  const board = S.boards[targetIdx];
  const cells = PW.salvoCells(board, target.x, target.y);
  const results = [];
  for (const c of cells) {
    const res = E.fire(board, c.x, c.y);
    if (res.result !== E.REPEAT) results.push({ ...c, res });
  }
  applySalvoResults(targetIdx, results, () => {
    if (results.some((r) => r.res.gameOver)) {
      finishGame(me());
      return;
    }
    endMyTurn(); // the salvo always ends the turn
  });
}

function applySalvoResults(targetIdx, results, done) {
  const slot = slotFor(targetIdx);
  const step = FAST ? 70 : 520;
  results.forEach((r, i) => {
    SCENE.starComet(slot, r.x, r.y, i * step);
    setTimeout(() => {
      SND.plop();
      SCENE.applyShot(slot, r.x, r.y, r.res.result === E.MISS ? "miss" : "hit");
      if (r.res.result === E.SUNK && r.res.ship) {
        SND.fanfare();
        SCENE.revealShip(slot, r.res.ship);
        SCENE.revealWater(slot, r.res.revealed || []);
        renderChips(other(S.viewer));
      }
    }, i * step + (FAST ? 30 : 420));
  });
  const hits = results.filter((r) => r.res.result !== E.MISS).length;
  status(`⭐ Sternschnuppen-Salve: ${hits} Treffer!`);
  setTimeout(done, results.length * step + (FAST ? 120 : 900));
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
  $("#btn-opts").hidden = true;
  $("#btn-place-done").hidden = true;

  // make sure both dioramas exist (enemy diorama may not yet)
  if (S.mode === "online" || S.mode === "ai") {
    SCENE.setupBoard("enemy", S.worlds[1]);
  }
  SCENE.setCustomization("mine", customFor(0));
  SCENE.setCustomization("enemy", customFor(1));

  // Zauber-Kräfte: one visible treasure per board (spells cast on dig);
  // the on-demand card hand only with the extra option enabled
  if (flag("powers") && S.powersOn && S.gameMode === "classic") {
    const cards = S.cardsOn;
    S.powers = [
      PW.newPowerState(S.worlds[0], { cards }),
      PW.newPowerState(S.worlds[1], { cards }),
    ];
    for (const b of S.boards) if (b) ensureTreasures(b);
    SCENE.renderTreasures("mine", S.boards[0]?.treasures ?? []);
    SCENE.renderTreasures(
      "enemy",
      S.mode === "online" ? S.oppTreasures ?? [] : S.boards[1]?.treasures ?? []
    );
    if (cards) showPowerGain(PW.worldPower(S.worlds[S.viewer]), "🌍 Deine Welt-Karte");
  } else {
    S.powers = [null, null];
    SCENE.renderTreasures("mine", []);
    SCENE.renderTreasures("enemy", []);
  }
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
    beginTurnStatus();
    // card recharge: only with the card option, every RECHARGE_EVERY turns
    if (powersEnabled()) {
      const st = myPowers();
      if (st) {
        st.turns += 1;
        st.doubleShot = false;
        if (cardsEnabled() && st.turns % PW.RECHARGE_EVERY === 0) {
          gainPower(S.turn, PW.drawPower(Math.random, st.hand), "⚡ Neue Karte");
        }
      }
    }
    S.pendingPower = null;
    renderPowers();
  } else {
    renderPowers();
    SND.startAmbient(S.worlds[S.viewer]);
    SCENE.clearInteraction();
    SCENE.focusBoard(slotFor(S.viewer));
    status(S.mode === "ai" ? "Robo sucht gerade …" : "Dein Mitspieler sucht gerade …");
  }
}

function handleTap(x, y) {
  if (S.phase !== "battle" || S.inputLocked || S.turn !== S.viewer) return;
  // an armed power intercepts the tap as its target
  if (S.pendingPower) {
    const kind = S.pendingPower;
    S.pendingPower = null;
    executePower(kind, { x, y });
    return;
  }
  if (S.mode === "online") {
    onlineShoot(x, y);
    return;
  }
  const targetIdx = other(S.turn);
  const board = S.boards[targetIdx];
  if (board.shots[E.key(x, y)]) {
    SND.tap();
    return;
  }
  S.lastShot[S.turn] = { x, y };

  // the defender's lily-pad shield eats the shot — cell stays secret
  const defSt = powersEnabled() ? S.powers[targetIdx] : null;
  if (defSt?.shield) {
    defSt.shield = false;
    SCENE.shieldFlash(slotFor(targetIdx));
    SND.whoosh();
    status("🪷 Abgeprallt! Ein Seerosen-Schild hat den Schuss verschluckt.");
    S.inputLocked = true;
    setTimeout(() => {
      S.inputLocked = false;
      endMyTurn();
    }, FAST ? 60 : 1100);
    renderPowers();
    return;
  }

  const res = E.fire(board, x, y);
  if (res.result === E.REPEAT) {
    SND.tap();
    return;
  }
  // lock immediately — rapid double-taps must never fire twice while
  // the result of the first shot is still playing out
  S.inputLocked = true;

  // dug up the treasure: it casts its power on the spot, then the turn passes
  if (res.result === E.MISS && powersEnabled() && PW.treasureAt(board, x, y)) {
    board.treasures = board.treasures.filter((t) => !(t.x === x && t.y === y));
    SCENE.applyShotQuiet(slotFor(targetIdx), x, y, "miss");
    SCENE.openTreasure(slotFor(targetIdx), x, y);
    SND.treasure();
    const kind = PW.drawPower(Math.random, [], { instant: true });
    S.treasureFollowup = () => afterMyShot({ result: E.MISS, gameOver: false });
    setTimeout(
      () => powerFlyOut(kind, slotFor(targetIdx), x, y, () => autoUsePower(kind)),
      FAST ? 40 : 700
    );
    status("💎 Der Schatz entfesselt einen Zauber!");
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
  const shooterClover = powersEnabled() && !!S.powers[other(idx)]?.clover;
  const sonarDist =
    (S.rules.sonar || shooterClover) && res.result === E.MISS
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
    SND.missWorld(S.worlds[idx]);
    status(
      viewerIsShooter
        ? sonarDist != null
          ? `${world.words.miss} Sonar piept: ${sonarDist} Felder entfernt!`
          : world.words.miss
        : `Puh! ${opp} hat nichts gefunden.`
    );
  } else if (res.result === E.HIT) {
    if (viewerIsShooter) SND.hitEnemy(S.worlds[idx]);
    else SND.hitOwn();
    status(viewerIsShooter ? `${world.words.hit} Nochmal!` : `Oh nein! ${opp} hat was entdeckt …`);
  } else if (res.result === E.SUNK) {
    if (viewerIsShooter) SND.sunkEnemy(S.worlds[idx]);
    else SND.sunkOwn();
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
  if (res.result === E.HIT || res.result === E.SUNK) {
    S.inputLocked = false; // same player continues
    return;
  }
  if (res.result === E.DECOY) S.extraTurn = other(S.turn); // balloon owner earns a bonus

  // a miss normally ends the turn — unless a power says otherwise
  if (res.result === E.MISS) {
    const st = powersEnabled() ? myPowers() : null;
    if (st?.doubleShot) {
      st.doubleShot = false;
      S.inputLocked = false;
      toast("🎯 Doppelschuss! Das zählt nicht — gleich nochmal!");
      renderPowers();
      return;
    }
    if (S.extraTurn === S.turn) {
      S.extraTurn = null;
      S.inputLocked = false;
      toast("⏳ Extra-Zug! Such gleich nochmal!");
      return;
    }
  }
  endMyTurn();
}

// hand the turn over (hotseat: via the pass button; solo: to robo)
function endMyTurn() {
  if (S.mode === "hotseat") {
    S.inputLocked = true;
    SCENE.clearInteraction();
    renderPowers();
    $("#btn-endturn").hidden = false;
  } else {
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
    const schlau = S.aiState.difficulty === "schlau";
    const st1 = powersEnabled() ? S.powers[1] : null;

    // the clever robo actually casts its spells (card mode only)
    if (schlau && st1 && cardsEnabled()) {
      const shieldIdx = st1.hand.indexOf("schild");
      const zeitIdx = st1.hand.indexOf("zeit");
      const doppelIdx = st1.hand.indexOf("doppel");
      if (shieldIdx >= 0 && !st1.shield && S.boards[1].ships.some((s) => s.hits.length > 0 && !E.isSunk(s))) {
        st1.hand.splice(shieldIdx, 1);
        st1.shield = true;
        SCENE.shieldFlash("enemy");
        SND.powerCast("defense");
        toast("🤖 Robo wirkt einen Schutz-Zauber!");
      } else if (zeitIdx >= 0 && S.extraTurn === null && Math.random() < 0.6) {
        st1.hand.splice(zeitIdx, 1);
        S.extraTurn = 1;
        SCENE.clockRipple("mine");
        SND.powerCast("defense");
        toast("🤖 Robo wirkt einen Zeitzauber!");
      } else if (doppelIdx >= 0 && !st1.doubleShot && Math.random() < 0.6) {
        st1.hand.splice(doppelIdx, 1);
        st1.doubleShot = true;
        SND.powerCast("attack");
        toast("🤖 Robo zielt doppelt!");
      }
    }

    // the clever robo also goes for your visible treasure chest
    let shot = null;
    if (schlau && myBoard.treasures?.length && (st1?.hand.length ?? 0) < PW.HAND_MAX && Math.random() < 0.35) {
      shot = { ...myBoard.treasures[0] };
    }
    if (!shot) shot = nextShot(S.aiState, myBoard);
    if (!shot) return;

    // my lily-pad shield bounces robo's shot — cell stays secret
    if (powersEnabled() && S.powers[0]?.shield) {
      S.powers[0].shield = false;
      SCENE.shieldFlash("mine");
      SND.whoosh();
      status("🪷 Robo ist am Seerosen-Schild abgeprallt!");
      setTimeout(() => {
        S.turn = 0;
        S.inputLocked = false;
        beginTurn();
      }, FAST ? 60 : 1100);
      return;
    }

    const res = E.fire(myBoard, shot.x, shot.y);

    // robo digs up my treasure: gone — and a clever robo pockets a spell
    if (res.result === E.MISS && powersEnabled() && PW.treasureAt(myBoard, shot.x, shot.y)) {
      myBoard.treasures = myBoard.treasures.filter((t) => !(t.x === shot.x && t.y === shot.y));
      SCENE.applyShotQuiet("mine", shot.x, shot.y, "miss");
      SCENE.openTreasure("mine", shot.x, shot.y);
      SND.treasure();
      if (schlau && st1 && cardsEnabled() && st1.hand.length < PW.HAND_MAX) {
        st1.hand.push(PW.drawPower(Math.random, st1.hand, { instant: true }));
        status("💎 Robo hat deinen Schatz geborgen und eine Karte eingesteckt!");
      } else {
        status("💎 Oh nein, Robo hat deinen Schatz stibitzt!");
      }
      setTimeout(() => {
        S.turn = 0;
        S.inputLocked = false;
        beginTurn();
      }, FAST ? 80 : 1800);
      return;
    }
    noteResult(S.aiState, shot.x, shot.y, res.result, res.ship ? E.shipCells(res.ship) : null);
    showShotResult(0, shot.x, shot.y, res, () => {
      if (S.phase !== "battle") return;
      if (res.gameOver) {
        finishGame(1);
        return;
      }
      if (res.result === E.DECOY) S.extraTurn = 0; // robo popped my balloon
      if (res.result === E.MISS && powersEnabled() && S.powers[1]?.doubleShot) {
        S.powers[1].doubleShot = false;
        status("🤖 Robo zielt gleich nochmal …");
        scheduleRoboTurn();
        return;
      }
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

// ---------------------------------------------------------------- friends
// After one QR/code handshake both devices remember each other and can
// reconnect directly: every device listens on its stable id whenever
// the online screen is open.

function loadFriends() {
  try {
    const o = JSON.parse(localStorage.getItem("ff-friends") || "{}");
    return o && typeof o === "object" ? o : {};
  } catch {
    return {};
  }
}

function saveFriend(pid, worldId) {
  if (!pid || typeof pid !== "string" || pid === PID || pid.length > 24) return;
  try {
    const f = loadFriends();
    f[pid] = { world: WORLDS[worldId] ? worldId : "ozean", ts: Date.now() };
    localStorage.setItem("ff-friends", JSON.stringify(f));
  } catch {
    /* private mode etc. */
  }
}

function forgetFriend(pid) {
  try {
    const f = loadFriends();
    delete f[pid];
    localStorage.setItem("ff-friends", JSON.stringify(f));
  } catch {
    /* ignore */
  }
  renderFriends();
}

function timeAgo(ts) {
  const m = Math.max(1, Math.round((Date.now() - ts) / 60000));
  if (m < 60) return `vor ${m} Min.`;
  const h = Math.round(m / 60);
  if (h < 24) return `vor ${h} Std.`;
  const d = Math.round(h / 24);
  return d === 1 ? "gestern" : `vor ${d} Tagen`;
}

function renderFriends() {
  const box = $("#friends-box");
  const list = $("#friends-list");
  if (!box) return;
  const friends = Object.entries(loadFriends()).sort((a, b) => b[1].ts - a[1].ts);
  box.hidden = friends.length === 0;
  list.innerHTML = "";
  for (const [pid, f] of friends) {
    const row = document.createElement("div");
    row.className = "friend-row";
    const btn = document.createElement("button");
    btn.className = "friend-btn";
    btn.textContent = `🤝 Mitspieler aus ${getWorld(f.world).name} · ${timeAgo(f.ts)}`;
    btn.addEventListener("click", () => joinFriend(pid));
    const x = document.createElement("button");
    x.className = "friend-forget";
    x.textContent = "✕";
    x.setAttribute("aria-label", "Freund vergessen");
    x.addEventListener("click", (e) => {
      e.stopPropagation();
      SND.tap();
      forgetFriend(pid);
    });
    row.appendChild(btn);
    row.appendChild(x);
    list.appendChild(row);
  }
}

function startFriendListener() {
  if (S.friendNet) return;
  const net = new Net();
  S.friendNet = net;
  net.onMessage = (m) => handleNetMessage(m);
  net.onClose = () => {};
  net.onStatus = (st) => {
    if (st !== "connected" || S.friendNet !== net) return;
    if (S.net?.conn) {
      // already talking to someone — turn the second knock away
      net.destroy();
      if (S.friendNet === net) S.friendNet = null;
      return;
    }
    if (S.net) S.net.destroy();
    S.friendNet = null;
    S.net = net;
    S.isHost = true;
    wireNet();
    toast("🤝 Ein bekannter Freund ist beigetreten!", 2600);
    // the friend's `hi` pings drive the usual handshake from here
  };
  net.host(PID).catch(() => {
    if (S.friendNet === net) S.friendNet = null; // e.g. second tab holds the id
  });
}

function stopFriendListener() {
  if (S.friendNet) {
    S.friendNet.destroy();
    S.friendNet = null;
  }
}

function joinFriend(pid) {
  SND.tap();
  // fresh world choice for every match, then knock on the friend's door
  showWorldPick({
    title: "Wähl deine Welt!",
    selected: S.worlds[0],
    onDone: (worldId) => {
      S.worlds[0] = worldId;
      applyUiWorld(worldId);
      show("screen-online");
      toast("Klopfe beim Freund an …", 2400);
      S.isHost = false;
      if (S.net) S.net.destroy();
      S.net = new Net();
      wireNet();
      S.net
        .join(pid)
        .then(() => {
          const ping = setInterval(() => {
            if (S.phase !== "title" || !S.net) {
              clearInterval(ping);
              return;
            }
            S.net.send({ t: "hi", world: S.worlds[0], pid: PID });
          }, 1500);
          S.net.send({ t: "hi", world: S.worlds[0], pid: PID });
        })
        .catch(() => {
          toast("Dein Freund ist gerade nicht da. Zeigt euch sonst den QR-Code!", 3400);
          if (S.net) {
            S.net.destroy();
            S.net = null;
          }
        });
    },
  });
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
      // keep announcing until the host answers — the host may still be
      // picking their world, so never give up while the line is open
      const ping = setInterval(() => {
        if (S.phase !== "title" || !S.net) {
          clearInterval(ping);
          return;
        }
        S.net.send({ t: "hi", world: S.worlds[0], pid: PID });
      }, 1500);
      S.net.send({ t: "hi", world: S.worlds[0], pid: PID });
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
  stopFriendListener();
  saveFriend(S.oppPid, S.worlds[1]);
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
  S.lastShot[0] = { x, y };
  S.inputLocked = true;
  const clover = powersEnabled() && !!S.powers[0]?.clover;
  if (!S.net.send({ t: "shot", x, y, clover })) {
    S.inputLocked = false;
  }
}

function handleNetMessage(msg) {
  switch (msg.t) {
    case "hi": {
      // guest announces itself (+ its world & friend id)
      if (msg.world && WORLDS[msg.world]) S.worlds[1] = msg.world;
      if (msg.pid) S.oppPid = msg.pid;
      if (!S.isHost) break;
      if (S.gameMode !== "chase" && S.gameMode !== "boss" && S.phase === "place") {
        // a lost hello: re-ack so the guest stops pinging
        sendHello();
        break;
      }
      if (!["title", "over", "chase", "boss"].includes(S.phase) || S.pickingWorld) break;
      if (S.gameMode === "chase") {
        sendHello();
        beginChaseOnlineHider();
        break;
      }
      if (S.gameMode === "boss") {
        sendHello();
        beginBossOnlineMonster();
        break;
      }
      // classic: the host picks their world fresh for every match
      S.pickingWorld = true;
      showWorldPick({
        title: "Mitspieler ist da — wähl deine Welt!",
        selected: S.worlds[0],
        onDone: (worldId) => {
          S.pickingWorld = false;
          S.worlds[0] = worldId;
          applyUiWorld(worldId);
          sendHello();
          beginOnlinePlacement();
        },
      });
      break;
    }
    case "world": {
      // the opponent re-picked their world (each match, fresh choice)
      if (msg.world && WORLDS[msg.world]) S.worlds[1] = msg.world;
      break;
    }
    case "hello": {
      if (!["title", "over", "chase", "boss"].includes(S.phase)) break;
      S.worlds[1] = WORLDS[msg.world] ? msg.world : "ozean";
      if (msg.pid) S.oppPid = msg.pid;
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
      // the host decides the extra rules + powers for both players
      S.rules = {
        decoy: !!msg.rules?.decoy,
        sonar: !!msg.rules?.sonar,
        ghost: !!msg.rules?.ghost,
      };
      S.powersOn = flag("powers") && msg.powers !== false;
      S.cardsOn = flag("powers") && !!msg.cards;
      syncRuleChips();
      const parts = [
        rulesSummary(S.rules),
        S.powersOn ? "💎 Schatz-Zauber" : "",
        S.cardsOn ? "🃏 Zauber-Karten" : "",
      ].filter(Boolean);
      if (parts.length) toast(`Gemeinsame Optionen: ${parts.join(" · ")}`, 3200);
      if (S.phase === "over") {
        // rematch: the guest also picks a fresh world every match
        showWorldPick({
          title: "Neue Runde — wähl deine Welt!",
          selected: S.worlds[0],
          onDone: (worldId) => {
            S.worlds[0] = worldId;
            applyUiWorld(worldId);
            S.net.send({ t: "world", world: worldId });
            beginOnlinePlacement();
          },
        });
        break;
      }
      beginOnlinePlacement();
      break;
    }
    case "ready": {
      S.oppReady = true;
      S.oppCustom = sanitizeCustomMap(msg.custom);
      S.oppTreasures = Array.isArray(msg.treasures)
        ? msg.treasures
            .filter((t) => Number.isInteger(t?.x) && Number.isInteger(t?.y))
            .slice(0, 3)
        : [];
      maybeStartOnline();
      break;
    }
    case "start": {
      startBattle(msg.youStart ? 0 : 1);
      toast(msg.youStart ? "Du fängst an!" : "Dein Mitspieler fängt an!");
      break;
    }
    case "shot": {
      // my lily-pad shield: the shot bounces, the cell stays secret
      if (powersEnabled() && S.powers[0]?.shield && !S.boards[0].shots[E.key(msg.x, msg.y)]) {
        S.powers[0].shield = false;
        S.net.send({ t: "result", x: msg.x, y: msg.y, result: "shield" });
        SCENE.shieldFlash("mine");
        SND.whoosh();
        status("🪷 Abgeprallt! Dein Seerosen-Schild hat den Schuss verschluckt.");
        renderPowers();
        setTimeout(() => {
          if (S.phase !== "battle") return;
          S.turn = 0;
          S.inputLocked = false;
          beginTurn();
          toast("Du bist dran!");
        }, FAST ? 60 : 1100);
        break;
      }

      const res = E.fire(S.boards[0], msg.x, msg.y);

      // they dug up my treasure — everyone sees it; I wait for their spell
      if (res.result === E.MISS && powersEnabled() && PW.treasureAt(S.boards[0], msg.x, msg.y)) {
        S.boards[0].treasures = S.boards[0].treasures.filter(
          (t) => !(t.x === msg.x && t.y === msg.y)
        );
        S.net.send({ t: "result", x: msg.x, y: msg.y, result: E.MISS, treasure: true });
        SCENE.applyShotQuiet("mine", msg.x, msg.y, "miss");
        SCENE.openTreasure("mine", msg.x, msg.y);
        SND.treasure();
        status("💎 Dein Mitspieler hat deinen Schatz geborgen — sein Zauber wirkt …");
        break;
      }

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
          (S.rules.sonar || msg.clover) && res.result === E.MISS
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
      if (msg.result === "shield") {
        // bounced off — no mark, the cell stays shootable later
        SCENE.shieldFlash("enemy");
        SND.whoosh();
        status("🪷 Abgeprallt! Ein Seerosen-Schild hat deinen Schuss verschluckt.");
        S.turn = 1;
        setTimeout(() => {
          if (S.phase === "battle") beginTurn();
        }, FAST ? 60 : 1100);
        break;
      }
      if (msg.treasure) {
        S.shadow.marks[E.key(msg.x, msg.y)] = E.MISS;
        SCENE.applyShotQuiet("enemy", msg.x, msg.y, "miss");
        SCENE.openTreasure("enemy", msg.x, msg.y);
        SND.treasure();
        const kind = PW.drawPower(Math.random, [], { instant: true });
        S.treasureFollowup = () => {
          S.net.send({ t: "pw-done" });
          if (S.phase !== "battle") return;
          S.turn = 1;
          beginTurn();
        };
        setTimeout(
          () => powerFlyOut(kind, "enemy", msg.x, msg.y, () => autoUsePower(kind)),
          FAST ? 40 : 700
        );
        status("💎 Der Schatz entfesselt einen Zauber!");
        break;
      }
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
          const st = powersEnabled() ? S.powers[0] : null;
          if (st?.doubleShot) {
            st.doubleShot = false;
            S.inputLocked = false;
            toast("🎯 Doppelschuss! Das zählt nicht — gleich nochmal!");
            renderPowers();
            return;
          }
          if (S.extraTurn === 0) {
            S.extraTurn = null;
            S.inputLocked = false;
            toast("⏳ Extra-Zug! Such gleich nochmal!");
            return;
          }
          S.turn = 1;
          beginTurn();
        }
      });
      break;
    }
    case "pw": {
      if (S.phase !== "battle") break;
      const b = S.boards[0];
      if (msg.kind === "welle") {
        S.net.send({ t: "pwr", kind: "welle", cells: PW.scanCells(b, PW.rowCells(b, msg.y)) });
        toast("🌊 Eine große Welle rollt über dein Brett …");
      } else if (msg.kind === "radar") {
        S.net.send({ t: "pwr", kind: "radar", cells: PW.scanCells(b, PW.squareCells(b, msg.x, msg.y)) });
        toast("🛰️ Ein Satellit funkt über deinem Brett …");
      } else if (msg.kind === "fernglas") {
        S.net.send({ t: "pwr", kind: "fernglas", cells: PW.scanCells(b, [{ x: msg.x, y: msg.y }]) });
      } else if (msg.kind === "trommel" || msg.kind === "kompass") {
        S.net.send({ t: "pwr", kind: msg.kind, dir: PW.directionToNearest(b, msg.x, msg.y) });
      } else if (msg.kind === "glocke") {
        S.net.send({ t: "pwr", kind: "glocke", big: PW.biggestHiddenDir(b) });
      } else if (msg.kind === "zeit") {
        S.extraTurn = 1;
        toast("⏳ Dein Mitspieler hat einen Zeitzauber gewirkt!");
      } else if (msg.kind === "wirbel") {
        toast("🌪️ Drüben hat jemand heimlich das Versteck gewechselt …");
      } else if (msg.kind === "ballon") {
        toast("🎈 Drüben wurde ein neuer Schwindel-Ballon versteckt …");
      } else if (msg.kind === "salve") {
        const cells = PW.salvoCells(b, msg.x, msg.y);
        const results = [];
        for (const c of cells) {
          const res = E.fire(b, c.x, c.y);
          if (res.result === E.REPEAT) continue;
          results.push({
            x: c.x,
            y: c.y,
            result: res.result,
            ship:
              res.result === E.SUNK
                ? { id: res.ship.id, size: res.ship.size, x: res.ship.x, y: res.ship.y, dir: res.ship.dir }
                : null,
            revealed: res.revealed,
            gameOver: res.gameOver,
          });
        }
        const over = results.some((r) => r.gameOver);
        S.net.send({ t: "pwr", kind: "salve", results, gameOver: over });
        applySalvoResults(
          0,
          results.map((r) => ({ x: r.x, y: r.y, res: r })),
          () => {
            if (over) {
              finishGame(1);
              return;
            }
            S.turn = 0;
            S.inputLocked = false;
            beginTurn();
            toast("Du bist dran!");
          }
        );
      }
      break;
    }
    case "pw-done": {
      // the treasure spell over there has finished — my turn now
      if (S.phase !== "battle") break;
      S.turn = 0;
      S.inputLocked = false;
      beginTurn();
      toast("Du bist dran!");
      break;
    }
    case "pwr": {
      if (msg.kind === "salve") {
        for (const r of msg.results) {
          S.shadow.marks[E.key(r.x, r.y)] = r.result === E.MISS ? E.MISS : E.HIT;
          if (r.result === E.SUNK && r.ship) {
            S.shadow.found.push(r.ship);
            for (const c of r.revealed || []) S.shadow.marks[E.key(c.x, c.y)] = E.MISS;
          }
        }
        applySalvoResults(
          1,
          msg.results.map((r) => ({ x: r.x, y: r.y, res: r })),
          () => {
            if (msg.gameOver) {
              finishGame(0);
              return;
            }
            S.turn = 1;
            S.inputLocked = false;
            beginTurn();
          }
        );
        break;
      }
      const apply = S.pendingInfo;
      S.pendingInfo = null;
      if (!apply) break;
      if (msg.kind === "trommel" || msg.kind === "kompass") apply({ dir: msg.dir });
      else if (msg.kind === "glocke") apply({ big: msg.big });
      else apply({ cells: msg.cells || [] });
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

function sendHello() {
  S.net.send({
    t: "hello",
    v: 2,
    world: S.worlds[0],
    rules: S.rules,
    mode: S.gameMode,
    powers: flag("powers") && S.powersOn,
    cards: flag("powers") && S.powersOn && S.cardsOn,
    pid: PID,
  });
}

function maybeRematch() {
  if (!(S.rematchMine && S.rematchTheirs)) return;
  if (!S.isHost) return;
  if (S.gameMode === "chase") {
    sendHello();
    beginChaseOnlineHider();
    return;
  }
  if (S.gameMode === "boss") {
    sendHello();
    beginBossOnlineMonster();
    return;
  }
  // classic rematch: the host re-picks their world first
  if (S.pickingWorld) return;
  S.pickingWorld = true;
  showWorldPick({
    title: "Neue Runde — wähl deine Welt!",
    selected: S.worlds[0],
    onDone: (worldId) => {
      S.pickingWorld = false;
      S.worlds[0] = worldId;
      applyUiWorld(worldId);
      sendHello();
      beginOnlinePlacement();
    },
  });
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

// hot-and-cold flavor for the chase — hearts race when you're close
function chaseWarmth(dist) {
  if (dist <= 1) return "🔥 GANZ NAH!";
  if (dist === 2) return "Heiß!";
  if (dist === 3) return "Warm …";
  return "Brrr, kalt.";
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
  $("#btn-opts").hidden = true;
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
  S.journey = null;
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
  SND.heartbeat(res.dist);
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
    chaseStatus(chaseWarmth(res.dist));
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
  journeyAdvance(iWon);
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
  stopFriendListener();
  saveFriend(S.oppPid, S.worlds[1]);
  S.mode = "chase";
  S.phase = "chase";
  S.chase = { kind: "online", st: CHASE.createChase(), role: "hider", marks: {} };
  CHASE.placeFrido(S.chase.st, 3, 4);
  setupChaseBoard();
  beginChaseHiding();
  $("#btn-place-done").textContent = "Versteckt!";
}

function beginChaseOnlineSeeker() {
  stopFriendListener();
  saveFriend(S.oppPid, S.worlds[1]);
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
      SND.heartbeat(msg.dist);
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
      status(`${chaseWarmth(msg.dist)} Er huscht weiter … 🔦 ${msg.shotsLeft} Schüsse übrig`);
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
  $("#btn-opts").hidden = true;
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
  S.journey = null;
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
    if (BOSS.bossLimps(st)) {
      status(`${bossName()} humpelt und bleibt stehen! Jetzt hast du es!`);
    } else {
      BOSS.roboBossMove(st, { x, y });
      SND.whoosh();
      if (BOSS.bossRoars(st)) bossRoar();
    }
  } else {
    if (BOSS.bossLimps(st)) {
      toast(`${bossName()} humpelt und bleibt stehen! 🩹`);
      S.inputLocked = false;
      bossHunterStatus(st.wounds.length, st.shotsLeft, "Es kann nicht fliehen —");
      return;
    }
    S.inputLocked = true;
    setTimeout(() => openMoveOverlay("boss"), FAST ? 50 : 900);
  }
}

// ROAAAR! screen shake + growl — pure drama, the monster is furious
function bossRoar() {
  SND.growl();
  SCENE.kick(0.8);
  if (navigator.vibrate) navigator.vibrate([80, 40, 120]);
  toast(`👣 ROAAAR! ${bossName()} ist wütend!`, 1800);
}

function bossMoveTap(dx, dy) {
  const st = S.boss.st;
  if (BOSS.moveBoss(st, dx, dy)) {
    SND.whoosh();
    $("#chase-move").hidden = true;
    const roar = BOSS.bossRoars(st);
    if (roar) bossRoar();
    if (S.boss.kind === "online") {
      SCENE.moveCreature("mine", bossShipOf(st));
      S.net.send({ t: "b-moved", roar });
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
  journeyAdvance(iWon);
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
  stopFriendListener();
  saveFriend(S.oppPid, S.worlds[1]);
  S.mode = "boss";
  S.phase = "boss";
  S.boss = { kind: "online", st: BOSS.createBoss(), role: "monster", marks: {} };
  setupBossBoard();
  beginBossPlacing();
}

function beginBossOnlineHunter() {
  stopFriendListener();
  saveFriend(S.oppPid, S.worlds[1]);
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
      if (BOSS.bossLimps(st)) {
        toast(`${bossName()} humpelt und bleibt stehen! 🩹`);
        S.net.send({ t: "b-moved", limped: true });
        status(`🙈 Autsch! Der Jäger hat noch 🔦 ${st.shotsLeft} Schüsse.`);
        break;
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
      if (msg.roar) bossRoar();
      bossHunterStatus(
        S.boss.wounds,
        S.boss.shotsLeft,
        msg.limped ? "Es humpelt und konnte nicht fliehen!" : "Es ist weitergestapft — jag es!"
      );
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
  S.journey = null;
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
  $("#btn-opts").hidden = true;
  $("#btn-place-done").hidden = true;
  puzzleStatus();
  renderChips(0);
  toast("⭐⭐⭐ gibt es für höchstens 1 Fehlgrabung!", 2600);
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
    // star rating: fewer wrong digs = more stars, 3 stars = extra sticker
    const misses = PUZZLE_SPADES - S.puzzle.spades;
    const stars = misses <= 1 ? 3 : misses <= 3 ? 2 : 1;
    $("#win-title").textContent = `Rätsel gelöst! ${"⭐".repeat(stars)}`;
    $("#win-sub").textContent =
      stars === 3
        ? "PERFEKT geknobelt — dafür gibt es einen Extra-Sticker!"
        : stars === 2
          ? `Stark! Nur ${misses} Fehlgrabungen. Schaffst du es mit höchstens einer?`
          : world.words.win;
    if (flag("stickers") && stars === 3) PROG.awardSticker(S.worlds[0]);
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
  journeyAdvance(won);
  show("screen-win");
}

// -------------------------------------------------------------- game over

function finishGame(winner) {
  S.phase = "over";
  SCENE.clearInteraction();
  renderPowers();
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
  journeyAdvance(iWon);
  show("screen-win");
  if (iWon) {
    SND.bigWin();
    SCENE.confettiRain(slotFor(loserIdx));
  } else {
    SND.sad();
  }
}

// ------------------------------------------------------------ Weltreise

// eight stops across the four worlds — each teaches one game or twist
const JOURNEY = [
  { world: "ozean", type: "classic", rules: {}, emoji: "🌊", label: "Die erste Suche" },
  { world: "ozean", type: "classic", rules: { sonar: true }, emoji: "🐬", label: "Delfin-Sonar" },
  { world: "teich", type: "puzzle", emoji: "🧩", label: "Knobel-Teich" },
  { world: "teich", type: "classic", rules: { decoy: true }, emoji: "🎈", label: "Ballon-Trick" },
  { world: "dino", type: "chase", emoji: "🙈", label: "Fang den Frechdachs" },
  { world: "dino", type: "classic", rules: { ghost: true }, emoji: "👻", label: "Geisterstunde" },
  { world: "weltraum", type: "puzzle", emoji: "✨", label: "Sternen-Rätsel" },
  { world: "weltraum", type: "boss", emoji: "👑", label: "Das König-Monster" },
];

function loadJourney() {
  const n = parseInt(localStorage.getItem("ff-weltreise") || "0", 10);
  return Number.isFinite(n) ? Math.max(0, Math.min(JOURNEY.length, n)) : 0;
}

function saveJourney(n) {
  try {
    localStorage.setItem("ff-weltreise", String(n));
  } catch {
    /* private mode etc. */
  }
}

function openJourney() {
  SND.tap();
  const done = loadJourney();
  const list = $("#journey-stops");
  list.innerHTML = "";
  JOURNEY.forEach((stop, i) => {
    const row = document.createElement("div");
    row.className = `journey-stop${i < done ? " done" : i === done ? " current" : " locked"}`;
    const world = getWorld(stop.world);
    row.innerHTML = `<span class="journey-emoji">${i < done ? "✅" : i === done ? stop.emoji : "🔒"}</span>
      <span class="journey-label">${i + 1}. ${stop.label}</span>
      <span class="journey-world">${world.name}</span>`;
    list.appendChild(row);
  });
  const btn = $("#btn-journey-go");
  if (done >= JOURNEY.length) {
    $("#journey-title").textContent = "🎉 Weltreise geschafft!";
    btn.textContent = "Nochmal von vorn";
  } else {
    $("#journey-title").textContent = "🗺️ Deine Weltreise";
    btn.textContent = `Etappe ${done + 1} spielen!`;
  }
  show("screen-journey");
}

function startJourneyStop(i) {
  if (i >= JOURNEY.length) {
    saveJourney(0);
    openJourney();
    return;
  }
  const stop = JOURNEY[i];
  S.worlds[0] = stop.world;
  applyUiWorld(stop.world);
  if (stop.type === "classic") {
    S.rules = {
      decoy: !!stop.rules.decoy,
      sonar: !!stop.rules.sonar,
      ghost: !!stop.rules.ghost,
    };
    syncRuleChips();
    S.forceRoboLevel = "leicht"; // the journey stays kind
    startMode("ai");
  } else if (stop.type === "puzzle") {
    startPuzzle();
  } else if (stop.type === "chase") {
    startChase("ai");
  } else {
    startBoss("ai");
  }
  // the starters clear any stale journey state — claim it afterwards
  S.journey = { stop: i, nextStop: i };
  toast(`${stop.emoji} Etappe ${i + 1}: ${stop.label}`, 2600);
}

// call from every win path — upgrades the win screen into a stage clear
function journeyAdvance(won) {
  if (!S.journey) return;
  if (!won) {
    $("#btn-rematch").textContent = "Nochmal versuchen!";
    return;
  }
  const next = S.journey.stop + 1;
  S.journey.nextStop = next;
  if (next > loadJourney()) saveJourney(next);
  if (next >= JOURNEY.length) {
    $("#win-sub").textContent = "🎉 Die ganze Weltreise geschafft! Du bist ein Funkel-Held!";
    $("#btn-rematch").textContent = "Zur Weltreise";
  } else {
    $("#win-sub").textContent = `Etappe ${next} von ${JOURNEY.length} geschafft — weiter geht's!`;
    $("#btn-rematch").textContent = "Nächste Etappe!";
  }
}

// ------------------------------------------------------------ aquarium

function refreshAquarium() {
  if (S.mode !== "aquarium" || !S.aquarium) return;
  SCENE.populateAquarium(
    "mine",
    S.aquarium.map((e) => ({ ...e, custom: loadCustom(e.worldId)[e.idx] ?? null }))
  );
}

function openAquarium() {
  SND.unlock();
  SND.whoosh();
  goFullscreen();
  S.mode = "aquarium";
  S.phase = "aquarium";
  S.viewer = 0;
  applyUiWorld(S.worlds[0]);
  // no grid, no mat — just the living world
  SCENE.setupBoard("mine", S.worlds[0], { bare: true });

  const p = PROG.loadProgress();
  const list = [];
  for (const world of Object.values(WORLDS)) {
    world.creatures.forEach((c, i) => {
      if (PROG.stickerCount(world.id, i, p) > 0) {
        list.push({ key: `${world.id}-${i}`, worldId: world.id, idx: i, name: c.name });
      }
    });
  }
  S.aquarium = list;
  S.aquariumIdx = 0;
  refreshAquarium();
  SCENE.focusBoard("mine");
  SCENE.clearInteraction();
  S.aquariumTap = (x, y) => {
    const key = SCENE.nearestAquariumKey("mine", x, y);
    if (key) {
      SND.sparkle();
      SCENE.hopCreature("mine", key);
      const i = list.findIndex((e) => e.key === key);
      if (i >= 0) {
        S.aquariumIdx = i;
        toast(`${list[i].name} freut sich! 💛`, 1400);
        // a tapped friend hops straight into the dressing room
        if (flag("styles") && $("#customizer").hidden) {
          setTimeout(() => {
            if (S.mode === "aquarium") openCustomizer(i);
          }, FAST ? 60 : 500);
        }
      }
      return;
    }
    if (!list.length) return;
    // tap the water: drop a snack, the closest friend swims over
    const px = x - 4 + 0.5;
    const pz = y - 4 + 0.5;
    SND.plop();
    SCENE.dropFood("mine", px, pz);
    const fed = SCENE.lureNearest("mine", px, pz);
    const item = list.find((e) => e.key === fed);
    if (item) status(`🍪 ${item.name} hat den Snack entdeckt!`);
  };
  SCENE.setTapMode("mine", S.aquariumTap);
  SND.startAmbient(S.worlds[0]);
  show(null);
  $("#btn-shuffle").hidden = true;
  $("#btn-opts").hidden = true;
  $("#btn-endturn").hidden = true;
  $("#btn-place-done").hidden = true;
  renderChips(0);
  status(
    list.length
      ? `Dein Aquarium: ${list.length} ${list.length === 1 ? "Freund" : "Freunde"} — antippen oder füttern!`
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
  if (S.journey) {
    if (S.journey.nextStop >= JOURNEY.length) {
      S.journey = null;
      goHome();
      openJourney();
      return;
    }
    startJourneyStop(S.journey.nextStop);
    return;
  }
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
  stopFriendListener();
  S.oppPid = null;
  S.pickingWorld = false;
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
  S.journey = null;
  S.gameMode = "classic";
  S.rules = flag("rules") ? loadRules() : { decoy: false, sonar: false, ghost: false };
  S.powersOn = flag("powers") ? loadPowersOpt() : false;
  S.cardsOn = flag("powers") ? loadCardsOpt() : false;
  syncRuleChips();
  S.customs = [{}, {}];
  S.oppCustom = null;
  $("#chase-move").hidden = true;
  SCENE.resetScene();
  closeStylePanel();
  $("#btn-rematch").disabled = false;
  $("#btn-rematch").textContent = "Nochmal spielen";
  $("#btn-endturn").hidden = true;
  $("#btn-shuffle").hidden = true;
  $("#btn-opts").hidden = true;
  $("#btn-place-done").hidden = true;
  applyUiWorld(S.worlds[0]);
  renderPowers();
  show("screen-title");
}

// ------------------------------------------------------------------ boot

function boot() {
  SCENE.initScene($("#stage"));
  applyUiWorld("ozean");
  S.rules = flag("rules") ? loadRules() : { decoy: false, sonar: false, ghost: false };
  S.powersOn = flag("powers") ? loadPowersOpt() : false;
  S.cardsOn = flag("powers") ? loadCardsOpt() : false;
  syncRuleChips();
  $("#opt-cards").checked = S.cardsOn;
  $("#opt-cards").closest(".opt-row").hidden = !flag("powers");
  $("#opt-cards").addEventListener("change", (e) => {
    SND.unlock();
    SND.tap();
    S.cardsOn = e.target.checked;
    savePowersOpt();
  });
  for (const id of ["#rule-decoy", "#rule-sonar", "#rule-ghost"]) {
    $(id).closest(".opt-row").hidden = !flag("rules");
  }
  $("#opt-powers").checked = S.powersOn;
  $("#opt-powers").closest(".opt-row").hidden = !flag("powers");
  $("#opt-powers").addEventListener("change", (e) => {
    SND.unlock();
    SND.tap();
    S.powersOn = e.target.checked;
    savePowersOpt();
  });
  $("#btn-options").addEventListener("click", () => {
    SND.tap();
    optionsReturn = null;
    $("#options-note").hidden = true;
    $("#opt-world").hidden = true;
    show("screen-options");
  });
  $("#btn-options-back").addEventListener("click", () => {
    SND.tap();
    if (optionsReturn === "game") {
      optionsReturn = null;
      show(null); // back into the running game HUD
      return;
    }
    show("screen-title");
  });
  $("#btn-powers-legend").addEventListener("click", () => {
    SND.tap();
    const box = $("#powers-legend");
    if (!box.hidden) {
      box.hidden = true;
      return;
    }
    box.innerHTML = `<p class="opt-desc legend-intro">So bekommst du Zauber: 💎 Schätze ausgraben (3 pro Brett versteckt), ⚡ alle 4 Züge eine Aufladung, 🌍 und deine Welt schenkt dir eine Start-Kraft. Höchstens 3 auf der Hand!</p>`;
    for (const [kind, p] of Object.entries(PW.POWERS)) {
      const row = document.createElement("div");
      row.className = "legend-row";
      const worldTag = p.world ? ` <span class="legend-world">(${getWorld(p.world).name})</span>` : "";
      row.innerHTML = `<img class="legend-icon" alt="" src="${SCENE.powerIconUrl(kind)}" /><span class="legend-text"><b>${p.name}</b>${worldTag}<br />${p.desc}</span>`;
      box.appendChild(row);
    }
    box.hidden = false;
  });
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
  $("#btn-journey").hidden = !flag("weltreise");
  $("#btn-journey").addEventListener("click", openJourney);
  $("#btn-journey-go").addEventListener("click", () => {
    SND.tap();
    startJourneyStop(loadJourney());
  });
  $("#btn-journey-back").addEventListener("click", () => {
    SND.tap();
    show("screen-title");
  });
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

  try {
    S.roboLevel = localStorage.getItem("ff-robo") === "schlau" ? "schlau" : "leicht";
  } catch {
    S.roboLevel = "leicht";
  }
  document.querySelectorAll("[data-mode]").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (btn.dataset.mode === "ai") {
        SND.unlock();
        SND.tap();
        show("screen-robo");
        return;
      }
      startMode(btn.dataset.mode);
    });
  });
  document.querySelectorAll("[data-robo]").forEach((btn) => {
    btn.addEventListener("click", () => {
      S.roboLevel = btn.dataset.robo === "schlau" ? "schlau" : "leicht";
      try {
        localStorage.setItem("ff-robo", S.roboLevel);
      } catch {
        /* private mode */
      }
      startMode("ai");
    });
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
  let optionsReturn = null;
  $("#btn-opts").addEventListener("click", () => {
    SND.tap();
    optionsReturn = "game";
    $("#options-note").hidden = false;
    // world switching lives inside the menu now — placement only
    $("#opt-world").hidden = S.phase !== "place";
    show("screen-options");
  });
  $("#opt-world").addEventListener("click", () => {
    changeMyWorld();
  });
  $("#btn-cust-done").addEventListener("click", () => {
    SND.tap();
    closeStylePanel();
  });
  $("#cust-prev").addEventListener("click", () => {
    SND.tap();
    cust.i -= 1;
    cust.lockedHat = null;
    renderCustomizer();
  });
  $("#cust-next").addEventListener("click", () => {
    SND.tap();
    cust.i += 1;
    cust.lockedHat = null;
    renderCustomizer();
  });
  $("#cust-hat-prev").addEventListener("click", () => cycleHat(-1));
  $("#cust-hat-next").addEventListener("click", () => cycleHat(1));
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
    power: (kind) => {
      const st = myPowers();
      if (st) {
        st.hand.push(kind);
        renderPowers();
      }
    },
    usePower: (kind, target) => executePower(kind, target),
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
