// Funkel-Flotte — game flow. Rules live in engine.js, presentation in
// scene.js (three.js). Each player plays from their OWN world: your
// board is your world's diorama, the opponent's board is theirs.

import * as E from "./engine.js";
import { createAiState, noteResult, nextShot } from "./ai.js";
import { WORLDS, getWorld, randomOtherWorld, pickableWorldIds } from "./worlds.js";
import { TINTS, ACCESSORIES, ACCESSORY_NAMES } from "./models.js";
import * as PROG from "./progress.js";
import { flag, setFlag, allFlags } from "./flags.js";
import { generatePuzzle, PUZZLE_SPADES, PUZZLE_STAGES, puzzleStage, puzzleStageIndex } from "./puzzle.js";
import { icon } from "./icons.js";
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
  boardPreset: "klassisch", // which board/fleet preset (see BOARD_PRESETS)
  allowTouch: false, // Enge Verstecke: creatures may sit side by side
  moreTreasures: false, // up to three chests per board (persisted)
  forceTreasureKind: null, // story journey: this spell waits in the chest
  treasureKind: null, // the spell the just-dug chest released
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
  if (screenId === "screen-title") {
    renderTitleFriends();
    renderJourneyHero();
    startFriendListener();
  }
  maybeShowUpdate();
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
  for (const world of pickableWorldIds(flag("welten")).map((id) => WORLDS[id])) {
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

// ------------------------------------------------------------- UI icons
// Swap emoji placeholders for real icons: 3D thumbs of the game's own
// models where one exists, crafted SVGs for abstract concepts.

function decorateIcons() {
  $("#btn-options").innerHTML = `${icon("gear", 20)} Spiel-Optionen`;
  $("#btn-opts").innerHTML = `${icon("gear", 18)} Menü`;
  $("#btn-album").innerHTML = `${icon("book", 20)} Sticker-Album`;
  $("#btn-aquarium").innerHTML = `<img class="ui-thumb" alt="" src="${SCENE.creatureThumb("ozean", 4, 1.4, 64)}" /> Funkel-Park`;
  const xthumb = (id, src) => {
    const span = $(id)?.querySelector(".xemoji");
    if (span) span.outerHTML = `<img class="xthumb" alt="" src="${src}" />`;
  };
  xthumb("#btn-puzzle", SCENE.modelThumbUrl("fernglas", 96));
  xthumb("#btn-chase", SCENE.creatureThumb("dino", 4, 1, 96));
  xthumb("#btn-boss", SCENE.creatureThumb("weltraum", 0, 3.2, 96));
  document.querySelector('[data-robo="leicht"]').innerHTML =
    `${icon("robot", 26)} Robo Sanft<br /><small>sucht gemütlich, ganz ohne Zauber</small>`;
  document.querySelector('[data-robo="schlau"]').innerHTML =
    `${icon("robotSmart", 26)} Robo Schlau<br /><small>jagt clever, zaubert und klaut Schätze!</small>`;
  document.querySelector(".resume-emoji").innerHTML = icon("play", 26);
  document.querySelector(".invite-emoji").innerHTML = icon("bell", 28);
  // options: sections + rows
  const sect = (id, html) => {
    const s = document.querySelector(`${id} summary`);
    if (s) s.innerHTML = `<span class="sect-label">${html}</span>`;
  };
  sect("#sect-board", `${icon("board", 22)} Brett &amp; Flotte`);
  sect("#sect-zauber", `<img class="ui-thumb" alt="" src="${SCENE.modelThumbUrl("chest:ozean", 64)}" /> Zauber`);
  sect("#sect-rules", `${icon("dice", 22)} Extra-Regeln`);
  const row = (inputId, html) => {
    const name = $(inputId)?.closest(".opt-row")?.querySelector(".opt-name");
    if (name) name.innerHTML = `${html} ${name.textContent.trim()}`;
  };
  row("#opt-powers", `<img class="ui-thumb" alt="" src="${SCENE.modelThumbUrl("chest:ozean", 64)}" />`);
  row("#opt-treasures", `<img class="ui-thumb" alt="" src="${SCENE.modelThumbUrl("chest:dino", 64)}" />`);
  row("#opt-cards", `<img class="ui-thumb" alt="" src="${SCENE.powerIconUrl("salve", 64)}" />`);
  row("#rule-decoy", `<img class="ui-thumb" alt="" src="${SCENE.modelThumbUrl("decoy", 64)}" />`);
  row("#rule-sonar", icon("sonar", 20));
  row("#rule-ghost", icon("ghost", 20));
  row("#rule-touch", icon("snuggle", 20));
}

// the Weltreise hero card: progress bar + the next stop's chest
function renderJourneyHero() {
  const btn = $("#btn-journey");
  if (!btn || btn.hidden) return;
  const done = Math.min(loadJourney(), JOURNEY.length);
  const stop = JOURNEY[Math.min(done, JOURNEY.length - 1)];
  $("#jh-chest").src = SCENE.modelThumbUrl(`chest:${stop.world}`, 96);
  $("#jh-sub").textContent =
    done >= JOURNEY.length
      ? "Alle Etappen geschafft — nochmal von vorn?"
      : `Etappe ${done + 1} von ${JOURNEY.length}: ${stop.label}`;
  $("#jh-fill").style.width = `${Math.round((Math.min(done, JOURNEY.length) / JOURNEY.length) * 100)}%`;
}

function foundIdsOn(index) {
  if (S.mode === "online" && index === 1) {
    return new Set(S.shadow.found.map((s) => s.id));
  }
  return new Set(S.boards[index].ships.filter(E.isSunk).map((s) => s.id));
}

// --------------------------------------------------------------- helpers

// ------------------------------------------------------- board & fleet
// Preset boards: size + which creatures live there. "2x2" is a chunky
// square friend, 1 is a tiny single-cell friend.

const BOARD_PRESETS = {
  klassisch: { grid: 8, fleet: [4, 3, 3, 2, 2], name: "Klassisch", desc: "8×8 Felder, fünf Freunde — so wie immer." },
  flink: { grid: 6, fleet: [3, 2, 2, 1], name: "Flink", desc: "Kleines 6×6-Brett mit vier Freunden — perfekt für eine schnelle Runde." },
  riesig: { grid: 10, fleet: [5, 4, 3, 3, 2, 2, 1], name: "Riesig", desc: "Großes 10×10-Meer mit sieben Freunden — die lange Expedition." },
  grossklein: { grid: 8, fleet: ["2x2", 3, 3, 2, 1], name: "Groß & Klein", desc: "Ein extragroßer 2×2-Freund und ein Winzling mischen die Flotte auf (8×8)." },
};

function boardPreset() {
  return BOARD_PRESETS[S.boardPreset] ?? BOARD_PRESETS.klassisch;
}

function loadBoardOpt() {
  if (!flag("variety")) return { preset: "klassisch", touch: false };
  try {
    const o = JSON.parse(localStorage.getItem("ff-board") || "{}");
    return {
      preset: BOARD_PRESETS[o.preset] ? o.preset : "klassisch",
      touch: !!o.touch,
    };
  } catch {
    return { preset: "klassisch", touch: false };
  }
}

function saveBoardOpt() {
  try {
    localStorage.setItem("ff-board", JSON.stringify({ preset: S.boardPreset, touch: S.allowTouch }));
  } catch {
    /* private mode etc. */
  }
}

function renderBoardPresets() {
  const box = $("#board-presets");
  if (!box) return;
  box.innerHTML = "";
  for (const [id, p] of Object.entries(BOARD_PRESETS)) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "board-choice" + (id === S.boardPreset ? " selected" : "");
    btn.dataset.preset = id;
    const gridIcon = { klassisch: "grid8", flink: "grid6", riesig: "grid10", grossklein: "gridMix" }[id];
    btn.innerHTML = `<span class="opt-name">${icon(gridIcon, 20)} ${p.name}</span><span class="opt-desc">${p.desc}</span>`;
    btn.addEventListener("click", () => {
      SND.unlock();
      SND.tap();
      S.boardPreset = id;
      saveBoardOpt();
      renderBoardPresets();
    });
    box.appendChild(btn);
  }
}

function newBoardWithFleet() {
  const p = boardPreset();
  const b = E.createBoard(p.grid);
  if (S.allowTouch) b.allowTouch = true;
  E.randomFleet(b, p.fleet);
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
  $("#rule-touch").checked = S.allowTouch;
  const mt = $("#opt-treasures");
  if (mt) mt.checked = S.moreTreasures;
  renderBoardPresets();
}

function rulesSummary(rules) {
  const parts = [];
  if (rules.decoy) parts.push("🎈 Ballon-Schwindel");
  if (rules.sonar) parts.push("🐬 Sonar");
  if (rules.ghost) parts.push("👻 Geisterstunde");
  return parts.join(" · ");
}

