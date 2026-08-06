import test from "node:test";
import assert from "node:assert/strict";
import * as E from "../js/engine.js";

function boardWith(ships) {
  const b = E.createBoard();
  for (const s of ships) {
    assert.equal(E.placeShip(b, s), true, `placing ${JSON.stringify(s)}`);
  }
  return b;
}

test("decoy: placement respects no-touch in both directions", () => {
  const b = boardWith([{ id: 0, size: 3, x: 0, y: 0, dir: "h" }]);
  assert.equal(E.canPlaceDecoy(b, 1, 1), false); // touches the ship
  assert.equal(E.canPlaceDecoy(b, 3, 1), false); // diagonal touch
  assert.equal(E.placeDecoy(b, 5, 5), true);
  // now ships must keep away from the decoy
  assert.equal(E.canPlace(b, { id: 1, size: 2, x: 4, y: 4, dir: "h" }, 1), false);
  assert.equal(E.canPlace(b, { id: 1, size: 2, x: 0, y: 7, dir: "h" }, 1), true);
});

test("decoy: firing pops it without ending the game", () => {
  const b = boardWith([{ id: 0, size: 2, x: 0, y: 0, dir: "h" }]);
  E.placeDecoy(b, 5, 5);
  const res = E.fire(b, 5, 5);
  assert.equal(res.result, E.DECOY);
  assert.equal(res.gameOver, false);
  assert.equal(b.shots["5,5"], E.DECOY);
  // popped cell cannot be shot again
  assert.equal(E.fire(b, 5, 5).result, E.REPEAT);
  // creatures still win the game as usual
  E.fire(b, 0, 0);
  const done = E.fire(b, 1, 0);
  assert.equal(done.result, E.SUNK);
  assert.equal(done.gameOver, true);
});

test("randomDecoy finds a legal spot on a busy board", () => {
  const b = E.createBoard();
  let seed = 42;
  const rng = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  assert.equal(E.randomFleet(b, undefined, rng), true);
  assert.equal(E.randomDecoy(b, rng), true);
  assert.equal(E.canPlaceDecoy(b, b.decoy.x, b.decoy.y), true);
});

test("sonar: Chebyshev distance to nearest unfound creature", () => {
  const b = boardWith([
    { id: 0, size: 2, x: 0, y: 0, dir: "h" },
    { id: 1, size: 2, x: 6, y: 6, dir: "v" },
  ]);
  assert.equal(E.sonarDistance(b, 3, 0), 2); // nearest cell (1,0)
  assert.equal(E.sonarDistance(b, 5, 5), 1);
  assert.equal(E.sonarDistance(b, 7, 0), 6); // ship0 (1,0) and ship1 (6,6) both 6 away
  // sink ship 1; distances now point at ship 0 only
  E.fire(b, 6, 6);
  E.fire(b, 6, 7);
  assert.equal(E.sonarDistance(b, 5, 5), 5);
  assert.equal(E.sonarDistance(b, 1, 1), 1);
});

test("ghost: forgetShot clears misses only and makes them shootable again", () => {
  const b = boardWith([{ id: 0, size: 2, x: 0, y: 0, dir: "h" }]);
  E.placeDecoy(b, 7, 7);
  E.fire(b, 4, 4); // miss
  E.fire(b, 0, 0); // hit
  E.fire(b, 7, 7); // decoy
  assert.equal(E.forgetShot(b, 4, 4), true);
  assert.equal(b.shots["4,4"], undefined);
  assert.equal(E.fire(b, 4, 4).result, E.MISS); // shootable again
  assert.equal(E.forgetShot(b, 0, 0), false); // hits stay
  assert.equal(E.forgetShot(b, 7, 7), false); // popped balloon stays
});
