// Zauber-Kräfte (special abilities) for the classic battle mode.
// Pure logic + catalog — no DOM. Powers are earned three ways:
//   💎 hidden treasure cells, ⚡ every 4th turn, 🌍 world signature.

import * as E from "./engine.js";

export const HAND_MAX = 2; // powers stay scarce and precious
export const TREASURES_PER_BOARD = 1; // one visible chest per board
export const RECHARGE_EVERY = 6; // own turns between free powers
export const CLOVER_USES = 4; // misses that show a distance number

// target: what a power needs before it fires
//   none  — instant | cell — one enemy cell | row — one enemy row
//   cell3 — an enemy cell, hits it + its two right neighbours
export const POWERS = {
  welle: {
    emoji: "🌊",
    name: "Große Welle",
    target: "row",
    world: "ozean",
    desc: "Eine Riesenwelle rollt über eine Reihe und verrät alle Verstecke darin — ganz ohne Schuss.",
    use: "Tipp eine Reihe an — die Welle verrät alle Verstecke darin.",
  },
  radar: {
    emoji: "🛰️",
    name: "Sternen-Radar",
    target: "cell",
    world: "weltraum",
    desc: "Dein Satellit durchleuchtet ein 2×2-Feld und zeigt, wo sich jemand versteckt.",
    use: "Tipp ein Feld an — das Radar durchleuchtet 2×2 Felder.",
  },
  trommel: {
    emoji: "🥁",
    name: "Urwald-Trommel",
    target: "cell",
    world: "dino",
    desc: "Trommle auf ein Feld: Ein Pfeil zeigt von dort zum nächsten versteckten Freund.",
    use: "Tipp ein Feld an — ein Pfeil zeigt zum nächsten Freund.",
  },
  schild: {
    emoji: "🪷",
    name: "Seerosen-Schild",
    target: "none",
    world: "teich",
    desc: "Der nächste Treffer auf deine Freunde prallt einfach ab. Das Feld bleibt geheim!",
    use: "Wirkt von allein: Der nächste Treffer prallt einfach ab.",
  },
  fernglas: {
    emoji: "🔍",
    name: "Fernglas",
    target: "cell",
    desc: "Schau heimlich unter ein Feld, ohne zu schießen.",
    use: "Tipp ein Feld an und schau heimlich darunter.",
  },
  doppel: {
    emoji: "🎯",
    name: "Doppelschuss",
    target: "none",
    desc: "Doppeltes Suchglück: Dein nächstes Daneben beendet deinen Zug nicht. Aus der Schatztruhe heißt das — sofort zwei Schüsse!",
    use: "Du darfst gleich ZWEIMAL suchen!",
  },
  zeit: {
    emoji: "⏳",
    name: "Zeitzauber",
    target: "none",
    desc: "Schenkt dir einen Extra-Zug: Nach deinem nächsten Daneben suchst du einfach weiter.",
    use: "Nach deinem nächsten Daneben suchst du einfach weiter.",
  },
  wirbel: {
    emoji: "🌪️",
    name: "Wirbelwind",
    target: "own",
    cardsOnly: true,
    desc: "Tipp einen deiner Freunde an — der Wirbelwind trägt ihn an ein neues Versteck. Sogar Verletzte fliehen, und die Treffer des Gegners verschwinden dabei!",
    use: "Tipp deinen Freund an — er flieht mitsamt seinen Wunden.",
  },
  ballon: {
    emoji: "🎈",
    name: "Extra-Ballon",
    target: "none",
    cardsOnly: true,
    desc: "Versteck einen neuen Schwindel-Ballon auf deinem Brett. Peng!",
    use: "Versteckt sofort einen neuen Schwindel-Ballon bei dir.",
  },
  kompass: {
    emoji: "🧭",
    name: "Magnet-Kompass",
    target: "none",
    desc: "Ein Zauberpfeil zeigt von deinem letzten Schuss zum nächsten Versteck.",
    use: "Wirkt sofort: Der Pfeil zeigt vom letzten Schuss zum nächsten Versteck.",
  },
  glocke: {
    emoji: "🔔",
    name: "Zauberglocke",
    target: "none",
    desc: "Die Glocke flüstert dir zu, ob der größte versteckte Freund quer oder hochkant liegt.",
    use: "Wirkt sofort: Die Glocke verrät, wie der größte Freund liegt.",
  },
  klee: {
    emoji: "🍀",
    name: "Glücksklee",
    target: "none",
    desc: "Glück für eine Weile: Deine nächsten 4 Daneben zeigen, wie weit der nächste Freund entfernt ist.",
    use: "Deine nächsten 4 Daneben zeigen die Entfernung.",
  },
  salve: {
    emoji: "⭐",
    name: "Sternschnuppen-Salve",
    target: "cell3",
    cardsOnly: true,
    desc: "Drei Sternschnuppen sausen auf drei Felder nebeneinander! Danach ist der andere dran.",
    use: "Tipp ein Feld an — drei Sternschnuppen sausen los.",
  },
};

