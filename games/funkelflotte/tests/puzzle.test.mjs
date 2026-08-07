import test from "node:test";
import assert from "node:assert/strict";
import * as E from "../js/engine.js";
import { computeCounts, countSolutions, generatePuzzle, PUZZLE_FLEET, PUZZLE_STAGES, puzzleStageIndex } from "../js/puzzle.js";

function seededRng(seed) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
}

test("computeCounts sums ship cells per row and column", () => {
  const b = E.createBoard(6);
  E.placeShip(b, { id: 0, size: 3, x: 0, y: 0, dir: "h" });
  E.placeShip(b, { id: 1, size: 2, x: 5, y: 3, dir: "v" });
  const { rows, cols } = computeCounts(b);
  assert.deepEqual(rows, [3, 0, 0, 1, 1, 0]);
  assert.deepEqual(cols, [1, 1, 1, 0, 0, 2]);
});

test("countSolutions finds a known unique layout", () => {
  // one 2-ship on a 3x3 board at (0,0)-(1,0)
  const rows = [2, 0, 0];
  const cols = [1, 1, 0];
  assert.equal(countSolutions(3, [2], rows, cols, {}, 10), 1);
});

test("countSolutions detects ambiguity and constraints resolve it", () => {
  // a 2-ship somewhere in row 0 of a 4x4: two placements fit counts [1,1,0,0]
  const rows = [2, 0, 0, 0];
  const cols = [1, 1, 1, 1];
  // (0,0)-(1,0) leaves cols [1,1,0,0] — mismatch; craft instead:
  // cols allow x0..x3, ship must cover two adjacent of them → 3 layouts? verify >1
  const n = countSolutions(4, [2], rows, [1, 1, 0, 0], {}, 10);
  assert.equal(n, 1); // cols pin it to (0,0)-(1,0)
  const ambiguous = countSolutions(4, [2], [1, 1, 0, 0], [2, 0, 0, 0], {}, 10);
  assert.equal(ambiguous, 1); // vertical at x=0,y=0..1
  // genuinely ambiguous: two vertical 2-ships at x0/x2 can swap their
  // row pairs {0,1} and {2,3}
  const multi = countSolutions(4, [2, 2], [1, 1, 1, 1], [2, 0, 2, 0], {}, 10);
  assert.equal(multi, 2);
  // a ship hint on (0,0) pins the layout
  const constrained = countSolutions(4, [2, 2], [1, 1, 1, 1], [2, 0, 2, 0], { "0,0": "ship" }, 10);
  assert.equal(constrained, 1);
});

test("generatePuzzle produces a uniquely solvable puzzle", () => {
  for (const seed of [7, 99, 12345]) {
    const rng = seededRng(seed);
    const { board, rows, cols, hints } = generatePuzzle(rng);
    assert.equal(board.ships.length, PUZZLE_FLEET.length);
    const counts = computeCounts(board);
    assert.deepEqual(counts.rows, rows);
    assert.deepEqual(counts.cols, cols);
    const constraints = {};
    for (const h of hints) constraints[E.key(h.x, h.y)] = h.type;
    assert.equal(
      countSolutions(board.size, PUZZLE_FLEET, rows, cols, constraints),
      1,
      `seed ${seed} should be unique`
    );
    // every hint is truthful
    for (const h of hints) {
      const isShip = !!E.shipAt(board, h.x, h.y);
      assert.equal(isShip, h.type === "ship");
    }
  }
});

test("difficulty ladder: stages get denser, singles have no h/v twins", () => {
  assert.equal(PUZZLE_STAGES.length, 3);
  assert.equal(puzzleStageIndex(0), 0);
  assert.equal(puzzleStageIndex(1), 0);
  assert.equal(puzzleStageIndex(2), 1);
  assert.equal(puzzleStageIndex(5), 1);
  assert.equal(puzzleStageIndex(6), 2);
  // stage fleets grow, spades shrink
  assert.ok(PUZZLE_STAGES[1].fleet.length > PUZZLE_STAGES[0].fleet.length);
  assert.ok(PUZZLE_STAGES[2].grid > PUZZLE_STAGES[0].grid);
  assert.ok(PUZZLE_STAGES[1].spades < PUZZLE_STAGES[0].spades);
  // a lone 1-ship on an empty 3x3 with counts pinning one cell has
  // EXACTLY one solution — no horizontal/vertical double counting
  const n = countSolutions(3, [1], [1, 0, 0], [1, 0, 0], {});
  assert.equal(n, 1);
});

test("stage 2 and 3 boards generate uniquely with the sneaky single", () => {
  for (const st of [PUZZLE_STAGES[1], PUZZLE_STAGES[2]]) {
    const p = generatePuzzle(Math.random, { size: st.grid, fleet: st.fleet });
    const constraints = Object.fromEntries(p.hints.map((h) => [`${h.x},${h.y}`, "ship"]));
    assert.equal(countSolutions(st.grid, st.fleet, p.rows, p.cols, constraints), 1);
  }
});
