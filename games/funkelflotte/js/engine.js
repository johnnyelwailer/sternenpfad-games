// Funkel-Flotte game engine — pure logic, no DOM.
// A kid-friendly "Schiffe versenken" (battleship) where players find
// hidden creatures on a grid. Ships never touch each other (classic
// German no-touch rule), which lets us auto-reveal water around a
// fully found creature.

export const DEFAULT_GRID = 8;
export const DEFAULT_FLEET = [4, 3, 3, 2, 2];

export const MISS = "miss";
export const HIT = "hit";
export const SUNK = "sunk";
export const REPEAT = "repeat";
export const DECOY = "decoy"; // Schwindler rule: popped the bluff balloon

export function key(x, y) {
  return `${x},${y}`;
}

export function createBoard(size = DEFAULT_GRID) {
  return {
    size,
    ships: [],
    // shots: map "x,y" -> MISS | HIT (SUNK cells stay HIT here)
    shots: {},
  };
}

export function shipCells(ship) {
  const cells = [];
  for (let i = 0; i < ship.size; i += 1) {
    if (ship.dir === "h") cells.push({ x: ship.x + i, y: ship.y });
    else cells.push({ x: ship.x, y: ship.y + i });
  }
  return cells;
}

export function inBounds(board, x, y) {
  return x >= 0 && y >= 0 && x < board.size && y < board.size;
}

function cellsTouch(a, b) {
  return Math.abs(a.x - b.x) <= 1 && Math.abs(a.y - b.y) <= 1;
}

// Can `ship` be placed on `board`? Ships must be fully in bounds and
// must not touch any other ship, not even diagonally.
export function canPlace(board, ship, ignoreId = null) {
  const cells = shipCells(ship);
  for (const c of cells) {
    if (!inBounds(board, c.x, c.y)) return false;
  }
  for (const other of board.ships) {
    if (ignoreId !== null && other.id === ignoreId) continue;
    for (const oc of shipCells(other)) {
      for (const c of cells) {
        if (cellsTouch(c, oc)) return false;
      }
    }
  }
  // the decoy balloon counts as occupied space too (no-touch keeps the
  // auto-reveal around sunk creatures truthful)
  if (board.decoy) {
    for (const c of cells) {
      if (cellsTouch(c, board.decoy)) return false;
    }
  }
  return true;
}

// ------------------------------------------------------- decoy (Schwindler)

export function canPlaceDecoy(board, x, y) {
  if (!inBounds(board, x, y)) return false;
  for (const s of board.ships) {
    for (const c of shipCells(s)) {
      if (cellsTouch({ x, y }, c)) return false;
    }
  }
  return true;
}

export function placeDecoy(board, x, y) {
  if (!canPlaceDecoy(board, x, y)) return false;
  board.decoy = { x, y };
  return true;
}

export function randomDecoy(board, rng = Math.random) {
  for (let tries = 0; tries < 400; tries += 1) {
    const x = Math.floor(rng() * board.size);
    const y = Math.floor(rng() * board.size);
    if (placeDecoy(board, x, y)) return true;
  }
  return false;
}

export function placeShip(board, ship) {
  if (!canPlace(board, ship, ship.id)) return false;
  const existing = board.ships.findIndex((s) => s.id === ship.id);
  const stored = { ...ship, hits: [] };
  if (existing >= 0) {
    stored.hits = board.ships[existing].hits;
    board.ships[existing] = stored;
  } else {
    board.ships.push(stored);
  }
  return true;
}

export function moveShip(board, id, x, y, dir) {
  const ship = board.ships.find((s) => s.id === id);
  if (!ship) return false;
  const candidate = { ...ship, x, y, dir };
  if (!canPlace(board, candidate, id)) return false;
  ship.x = x;
  ship.y = y;
  ship.dir = dir;
  return true;
}

