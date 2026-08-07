// Knobel-Insel: battleship-solitaire puzzles. A hidden mini fleet, the
// row/column counts as clues, and just enough revealed hint cells that
// exactly ONE layout fits. Pure logic — no DOM.

import * as E from "./engine.js";

export const PUZZLE_FLEET = [3, 3, 2];
export const PUZZLE_SPADES = 6; // wrong digs allowed before the retry screen

// difficulty ladder: wins unlock denser fleets (a sneaky single-cell
// friend the counts can barely pin down!) and finally a 10×10 board
export const PUZZLE_STAGES = [
  { grid: 8, fleet: [3, 3, 2], spades: 6 },
  { grid: 8, fleet: [4, 3, 2, 2, 1], spades: 5 },
  { grid: 10, fleet: [4, 3, 3, 2, 2, 1], spades: 5 },
];

export function puzzleStage(wins) {
  return PUZZLE_STAGES[wins >= 6 ? 2 : wins >= 2 ? 1 : 0];
}

export function puzzleStageIndex(wins) {
  return wins >= 6 ? 2 : wins >= 2 ? 1 : 0;
}

export function computeCounts(board) {
  const rows = Array(board.size).fill(0);
  const cols = Array(board.size).fill(0);
  for (const s of board.ships) {
    for (const c of E.shipCells(s)) {
      rows[c.y] += 1;
      cols[c.x] += 1;
    }
  }
  return { rows, cols };
}

function allPlacements(size, len) {
  const out = [];
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x <= size - len; x += 1) out.push({ x, y, dir: "h", size: len });
  }
  if (len === 1) return out; // a 1-cell ship has no orientation — no h/v twins
  for (let x = 0; x < size; x += 1) {
    for (let y = 0; y <= size - len; y += 1) out.push({ x, y, dir: "v", size: len });
  }
  return out;
}

// Count layouts of `fleet` consistent with the counts and constraints
// (map "x,y" -> "ship" | "water"). Stops early at `limit`. Equal-sized
// ships are placed in canonical order so permutations never double-count.
export function countSolutions(size, fleet, rows, cols, constraints = {}, limit = 2) {
  const placements = fleet.map((len) => allPlacements(size, len));
  const board = { size, ships: [] };
  const rcount = Array(size).fill(0);
  const ccount = Array(size).fill(0);
  const occupied = new Set();
  let found = 0;

  const rec = (i, minIdx) => {
    if (found >= limit) return;
    if (i === fleet.length) {
      for (let k = 0; k < size; k += 1) {
        if (rcount[k] !== rows[k] || ccount[k] !== cols[k]) return;
      }
      for (const [k, v] of Object.entries(constraints)) {
        if (v === "ship" && !occupied.has(k)) return;
      }
      found += 1;
      return;
    }
    const start = i > 0 && fleet[i] === fleet[i - 1] ? minIdx : 0;
    for (let p = start; p < placements[i].length; p += 1) {
      const ship = { ...placements[i][p], id: i };
      if (!E.canPlace(board, ship, ship.id)) continue;
      const cells = E.shipCells(ship);
      let ok = true;
      for (const c of cells) {
        const k = E.key(c.x, c.y);
        if (constraints[k] === "water" || rcount[c.y] + 1 > rows[c.y] || ccount[c.x] + 1 > cols[c.x]) {
          ok = false;
          break;
        }
        rcount[c.y] += 1;
        ccount[c.x] += 1;
        occupied.add(k);
      }
      if (ok) {
        board.ships.push({ ...ship, hits: [] });
        rec(i + 1, p + 1);
        board.ships.pop();
      }
      // roll back whatever this placement applied; cells it could not
      // apply (failure midway) are simply not in `occupied` — layouts
      // never overlap, so membership means "added right here"
      for (const c of cells) {
        const k = E.key(c.x, c.y);
        if (!occupied.has(k)) continue;
        rcount[c.y] -= 1;
        ccount[c.x] -= 1;
        occupied.delete(k);
      }
    }
  };
  rec(0, 0);
  return found;
}

// Build a puzzle: hidden fleet + counts + hint cells until the layout
// is provably unique.
export function generatePuzzle(rng = Math.random, { size = 8, fleet = PUZZLE_FLEET } = {}) {
  const board = E.createBoard(size);
  E.randomFleet(board, fleet, rng);
  const { rows, cols } = computeCounts(board);
  const shipCellsAll = board.ships.flatMap((s) => E.shipCells(s));
  const constraints = {};

  let guard = 0;
  while (countSolutions(size, fleet, rows, cols, constraints) > 1 && guard < shipCellsAll.length) {
    guard += 1;
    const open = shipCellsAll.filter((c) => !constraints[E.key(c.x, c.y)]);
    if (!open.length) break;
    const c = open[Math.floor(rng() * open.length)];
    constraints[E.key(c.x, c.y)] = "ship";
  }

  const hints = Object.entries(constraints).map(([k, type]) => {
    const [x, y] = k.split(",").map(Number);
    return { x, y, type };
  });
  return { board, rows, cols, hints };
}
