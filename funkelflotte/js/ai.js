// Robo opponent for Funkel-Flotte. Hunt/target strategy, tuned to be
// beatable by a 7-year-old: in "leicht" mode it shoots mostly randomly,
// in "schlau" mode it hunts with parity and finishes creatures it found.

import { key, inBounds } from "./engine.js";

export function createAiState(difficulty = "leicht") {
  return {
    difficulty,
    // hit cells that belong to a not-yet-sunk creature
    openHits: [],
  };
}

export function noteResult(state, x, y, result, sunkShipCells = null) {
  if (result === "hit") {
    state.openHits.push({ x, y });
  } else if (result === "sunk") {
    state.openHits.push({ x, y });
    if (sunkShipCells) {
      state.openHits = state.openHits.filter(
        (h) => !sunkShipCells.some((c) => c.x === h.x && c.y === h.y)
      );
    } else {
      state.openHits = [];
    }
  }
}

function unshot(board, shots, x, y) {
  return inBounds(board, x, y) && !shots[key(x, y)];
}

function targetCandidates(board, shots, openHits) {
  const out = [];
  if (openHits.length >= 2) {
    // Extend the line of hits in both directions.
    const sorted = [...openHits].sort((a, b) => a.x - b.x || a.y - b.y);
    const horizontal = sorted.every((h) => h.y === sorted[0].y);
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    if (horizontal) {
      out.push({ x: first.x - 1, y: first.y }, { x: last.x + 1, y: last.y });
    } else {
      out.push({ x: first.x, y: first.y - 1 }, { x: last.x, y: last.y + 1 });
    }
  }
  if (out.filter((c) => unshot(board, shots, c.x, c.y)).length === 0) {
    for (const h of openHits) {
      out.push(
        { x: h.x - 1, y: h.y },
        { x: h.x + 1, y: h.y },
        { x: h.x, y: h.y - 1 },
        { x: h.x, y: h.y + 1 }
      );
    }
  }
  return out.filter((c) => unshot(board, shots, c.x, c.y));
}

// Pick the next shot for the AI. `board` is the human player's board
// (only size + shots are read — the AI never peeks at ship positions).
export function nextShot(state, board, rng = Math.random) {
  const shots = board.shots;

  if (state.openHits.length > 0) {
    const targets = targetCandidates(board, shots, state.openHits);
    if (targets.length > 0) {
      return targets[Math.floor(rng() * targets.length)];
    }
  }

  const all = [];
  const parity = [];
  for (let y = 0; y < board.size; y += 1) {
    for (let x = 0; x < board.size; x += 1) {
      if (shots[key(x, y)]) continue;
      all.push({ x, y });
      if ((x + y) % 2 === 0) parity.push({ x, y });
    }
  }
  if (all.length === 0) return null;

  if (state.difficulty === "schlau" && parity.length > 0 && rng() < 0.8) {
    return parity[Math.floor(rng() * parity.length)];
  }
  return all[Math.floor(rng() * all.length)];
}
