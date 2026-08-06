// Monster gegen Flotte: one huge 5-cell monster prowls the board while
// the hunter tries to land five wounds with a limited shot budget and
// distance clues. Wounds belong to the monster's BODY segments, so
// they travel along when it moves. Pure logic — the full state lives
// with the monster's owner.

import { key } from "./engine.js";

export const BOSS_SHOTS = 18;
export const BOSS_SIZE = 5;
export const BOSS_FADE = 3; // distance marks fade after this many shots

export function bossCells(st) {
  const out = [];
  for (let i = 0; i < BOSS_SIZE; i += 1) {
    if (st.boss.dir === "h") out.push({ x: st.boss.x + i, y: st.boss.y });
    else out.push({ x: st.boss.x, y: st.boss.y + i });
  }
  return out;
}

function inBoard(st, x, y) {
  return x >= 0 && y >= 0 && x < st.size && y < st.size;
}

function fits(st, x, y, dir) {
  const mx = dir === "h" ? x + BOSS_SIZE - 1 : x;
  const my = dir === "v" ? y + BOSS_SIZE - 1 : y;
  return inBoard(st, x, y) && inBoard(st, mx, my);
}

export function createBoss(rng = Math.random, { size = 8, shots = BOSS_SHOTS } = {}) {
  const dir = rng() < 0.5 ? "h" : "v";
  const maxX = dir === "h" ? size - BOSS_SIZE : size - 1;
  const maxY = dir === "v" ? size - BOSS_SIZE : size - 1;
  return {
    size,
    boss: {
      x: Math.floor(rng() * (maxX + 1)),
      y: Math.floor(rng() * (maxY + 1)),
      dir,
    },
    wounds: [], // wounded segment indexes (0..BOSS_SIZE-1)
    shotsLeft: shots,
    shotCount: 0,
    moves: 0, // total moves taken — every 3rd one is a ROAR
    limp: false, // toggles once wounded 3+: it only moves every 2nd time
    marks: {}, // "x,y" -> { dist, at }
    defeated: false,
  };
}

// wounded monsters limp: with 3+ wounds they sit out every other move.
// Call once per move opportunity; true = the monster stays put.
export function bossLimps(st) {
  if (st.wounds.length < 3) return false;
  st.limp = !st.limp;
  return st.limp;
}

// clamp-place the monster during setup; tapping its body rotates it
export function placeBoss(st, x, y, dir = st.boss.dir) {
  const cx = Math.max(0, Math.min(dir === "h" ? st.size - BOSS_SIZE : st.size - 1, x));
  const cy = Math.max(0, Math.min(dir === "v" ? st.size - BOSS_SIZE : st.size - 1, y));
  if (!fits(st, cx, cy, dir)) return false;
  st.boss = { x: cx, y: cy, dir };
  return true;
}

export function segmentAt(st, x, y) {
  const cells = bossCells(st);
  for (let i = 0; i < cells.length; i += 1) {
    if (cells[i].x === x && cells[i].y === y) return i;
  }
  return -1;
}

export function bossShoot(st, x, y) {
  if (st.defeated || st.shotsLeft <= 0 || !inBoard(st, x, y)) return { result: "over" };
  st.shotCount += 1;
  st.shotsLeft -= 1;
  const seg = segmentAt(st, x, y);
  if (seg >= 0) {
    const newWound = !st.wounds.includes(seg);
    if (newWound) st.wounds.push(seg);
    st.defeated = st.wounds.length >= BOSS_SIZE;
    delete st.marks[key(x, y)]; // stale distance clue under the monster
    return {
      result: "hit",
      seg,
      newWound,
      wounds: st.wounds.length,
      defeated: st.defeated,
      faded: [],
      escaped: !st.defeated && st.shotsLeft === 0,
    };
  }
  let dist = null;
  for (const c of bossCells(st)) {
    const d = Math.max(Math.abs(c.x - x), Math.abs(c.y - y));
    if (dist === null || d < dist) dist = d;
  }
  st.marks[key(x, y)] = { dist, at: st.shotCount };
  const faded = [];
  for (const [k, m] of Object.entries(st.marks)) {
    if (st.shotCount - m.at >= BOSS_FADE) {
      delete st.marks[k];
      faded.push(k);
    }
  }
  return { result: "miss", dist, faded, escaped: st.shotsLeft === 0, wounds: st.wounds.length };
}

export function legalBossMoves(st) {
  const out = [];
  for (const [dx, dy] of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ]) {
    if (fits(st, st.boss.x + dx, st.boss.y + dy, st.boss.dir)) out.push({ dx, dy });
  }
  return out;
}

export function moveBoss(st, dx, dy) {
  if (!fits(st, st.boss.x + dx, st.boss.y + dy, st.boss.dir)) return false;
  st.boss.x += dx;
  st.boss.y += dy;
  st.moves += 1;
  return true;
}

export function bossRoars(st) {
  return st.moves > 0 && st.moves % 3 === 0;
}

// robo monster: shuffles away from the last shot, with some wobble
export function roboBossMove(st, lastShot, rng = Math.random) {
  const moves = legalBossMoves(st);
  if (!moves.length) return null;
  let pick;
  if (lastShot && rng() < 0.7) {
    let bestD = -1;
    for (const m of moves) {
      let d = Infinity;
      for (const c of bossCells({ ...st, boss: { ...st.boss, x: st.boss.x + m.dx, y: st.boss.y + m.dy } })) {
        d = Math.min(d, Math.max(Math.abs(c.x - lastShot.x), Math.abs(c.y - lastShot.y)));
      }
      const scored = d + rng() * 0.5;
      if (scored > bestD) {
        bestD = scored;
        pick = m;
      }
    }
  } else {
    pick = moves[Math.floor(rng() * moves.length)];
  }
  moveBoss(st, pick.dx, pick.dy);
  return pick;
}
