import test from "node:test";
import assert from "node:assert/strict";
import {
  createBoard,
  placeShip,
  moveShip,
  canPlace,
  randomFleet,
  fire,
  shipCells,
  shipAt,
  allSunk,
  surroundCells,
  serializeShips,
  totalShipCells,
  key,
  normalizeFleetEntry,
  DEFAULT_FLEET,
  DEFAULT_GRID,
  MISS,
  HIT,
  SUNK,
  REPEAT,
} from "../js/engine.js";

function seededRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

test("createBoard creates an empty board of the right size", () => {
  const b = createBoard();
  assert.equal(b.size, DEFAULT_GRID);
  assert.equal(b.ships.length, 0);
  assert.deepEqual(b.shots, {});
});

test("shipCells expands horizontal and vertical ships", () => {
  assert.deepEqual(shipCells({ size: 3, x: 1, y: 2, dir: "h" }), [
    { x: 1, y: 2 },
    { x: 2, y: 2 },
    { x: 3, y: 2 },
  ]);
  assert.deepEqual(shipCells({ size: 2, x: 4, y: 5, dir: "v" }), [
    { x: 4, y: 5 },
    { x: 4, y: 6 },
  ]);
});

test("placeShip rejects out-of-bounds placements", () => {
  const b = createBoard(8);
  assert.equal(placeShip(b, { id: 0, size: 4, x: 5, y: 0, dir: "h" }), false);
  assert.equal(placeShip(b, { id: 0, size: 4, x: 0, y: 5, dir: "v" }), false);
  assert.equal(placeShip(b, { id: 0, size: 4, x: -1, y: 0, dir: "h" }), false);
  assert.equal(b.ships.length, 0);
});

test("placeShip enforces the no-touch rule (including diagonals)", () => {
  const b = createBoard(8);
  assert.equal(placeShip(b, { id: 0, size: 3, x: 2, y: 2, dir: "h" }), true);
  // overlapping
  assert.equal(canPlace(b, { id: 1, size: 2, x: 3, y: 2, dir: "h" }), false);
  // side by side (touching edge)
  assert.equal(canPlace(b, { id: 1, size: 2, x: 2, y: 3, dir: "h" }), false);
  // diagonal touch
  assert.equal(canPlace(b, { id: 1, size: 2, x: 1, y: 1, dir: "v" }), false);
  // one row of water between: fine
  assert.equal(canPlace(b, { id: 1, size: 2, x: 2, y: 4, dir: "h" }), true);
});

test("moveShip relocates a ship only to valid spots and ignores itself", () => {
  const b = createBoard(8);
  placeShip(b, { id: 0, size: 3, x: 0, y: 0, dir: "h" });
  placeShip(b, { id: 1, size: 2, x: 0, y: 4, dir: "h" });
  // moving onto the other ship fails
  assert.equal(moveShip(b, 0, 0, 4, "h"), false);
  // moving within its own footprint (rotation in place) is allowed
  assert.equal(moveShip(b, 0, 0, 0, "v"), true);
  const s = b.ships.find((x) => x.id === 0);
  assert.equal(s.dir, "v");
});

test("randomFleet places the whole fleet validly (many seeds)", () => {
  for (let seed = 1; seed <= 50; seed += 1) {
    const b = createBoard();
    const ok = randomFleet(b, DEFAULT_FLEET, seededRng(seed));
    assert.equal(ok, true, `seed ${seed} failed`);
    assert.equal(b.ships.length, DEFAULT_FLEET.length);
    // every ship valid w.r.t. all others
    for (const ship of b.ships) {
      assert.equal(canPlace(b, ship, ship.id), true);
    }
    const cellCount = b.ships.reduce((n, s) => n + shipCells(s).length, 0);
    assert.equal(cellCount, totalShipCells());
  }
});

test("fire reports miss, hit, sunk, repeat and gameOver", () => {
  const b = createBoard(8);
  placeShip(b, { id: 0, size: 2, x: 0, y: 0, dir: "h" });
  placeShip(b, { id: 1, size: 2, x: 0, y: 4, dir: "h" });

  assert.equal(fire(b, 5, 5).result, MISS);
  assert.equal(fire(b, 5, 5).result, REPEAT);
  assert.equal(fire(b, 0, 0).result, HIT);
  assert.equal(fire(b, 0, 0).result, REPEAT);

  const sunk = fire(b, 1, 0);
  assert.equal(sunk.result, SUNK);
  assert.equal(sunk.ship.id, 0);
  assert.equal(sunk.gameOver, false);
  assert.equal(allSunk(b), false);

  fire(b, 0, 4);
  const last = fire(b, 1, 4);
  assert.equal(last.result, SUNK);
  assert.equal(last.gameOver, true);
  assert.equal(allSunk(b), true);
});

