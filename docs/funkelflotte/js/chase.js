// Fang-mich (chase) mode: one sneaky creature secretly moves one cell
// after every missed shot; the seeker has a shot budget and distance
// clues. Pure logic — no DOM. The full state lives with the HIDER
// (locally, or on the hider's device online); the seeker only ever
// sees marks and distances.

import { key } from "./engine.js";

export const CHASE_SHOTS = 12;
export const CHASE_FADE = 3; // distance marks fade after this many shots

export function createChase(rng = Math.random, { size = 8, shots = CHASE_SHOTS } = {}) {
  return {
    size,
    frido: { x: Math.floor(rng() * size), y: Math.floor(rng() * size) },
    shotsLeft: shots,
    shotCount: 0,
    marks: {}, // "x,y" -> { dist, at }
    caught: false,
  };
}

export function inChase(st, x, y) {
  return x >= 0 && y >= 0 && x < st.size && y < st.size;
}

export function placeFrido(st, x, y) {
  if (!inChase(st, x, y)) return false;
  st.frido = { x, y };
  return true;
}

// One seeker shot. Distance is measured BEFORE any move, so the clue
// is always truthful for the moment of the shot.
export function chaseShoot(st, x, y) {
  if (st.caught || st.shotsLeft <= 0 || !inChase(st, x, y)) return { result: "over" };
  st.shotCount += 1;
  st.shotsLeft -= 1;
  const dist = Math.max(Math.abs(st.frido.x - x), Math.abs(st.frido.y - y));
  if (dist === 0) {
    st.caught = true;
    return { result: "caught", dist: 0, faded: [], escaped: false };
  }
  st.marks[key(x, y)] = { dist, at: st.shotCount };
  const faded = [];
  for (const [k, m] of Object.entries(st.marks)) {
    if (st.shotCount - m.at >= CHASE_FADE) {
      delete st.marks[k];
      faded.push(k);
    }
  }
  return { result: "miss", dist, faded, escaped: st.shotsLeft === 0 };
}

// Frido may not stop on a currently marked cell (the seeker's fresh
// clues stay truthful that way) — marked cells fade, so hiding spots
// keep opening up again.
export function legalMoves(st) {
  const out = [];
  for (const [dx, dy] of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ]) {
    const x = st.frido.x + dx;
    const y = st.frido.y + dy;
    if (inChase(st, x, y) && !st.marks[key(x, y)]) out.push({ x, y, dx, dy });
  }
  return out;
}

export function moveFrido(st, dx, dy) {
  const x = st.frido.x + dx;
  const y = st.frido.y + dy;
  if (!inChase(st, x, y) || st.marks[key(x, y)]) return false;
  st.frido = { x, y };
  return true;
}

// robo hider: mostly flees from the last shot, sometimes zigzags
export function roboMove(st, lastShot, rng = Math.random) {
  const moves = legalMoves(st);
  if (!moves.length) return null; // cornered — stays put this round
  let pick;
  if (lastShot && rng() < 0.75) {
    let bestD = -1;
    for (const m of moves) {
      const d =
        Math.max(Math.abs(m.x - lastShot.x), Math.abs(m.y - lastShot.y)) + rng() * 0.4;
      if (d > bestD) {
        bestD = d;
        pick = m;
      }
    }
  } else {
    pick = moves[Math.floor(rng() * moves.length)];
  }
  st.frido = { x: pick.x, y: pick.y };
  return pick;
}
