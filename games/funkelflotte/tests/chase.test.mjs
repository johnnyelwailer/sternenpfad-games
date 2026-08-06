import test from "node:test";
import assert from "node:assert/strict";
import {
  createChase,
  chaseShoot,
  placeFrido,
  legalMoves,
  moveFrido,
  roboMove,
  CHASE_SHOTS,
  CHASE_FADE,
} from "../js/chase.js";

function rngOf(...vals) {
  let i = 0;
  return () => vals[i++ % vals.length];
}

test("shots report truthful pre-move distance and budget counts down", () => {
  const st = createChase(rngOf(0.5));
  placeFrido(st, 4, 4);
  const res = chaseShoot(st, 0, 4);
  assert.equal(res.result, "miss");
  assert.equal(res.dist, 4);
  assert.equal(st.shotsLeft, CHASE_SHOTS - 1);
  assert.equal(chaseShoot(st, 4, 4).result, "caught");
  assert.equal(st.caught, true);
  assert.equal(chaseShoot(st, 1, 1).result, "over");
});

test("marks fade after CHASE_FADE further shots", () => {
  const st = createChase(rngOf(0.9));
  placeFrido(st, 7, 7);
  chaseShoot(st, 0, 0);
  assert.ok(st.marks["0,0"]);
  const results = [chaseShoot(st, 1, 0), chaseShoot(st, 2, 0), chaseShoot(st, 3, 0)];
  const fadedKeys = results.flatMap((r) => r.faded);
  assert.ok(fadedKeys.includes("0,0"));
  assert.equal(st.marks["0,0"], undefined);
});

test("frido cannot stop on marked cells and walls block moves", () => {
  const st = createChase(rngOf(0.1));
  placeFrido(st, 0, 0);
  chaseShoot(st, 1, 0); // marks (1,0)
  const moves = legalMoves(st);
  assert.deepEqual(
    moves.map((m) => `${m.x},${m.y}`).sort(),
    ["0,1"]
  );
  assert.equal(moveFrido(st, 1, 0), false); // marked
  assert.equal(moveFrido(st, -1, 0), false); // wall
  assert.equal(moveFrido(st, 0, 1), true);
  assert.deepEqual(st.frido, { x: 0, y: 1 });
});

test("escape happens when the last shot misses", () => {
  const st = createChase(rngOf(0.5), { shots: 2 });
  placeFrido(st, 7, 7);
  assert.equal(chaseShoot(st, 0, 0).escaped, false);
  const last = chaseShoot(st, 0, 1);
  assert.equal(last.escaped, true);
  assert.equal(st.shotsLeft, 0);
});

test("robo hider flees from the last shot", () => {
  const st = createChase(rngOf(0.2));
  placeFrido(st, 4, 4);
  const before = { ...st.frido };
  const mv = roboMove(st, { x: 4, y: 3 }, rngOf(0.1));
  assert.ok(mv);
  assert.notDeepEqual(st.frido, before);
  // fled: distance to last shot did not shrink
  const dBefore = Math.max(Math.abs(before.x - 4), Math.abs(before.y - 3));
  const dAfter = Math.max(Math.abs(st.frido.x - 4), Math.abs(st.frido.y - 3));
  assert.ok(dAfter >= dBefore);
});