test("fire out of bounds is a repeat/no-op", () => {
  const b = createBoard(8);
  placeShip(b, { id: 0, size: 2, x: 0, y: 0, dir: "h" });
  assert.equal(fire(b, -1, 0).result, REPEAT);
  assert.equal(fire(b, 0, 8).result, REPEAT);
});

test("sinking a creature auto-reveals the water around it", () => {
  const b = createBoard(8);
  placeShip(b, { id: 0, size: 2, x: 2, y: 2, dir: "h" });
  placeShip(b, { id: 1, size: 2, x: 5, y: 5, dir: "v" });
  fire(b, 2, 2);
  const res = fire(b, 3, 2);
  assert.equal(res.result, SUNK);
  // 2x4 bounding ring minus the 2 ship cells = 10 cells
  assert.equal(res.revealed.length, 10);
  for (const c of res.revealed) {
    assert.equal(b.shots[key(c.x, c.y)], MISS);
  }
  // corners of the ring included
  assert.ok(res.revealed.some((c) => c.x === 1 && c.y === 1));
  assert.ok(res.revealed.some((c) => c.x === 4 && c.y === 3));
});

test("surroundCells clips at the board edge", () => {
  const b = createBoard(8);
  placeShip(b, { id: 0, size: 2, x: 0, y: 0, dir: "h" });
  const ring = surroundCells(b, b.ships[0]);
  assert.equal(ring.length, 4); // (2,0),(0,1),(1,1),(2,1)
  for (const c of ring) {
    assert.ok(c.x >= 0 && c.y >= 0);
  }
});

test("auto-reveal skips treasure cells so chests next to a find stay diggable", () => {
  const b = createBoard(8);
  placeShip(b, { id: 0, size: 2, x: 2, y: 2, dir: "h" });
  placeShip(b, { id: 1, size: 2, x: 5, y: 5, dir: "v" });
  b.treasures = [{ x: 1, y: 1, revealed: true }]; // diagonal neighbour of the ship
  fire(b, 2, 2);
  const res = fire(b, 3, 2);
  assert.equal(res.result, SUNK);
  // the chest cell keeps its secret: not marked, not in the revealed list
  assert.equal(b.shots[key(1, 1)], undefined);
  assert.ok(!res.revealed.some((c) => c.x === 1 && c.y === 1));
  // and the dig still works — a fresh shot, not a swallowed repeat
  assert.equal(fire(b, 1, 1).result, MISS);
});

test("auto-revealed water never overwrites an existing hit", () => {
  const b = createBoard(8);
  placeShip(b, { id: 0, size: 2, x: 2, y: 2, dir: "h" });
  fire(b, 1, 1); // miss recorded inside the future ring
  fire(b, 2, 2);
  const res = fire(b, 3, 2);
  assert.equal(res.result, SUNK);
  assert.ok(!res.revealed.some((c) => c.x === 1 && c.y === 1));
});

test("serializeShips exposes placement but not hit state", () => {
  const b = createBoard(8);
  placeShip(b, { id: 0, size: 2, x: 2, y: 2, dir: "h" });
  fire(b, 2, 2);
  const ser = serializeShips(b);
  assert.deepEqual(ser, [{ id: 0, size: 2, x: 2, y: 2, dir: "h" }]);
  assert.equal(Object.hasOwn(ser[0], "hits"), false);
});

test("shipAt finds the ship occupying a cell", () => {
  const b = createBoard(8);
  placeShip(b, { id: 7, size: 3, x: 4, y: 4, dir: "v" });
  assert.equal(shipAt(b, 4, 5).id, 7);
  assert.equal(shipAt(b, 5, 5), null);
});

test("a full game against random shots always terminates with all sunk", () => {
  const rng = seededRng(99);
  const b = createBoard();
  assert.equal(randomFleet(b, DEFAULT_FLEET, rng), true);
  let shotsFired = 0;
  outer: for (let y = 0; y < b.size; y += 1) {
    for (let x = 0; x < b.size; x += 1) {
      const res = fire(b, x, y);
      if (res.result !== REPEAT) shotsFired += 1;
      if (res.gameOver) break outer;
    }
  }
  assert.equal(allSunk(b), true);
  assert.ok(shotsFired <= b.size * b.size);
});

// ------------------------------------------------- board & fleet variety