// random pool for treasures/recharges — world powers are start gifts,
// stronger powers appear less often
const POOL = [
  "fernglas",
  "fernglas",
  "fernglas",
  "doppel",
  "doppel",
  "doppel",
  "kompass",
  "kompass",
  "kompass",
  "glocke",
  "glocke",
  "wirbel",
  "wirbel",
  "ballon",
  "ballon",
  "zeit",
  "klee",
  "salve",
  "schild",
];

export function worldPower(worldId) {
  return { ozean: "welle", weltraum: "radar", dino: "trommel", teich: "schild" }[worldId] ?? "fernglas";
}

export function drawPower(rng = Math.random, hand = [], { instant = false } = {}) {
  let pool = hand.includes("klee") ? POOL.filter((k) => k !== "klee") : POOL;
  // treasures auto-fire their power on the spot — spells marked
  // cardsOnly can't show themselves off there (the salvo grants extra
  // shots, the balloon hides itself immediately) and only ever come
  // from card recharges
  if (instant) pool = pool.filter((k) => !POWERS[k].cardsOnly);
  return pool[Math.floor(rng() * pool.length)];
}

// `cards: true` starts the hand with the world's signature card — the
// on-demand card system is an opt-in extra; by default powers only
// come out of treasures and cast themselves
export function newPowerState(worldId, { cards = false } = {}) {
  return {
    hand: cards ? [worldPower(worldId)] : [],
    shield: false, // set when "schild" is activated, eaten by next hit
    clover: 0, // remaining misses that show a distance (Glücksklee)
    doubleShot: false, // one forgiven miss — keeps until it fires
    turns: 0, // own turns taken (for recharges)
  };
}

// ------------------------------------------------------------ treasures

export function seedTreasures(board, count = TREASURES_PER_BOARD, rng = Math.random) {
  board.treasures = [];
  const occupied = new Set();
  for (const s of board.ships) for (const c of E.shipCells(s)) occupied.add(E.key(c.x, c.y));
  if (board.decoy) occupied.add(E.key(board.decoy.x, board.decoy.y));
  for (let tries = 0; tries < 500 && board.treasures.length < count; tries += 1) {
    const x = Math.floor(rng() * board.size);
    const y = Math.floor(rng() * board.size);
    const k = E.key(x, y);
    if (occupied.has(k)) continue;
    occupied.add(k);
    board.treasures.push({ x, y });
  }
  return board.treasures.length;
}

export function treasureAt(board, x, y) {
  return (board.treasures ?? []).some((t) => t.x === x && t.y === y);
}

// Chests start buried: they surface when a shot lands right next to
// them, or once the board has seen enough shots. Works on either a
// real board's shots or the shooter's shadow marks. Returns the
// treasures that JUST surfaced.
export const TREASURE_REVEAL_SHOTS = 6;

export function revealTreasures(treasures, marks, x = null, y = null) {
  const out = [];
  const shots = Object.keys(marks ?? {}).length;
  for (const t of treasures ?? []) {
    if (t.revealed) continue;
    const near = x != null && Math.max(Math.abs(t.x - x), Math.abs(t.y - y)) <= 1;
    if (near || shots >= TREASURE_REVEAL_SHOTS) {
      t.revealed = true;
      out.push(t);
    }
  }
  return out;
}

// ------------------------------------------------------ info helpers
// (computed on the DEFENDER's board — online they answer over the wire)

export function scanCells(board, cells) {
  return cells.map((c) => ({ ...c, ship: !!E.shipAt(board, c.x, c.y) }));
}

export function rowCells(board, y) {
  const out = [];
  for (let x = 0; x < board.size; x += 1) out.push({ x, y });
  return out;
}

export function squareCells(board, x, y) {
  const out = [];
  for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
    const cx = Math.min(board.size - 1, Math.max(0, x + dx));
    const cy = Math.min(board.size - 1, Math.max(0, y + dy));
    if (!out.some((c) => c.x === cx && c.y === cy)) out.push({ x: cx, y: cy });
  }
  return out;
}

