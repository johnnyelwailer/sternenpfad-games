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

test("decoy: may snuggle right beside creatures — only overlap is out", () => {
  const b = boardWith([{ id: 0, size: 3, x: 0, y: 0, dir: "h" }]);
  assert.equal(E.canPlaceDecoy(b, 1, 0), false); // ON the ship: never
  assert.equal(E.canPlaceDecoy(b, 1, 1), true); // directly below: fine!
  assert.equal(E.canPlaceDecoy(b, 3, 1), true); // diagonal: fine!
  assert.equal(E.placeDecoy(b, 5, 5), true);
  // ships may cuddle up to the balloon too — just not sit on it
  assert.equal(E.canPlace(b, { id: 1, size: 2, x: 4, y: 5, dir: "h" }, 1), false); // overlaps
  assert.equal(E.canPlace(b, { id: 1, size: 2, x: 4, y: 4, dir: "h" }, 1), true); // adjacent
});

test("decoy: auto-reveal skips the balloon cell (the honest gap trap)", () => {
  const b = boardWith([{ id: 0, size: 2, x: 2, y: 2, dir: "h" }]);
  E.placeDecoy(b, 2, 3); // right below the creature
  E.fire(b, 2, 2);
  const res = E.fire(b, 3, 2);
  assert.equal(res.result, E.SUNK);
  // the ring is revealed as water — except the balloon's cell
  assert.equal(b.shots[E.key(2, 3)], undefined);
  assert.ok(!res.revealed.some((c) => c.x === 2 && c.y === 3));
  // popping it later still works
  assert.equal(E.fire(b, 2, 3).result, E.DECOY);
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