test("normalizeFleetEntry: numbers are lines, '2x2' is a square of 4", () => {
  assert.deepEqual(normalizeFleetEntry(3), { shape: "line", size: 3 });
  assert.deepEqual(normalizeFleetEntry(1), { shape: "line", size: 1 });
  assert.deepEqual(normalizeFleetEntry("2x2"), { shape: "sq", size: 4 });
});

test("shipCells: a square ship occupies its 2×2 block", () => {
  const cells = shipCells({ shape: "sq", size: 4, x: 3, y: 5, dir: "h" });
  assert.deepEqual(
    cells.map((c) => key(c.x, c.y)).sort(),
    ["3,5", "3,6", "4,5", "4,6"].sort()
  );
});

test("square ships sink after all 4 cells are hit", () => {
  const b = createBoard(8);
  placeShip(b, { id: 0, shape: "sq", size: 4, x: 2, y: 2, dir: "h" });
  assert.equal(fire(b, 2, 2).result, HIT);
  assert.equal(fire(b, 3, 2).result, HIT);
  assert.equal(fire(b, 2, 3).result, HIT);
  const res = fire(b, 3, 3);
  assert.equal(res.result, SUNK);
  assert.equal(res.gameOver, true);
});

test("Enge Verstecke: touching allowed, overlap still forbidden", () => {
  const b = createBoard(8);
  b.allowTouch = true;
  placeShip(b, { id: 0, size: 3, x: 2, y: 2, dir: "h" });
  // directly below — would be illegal classically
  assert.equal(canPlace(b, { id: 1, size: 2, x: 2, y: 3, dir: "h" }), true);
  // overlapping is never okay
  assert.equal(canPlace(b, { id: 1, size: 2, x: 3, y: 2, dir: "h" }), false);
  // and the classic board still rejects the touch
  const c = createBoard(8);
  placeShip(c, { id: 0, size: 3, x: 2, y: 2, dir: "h" });
  assert.equal(canPlace(c, { id: 1, size: 2, x: 2, y: 3, dir: "h" }), false);
});

test("Enge Verstecke: sinking reveals no surrounding water", () => {
  const b = createBoard(8);
  b.allowTouch = true;
  placeShip(b, { id: 0, size: 2, x: 2, y: 2, dir: "h" });
  placeShip(b, { id: 1, size: 2, x: 2, y: 3, dir: "h" });
  fire(b, 2, 2);
  const res = fire(b, 3, 2);
  assert.equal(res.result, SUNK);
  assert.deepEqual(res.revealed, []);
  // the neighbour hiding right next door is still hittable
  assert.equal(fire(b, 2, 3).result, HIT);
});

test("randomFleet fills small, big and mixed-shape boards", () => {
  const rng = seededRng(7);
  const flink = createBoard(6);
  assert.equal(randomFleet(flink, [3, 2, 2, 1], rng), true);
  assert.equal(flink.ships.length, 4);

  const riesig = createBoard(10);
  assert.equal(randomFleet(riesig, [5, 4, 3, 3, 2, 2, 1], rng), true);
  assert.equal(riesig.ships.length, 7);

  const grossklein = createBoard(8);
  assert.equal(randomFleet(grossklein, ["2x2", 3, 3, 2, 1], rng), true);
  const sq = grossklein.ships.find((s) => s.shape === "sq");
  assert.ok(sq);
  assert.equal(sq.size, 4);
  // every occupied cell of every ship stays in bounds
  for (const board of [flink, riesig, grossklein]) {
    for (const s of board.ships) {
      for (const c of shipCells(s)) {
        assert.ok(c.x >= 0 && c.y >= 0 && c.x < board.size && c.y < board.size);
      }
    }
  }
});

test("randomFleet with touch rule packs a tight 6×6 board", () => {
  const rng = seededRng(11);
  const b = createBoard(6);
  b.allowTouch = true;
  assert.equal(randomFleet(b, [3, 2, 2, 1], rng), true);
  const seen = new Set();
  for (const s of b.ships) {
    for (const c of shipCells(s)) {
      const k = key(c.x, c.y);
      assert.ok(!seen.has(k), "no overlaps even when touching is allowed");
      seen.add(k);
    }
  }
});

test("serializeShips carries shape only for non-line creatures", () => {
  const b = createBoard(8);
  placeShip(b, { id: 0, shape: "sq", size: 4, x: 1, y: 1, dir: "h" });
  placeShip(b, { id: 1, shape: "line", size: 2, x: 5, y: 5, dir: "v" });
  const ser = serializeShips(b);
  assert.equal(ser.find((s) => s.id === 0).shape, "sq");
  assert.equal(Object.hasOwn(ser.find((s) => s.id === 1), "shape"), false);
});
