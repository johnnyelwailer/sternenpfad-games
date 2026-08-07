// Monster gegen Flotte: one huge 6-cell monster prowls the board while
// the hunter tries to wound every segment with a limited shot budget and
// distance clues. Wounds belong to the monster's BODY segments, so
// they travel along when it moves. Pure logic — the full state lives
// with the monster's owner.

import { key } from "./engine.js";

export const BOSS_SHOTS = 20;
export const BOSS_SIZE = 6; // a big, unmissable beast
export const BOSS_FADE = 4; // distance marks fade after this many shots

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

// the robo monster is heavy and unhurried: it rests every second chance
// (its wounded limp comes on top) — solo hunts stay winnable for kids
export function bossRests(st) {
  st.rest = !st.rest;
  if (st.rest) return true;
  return bossLimps(st);
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

// ------------------------------------------------------------- hunt mode
// Solo Monsterjagd 2.0: YOUR OWN fleet stands on the same board — it is
// your lives. The monster stalks the nearest living creature (so its
// path is finally predictable!), and every step onto a creature takes a
// bite. Visible chests hold power-ups. No shot budget: the fleet is
// the clock.

export const HUNT_FLEET = [3, 2, 2]; // creature sizes = your lives
export const HUNT_TREASURES = 2;
export const FREEZE_MOVES = 3; // an ice chest roots the monster this long

export function fleetCells(ship) {
  const out = [];
  for (let i = 0; i < ship.size; i += 1) {
    out.push(ship.dir === "h" ? { x: ship.x + i, y: ship.y } : { x: ship.x, y: ship.y + i });
  }
  return out;
}

export function fleetAlive(st) {
  return st.fleet.filter((s) => s.hits.length < s.size).length;
}

export function fleetHealthyCells(st) {
  const out = [];
  for (const ship of st.fleet) {
    if (ship.hits.length >= ship.size) continue;
    for (const c of fleetCells(ship)) {
      if (!ship.hits.some((h) => h.x === c.x && h.y === c.y)) out.push(c);
    }
  }
  return out;
}

export function fleetShipAt(st, x, y) {
  for (const ship of st.fleet ?? []) {
    if (fleetCells(ship).some((c) => c.x === x && c.y === y)) return ship;
  }
  return null;
}

export function treasureIdxAt(st, x, y) {
  return (st.treasures ?? []).findIndex((t) => t.x === x && t.y === y);
}

export function createHunt(rng = Math.random, { size = 8 } = {}) {
  const st = createBoss(rng, { size, shots: 9999 });
  st.hunt = true;
  st.freeze = 0; // moves the monster stays frozen
  st.extraShots = 0; // banked bonus shots (chest power)
  st.fleet = [];
  st.treasures = [];

  // cells blocked for placement: monster body + fleet + one-cell halo
  const blocked = new Set(bossCells(st).map((c) => key(c.x, c.y)));
  const blockWithHalo = (cells) => {
    for (const c of cells) {
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) blocked.add(key(c.x + dx, c.y + dy));
      }
    }
  };
  HUNT_FLEET.forEach((len, i) => {
    for (let tries = 0; tries < 500; tries += 1) {
      const dir = rng() < 0.5 ? "h" : "v";
      const maxX = dir === "h" ? size - len : size - 1;
      const maxY = dir === "v" ? size - len : size - 1;
      const ship = {
        id: 10 + i, // clear of the monster's id (the king look keys on it)
        size: len,
        x: Math.floor(rng() * (maxX + 1)),
        y: Math.floor(rng() * (maxY + 1)),
        dir,
        hits: [],
      };
      if (fleetCells(ship).some((c) => blocked.has(key(c.x, c.y)))) continue;
      st.fleet.push(ship);
      blockWithHalo(fleetCells(ship));
      break;
    }
  });
  for (let placed = 0, tries = 0; placed < HUNT_TREASURES && tries < 500; tries += 1) {
    const x = Math.floor(rng() * size);
    const y = Math.floor(rng() * size);
    if (blocked.has(key(x, y))) continue;
    blocked.add(key(x, y));
    st.treasures.push({ x, y });
    placed += 1;
  }
  return st;
}

// chest power-ups, equally likely: two shots / freeze / shadow hint
export function drawHuntPower(rng = Math.random) {
  return ["doppel", "frost", "glocke"][Math.floor(rng() * 3)];
}

// The monster's turn in hunt mode: frozen and resting turns keep the
// kid-fair pace; otherwise it takes the step that brings it closest to
// the nearest still-healthy creature — and BITES one overlapped cell.
export function huntBossMove(st, rng = Math.random) {
  if (st.freeze > 0) {
    st.freeze -= 1;
    return { frozen: true, freezeLeft: st.freeze };
  }
  if (bossRests(st)) return { rested: true };
  const targets = fleetHealthyCells(st);
  if (!targets.length) return { allGone: true };
  const moves = legalBossMoves(st);
  if (!moves.length) return { stuck: true };
  let pick = moves[0];
  let bestD = Infinity;
  for (const m of moves) {
    const body = bossCells({ ...st, boss: { ...st.boss, x: st.boss.x + m.dx, y: st.boss.y + m.dy } });
    let d = Infinity;
    for (const c of body) {
      for (const t of targets) d = Math.min(d, Math.max(Math.abs(c.x - t.x), Math.abs(c.y - t.y)));
    }
    const scored = d + rng() * 0.4; // a little wobble, never a teleport
    if (scored < bestD) {
      bestD = scored;
      pick = m;
    }
  }
  moveBoss(st, pick.dx, pick.dy);
  const roar = bossRoars(st);
  // bite exactly ONE healthy fleet cell under the new body
  const body = new Set(bossCells(st).map((c) => key(c.x, c.y)));
  for (const ship of st.fleet) {
    if (ship.hits.length >= ship.size) continue;
    for (const c of fleetCells(ship)) {
      if (!body.has(key(c.x, c.y))) continue;
      if (ship.hits.some((h) => h.x === c.x && h.y === c.y)) continue;
      ship.hits.push({ x: c.x, y: c.y });
      return {
        moved: pick,
        roar,
        bite: { ship, x: c.x, y: c.y, seg: fleetCells(ship).findIndex((fc) => fc.x === c.x && fc.y === c.y) },
        destroyed: ship.hits.length >= ship.size,
        allGone: fleetAlive(st) === 0,
      };
    }
  }
  return { moved: pick, roar };
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
