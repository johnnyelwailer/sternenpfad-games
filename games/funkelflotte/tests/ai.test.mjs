import test from "node:test";
import assert from "node:assert/strict";
import { createBoard, placeShip, randomFleet, fire, shipCells, allSunk, key, SUNK, HIT, MISS } from "../js/engine.js";
import { createAiState, noteResult, nextShot } from "../js/ai.js";

function seededRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

test("nextShot never repeats a cell and always stays on the board", () => {
  const rng = seededRng(7);
  const board = createBoard();
  randomFleet(board, undefined, rng);
  const state = createAiState("schlau");
  const seen = new Set();
  for (let i = 0; i < board.size * board.size; i += 1) {
    const shot = nextShot(state, board, rng);
    if (!shot) break;
    const k = key(shot.x, shot.y);
    assert.ok(!seen.has(k), `repeated ${k}`);
    assert.ok(shot.x >= 0 && shot.x < board.size && shot.y >= 0 && shot.y < board.size);
    seen.add(k);
    const res = fire(board, shot.x, shot.y);
    noteResult(state, shot.x, shot.y, res.result, res.ship ? shipCells(res.ship) : null);
    if (res.gameOver) break;
  }
});

test("nextShot returns null when the board is exhausted", () => {
  const board = createBoard(2);
  placeShip(board, { id: 0, size: 2, x: 0, y: 0, dir: "h" });
  const state = createAiState();
  const rng = seededRng(3);
  // Play until the AI has nothing left to shoot (auto-reveal may
  // exhaust cells early), then confirm every cell is accounted for.
  for (let i = 0; i < 10; i += 1) {
    const shot = nextShot(state, board, rng);
    if (!shot) break;
    const res = fire(board, shot.x, shot.y);
    noteResult(state, shot.x, shot.y, res.result, res.ship ? shipCells(res.ship) : null);
  }
  assert.equal(nextShot(state, board, rng), null);
  assert.equal(Object.keys(board.shots).length, 4);
  assert.equal(allSunk(board), true);
});

test("after a hit, the AI targets an adjacent cell", () => {
  const board = createBoard(8);
  placeShip(board, { id: 0, size: 3, x: 3, y: 3, dir: "h" });
  const state = createAiState("schlau");
  const res = fire(board, 3, 3);
  assert.equal(res.result, HIT);
  noteResult(state, 3, 3, res.result, null);
  const rng = seededRng(11);
  for (let i = 0; i < 20; i += 1) {
    const shot = nextShot(state, board, rng);
    const dist = Math.abs(shot.x - 3) + Math.abs(shot.y - 3);
    assert.equal(dist, 1, `shot ${shot.x},${shot.y} not adjacent to hit`);
  }
});

test("with two hits in a line, the AI extends the line", () => {
  const board = createBoard(8);
  placeShip(board, { id: 0, size: 4, x: 2, y: 4, dir: "h" });
  const state = createAiState("schlau");
  for (const x of [3, 4]) {
    const res = fire(board, x, 4);
    noteResult(state, x, 4, res.result, null);
  }
  const rng = seededRng(5);
  for (let i = 0; i < 20; i += 1) {
    const shot = nextShot(state, board, rng);
    assert.equal(shot.y, 4);
    assert.ok(shot.x === 2 || shot.x === 5, `expected line end, got ${shot.x},${shot.y}`);
  }
});

test("the AI finishes every game (both difficulties, many seeds)", () => {
  for (const difficulty of ["leicht", "schlau"]) {
    for (let seed = 1; seed <= 25; seed += 1) {
      const rng = seededRng(seed * 31 + 1);
      const board = createBoard();
      assert.equal(randomFleet(board, undefined, rng), true);
      const state = createAiState(difficulty);
      let turns = 0;
      while (!allSunk(board)) {
        const shot = nextShot(state, board, rng);
        assert.ok(shot, `AI stuck (seed ${seed}, ${difficulty})`);
        const res = fire(board, shot.x, shot.y);
        assert.notEqual(res.result, "repeat");
        noteResult(state, shot.x, shot.y, res.result, res.ship ? shipCells(res.ship) : null);
        turns += 1;
        assert.ok(turns <= 64, `too many turns (seed ${seed})`);
      }
    }
  }
});

test("smart AI is meaningfully better than worst case", () => {
  // With auto-reveal + hunt/target the smart AI should finish well
  // under the 64-shot worst case on average.
  let total = 0;
  const games = 30;
  for (let seed = 1; seed <= games; seed += 1) {
    const rng = seededRng(seed * 977 + 5);
    const board = createBoard();
    randomFleet(board, undefined, rng);
    const state = createAiState("schlau");
    let turns = 0;
    while (!allSunk(board)) {
      const shot = nextShot(state, board, rng);
      const res = fire(board, shot.x, shot.y);
      noteResult(state, shot.x, shot.y, res.result, res.ship ? shipCells(res.ship) : null);
      turns += 1;
    }
    total += turns;
  }
  const avg = total / games;
  assert.ok(avg < 50, `average ${avg} not better than random`);
});

test("noteResult clears only the sunk creature's hits", () => {
  const state = createAiState();
  noteResult(state, 1, 1, HIT, null);
  noteResult(state, 5, 5, HIT, null);
  noteResult(state, 5, 6, SUNK, [
    { x: 5, y: 5 },
    { x: 5, y: 6 },
  ]);
  assert.deepEqual(state.openHits, [{ x: 1, y: 1 }]);
});

test("miss results do not add open hits", () => {
  const state = createAiState();
  noteResult(state, 0, 0, MISS, null);
  assert.equal(state.openHits.length, 0);
});