// everything non-default about this round, for a quick recap toast
function setupSummary() {
  const parts = [];
  if (S.boardPreset !== "klassisch") parts.push(boardPreset().name);
  if (S.allowTouch) parts.push("🤝 Enge Verstecke");
  if (S.moreTreasures && flag("powers") && S.powersOn) parts.push("💎💎 Mehr Schätze");
  const r = rulesSummary(S.rules);
  if (r) parts.push(r);
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

function loadTreasuresOpt() {
  try {
    return localStorage.getItem("ff-more-treasures") === "1"; // OFF by default
  } catch {
    return false;
  }
}

function saveTreasuresOpt() {
  try {
    localStorage.setItem("ff-more-treasures", S.moreTreasures ? "1" : "0");
  } catch {
    /* private mode etc. */
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
  if (!board.treasures) {
    // Mehr Schätze: sometimes two, rarely three chests hide on a board
    const count = S.moreTreasures
      ? 1 + (Math.random() < 0.6 ? 1 : 0) + (Math.random() < 0.25 ? 1 : 0)
      : PW.TREASURES_PER_BOARD;
    PW.seedTreasures(board, count);
    // the story journey teaches a spell: its chest is visible right away
    if (S.forceTreasureKind) for (const t of board.treasures) t.revealed = true;
  }
  return board.treasures;
}

function treasureListFor(idx) {
  return S.mode === "online" && idx === 1 ? S.oppTreasures : S.boards[idx]?.treasures;
}

function marksFor(idx) {
  return S.mode === "online" && idx === 1 ? S.shadow?.marks : S.boards[idx]?.shots;
}

// after any shot lands on board `idx`: do buried chests surface?
function checkTreasureReveal(idx, x, y) {
  if (!powersEnabled()) return;
  const newly = PW.revealTreasures(treasureListFor(idx) ?? [], marksFor(idx) ?? {}, x, y);
  for (const t of newly) {
    SCENE.spawnChest(slotFor(idx), t.x, t.y);
    SND.sparkle();
    toast("💎 Eine Schatztruhe ist aufgetaucht!", 2200);
  }
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
  // fresh game, fresh board choice: the persisted preset wins (an online
  // guest may have played the host's board last round)
  const bo = loadBoardOpt();
  S.boardPreset = bo.preset;
  S.allowTouch = bo.touch;
  if (S.nextBoardOverride) {
    // the story journey stages each stop's board explicitly
    S.boardPreset = BOARD_PRESETS[S.nextBoardOverride.preset] ? S.nextBoardOverride.preset : "klassisch";
    S.allowTouch = !!S.nextBoardOverride.touch;
    S.moreTreasures = !!S.nextBoardOverride.moreTreasures;
    S.nextBoardOverride = null;
  }
  S.setupToastShown = false;
  // the story journey plants a specific spell in the chest (nextTeachKind
  // is set right before startMode); ordinary games draw randomly
  S.forceTreasureKind = S.nextTeachKind ?? null;
  S.nextTeachKind = null;
  if (mode !== "online") stopFriendListener();
  if (S.pendingInvite) answerInvite(false);
  clearSave();
  S.turn = 0;
  S.viewer = 0;
  S.rematchMine = false;
  S.rematchTheirs = false;
  S.inputLocked = false;
  resetRuleState();

  if (mode === "ai") {
    S.worlds[1] = randomOtherWorld(S.worlds[0], flag("welten"));
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
  SCENE.setupBoard(slot, S.worlds[idx], { grid: S.boards[idx].size });
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
      // Enge Verstecke: only the occupied cells themselves are blocked.
      // The balloon ignores the gap rule entirely — it may snuggle
      // anywhere, and creatures may snuggle up to it.
      const reach = board.allowTouch || String(id) === "decoy" ? 0 : 1;
      const markAround = (cx, cy) => {
        for (let dx = -reach; dx <= reach; dx += 1) {
          for (let dy = -reach; dy <= reach; dy += 1) {
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
      if (board.decoy && id !== "decoy") set.add(E.key(board.decoy.x, board.decoy.y));
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
          toast("Da sitzt schon jemand — der Ballon braucht ein eigenes Feld!");
        }
        SCENE.moveCreature(slot, decoyShipOf(board));
        return;
      }
      if (E.moveShip(board, id, x, y, dir)) {
        SND.tap();
        SCENE.moveCreature(slot, board.ships.find((s) => s.id === id));
      } else {
        SND.sad();
        toast(
          board.allowTouch
            ? "Da sitzt schon jemand!"
            : "Die Freunde brauchen ein Feld Abstand zueinander!"
        );
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
      // squares and single-cell friends have nothing to rotate — wiggle
      if (ship.shape === "sq" || ship.size === 1) {
        SND.plop();
        SCENE.shakeCreature(slot, id);
        return;
      }
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
  // recap what's special about this round (online guests get the
  // host's shared-options toast instead)
  if (S.mode !== "online" && player === 0 && !S.setupToastShown) {
    S.setupToastShown = true;
    const summary = setupSummary();
    if (summary) toast(`Diese Runde: ${summary}`, 3000);
  }
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
  // passive badges: compact round counters, deliberately NOT card-like —
  // dark cards read as buttons and get tapped in vain. Icon + number.
  if (st.shield) box.appendChild(passiveBadge("schild", 1));
  if (st.clover) box.appendChild(passiveBadge("klee", st.clover));
  if (st.doubleShot) box.appendChild(passiveBadge("doppel", 1));
  if (S.extraTurn === me()) box.appendChild(passiveBadge("zeit", 1));
  box.hidden = box.children.length === 0;
}

function passiveBadge(kind, count) {
  const b = document.createElement("div");
  b.className = "power-badge";
  b.dataset.kind = kind;
  b.innerHTML = `<img alt="" src="${SCENE.powerIconUrl(kind)}" />${
    count > 0 ? `<span class="badge-count">${count}</span>` : ""
  }`;
  return b;
}

// reveal card whenever a power arrives — big icon + name; the effect
// itself is the explanation
let gainTimer = null;
let gainDismiss = null;
function hidePowerGain() {
  $("#power-gain").hidden = true;
  clearTimeout(gainTimer);
  if (gainDismiss) {
    document.removeEventListener("pointerdown", gainDismiss, true);
    gainDismiss = null;
  }
}

function showPowerGain(kind, why) {
  const p = PW.POWERS[kind];
  const card = $("#power-gain");
  card.innerHTML = `<div class="gain-why">${why}</div>
    <img alt="" src="${SCENE.powerIconUrl(kind, 192)}" />
    <div class="gain-name">${p.name}</div>
    <div class="gain-use">${p.use ?? ""}</div>
    <div class="gain-dismiss">Weiter geht's mit einem Tipp</div>`;
  card.hidden = false;
  clearTimeout(gainTimer);
  // the card waits for the reader — only automated tests rush it away
  if (FAST) {
    gainTimer = setTimeout(hidePowerGain, 300);
  }
  // a tap ANYWHERE dismisses — and does ONLY that: the tap is swallowed
  // (pointerdown and its paired click), so it can never double as a
  // board shot or a button press hiding under the card
  if (gainDismiss) document.removeEventListener("pointerdown", gainDismiss, true);
  gainDismiss = (e) => {
    e.preventDefault();
    e.stopPropagation();
    const squelch = (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
    };
    document.addEventListener("click", squelch, { capture: true, once: true });
    setTimeout(() => document.removeEventListener("click", squelch, true), 350);
    hidePowerGain();
  };
  setTimeout(() => {
    if (!card.hidden) document.addEventListener("pointerdown", gainDismiss, true);
  }, 50);
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
  S.treasureKind = kind;
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
  S.treasureFollowup = null;
  const kind = S.treasureKind;
  S.treasureKind = null;
  // digging a chest is a GIFT, not your shot: every chest spell keeps
  // the turn, so you always get to play with what you just learned
  const keepTurn =
    {
      doppel: "🎯 Doppelschuss! Du darfst gleich ZWEIMAL suchen!",
      fernglas: "🔍 Du weißt jetzt mehr — such gleich weiter!",
      trommel: "🥁 Folg dem Pfeil — such gleich weiter!",
      kompass: "🧭 Folg dem Pfeil — such gleich weiter!",
      glocke: "🔔 Such unter dem Schatten — du bist noch dran!",
      klee: "🍀 Jedes Daneben zeigt jetzt die Entfernung — such gleich weiter!",
      zeit: "⏳ Die Zeit ist auf deiner Seite — such gleich weiter!",
      schild: "🪷 Schild aktiv — und du darfst gleich weitersuchen!",
    }[kind] ?? "✨ Schatz-Zauber gewirkt — du bist immer noch dran!";
  setTimeout(() => {
    if (S.phase !== "battle") return;
    if (S.mode === "online" && kind === "doppel") S.net.send({ t: "pw", kind: "doppel" });
    S.inputLocked = false;
    status(keepTurn);
    renderPowers();
    saveGame();
  }, FAST ? 140 : 1400);
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
    if (["own", "own-cell"].includes(PW.POWERS[kind].target)) resumeBattleView();
    else beginTurnStatus();
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
  } else if (p.target === "own" || p.target === "own-cell") {
    // aim on YOUR OWN board: fly home so you see what you're choosing
    S.pendingPower = kind;
    const mySlot = slotFor(me());
    SCENE.focusBoard(mySlot);
    SCENE.setTapMode(mySlot, (x, y) => ownPowerTap(x, y));
    status(
      p.target === "own"
        ? `${p.emoji} ${p.name}: Tipp den Freund an, der umziehen soll!`
        : `${p.emoji} ${p.name}: Tipp ein freies Feld — da versteckt sich der Ballon!`
    );
    renderPowers();
  } else {
    S.pendingPower = kind;
    status(
      p.target === "row"
        ? `${p.emoji} ${p.name}: Tipp eine Reihe auf dem Suchbrett an!`
        : p.target === "col"
          ? `${p.emoji} ${p.name}: Tipp eine Spalte auf dem Suchbrett an!`
          : `${p.emoji} ${p.name}: Tipp ein Feld auf dem Suchbrett an!`
    );
    renderPowers();
  }
}

// point the camera and taps back at the enemy board after an own-board
// interlude (choosing a friend, watching a move)
function resumeBattleView() {
  if (S.phase !== "battle" || S.turn !== S.viewer) return;
  const target = other(S.turn);
  SCENE.focusBoard(slotFor(target));
  SCENE.setTapMode(slotFor(target), (x, y) => handleTap(x, y));
  beginTurnStatus();
}

// a tap on the OWN board while an own-target power is armed
function ownPowerTap(x, y) {
  if (S.phase !== "battle" || S.inputLocked || S.turn !== S.viewer) return;
  const kind = S.pendingPower;
  if (!kind) return;
  const target = PW.POWERS[kind].target;
  const board = S.boards[me()];
  if (target === "own-cell") {
    // pick a free spot (the balloon) — invalid taps keep the aim armed
    if (!PW.canExtraBalloonAt(board, x, y)) {
      SND.sad();
      toast("Da geht das nicht — such ein freies Feld!");
      return;
    }
    S.pendingPower = null;
    executePower(kind, { x, y });
    return;
  }
  if (target !== "own") return;
  const ship = E.shipAt(board, x, y);
  if (!ship) {
    SND.tap();
    return;
  }
  if (E.isSunk(ship)) {
    SND.sad();
    toast("Der wurde schon ganz gefunden — der kann nicht mehr fliehen!");
    return;
  }
  S.pendingPower = null;
  executePower(kind, { shipId: ship.id });
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
  else if (kind === "frost") apply({ cells: PW.scanCells(board, PW.crossCells(board, payload.x, payload.y)) });
  else if (kind === "funke") apply({ cells: PW.scanCells(board, PW.plusCells(board, payload.x, payload.y)) });
  else if (kind === "enterhaken") apply({ cells: PW.scanCells(board, PW.hookCells(board, payload.x, payload.y)) });
  else if (kind === "leuchtfeuer") apply({ cells: PW.scanCells(board, PW.columnCells(board, payload.x)) });
  else if (kind === "fernglas") apply({ cells: PW.scanCells(board, [{ x: payload.x, y: payload.y }]) });
  else if (kind === "trommel" || kind === "kompass") apply({ dir: PW.directionToNearest(board, payload.x, payload.y) });
  else if (kind === "glocke") apply({ big: PW.biggestHiddenRegion(board) });
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
  } else if (kind === "frost") {
    consumePower(kind);
    SCENE.frostStar(enemySlot, target.x, target.y);
    resolveInfo(kind, { x: target.x, y: target.y }, ({ cells }) => {
      SND.sparkle();
      cells.forEach((c, i) => setTimeout(() => SCENE.peekMarker(enemySlot, c.x, c.y, c.ship), 400 + i * 140));
      status("❄️ Der Eisstern hat alles glitzern lassen!");
    });
  } else if (kind === "funke") {
    consumePower(kind);
    SCENE.sparkFly(enemySlot, target.x, target.y);
    resolveInfo(kind, { x: target.x, y: target.y }, ({ cells }) => {
      SND.sparkle();
      cells.forEach((c, i) => setTimeout(() => SCENE.peekMarker(enemySlot, c.x, c.y, c.ship), 400 + i * 140));
      status("🎆 Der Funke hat in alle Richtungen gesprüht!");
    });
  } else if (kind === "enterhaken") {
    consumePower(kind);
    SCENE.hookDrag(enemySlot, target.x, target.y);
    SND.whoosh();
    resolveInfo(kind, { x: target.x, y: target.y }, ({ cells }) => {
      SND.sparkle();
      cells.forEach((c, i) => setTimeout(() => SCENE.peekMarker(enemySlot, c.x, c.y, c.ship), 500 + i * 180));
      status("🪝 Der Enterhaken hat alles abgetastet!");
    });
  } else if (kind === "leuchtfeuer") {
    consumePower(kind);
    SCENE.lightSweep(enemySlot, target.x);
    SND.whoosh();
    resolveInfo(kind, { x: target.x }, ({ cells }) => {
      SND.sparkle();
      cells.forEach((c, i) => setTimeout(() => SCENE.peekMarker(enemySlot, c.x, c.y, c.ship), 300 + i * 90));
      status("🚨 Das Leuchtfeuer verrät seine Geheimnisse!");
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
      // a rough shadow settles over the REGION where the biggest hidden
      // friend really lurks — vague on purpose, honest always
      if (big && Number.isFinite(big.cx) && Number.isFinite(big.rx)) {
        SCENE.regionShadow(enemySlot, big);
      }
      status(
        big
          ? big.dir === "sq"
            ? "🔔 Unter dem Schatten lauert ein 2×2-Brocken — irgendwo da drin!"
            : `🔔 Unter dem Schatten lauert er: ${big.size} Felder lang, ${
                big.dir === "h" ? "QUER ↔" : "HOCHKANT ↕"
              } — irgendwo da drin!`
          : "🔔 Die Glocke schweigt — alle sind gefunden!"
      );
    });
  } else if (kind === "klee") {
    consumePower(kind);
    st.clover = PW.CLOVER_USES;
    SCENE.cloverRain(enemySlot);
    SND.fanfare();
    // teach by showing: flash real distance numbers on a few free cells
    // (offline modes know the enemy board; online the first miss teaches)
    if (S.mode !== "online") {
      const eb = S.boards[other(my)];
      const demo = [];
      const used = new Set();
      for (let tries = 0; tries < 80 && demo.length < 3; tries += 1) {
        const x = Math.floor(Math.random() * eb.size);
        const y = Math.floor(Math.random() * eb.size);
        const k = E.key(x, y);
        if (used.has(k) || eb.shots[k] || E.shipAt(eb, x, y)) continue;
        if (PW.treasureAt(eb, x, y)) continue;
        const dist = E.sonarDistance(eb, x, y);
        if (dist == null) continue;
        used.add(k);
        demo.push({ x, y, dist });
      }
      SCENE.sonarPreview(enemySlot, demo);
    }
    status("🍀 Glücksklee! Jedes Daneben zeigt ab jetzt so eine Zahl: Felder bis zum nächsten Freund.");
  } else if (kind === "doppel") {
    consumePower(kind);
    st.doubleShot = true;
    SCENE.doubleShotFlare(enemySlot);
    status("🎯 Doppelschuss bereit: Dein nächstes Daneben beendet den Zug nicht!");
  } else if (kind === "zeit") {
    // time runs BACKWARD: heal the freshest wound on your most-injured
    // friend — the enemy's hit mark rewinds away before their eyes
    const healed = PW.rewindWound(S.boards[my]);
    consumePower(kind);
    if (!healed) {
      // nothing to heal — time gifts a bonus turn instead
      S.extraTurn = my;
      if (S.mode === "online") S.net.send({ t: "pw", kind: "zeit" });
      SCENE.clockRipple(enemySlot);
      SND.sparkle();
      status("⏳ Niemand ist verletzt — die Zeit schenkt dir einen Extra-Zug!");
    } else {
      const mySlot = slotFor(my);
      const name = getWorld(S.worlds[my]).creatures[healed.ship.id]?.name ?? "dein Freund";
      SCENE.focusBoard(mySlot);
      SCENE.clockRipple(mySlot);
      SCENE.whirlAwayMark(mySlot, healed.cell.x, healed.cell.y);
      SCENE.clearMark(mySlot, healed.cell.x, healed.cell.y);
      // robo saw its hit disappear — it forgets that lead, like a human
      if (S.mode === "ai" && S.aiState?.openHits) {
        S.aiState.openHits = S.aiState.openHits.filter(
          (h) => !(h.x === healed.cell.x && h.y === healed.cell.y)
        );
      }
      if (S.mode === "online") S.net.send({ t: "pw", kind: "zeit", cell: healed.cell });
      SND.sparkle();
      status(`⏳ Die Zeit dreht zurück: ${name} ist wieder heil!`);
      // a beat to take it in, then back — BEFORE a chest followup (at
      // 1400ms) unlocks input, so taps never land while flying home
      S.inputLocked = true;
      setTimeout(() => {
        S.inputLocked = false;
        resumeBattleView();
      }, FAST ? 120 : 1300);
    }
  } else if (kind === "schild") {
    consumePower(kind);
    st.shield = true;
    SCENE.shieldFlash(slotFor(my));
    SND.sparkle();
    status("🪷 Seerosen-Schild aktiv: Der nächste Treffer prallt ab!");
  } else if (kind === "wirbel") {
    const board = S.boards[my];
    const chosen = board.ships.find((s) => s.id === target?.shipId) ?? null;
    const fromCells = chosen ? E.shipCells(chosen) : null;
    const res = PW.whirlwindMove(board, Math.random, target?.shipId ?? null);
    if (!res) {
      SND.sad();
      toast("Kein Platz zum Wirbeln — probier einen anderen Freund!");
      S.pendingPower = null;
      renderPowers();
      resumeBattleView();
      return;
    }
    const { ship: moved, cleared } = res;
    consumePower(kind);
    // show the whole journey: tornado at the old hiding spot, then the
    // friend visibly hops over to the new one while you watch
    const mySlot = slotFor(my);
    SCENE.focusBoard(mySlot);
    const fromMid = fromCells?.[Math.floor(fromCells.length / 2)];
    if (fromMid) SCENE.tornadoAt(mySlot, fromMid.x, fromMid.y);
    // a wounded friend escapes: the enemy's hit marks swirl away
    for (const c of cleared) SCENE.whirlAwayMark(mySlot, c.x, c.y);
    SCENE.moveCreature(mySlot, moved);
    // robo saw its hits vanish too — it forgets those leads, like a human
    if (S.mode === "ai" && S.aiState?.openHits && cleared.length) {
      S.aiState.openHits = S.aiState.openHits.filter(
        (h) => !cleared.some((c) => c.x === h.x && c.y === h.y)
      );
    }
    if (S.mode === "online") S.net.send({ t: "pw", kind: "wirbel", cleared });
    SND.whoosh();
    if (cleared.length) SND.growl();
    status(
      cleared.length
        ? "🌪️ Wusch! Dein verletzter Freund ist entwischt — die Treffer dort sind weg!"
        : "🌪️ Wusch! Dein Freund ist umgezogen — pssst, neues Versteck!"
    );
    // a beat to take it in, then back to the hunt
    S.inputLocked = true;
    setTimeout(() => {
      S.inputLocked = false;
      resumeBattleView();
    }, FAST ? 120 : 2200);
  } else if (kind === "ballon") {
    // the player chose the exact spot on their own board
    if (!PW.extraBalloonAt(S.boards[my], target.x, target.y)) {
      SND.sad();
      toast("Da geht das nicht — such ein freies Feld!");
      S.pendingPower = kind; // stay armed, try another cell
      renderPowers();
      return;
    }
    consumePower(kind);
    syncCreatureVisibility();
    if (S.mode === "online") S.net.send({ t: "pw", kind: "ballon" });
    SND.plop();
    // the camera is already on the own board from aiming — celebrate the
    // chosen spot, then back to the hunt
    SCENE.spotlight(slotFor(my), target.x, target.y);
    status("🎈 Dein neuer Schwindel-Ballon sitzt genau DA — pssst!");
    S.inputLocked = true;
    setTimeout(() => {
      S.inputLocked = false;
      resumeBattleView();
    }, FAST ? 120 : 2000);
  } else if (kind === "salve") {
    consumePower(kind);
    runSalvo(target);
  }
  renderPowers();
  dispatchTreasureFollowup();
  saveGame();
}

// activation timbre by temperament
const CAST_SOUND = {
  welle: "info",
  radar: "info",
  frost: "info",
  funke: "info",
  enterhaken: "info",
  leuchtfeuer: "info",
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
      checkTreasureReveal(targetIdx, r.x, r.y);
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

let storyVig = null;
function stopStoryVignette() {
  storyVig?.dispose();
  storyVig = null;
  const stage = $("#story-stage");
  if (stage) stage.hidden = true;
}

function showPass({ title, sub, btn, action, vignette = null }) {
  $("#pass-title").textContent = title;
  $("#pass-sub").textContent = sub;
  $("#btn-pass-go").textContent = btn;
  stopStoryVignette();
  if (vignette) {
    const stage = $("#story-stage");
    stage.hidden = false;
    storyVig = SCENE.storyVignette(stage, vignette.world, vignette.prop);
  }
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
    SCENE.setupBoard("enemy", S.worlds[1], {
      grid: S.boards[1]?.size ?? S.shadow?.size ?? boardPreset().grid,
    });
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
    // chests start buried — they surface as the search progresses
    SCENE.renderTreasures("mine", (S.boards[0]?.treasures ?? []).filter((t) => t.revealed));
    SCENE.renderTreasures("enemy", (treasureListFor(1) ?? []).filter((t) => t.revealed));
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
  saveGame();
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
        // NOTE: doubleShot deliberately survives turn changes — it
        // lasts until a miss actually consumes it
        if (cardsEnabled() && st.turns % PW.RECHARGE_EVERY === 0) {
          gainPower(S.turn, PW.drawPower(Math.random, st.hand), "⚡ Neue Karte");
        }
      }
    }
    S.pendingPower = null;
    renderPowers();
    saveGame();
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

  // dug up the treasure: it casts its power on the spot — and the turn
  // stays with the digger, so the spell can be used right away
  if (res.result === E.MISS && powersEnabled() && PW.treasureAt(board, x, y)) {
    board.treasures = board.treasures.filter((t) => !(t.x === x && t.y === y));
    SCENE.applyShotQuiet(slotFor(targetIdx), x, y, "miss");
    SCENE.openTreasure(slotFor(targetIdx), x, y);
    SND.treasure();
    const kind = S.forceTreasureKind ?? PW.drawPower(Math.random, [], { instant: true });
    S.forceTreasureKind = null; // the taught spell fills only the first chest
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
  // Glücksklee is a limited charm: each shown number uses up one leaf
  if (res.result === E.MISS && sonarDist != null) {
    const shSt = powersEnabled() ? S.powers[other(idx)] : null;
    if (shSt && typeof shSt.clover === "number" && shSt.clover > 0) {
      shSt.clover -= 1;
      if (other(idx) === me() && shSt.clover === 0) {
        setTimeout(() => toast("🍀 Der Glücksklee ist verwelkt."), FAST ? 100 : 1400);
      }
    }
  }
  SCENE.applyShot(
    slot,
    x,
    y,
    res.result === E.MISS ? "miss" : res.result === E.DECOY ? "decoy" : "hit",
    { sonarDist }
  );
  ghostTick(idx, x, y, res.result);
  checkTreasureReveal(idx, x, y);
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
  saveGame();
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
      } else if (
        zeitIdx >= 0 &&
        Math.random() < 0.6 &&
        S.boards[1].ships.some((s) => s.hits.length > 0 && !E.isSunk(s))
      ) {
        // robo rewinds time: one of its wounds heals, MY mark vanishes
        st1.hand.splice(zeitIdx, 1);
        const healed = PW.rewindWound(S.boards[1]);
        if (healed) {
          SCENE.clockRipple("enemy");
          SCENE.whirlAwayMark("enemy", healed.cell.x, healed.cell.y);
          SCENE.clearMark("enemy", healed.cell.x, healed.cell.y);
          SND.powerCast("defense");
          toast("🤖 ⏳ Robo dreht die Zeit zurück — dein Treffer ist weg!", 3200);
        }
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
  return { size: boardPreset().grid, marks: {}, found: [] };
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
    btn.innerHTML = `${icon("friends", 18)} Mitspieler aus ${getWorld(f.world).name} · ${timeAgo(f.ts)}`;
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

// one-tap rematch straight from the title screen — remembered friends
// deserve better than three clicks
function renderTitleFriends() {
  const box = $("#title-friends");
  if (!box) return;
  const friends = Object.entries(loadFriends())
    .sort((a, b) => b[1].ts - a[1].ts)
    .slice(0, 2);
  box.hidden = friends.length === 0;
  box.innerHTML = "";
  for (const [pid, f] of friends) {
    const btn = document.createElement("button");
    btn.className = "btn friend-quick";
    btn.innerHTML = `${icon("friends", 20)} Zusammen spielen <small>Freund aus ${getWorld(f.world).name} · ${timeAgo(f.ts)}</small>`;
    btn.addEventListener("click", () => joinFriend(pid));
    box.appendChild(btn);
  }
}

// where the always-open friend door makes sense: any menu screen, and
// throughout an online match (it doubles as the resume door)
function friendListenerWanted() {
  if (S.phase === "title" || S.phase === "over") return true;
  return S.mode === "online" && ["place", "battle"].includes(S.phase);
}

function startFriendListener() {
  if (S.friendNet) return;
  const net = new Net();
  S.friendNet = net;
  net.onMessage = () => {};
  net.onClose = () => {};
  net.onStatus = (st) => {
    if (st !== "connected" || S.friendNet !== net) return;
    S.friendNet = null;
    handleKnock(net);
  };
  net.host(PID).catch(() => {
    // e.g. a second tab (or our own game net) holds the id — try again
    // later so the door reopens once it frees up
    if (S.friendNet === net) S.friendNet = null;
    setTimeout(() => {
      if (!S.friendNet && friendListenerWanted()) startFriendListener();
    }, 8000);
  });
}

// someone connected to our stable address — figure out who and why
function handleKnock(net) {
  // mid-battle it can only be our opponent finding the way back
  if (S.phase === "battle" && S.mode === "online") {
    net.onMessage = (m) => {
      if (m && m.t === "resume" && (!S.oppPid || m.pid === S.oppPid)) {
        if (S.net) S.net.destroy();
        S.net = net;
        wireNet();
        handleNetMessage(m);
      } else {
        net.destroy();
        startFriendListener();
      }
    };
    return;
  }
  // busy (already paired, or an invite is pending) — politely decline
  if (S.phase !== "title" || S.net?.conn || S.pendingInvite) {
    net.destroy();
    if (friendListenerWanted()) startFriendListener();
    return;
  }
  showInvitePopup(net);
}

// ---------------------------------------------------- incoming invite
// A friend knocked: flash a popup so this device's player notices —
// nothing starts until they say yes.

function showInvitePopup(net) {
  S.pendingInvite = { net };
  const pop = $("#invite-pop");
  $("#invite-text").textContent = "Ein Freund möchte mit dir spielen!";
  pop.hidden = false;
  SND.unlock();
  SND.fanfare();
  try {
    navigator.vibrate?.([120, 60, 120]);
  } catch {
    /* not supported */
  }
  net.onMessage = (m) => {
    if (m && m.t === "hi" && m.world && WORLDS[m.world]) {
      $("#invite-text").textContent = `Dein Freund aus ${getWorld(m.world).name} möchte spielen!`;
    }
  };
  net.onClose = () => {
    // the knocker gave up before we answered
    if (S.pendingInvite?.net === net) answerInvite(false);
  };
}

function answerInvite(accepted) {
  const inv = S.pendingInvite;
  if (!inv) return;
  S.pendingInvite = null;
  $("#invite-pop").hidden = true;
  if (accepted && inv.net.conn?.open) {
    if (S.net) S.net.destroy();
    S.net = inv.net;
    S.isHost = true;
    wireNet();
    toast("🤝 Los geht's!", 2000);
    // the friend's `hi` pings drive the world pick from here
  } else {
    inv.net.destroy();
    if (friendListenerWanted()) startFriendListener();
  }
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
      // knock up to three times — brokers and sleepy phones need a moment
      const attempt = (triesLeft) => {
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
            if (triesLeft > 0 && S.phase === "title") {
              toast("Klopfe nochmal an …", 2000);
              setTimeout(() => attempt(triesLeft - 1), 2500);
              return;
            }
            toast("Dein Freund ist gerade nicht da. Zeigt euch sonst den QR-Code!", 3400);
            if (S.net) {
              S.net.destroy();
              S.net = null;
            }
          });
      };
      attempt(2);
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
    // mid-battle drop: hold the fort and let the opponent reconnect
    if (S.phase === "battle" && S.mode === "online" && S.oppPid) {
      enterReconnectWait();
      return;
    }
    toast("Die Verbindung ist weg.", 2600);
    goHome();
  };
  // a second knock on our address while the old socket still LOOKS open:
  // if it announces itself as our opponent resuming, swap it in — waiting
  // for a zombie connection to time out is how reconnects get lost
  S.net.onKnock = (conn) => {
    const net = S.net;
    const probe = (data) => {
      conn.off?.("data", probe);
      const isResume =
        data &&
        data.t === "resume" &&
        S.phase === "battle" &&
        S.mode === "online" &&
        (!S.oppPid || data.pid === S.oppPid);
      if (isResume && S.net === net) {
        net.replaceConn(conn);
        handleNetMessage(data);
      } else {
        try {
          conn.close();
        } catch {
          /* ignore */
        }
      }
    };
    conn.on("data", probe);
    setTimeout(() => {
      if (S.net?.conn !== conn) {
        conn.off?.("data", probe);
        try {
          conn.close();
        } catch {
          /* ignore */
        }
      }
    }, 10000);
  };
}

function beginOnlinePlacement() {
  // keep the stable-id door open during the match: it doubles as the
  // resume door when the opponent refreshes mid-battle
  startFriendListener();
  saveFriend(S.oppPid, S.worlds[1]);
  renderTitleFriends();
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
      // the host decides the extra rules + powers + board for both players
      S.rules = {
        decoy: !!msg.rules?.decoy,
        sonar: !!msg.rules?.sonar,
        ghost: !!msg.rules?.ghost,
      };
      S.powersOn = flag("powers") && msg.powers !== false;
      S.cardsOn = flag("powers") && !!msg.cards;
      S.moreTreasures = flag("powers") && !!msg.moreTreasures;
      S.boardPreset = BOARD_PRESETS[msg.board?.preset] ? msg.board.preset : "klassisch";
      S.allowTouch = !!msg.board?.touch;
      syncRuleChips();
      const parts = [
        rulesSummary(S.rules),
        S.boardPreset !== "klassisch" ? boardPreset().name : "",
        S.allowTouch ? "🤝 Enge Verstecke" : "",
        S.powersOn ? "💎 Schatz-Zauber" : "",
        S.moreTreasures ? "💎💎 Mehr Schätze" : "",
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

      const resultMsg = {
        t: "result",
        x: msg.x,
        y: msg.y,
        result: res.result,
        ship:
          res.result === E.SUNK
            ? { id: res.ship.id, size: res.ship.size, shape: res.ship.shape, x: res.ship.x, y: res.ship.y, dir: res.ship.dir }
            : null,
        revealed: res.revealed,
        gameOver: res.gameOver,
        dist:
          (S.rules.sonar || msg.clover) && res.result === E.MISS
            ? E.sonarDistance(S.boards[0], msg.x, msg.y)
            : null,
      };
      S.net.send(resultMsg);
      if (res.result !== E.REPEAT) S.lastResultMsg = resultMsg; // for resume replay
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
      } else if (msg.kind === "frost") {
        S.net.send({ t: "pwr", kind: "frost", cells: PW.scanCells(b, PW.crossCells(b, msg.x, msg.y)) });
        toast("❄️ Ein Eisstern glitzert über deinem Brett …");
      } else if (msg.kind === "enterhaken") {
        S.net.send({ t: "pwr", kind: "enterhaken", cells: PW.scanCells(b, PW.hookCells(b, msg.x, msg.y)) });
        toast("🪝 Ein Enterhaken kratzt über dein Brett …");
      } else if (msg.kind === "leuchtfeuer") {
        S.net.send({ t: "pwr", kind: "leuchtfeuer", cells: PW.scanCells(b, PW.columnCells(b, msg.x)) });
        toast("🚨 Ein Lichtstrahl wandert über dein Brett …");
      } else if (msg.kind === "funke") {
        S.net.send({ t: "pwr", kind: "funke", cells: PW.scanCells(b, PW.plusCells(b, msg.x, msg.y)) });
        toast("🎆 Funken sprühen über deinem Brett …");
      } else if (msg.kind === "fernglas") {
        S.net.send({ t: "pwr", kind: "fernglas", cells: PW.scanCells(b, [{ x: msg.x, y: msg.y }]) });
      } else if (msg.kind === "trommel" || msg.kind === "kompass") {
        S.net.send({ t: "pwr", kind: msg.kind, dir: PW.directionToNearest(b, msg.x, msg.y) });
      } else if (msg.kind === "glocke") {
        S.net.send({ t: "pwr", kind: "glocke", big: PW.biggestHiddenRegion(b) });
      } else if (msg.kind === "zeit") {
        if (msg.cell && Number.isInteger(msg.cell.x) && Number.isInteger(msg.cell.y)) {
          // their wound healed — my hit mark over there rewinds away
          delete S.shadow.marks[E.key(msg.cell.x, msg.cell.y)];
          SCENE.whirlAwayMark("enemy", msg.cell.x, msg.cell.y);
          SCENE.clearMark("enemy", msg.cell.x, msg.cell.y);
          toast("⏳ Zeitzauber! Drüben heilt eine Wunde — dein Treffer ist weg!", 3200);
        } else {
          S.extraTurn = 1;
          toast("⏳ Dein Mitspieler hat einen Zeitzauber gewirkt — Extra-Zug für ihn!");
        }
      } else if (msg.kind === "doppel") {
        toast("🎯 Drüben wirkt ein Doppelschuss — gleich wird zweimal gesucht!");
      } else if (msg.kind === "wirbel") {
        // their creature escaped — my hit marks over there swirl away
        const cleared = Array.isArray(msg.cleared)
          ? msg.cleared.filter((c) => Number.isInteger(c?.x) && Number.isInteger(c?.y))
          : [];
        for (const c of cleared) {
          delete S.shadow.marks[E.key(c.x, c.y)];
          SCENE.whirlAwayMark("enemy", c.x, c.y);
          SCENE.tornadoAt("enemy", c.x, c.y);
        }
        if (cleared.length) SND.growl();
        toast(
          cleared.length
            ? "🌪️ Wirbelwind! Der getroffene Freund ist entwischt — deine Treffer dort sind weg!"
            : "🌪️ Drüben hat jemand heimlich das Versteck gewechselt …",
          3200
        );
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
                ? { id: res.ship.id, size: res.ship.size, shape: res.ship.shape, x: res.ship.x, y: res.ship.y, dir: res.ship.dir }
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
    case "resume": {
      // the opponent refreshed and is back — pick up where we stopped
      if (S.phase !== "battle" || S.mode !== "online") break;
      if (msg.pid && S.oppPid && msg.pid !== S.oppPid) break; // stranger
      S.net.send({ t: "resume-ok", yourTurn: S.turn === 1, lastResult: S.lastResultMsg ?? null });
      S.inputLocked = false;
      beginTurn();
      toast("🔌 Dein Mitspieler ist zurück!");
      startFriendListener(); // reopen the resume door for next time
      saveGame();
      break;
    }
    case "resume-ok": {
      if (S.phase !== "battle" || S.resumeOk) break;
      S.resumeOk = true;
      S.turn = msg.yourTurn ? 0 : 1;
      // replay the one result that may have been lost in the refresh
      const lr = msg.lastResult;
      if (lr && lr.result && lr.result !== E.REPEAT && !S.shadow.marks[E.key(lr.x, lr.y)]) {
        const mark = lr.result === E.MISS ? E.MISS : lr.result === E.DECOY ? E.DECOY : E.HIT;
        S.shadow.marks[E.key(lr.x, lr.y)] = mark;
        SCENE.applyShotQuiet("enemy", lr.x, lr.y, mark);
        if (lr.result === E.SUNK && lr.ship) {
          S.shadow.found.push(lr.ship);
          for (const c of lr.revealed || []) S.shadow.marks[E.key(c.x, c.y)] = E.MISS;
          SCENE.addCreature("enemy", { ...lr.ship, hits: [] }, { found: true });
        }
      }
      S.inputLocked = false;
      beginTurn();
      toast("▶️ Weiter geht's!");
      startFriendListener(); // reopen the resume door for next time
      saveGame();
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
    moreTreasures: flag("powers") && S.powersOn && S.moreTreasures,
    board: { preset: S.boardPreset, touch: S.allowTouch },
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

// parade the quarry across the middle of the board before the hunt:
// the child SEES what they're hunting and how many cells it spans —
// then it whooshes back into hiding (the shown spot is NOT the real one)
function quarryIntro(ship, text, growl, done) {
  S.inputLocked = true;
  SCENE.clearInteraction();
  SCENE.placeCreatures("mine", [ship], { popIn: true });
  status(text);
  if (growl) SND.growl();
  else SND.plop();
  setTimeout(() => SCENE.hopCreature("mine", ship.id), FAST ? 60 : 700);
  setTimeout(() => {
    SCENE.placeCreatures("mine", []);
    SND.whoosh();
    S.inputLocked = false;
    done();
  }, FAST ? 180 : 3200);
}

function startChase(kind) {
  SND.unlock();
  SND.whoosh();
  goFullscreen();
  S.mode = "chase";
  S.phase = "chase";
  S.gameMode = "chase";
  S.journey = null;
  S.inputLocked = false; // a won battle may have left the lock on
  S.chase = { kind, st: CHASE.createChase(), role: "seeker", waiting: false, marks: {} };
  if (kind === "online") {
    show("screen-online");
    return;
  }
  setupChaseBoard();
  if (kind === "ai") {
    quarryIntro(fridoShip(3, 4), `Das ist ${fridoName()} — nur EIN Feld klein und ganz schön flink!`, false, () => {
      chaseStatus("Ein frecher Freund hat sich versteckt.");
      SCENE.setTapMode("mine", (x, y) => chaseSeekTap(x, y));
    });
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
        quarryIntro(fridoShip(4, 3), `So sieht ${fridoName()} aus — nur EIN Feld klein!`, false, () => {
          chaseStatus();
          SCENE.setTapMode("mine", (x, y) => chaseSeekTap(x, y));
        });
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

// let the reveal breathe: the sneak pops out, hops, THEN the win screen
function chaseEnd(caught) {
  S.inputLocked = true;
  SCENE.clearInteraction();
  status(caught ? `🎉 Hab dich, ${fridoName()}!` : `Da steckte ${fridoName()}!`);
  setTimeout(() => SCENE.hopCreature("mine", 4), FAST ? 50 : 500);
  setTimeout(() => chaseEndNow(caught), FAST ? 150 : 2600);
}

function chaseEndNow(caught) {
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
  SCENE.setTapMode("mine", (x, y) => chaseOnlineSeekTap(x, y));
  quarryIntro(fridoShip(3, 4), `Das ist ${fridoName()} — nur EIN Feld klein und ganz schön flink!`, false, () => {
    // stay locked until the hider is ready (the flag may have arrived
    // while the intro played)
    S.inputLocked = !S.chase.ready;
    if (S.chase.ready) chaseStatus();
    else status("Dein Mitspieler versteckt sich gerade … 🙈");
  });
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

// Oktopus, UFO, Rexi, Frosch, Eisbär, Drache, Galeone, U-Boot
const BOSS_IDX = { ozean: 1, weltraum: 2, dino: 1, teich: 3, eis: 2, vulkan: 0, piraten: 0, marine: 2 };

function bossIdx() {
  return BOSS_IDX[S.worlds[0]] ?? 1;
}

function bossName() {
  return `König ${getWorld(S.worlds[0]).creatures[bossIdx()]?.name ?? "Monster"}`;
}

function bossShipOf(st) {
  return { id: bossIdx(), size: BOSS.BOSS_SIZE, x: st.boss.x, y: st.boss.y, dir: st.boss.dir, hits: [] };
}

// a fake board-centered pose for the intro parade — NEVER the real spot
function centeredBossShip(st) {
  return {
    id: bossIdx(),
    size: BOSS.BOSS_SIZE,
    x: Math.floor((st.size - BOSS.BOSS_SIZE) / 2),
    y: Math.floor(st.size / 2),
    dir: "h",
    hits: [],
  };
}

function bossHunterStatus(wounds, shotsLeft, prefix = "") {
  const lead = prefix ? `${prefix} ` : "";
  const st = S.boss?.st;
  if (st?.hunt) {
    // hunt mode: the monster's hearts vs. your fleet's healthy cells
    const fleet = BOSS.fleetHealthyCells(st).length;
    status(`${lead}${bossName()}: ${"💜".repeat(BOSS.BOSS_SIZE - wounds)} · Flotte: ${"❤️".repeat(fleet)}`);
    return;
  }
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
  S.inputLocked = false; // a won battle may have left the lock on
  // solo = hunt mode: your fleet on the same board is your lives
  S.boss = {
    kind,
    st: kind === "ai" ? BOSS.createHunt() : BOSS.createBoss(),
    role: "hunter",
    marks: {},
    shotsLeft: BOSS.BOSS_SHOTS,
    wounds: 0,
  };
  if (kind === "online") {
    show("screen-online");
    return;
  }
  setupBossBoard();
  if (kind === "ai") {
    const st = S.boss.st;
    // chests glitter through the parade; the fleet marches on after it
    SCENE.renderTreasures("mine", st.treasures);
    quarryIntro(
      centeredBossShip(st),
      `So RIESIG ist ${bossName()}: ${BOSS.BOSS_SIZE} Felder lang! Es jagt DEINE Freunde — finde es zuerst!`,
      true,
      () => {
        SCENE.placeCreatures("mine", st.fleet, { popIn: true });
        bossHunterStatus(0, 0, `${bossName()} schleicht zu deinen Freunden!`);
        SCENE.setTapMode("mine", (x, y) => bossSeekTap(x, y));
      }
    );
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
        quarryIntro(
          centeredBossShip(S.boss.st),
          `So RIESIG ist ${bossName()}: ${BOSS.BOSS_SIZE} Felder lang!`,
          true,
          () => {
            bossHunterStatus(0, S.boss.st.shotsLeft);
            SCENE.setTapMode("mine", (x, y) => bossSeekTap(x, y));
          }
        );
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

  if (st.hunt) {
    // no friendly fire — unless the monster is stomping RIGHT ON your
    // friend: then the tap hits the beast, never the friend
    if (BOSS.fleetShipAt(st, x, y) && BOSS.segmentAt(st, x, y) < 0) {
      SND.tap();
      toast("Da steht doch dein eigener Freund!");
      return;
    }
    // a chest! Digging is a gift, not a shot — the monster waits
    const ti = BOSS.treasureIdxAt(st, x, y);
    if (ti >= 0) {
      st.treasures.splice(ti, 1);
      SCENE.openTreasure("mine", x, y);
      SND.treasure();
      S.inputLocked = true;
      const kind = BOSS.drawHuntPower();
      powerFlyOut(kind, "mine", x, y, () => {
        S.inputLocked = false;
        if (kind === "doppel") {
          st.extraShots += 1;
          SND.fanfare();
          status("🎯 Doppelschuss! Dein nächster Zug hat ZWEI Schüsse — das Monster wartet.");
        } else if (kind === "frost") {
          st.freeze = BOSS.FREEZE_MOVES;
          SND.sparkle();
          status(`❄️ Eiszauber! ${bossName()} ist ${BOSS.FREEZE_MOVES} Züge lang festgefroren!`);
        } else {
          // glocke: a rough, honest shadow over the monster's region
          const big = PW.biggestHiddenRegion({
            size: st.size,
            ships: [{ size: BOSS.BOSS_SIZE, x: st.boss.x, y: st.boss.y, dir: st.boss.dir, hits: [] }],
          });
          if (big) SCENE.regionShadow("mine", big);
          SND.sparkle();
          status("🔔 Ein Schatten zeigt UNGEFÄHR, wo es gerade lauert!");
        }
      });
      return;
    }
  }

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
    // a banked Doppelschuss: the monster holds still for one more shot
    if (st.extraShots > 0) {
      st.extraShots -= 1;
      status("🎯 Gleich nochmal — das Monster wartet!");
      return;
    }
    huntMonsterTurn(st);
  } else {
    if (BOSS.bossRests(st)) {
      toast(`${bossName()} humpelt und bleibt stehen! 🩹`);
      S.inputLocked = false;
      bossHunterStatus(st.wounds.length, st.shotsLeft, "Es kann nicht fliehen —");
      return;
    }
    S.inputLocked = true;
    setTimeout(() => openMoveOverlay("boss"), FAST ? 50 : 900);
  }
}

// the hunt monster's turn: it stalks your fleet — and bites what it
// steps on. Every outcome is narrated so the danger stays readable.
function huntMonsterTurn(st) {
  const mv = BOSS.huntBossMove(st);
  if (!mv) return;
  if (mv.frozen) {
    status(`❄️ ${bossName()} ist festgefroren — es kann sich nicht rühren!`);
    return;
  }
  if (mv.rested) {
    status(`${bossName()} ruht sich aus — jetzt hast du es!`);
    return;
  }
  if (mv.stuck) {
    status(`${bossName()} ist eingeklemmt und bleibt stehen!`);
    return;
  }
  SND.whoosh();
  if (mv.bite) {
    const { ship, seg } = mv.bite;
    const name = getWorld(S.worlds[0]).creatures[ship.id % 5]?.name ?? "dein Freund";
    SND.growl();
    SCENE.kick(0.7);
    if (navigator.vibrate) navigator.vibrate([90, 40, 90]);
    SCENE.markWound("mine", ship.id, seg, ship.size);
    if (mv.allGone) {
      toast(`💔 ${name} ist verjagt — die Flotte ist weg!`, 2600);
      bossEnd(false);
      return;
    }
    if (mv.destroyed) {
      toast(`💥 ${name} wurde verjagt! Beschütze den Rest!`, 2600);
    } else {
      toast(`💔 Es hat ${name} gebissen! Finde es SCHNELL!`, 2400);
    }
    bossHunterStatus(st.wounds.length, 0);
    return;
  }
  if (mv.roar) bossRoar();
  bossHunterStatus(st.wounds.length, 0, "Es schleicht näher an deine Freunde …");
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

// same for the monster: show the whole beast (and its wounds) first
function bossEnd(hunterWon) {
  S.inputLocked = true;
  SCENE.clearInteraction();
  SND.growl();
  status(hunterWon ? `🎉 ${bossName()} ist besiegt!` : `${bossName()} stapft davon …`);
  setTimeout(() => bossEndNow(hunterWon), FAST ? 150 : 2600);
}

function bossEndNow(hunterWon) {
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
    const fleetGone = S.boss.st.hunt && BOSS.fleetAlive(S.boss.st) === 0;
    $("#win-title").textContent = hunterWon
      ? `${bossName()} besiegt!`
      : fleetGone
        ? `${bossName()} hat deine Flotte verjagt!`
        : `${bossName()} ist entkommen!`;
    $("#win-sub").textContent = hunterWon
      ? "Deine Freunde sind sicher — was für eine Jagd!"
      : fleetGone
        ? "Gleich nochmal — und diesmal beschützt du sie!"
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
  SCENE.setTapMode("mine", (x, y) => bossOnlineSeekTap(x, y));
  quarryIntro(
    centeredBossShip(S.boss.st),
    `So RIESIG ist das Monster: ${BOSS.BOSS_SIZE} Felder lang!`,
    true,
    () => {
      S.inputLocked = !S.boss.ready;
      if (S.boss.ready) bossHunterStatus(0, S.boss.shotsLeft);
      else status("Das Monster sucht sich einen Platz … 🙈");
    }
  );
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
  S.inputLocked = false; // a won battle may have left the lock on
  const worldId = S.worlds[0];
  applyUiWorld(worldId);

  // wins climb the difficulty ladder (the journey pins stage 1)
  const stageIdx = S.forcePuzzleStage ?? puzzleStageIndex(loadPuzzleWins());
  S.forcePuzzleStage = null;
  const stage = PUZZLE_STAGES[stageIdx];

  // deal a handful of boards and keep the one needing the FEWEST hints:
  // fewer givens = purer deduction, less "obvious"
  let deal = null;
  for (let i = 0; i < 4; i += 1) {
    const candidate = generatePuzzle(Math.random, { size: stage.grid, fleet: stage.fleet });
    if (!deal || candidate.hints.length < deal.hints.length) deal = candidate;
    if (deal.hints.length === 0) break;
  }
  const { board, rows, cols, hints } = deal;
  S.puzzle = { board, rows, cols, spades: stage.spades, stageIdx };
  S.boards = [board, null];

  SCENE.setupBoard("mine", worldId, { grid: stage.grid });
  SCENE.placeCreatures("mine", []); // everything stays hidden
  SCENE.setEdgeCounts("mine", rows, cols);
  // hints are WHISPERS now, not free shots: a "!" marks a cell where
  // someone surely hides — the child still digs it up themselves, so no
  // sunk-ring cascade solves the board at the start
  for (const h of hints) {
    SCENE.peekMarker("mine", h.x, h.y, true);
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
  if (stageIdx > 0) toast(`Knobel-Stufe ${stageIdx + 1}: mehr Freunde, weniger Schaufeln!`, 2600);
  else toast("Jede Zahl zählt die Freund-Felder in ihrer Reihe — bei 0 ist alles schon Wasser!", 3400);
  if (!FAST) {
    setTimeout(() => toast("Bei ! versteckt sich sicher jemand — ein Gratis-Anfang zum Knobeln!", 3000), 3800);
    setTimeout(() => toast("⭐⭐⭐ gibt es für höchstens 1 Fehlgrabung!", 2400), 7200);
  }
}

function puzzleStatus(prefix = "") {
  const lead = prefix ? `${prefix} ` : "";
  status(`${lead}Zahl am Rand = Freund-Felder in der Reihe. ${"⛏️".repeat(S.puzzle.spades)}`);
}

// dim satisfied row/col clues — and reveal the REST of a satisfied line
// as water for free: the deduction becomes visible, guessing pointless.
// (Rows with a 0 clear themselves at the start — instant aha moment.)
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
  const water = (x, y) => {
    const k = E.key(x, y);
    if (board.shots[k]) return;
    board.shots[k] = E.MISS;
    SCENE.applyShotQuiet("mine", x, y, "miss");
  };
  rows.forEach((n, y) => {
    if (foundRows[y] >= n) {
      SCENE.dimEdgeCount("mine", "rows", y);
      for (let x = 0; x < board.size; x += 1) water(x, y);
    }
  });
  cols.forEach((n, x) => {
    if (foundCols[x] >= n) {
      SCENE.dimEdgeCount("mine", "cols", x);
      for (let y = 0; y < board.size; y += 1) water(x, y);
    }
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

function loadPuzzleWins() {
  try {
    return parseInt(localStorage.getItem("ff-knobel-wins") || "0", 10) || 0;
  } catch {
    return 0;
  }
}

function puzzleEnd(won) {
  S.phase = "over";
  S.inputLocked = false;
  SCENE.clearInteraction();
  if (won && S.journey == null) {
    // free play climbs the ladder — the journey stays a training ground
    try {
      const wins = loadPuzzleWins() + 1;
      localStorage.setItem("ff-knobel-wins", String(wins));
      if (puzzleStageIndex(wins) > (S.puzzle.stageIdx ?? 0)) {
        setTimeout(
          () => toast(`🏆 Knobel-Stufe ${puzzleStageIndex(wins) + 1} freigeschaltet!`, 3200),
          FAST ? 100 : 1200
        );
      }
    } catch {
      /* private mode */
    }
  }
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
  clearSave();
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
// The Weltreise is a STORY: stop by stop it introduces the game's magic,
// one spell at a time — `teach` plants that spell in a chest that is
// visible from the first second, so the child digs it up on purpose and
// SEES what it does. Non-classic stops weave the minigames into the tale.
const JOURNEY = [
  {
    world: "ozean",
    type: "classic",
    rules: {},
    board: "flink",
    emoji: "🌊",
    label: "Die erste Suche",
    story:
      "Ein Sturm hat die Freunde in einer kleinen Bucht versteckt! Find sie, bevor Robo sie findet.",
  },
  {
    world: "ozean",
    type: "classic",
    rules: {},
    board: "flink",
    teach: "fernglas",
    emoji: "🔍",
    label: "Die glitzernde Truhe",
    story:
      "In der Truhe glitzert ein Fernglas — grab sie aus und schau heimlich unter ein Feld!",
  },
  {
    world: "teich",
    type: "classic",
    rules: { decoy: true },
    emoji: "🎈",
    label: "Das Ballon-Fest",
    story:
      "Ballon-Fest! Wer den Schwindel-Ballon trifft — PENG! — schenkt dem anderen einen Extra-Zug.",
  },
  {
    world: "weltraum",
    type: "classic",
    rules: {},
    teach: "doppel",
    emoji: "🎯",
    label: "Der Doppelstern",
    story:
      "Der Doppelstern schenkt dir ZWEI Schüsse auf einmal. Grab ihn aus!",
  },
  {
    world: "teich",
    type: "puzzle",
    emoji: "🧩",
    label: "Die Knobel-Insel",
    story:
      "Die Knobel-Insel! Die Zahlen am Rand verraten, wo die Freunde stecken.",
  },
  {
    world: "dino",
    type: "classic",
    rules: {},
    teach: "trommel",
    emoji: "🥁",
    label: "Trommeln im Dschungel",
    story:
      "Die Urwald-Trommel zeigt dir mit einem Pfeil den Weg. Trommel los!",
  },
  {
    world: "dino",
    type: "chase",
    emoji: "🙈",
    label: "Der freche Keksdieb",
    story:
      "Der Frechdachs hat die Kekse geklaut — schnapp ihn, bevor er entwischt!",
  },
  {
    world: "ozean",
    type: "classic",
    rules: {},
    board: "grossklein",
    teach: "glocke",
    emoji: "🔔",
    label: "Die singende Glocke",
    story:
      "Die Zauberglocke zeigt den Schatten des Größten — und diesmal lauert ein RIESIGER 2×2-Brocken!",
  },
  {
    world: "teich",
    type: "classic",
    rules: {},
    board: "grossklein",
    touch: true,
    teach: "klee",
    emoji: "🍀",
    label: "Das Glücksklee-Feld",
    story:
      "Glücksklee zeigt dir viermal die Entfernung — und die Freunde kuscheln diesmal GANZ eng zusammen!",
  },
  {
    world: "weltraum",
    type: "classic",
    rules: {},
    board: "riesig",
    teach: "zeit",
    emoji: "⏳",
    label: "Der Zeitkristall",
    story:
      "Der Zeitkristall schwebt über dem größten Meer der Reise — 10×10 Felder voller Verstecke!",
  },
  {
    world: "weltraum",
    type: "boss",
    emoji: "👑",
    label: "Das König-Monster",
    story:
      "Ein riesiges Monster stapft übers Feld — triff jeden Körperteil einmal!",
  },
  {
    world: "dino",
    type: "classic",
    rules: {},
    board: "riesig",
    touch: true,
    moreTreasures: true,
    teach: "schild",
    emoji: "🏆",
    label: "Die große Prüfung",
    story:
      "Die letzte Prüfung: das größte Meer, eng kuschelnde Freunde, überall Truhen — und Robo sucht richtig schlau!",
    robo: "schlau",
  },
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
  // every stop begins with its piece of the story, ACTED OUT: the hero
  // creature meets the stop's prop in a little animated vignette
  const prop =
    stop.teach ??
    (stop.type === "boss"
      ? "monster"
      : stop.type === "chase"
        ? "frido"
        : stop.type === "puzzle"
          ? "chest"
          : stop.rules?.decoy
            ? "decoy"
            : null);
  showPass({
    title: `${stop.emoji} Etappe ${i + 1}: ${stop.label}`,
    sub: stop.story,
    btn: "Los geht's!",
    vignette: { world: stop.world, prop },
    action: () => launchJourneyStop(i),
  });
}

function launchJourneyStop(i) {
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
    S.forceRoboLevel = stop.robo ?? "leicht"; // the journey stays kind (finale excepted)
    // each stop stages its own board: tiny seas first, wild waters last
    S.nextBoardOverride = {
      preset: stop.board ?? "klassisch",
      touch: !!stop.touch,
      moreTreasures: !!stop.moreTreasures,
    };
    // the teaching spell waits in a chest that is visible from the start
    S.nextTeachKind = stop.teach ?? null;
    S.powersOn = flag("powers") && !!stop.teach;
    S.cardsOn = false;
    startMode("ai");
  } else if (stop.type === "puzzle") {
    S.forcePuzzleStage = 0; // the journey teaches on the gentle board
    startPuzzle();
  } else if (stop.type === "chase") {
    startChase("ai");
  } else {
    startBoss("ai");
  }
  // the starters clear any stale journey state — claim it afterwards
  S.journey = { stop: i, nextStop: i };
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
  SCENE.setParkCreatures(
    S.aquarium.map((e) => ({ ...e, custom: loadCustom(e.worldId)[e.idx] ?? null }))
  );
}

// status line for the park view: overview vs. a focused pond
function parkStatus(pondIdx) {
  if (S.mode !== "aquarium") return;
  if (pondIdx == null) {
    status(
      S.aquarium.length
        ? `Funkel-Park: ${S.aquarium.length} ${S.aquarium.length === 1 ? "Freund" : "Freunde"} — tipp einen Teich an!`
        : "Der Funkel-Park ist noch leer! Gewinne Spiele und sammle Freunde."
    );
    return;
  }
  const world = getWorld(S.parkWorlds[pondIdx]);
  const n = S.aquarium.filter((e) => e.worldId === world.id).length;
  status(
    n
      ? `${world.name}: ${n} ${n === 1 ? "Freund" : "Freunde"} — antippen oder füttern!`
      : `${world.name}: Noch niemand hier — gewinne ${world.words.boardIn}!`
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

  // one big park: a themed pond per world, friends live in their own pond
  const worldIds = pickableWorldIds(flag("welten"));
  S.parkWorlds = worldIds;
  SCENE.setupPark(worldIds);

  const p = PROG.loadProgress();
  const list = [];
  for (const wid of worldIds) {
    WORLDS[wid].creatures.forEach((c, i) => {
      if (PROG.stickerCount(wid, i, p) > 0) {
        list.push({ key: `${wid}-${i}`, worldId: wid, idx: i, name: c.name });
      }
    });
  }
  S.aquarium = list;
  S.aquariumIdx = 0;
  refreshAquarium();
  SCENE.clearInteraction();
  SCENE.parkOverview({ immediate: true });
  // pond flights (taps AND pinch gestures) drive sound + status
  SCENE.onParkViewChange((pondIdx) => {
    parkStatus(pondIdx);
    SND.startAmbient(pondIdx == null ? "dino" : worldIds[pondIdx]);
  });

  S.aquariumTap = (hit) => {
    const focusedPond = SCENE.parkFocusedPond();
    if (hit.pond == null) {
      // meadow tap: from a pond, step back out to the overview
      if (focusedPond != null) {
        SND.whoosh();
        SCENE.parkOverview();
      }
      return;
    }
    if (hit.pond !== focusedPond) {
      // fly over to the tapped pond
      SND.tap();
      SCENE.focusPond(hit.pond);
      return;
    }
    // inside the focused pond: greet a friend …
    const key = SCENE.nearestParkKey(hit.px, hit.pz);
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
    // … or drop a snack; only THIS pond's friends come over
    const pondWorld = worldIds[hit.pond];
    if (!list.some((e) => e.worldId === pondWorld)) return;
    SND.plop();
    SCENE.dropFood("mine", hit.px, hit.pz);
    const fed = SCENE.lureNearest("mine", hit.px, hit.pz, (k) => k.startsWith(`${pondWorld}-`));
    const item = list.find((e) => e.key === fed);
    if (item) status(`🍪 ${item.name} hat den Snack entdeckt!`);
  };
  SCENE.setParkTap((hit) => S.aquariumTap(hit));
  SND.startAmbient("dino"); // meadow breeze + birds for the overview
  show(null);
  $("#btn-shuffle").hidden = true;
  $("#btn-opts").hidden = true;
  $("#btn-endturn").hidden = true;
  $("#btn-place-done").hidden = true;
  renderChips(0);
  parkStatus(null);
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

function goHome({ keepSave = false } = {}) {
  S.phase = "title";
  if (!keepSave) clearSave();
  SND.stopAmbient();
  stopFriendListener();
  if (S.reunite) {
    S.reunite.stop = true;
    for (const n of S.reunite.nets ?? []) n.destroy();
    S.reunite = null;
  }
  if (S.pendingInvite) answerInvite(false);
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
  S.moreTreasures = flag("powers") ? loadTreasuresOpt() : false;
  S.forceTreasureKind = null;
  S.treasureKind = null;
  const bo = loadBoardOpt();
  S.boardPreset = bo.preset;
  S.allowTouch = bo.touch;
  renderBoardPresets();
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
  maybeShowResume();
  renderTitleFriends();
  renderJourneyHero();
  startFriendListener();
  show("screen-title");
}

// ------------------------------------------------------------- resume
// A page refresh (or crash) must not kill a running battle: the full
// classic-game state is checkpointed continuously; online games
// reconnect over the stable friend ids afterwards.

const RESUME_KEY = "ff-resume";
const RESUME_MAX_AGE = 3 * 60 * 60 * 1000;

function saveGame() {
  if (S.phase !== "battle" || !["ai", "hotseat", "online"].includes(S.mode)) return;
  try {
    localStorage.setItem(
      RESUME_KEY,
      JSON.stringify({
        ts: Date.now(),
        mode: S.mode,
        gameMode: S.gameMode,
        isHost: S.isHost,
        worlds: S.worlds,
        rules: S.rules,
        boardPreset: S.boardPreset,
        allowTouch: S.allowTouch,
        powersOn: S.powersOn,
        cardsOn: S.cardsOn,
        turn: S.turn,
        viewer: S.viewer,
        extraTurn: S.extraTurn,
        boards: S.boards,
        shadow: S.shadow,
        powers: S.powers,
        customs: S.customs,
        oppCustom: S.oppCustom,
        oppTreasures: S.oppTreasures,
        oppPid: S.oppPid,
        lastShot: S.lastShot,
        sonarMap: S.sonarMap,
        ghostTrack: S.ghostTrack,
        aiState: S.aiState,
        journey: S.journey,
      })
    );
  } catch {
    /* storage full/private — resume is best effort */
  }
}

function clearSave() {
  try {
    localStorage.removeItem(RESUME_KEY);
  } catch {
    /* ignore */
  }
}

function loadSave() {
  try {
    const s = JSON.parse(localStorage.getItem(RESUME_KEY) || "null");
    if (!s || !s.boards?.[0] || Date.now() - (s.ts || 0) > RESUME_MAX_AGE) return null;
    return s;
  } catch {
    return null;
  }
}

function restoreSavedGame(saved) {
  S.mode = saved.mode;
  S.gameMode = saved.gameMode ?? "classic";
  S.isHost = !!saved.isHost;
  S.worlds = saved.worlds ?? ["ozean", "ozean"];
  S.rules = saved.rules ?? S.rules;
  S.boardPreset = BOARD_PRESETS[saved.boardPreset] ? saved.boardPreset : "klassisch";
  S.allowTouch = !!saved.allowTouch;
  S.powersOn = !!saved.powersOn;
  S.cardsOn = !!saved.cardsOn;
  S.turn = saved.turn ?? 0;
  S.viewer = saved.viewer ?? 0;
  S.extraTurn = saved.extraTurn ?? null;
  S.boards = saved.boards;
  S.shadow = saved.shadow ?? null;
  S.powers = saved.powers ?? [null, null];
  S.customs = saved.customs ?? [{}, {}];
  S.oppCustom = saved.oppCustom ?? null;
  S.oppTreasures = saved.oppTreasures ?? [];
  S.oppPid = saved.oppPid ?? null;
  S.lastShot = saved.lastShot ?? [null, null];
  S.sonarMap = saved.sonarMap ?? [{}, {}];
  S.ghostTrack = saved.ghostTrack ?? [
    { count: 0, queue: [] },
    { count: 0, queue: [] },
  ];
  S.aiState = saved.aiState ?? createAiState("leicht");
  S.journey = saved.journey ?? null;
  S.phase = "battle";
  syncRuleChips();
  applyUiWorld(S.worlds[S.mode === "hotseat" ? S.turn : 0]);
  SCENE.setupBoard("mine", S.worlds[0], { grid: S.boards[0]?.size ?? 8 });
  SCENE.setupBoard("enemy", S.worlds[1], {
    grid: S.boards[1]?.size ?? S.shadow?.size ?? 8,
  });
  SCENE.setCustomization("mine", customFor(0));
  SCENE.setCustomization("enemy", customFor(1));
  if (flag("powers") && S.powersOn) {
    SCENE.renderTreasures("mine", (S.boards[0]?.treasures ?? []).filter((t) => t.revealed));
    SCENE.renderTreasures("enemy", (treasureListFor(1) ?? []).filter((t) => t.revealed));
  }
  syncCreatureVisibility();
  replayMarks(0);
  replayMarks(1);
  show(null);
  $("#btn-shuffle").hidden = true;
  $("#btn-opts").hidden = true;
  $("#btn-place-done").hidden = true;
  $("#btn-endturn").hidden = true;
  renderPowers();
}

// the title-screen banner: an interrupted game is offered, not forced
function maybeShowResume() {
  const saved = loadSave();
  const box = $("#resume-banner");
  if (!saved) {
    box.hidden = true;
    return;
  }
  const label =
    saved.mode === "online"
      ? "Euer Zwei-Geräte-Spiel wartet noch!"
      : saved.mode === "hotseat"
        ? "Euer Spiel zu zweit wartet noch!"
        : "Dein Spiel gegen Robo wartet noch!";
  $("#resume-text").textContent = label;
  box.hidden = false;
}

function resumeSavedGame(saved) {
  restoreSavedGame(saved);
  if (S.mode === "online") {
    reconnectAfterRefresh();
  } else {
    S.inputLocked = false;
    beginTurn();
    if (S.mode === "ai" && S.turn === 1) scheduleRoboTurn();
    toast("▶️ Spiel fortgesetzt!", 2400);
  }
}

// how long both sides keep trying to find each other again
const RECONNECT_WINDOW = 120000;

// the resume pings that run once a fresh connection stands
function beginResumePings() {
  status("🔌 Verbinde wieder mit deinem Mitspieler …");
  let tries = 0;
  const ping = setInterval(() => {
    if (S.resumeOk || S.phase !== "battle" || !S.net) {
      clearInterval(ping);
      return;
    }
    tries += 1;
    if (tries > 15) {
      clearInterval(ping);
      toast("Dein Mitspieler ist gerade nicht erreichbar — probier es später nochmal!", 3600);
      goHome({ keepSave: true });
      return;
    }
    S.net.send({ t: "resume", pid: PID });
  }, 2000);
  S.net.send({ t: "resume", pid: PID });
}

// refresher side: hunt for the opponent on BOTH lanes — keep knocking
// on their stable id AND hold our own door open (they may have
// refreshed too, or their listener may reach us first)
function reconnectAfterRefresh() {
  status("🔌 Verbinde wieder mit deinem Mitspieler …");
  S.inputLocked = true;
  S.resumeOk = false;
  stopFriendListener(); // we manage the PID door ourselves for now
  const eng = { stop: false, nets: [], deadline: Date.now() + RECONNECT_WINDOW };
  S.reunite = eng;

  const cleanup = (keep = null) => {
    eng.stop = true;
    if (S.reunite === eng) S.reunite = null;
    for (const n of eng.nets) if (n !== keep) n.destroy();
    eng.nets = keep ? [keep] : [];
  };

  const adopt = (net, resumeMsg = null) => {
    if (eng.stop) return;
    cleanup(net);
    if (S.net && S.net !== net) S.net.destroy();
    S.net = net;
    wireNet();
    if (resumeMsg) handleNetMessage(resumeMsg);
    else beginResumePings();
  };

  const fail = () => {
    if (eng.stop) return;
    cleanup();
    toast("Dein Mitspieler ist gerade nicht erreichbar — probier es später nochmal!", 3600);
    goHome({ keepSave: true });
  };

  // active lane: knock on the opponent's door, again and again
  const joinLoop = () => {
    if (eng.stop) return;
    if (Date.now() > eng.deadline) {
      fail();
      return;
    }
    status("🔌 Verbinde wieder mit deinem Mitspieler …");
    const net = new Net();
    eng.nets.push(net);
    net.onMessage = () => {};
    net.onClose = () => {};
    net
      .join(S.oppPid)
      .then(() => adopt(net))
      .catch(() => {
        eng.nets = eng.nets.filter((n) => n !== net);
        net.destroy();
        if (!eng.stop) setTimeout(joinLoop, 4000);
      });
  };
  joinLoop();

  // passive lane: hold our own door open; if they connect here their
  // first resume ping identifies them
  const hostLoop = () => {
    if (eng.stop || Date.now() > eng.deadline) return;
    const net = new Net();
    eng.nets.push(net);
    net.onClose = () => {};
    net.onMessage = (m) => {
      if (m && m.t === "resume" && (!S.oppPid || m.pid === S.oppPid)) adopt(net, m);
    };
    net.host(PID).catch(() => {
      eng.nets = eng.nets.filter((n) => n !== net);
      net.destroy();
      if (!eng.stop) setTimeout(hostLoop, 8000);
    });
  };
  hostLoop();

  setTimeout(() => fail(), RECONNECT_WINDOW + 4000);
}

// survivor side: the line dropped mid-battle — hold the door open (with
// retries) until the opponent finds the way back
function enterReconnectWait() {
  status("🔌 Verbindung verloren — warte auf deinen Mitspieler …");
  S.inputLocked = true;
  SCENE.clearInteraction();
  if (S.net) {
    S.net.destroy();
    S.net = null;
  }
  stopFriendListener(); // free our stable id for the fresh listener
  const eng = { stop: false, deadline: Date.now() + RECONNECT_WINDOW };
  S.reunite = eng;

  const hostLoop = () => {
    if (eng.stop || Date.now() > eng.deadline) return;
    const net = new Net();
    eng.nets = [net];
    net.onMessage = (m) => handleNetMessage(m);
    net.onClose = () => {};
    net.onStatus = (st) => {
      if (st === "connected" && !eng.stop) {
        eng.stop = true;
        if (S.reunite === eng) S.reunite = null;
        S.net = net;
        wireNet();
      }
    };
    net.host(PID).catch(() => {
      net.destroy();
      if (!eng.stop) setTimeout(hostLoop, 6000);
    });
  };
  hostLoop();

  setTimeout(() => {
    if (eng.stop) return;
    eng.stop = true;
    if (S.reunite === eng) S.reunite = null;
    for (const n of eng.nets ?? []) n.destroy();
    toast("Dein Mitspieler ist gerade nicht erreichbar — probier es später nochmal!", 3600);
    goHome({ keepSave: true });
  }, RECONNECT_WINDOW);
}

// ------------------------------------------------------------- updates
// Poll the deployment stamp; when a new version ships, offer a one-tap
// refresh on the title screen (never interrupting a running game).
// The known version is PERSISTED: the usual flow is close app → new
// deploy → reopen, and a baseline that only lives for one session
// would adopt the new stamp silently and never show the banner.

let appVersion = null; // the version this device believes it is running
let latestVersion = null; // the newest stamp seen on the server
let updatePending = false;

function loadKnownVersion() {
  try {
    return localStorage.getItem("ff-version");
  } catch {
    return null;
  }
}

function storeKnownVersion(v) {
  try {
    localStorage.setItem("ff-version", v);
  } catch {
    /* private mode etc. */
  }
}

async function fetchVersion() {
  try {
    const res = await fetch(`version.json?t=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) return null;
    const j = await res.json();
    return j && j.v != null ? String(j.v) : null;
  } catch {
    return null; // offline or dev server without a build stamp
  }
}

async function checkForUpdate() {
  const v = await fetchVersion();
  if (!v) return false;
  latestVersion = v;
  if (appVersion === null) {
    const stored = loadKnownVersion();
    if (!stored) {
      // first ever run: whatever is live is what we just loaded
      appVersion = v;
      storeKnownVersion(v);
      return false;
    }
    appVersion = stored;
  }
  if (v !== appVersion) {
    updatePending = true;
    maybeShowUpdate();
    return true;
  }
  return false;
}

function maybeShowUpdate() {
  $("#update-banner").hidden = !(updatePending && S.phase === "title");
}

async function applyUpdate() {
  SND.tap();
  $("#update-banner").textContent = "✨ Wird aktualisiert …";
  // remember the version we are about to become, so the fresh boot
  // doesn't offer the same update again
  if (latestVersion) storeKnownVersion(latestVersion);
  // drop the offline cache so the reload really fetches the new build —
  // but NEVER let service-worker plumbing hold the reload hostage
  // (reg.update() can stall indefinitely): race it against a deadline
  const cleanup = (async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith("funkelflotte")).map((k) => caches.delete(k)));
    // fire and forget — the navigation triggers an SW update check anyway
    navigator.serviceWorker
      ?.getRegistration?.()
      .then((reg) => reg?.update?.())
      .catch(() => {});
  })().catch(() => {});
  await Promise.race([cleanup, new Promise((r) => setTimeout(r, 2500))]);
  window.location.reload();
}

// ------------------------------------------------------------------ boot

function boot() {
  SCENE.initScene($("#stage"));
  applyUiWorld("ozean");
  decorateIcons();
  renderJourneyHero();
  S.rules = flag("rules") ? loadRules() : { decoy: false, sonar: false, ghost: false };
  S.powersOn = flag("powers") ? loadPowersOpt() : false;
  S.cardsOn = flag("powers") ? loadCardsOpt() : false;
  const boardOpt = loadBoardOpt();
  S.boardPreset = boardOpt.preset;
  S.allowTouch = boardOpt.touch;
  renderBoardPresets();
  $("#rule-touch").checked = S.allowTouch;
  $("#rule-touch").addEventListener("change", (e) => {
    SND.unlock();
    SND.tap();
    S.allowTouch = e.target.checked;
    saveBoardOpt();
  });
  // feature flags hide whole option sections
  $("#sect-board").hidden = !flag("variety");
  $("#sect-zauber").hidden = !flag("powers");
  $("#sect-rules").hidden = !flag("rules");
  syncRuleChips();
  $("#opt-cards").checked = S.cardsOn;
  $("#opt-cards").addEventListener("change", (e) => {
    SND.unlock();
    SND.tap();
    S.cardsOn = e.target.checked;
    savePowersOpt();
  });
  S.moreTreasures = flag("powers") ? loadTreasuresOpt() : false;
  $("#opt-treasures").checked = S.moreTreasures;
  $("#opt-treasures").addEventListener("change", (e) => {
    SND.unlock();
    SND.tap();
    S.moreTreasures = e.target.checked;
    saveTreasuresOpt();
  });
  $("#opt-powers").checked = S.powersOn;
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
      const tags = [
        p.world ? `<span class="legend-world">(${getWorld(p.world).name})</span>` : "",
        p.cardsOnly ? '<span class="legend-world">(nur als 🃏 Karte)</span>' : "",
      ]
        .filter(Boolean)
        .join(" ");
      row.innerHTML = `<img class="legend-icon" alt="" src="${SCENE.powerIconUrl(kind)}" /><span class="legend-text"><b>${p.name}</b>${tags ? ` ${tags}` : ""}<br />${p.desc}</span>`;
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
    stopStoryVignette();
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

  // version polling: at boot, every 5 minutes, and when the app wakes up
  $("#update-banner").addEventListener("click", applyUpdate);
  checkForUpdate();
  setInterval(checkForUpdate, 5 * 60 * 1000);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) checkForUpdate();
  });
  // checkpoint the running game when the app is backgrounded or closed
  window.addEventListener("pagehide", saveGame);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) saveGame();
  });

  $("#btn-resume").addEventListener("click", () => {
    SND.unlock();
    SND.whoosh();
    $("#resume-banner").hidden = true;
    const saved = loadSave();
    if (!saved) {
      toast("Das Spiel ist leider nicht mehr da.", 2400);
      return;
    }
    resumeSavedGame(saved);
  });
  $("#btn-resume-discard").addEventListener("click", () => {
    SND.tap();
    clearSave();
    $("#resume-banner").hidden = true;
  });
  $("#invite-yes").addEventListener("click", () => {
    SND.tap();
    answerInvite(true);
  });
  $("#invite-no").addEventListener("click", () => {
    SND.tap();
    answerInvite(false);
  });
  // remembered friends: one tap from the title straight into a match,
  // and the stable-id door is open so THEIR tap flashes a popup here
  renderTitleFriends();
  startFriendListener();

  // an interrupted battle is offered back, never forced — the banner
  // wins over a stale ?join= deep link still sitting in the URL
  const savedGame = loadSave();
  maybeShowResume();

  // deep link: ?join=CODE — let the guest pick their world first
  const params = new URLSearchParams(window.location.search);
  const joinCode = normalizeCode(params.get("join"));
  if (!savedGame && joinCode.length === 4) {
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
    cellPos: (slot, x, y) => SCENE.cellScreenPos(slot, x, y, 0),
    ownTap: (x, y) => ownPowerTap(x, y),
    forceTreasure: (kind) => {
      S.forceTreasureKind = kind;
    },
    puzzleTap: (x, y) => puzzleTap(x, y),
    chaseTap: (x, y) => chaseSeekTap(x, y),
    chaseNetTap: (x, y) => chaseOnlineSeekTap(x, y),
    bossTap: (x, y) => bossSeekTap(x, y),
    bossNetTap: (x, y) => bossOnlineSeekTap(x, y),
    aquariumTap: (hit) => S.aquariumTap?.(hit),
    parkPos: (key) => SCENE.parkCreaturePos(key),
    parkFocused: () => SCENE.parkFocusedPond(),
    parkPonds: () => SCENE.parkPondCount(),
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
    checkUpdate: checkForUpdate,
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