// Fill the board with a random valid fleet. Returns true on success.
export function randomFleet(board, fleet = DEFAULT_FLEET, rng = Math.random) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    board.ships = [];
    let ok = true;
    for (let i = 0; i < fleet.length; i += 1) {
      const size = fleet[i];
      let placed = false;
      for (let tries = 0; tries < 200 && !placed; tries += 1) {
        const dir = rng() < 0.5 ? "h" : "v";
        const maxX = board.size - (dir === "h" ? size : 1);
        const maxY = board.size - (dir === "v" ? size : 1);
        const ship = {
          id: i,
          size,
          x: Math.floor(rng() * (maxX + 1)),
          y: Math.floor(rng() * (maxY + 1)),
          dir,
        };
        placed = placeShip(board, ship);
      }
      if (!placed) {
        ok = false;
        break;
      }
    }
    if (ok) return true;
  }
  return false;
}

export function shipAt(board, x, y) {
  for (const ship of board.ships) {
    for (const c of shipCells(ship)) {
      if (c.x === x && c.y === y) return ship;
    }
  }
  return null;
}

export function isSunk(ship) {
  return ship.hits.length >= ship.size;
}

export function allSunk(board) {
  return board.ships.length > 0 && board.ships.every(isSunk);
}

// Cells around a ship (used to auto-reveal water once a creature is
// fully found — possible because ships never touch).
export function surroundCells(board, ship) {
  const cells = new Set(shipCells(ship).map((c) => key(c.x, c.y)));
  const out = [];
  for (const c of shipCells(ship)) {
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        const x = c.x + dx;
        const y = c.y + dy;
        if (!inBounds(board, x, y)) continue;
        if (cells.has(key(x, y))) continue;
        if (out.some((o) => o.x === x && o.y === y)) continue;
        out.push({ x, y });
      }
    }
  }
  return out;
}

// Fire at a cell. Mutates the board's shot map (and the hit ship).
// Returns { result, ship, revealed, gameOver }.
//  - revealed: auto-revealed water cells when a creature was sunk
export function fire(board, x, y) {
  if (!inBounds(board, x, y)) return { result: REPEAT, ship: null, revealed: [], gameOver: false };
  const k = key(x, y);
  if (board.shots[k]) return { result: REPEAT, ship: null, revealed: [], gameOver: false };

  if (board.decoy && board.decoy.x === x && board.decoy.y === y) {
    board.shots[k] = DECOY;
    return { result: DECOY, ship: null, revealed: [], gameOver: false };
  }

  const ship = shipAt(board, x, y);
  if (!ship) {
    board.shots[k] = MISS;
    return { result: MISS, ship: null, revealed: [], gameOver: false };
  }

  board.shots[k] = HIT;
  if (!ship.hits.some((h) => h.x === x && h.y === y)) {
    ship.hits.push({ x, y });
  }

  if (isSunk(ship)) {
    const revealed = [];
    for (const c of surroundCells(board, ship)) {
      const ck = key(c.x, c.y);
      if (!board.shots[ck]) {
        board.shots[ck] = MISS;
        revealed.push(c);
      }
    }
    return { result: SUNK, ship, revealed, gameOver: allSunk(board) };
  }
  return { result: HIT, ship, revealed: [], gameOver: false };
}

// -------------------------------------------------- sonar (Delfin-Sonar)

// Chebyshev distance from (x,y) to the nearest not-yet-found creature.
// 0 would be a hit, so callers only need this for misses.
export function sonarDistance(board, x, y) {
  let best = null;
  for (const ship of board.ships) {
    if (isSunk(ship)) continue;
    for (const c of shipCells(ship)) {
      const d = Math.max(Math.abs(c.x - x), Math.abs(c.y - y));
      if (best === null || d < best) best = d;
    }
  }
  return best;
}

// ------------------------------------------------ ghost (Geisterstunde)

// Forget a miss mark so the cell becomes shootable again. Hits and the
// popped decoy stay — only water knowledge fades.
export function forgetShot(board, x, y) {
  const k = key(x, y);
  if (board.shots[k] === MISS) {
    delete board.shots[k];
    return true;
  }
  return false;
}

// Serialize only what the opponent may know at game end (fair-play reveal).
export function serializeShips(board) {
  return board.ships.map((s) => ({ id: s.id, size: s.size, x: s.x, y: s.y, dir: s.dir }));
}

export function totalShipCells(fleet = DEFAULT_FLEET) {
  return fleet.reduce((a, b) => a + b, 0);
}