export function salvoCells(board, x, y) {
  const out = [];
  for (let i = 0; i < 3; i += 1) {
    const cx = Math.min(board.size - 1, x + i);
    if (!out.some((c) => c.x === cx)) out.push({ x: cx, y });
  }
  return out;
}

// angle (radians, board space: +x right, +y down) from a cell toward
// the nearest cell of a not-yet-found creature; null if none left
export function directionToNearest(board, x, y) {
  let best = null;
  let bestD = Infinity;
  for (const ship of board.ships) {
    if (E.isSunk(ship)) continue;
    for (const c of E.shipCells(ship)) {
      const d = Math.max(Math.abs(c.x - x), Math.abs(c.y - y));
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
  }
  if (!best) return null;
  return { angle: Math.atan2(best.y - y, best.x - x), dist: bestD };
}

// orientation of the largest not-yet-found creature ("h" | "v" | null)
export function biggestHiddenDir(board) {
  let best = null;
  for (const ship of board.ships) {
    if (E.isSunk(ship)) continue;
    if (!best || ship.size > best.size) best = ship;
  }
  return best ? best.dir : null;
}

// Wirbelwind: move a not-yet-sunk creature (the chosen one, or a random
// one) to a fresh legal spot whose cells were never shot at (marks must
// stay truthful). Wounds travel along: the wounded segments stay
// wounded at the new place, and the enemy's HIT marks on the old cells
// are wiped — all they learn is that the creature escaped.
// Returns { ship, cleared } (cleared = the wiped mark cells) or null.
export function whirlwindMove(board, rng = Math.random, shipId = null) {
  let candidates = board.ships.filter((s) => !E.isSunk(s));
  if (shipId !== null) candidates = candidates.filter((s) => s.id === shipId);
  if (!candidates.length) return null;
  const ship = candidates[Math.floor(rng() * candidates.length)];
  // remember which SEGMENTS are wounded (relative to the ship origin)
  const oldCells = E.shipCells(ship);
  const woundedIdx = ship.hits
    .map((h) => oldCells.findIndex((c) => c.x === h.x && c.y === h.y))
    .filter((i) => i >= 0);
  for (let tries = 0; tries < 300; tries += 1) {
    const dir = rng() < 0.5 ? "h" : "v";
    const w = ship.shape === "sq" ? 2 : dir === "h" ? ship.size : 1;
    const h = ship.shape === "sq" ? 2 : dir === "v" ? ship.size : 1;
    const maxX = board.size - w;
    const maxY = board.size - h;
    const x = Math.floor(rng() * (maxX + 1));
    const y = Math.floor(rng() * (maxY + 1));
    if (x === ship.x && y === ship.y && dir === ship.dir) continue;
    const candidate = { ...ship, x, y, dir };
    if (!E.canPlace(board, candidate, ship.id)) continue;
    const cells = E.shipCells(candidate);
    if (cells.some((c) => board.shots[E.key(c.x, c.y)])) continue;
    if ((board.treasures ?? []).some((t) => cells.some((c) => c.x === t.x && c.y === t.y))) continue;
    // wipe the enemy's HIT marks on the abandoned cells
    const cleared = [];
    for (const hc of ship.hits) {
      const k = E.key(hc.x, hc.y);
      if (board.shots[k] === E.HIT) {
        delete board.shots[k];
        cleared.push({ x: hc.x, y: hc.y });
      }
    }
    ship.x = x;
    ship.y = y;
    ship.dir = dir;
    // the same segments stay wounded at the new address
    ship.hits = woundedIdx.map((i) => ({ x: cells[i].x, y: cells[i].y }));
    return { ship, cleared };
  }
  return null;
}

// Extra-Ballon: usable when no live balloon is on the board; the new
// balloon must sit on an unshot, treasure-free cell
export function canExtraBalloon(board) {
  if (!board.decoy) return true;
  return board.shots[E.key(board.decoy.x, board.decoy.y)] === E.DECOY;
}

export function extraBalloon(board, rng = Math.random) {
  if (!canExtraBalloon(board)) return false;
  for (let tries = 0; tries < 300; tries += 1) {
    const x = Math.floor(rng() * board.size);
    const y = Math.floor(rng() * board.size);
    if (board.shots[E.key(x, y)]) continue;
    if ((board.treasures ?? []).some((t) => t.x === x && t.y === y)) continue;
    if (!E.canPlaceDecoy(board, x, y)) continue;
    board.decoy = { x, y };
    return true;
  }
  return false;
}
