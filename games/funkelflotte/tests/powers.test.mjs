import test from "node:test";
import assert from "node:assert/strict";
import * as E from "../js/engine.js";
import * as P from "../js/powers.js";

function seeded(seed) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
}

function fullBoard(rng) {
  const b = E.createBoard();
  E.randomFleet(b, undefined, rng);
  return b;
}

test("every power has complete metadata and a sane target", () => {
  const kinds = Object.keys(P.POWERS);
  assert.ok(kinds.length >= 13, `expected >= 13 powers, got ${kinds.length}`);
  for (const [kind, p] of Object.entries(P.POWERS)) {
    assert.ok(p.emoji && p.name && p.desc, `${kind} needs emoji/name/desc`);
    assert.ok(["none", "cell", "row", "cell3"].includes(p.target), `${kind} target`);
  }
  // each world has a signature power
  for (const w of ["ozean", "weltraum", "dino", "teich"]) {
    assert.ok(P.POWERS[P.worldPower(w)], `world power for ${w}`);
  }
});

test("treasures avoid creatures, balloons and each other", () => {
  const rng = seeded(99);
  for (let round = 0; round < 5; round += 1) {
    const b = fullBoard(rng);
    E.randomDecoy(b, rng);
    assert.equal(P.seedTreasures(b, 3, rng), 3);
    const seen = new Set();
    for (const t of b.treasures) {
      const k = E.key(t.x, t.y);
      assert.equal(seen.has(k), false, "treasures overlap");
      seen.add(k);
      assert.equal(E.shipAt(b, t.x, t.y), null, "treasure on a creature");
      assert.equal(b.decoy.x === t.x && b.decoy.y === t.y, false, "treasure on balloon");
      assert.equal(P.treasureAt(b, t.x, t.y), true);
    }
  }
});

test("drawPower only draws from the pool and respects the clover rule", () => {
  const rng = seeded(7);
  for (let i = 0; i < 200; i += 1) {
    const kind = P.drawPower(rng, ["klee"]);
    assert.ok(P.POWERS[kind], `unknown power ${kind}`);
    assert.notEqual(kind, "klee", "no second clover");
  }
});

test("scan/row/square/salvo helpers stay in bounds and report ships", () => {
  const b = E.createBoard();
  E.placeShip(b, { id: 0, size: 3, x: 2, y: 4, dir: "h" });
  const row = P.scanCells(b, P.rowCells(b, 4));
  assert.equal(row.length, 8);
  assert.deepEqual(row.filter((c) => c.ship).map((c) => c.x), [2, 3, 4]);
  const sq = P.squareCells(b, 7, 7); // clamped corner collapses
  assert.ok(sq.every((c) => c.x < 8 && c.y < 8));
  const sv = P.salvoCells(b, 6, 0);
  assert.deepEqual(sv.map((c) => c.x), [6, 7]);
});

test("direction and bell helpers describe the hidden fleet", () => {
  const b = E.createBoard();
  assert.equal(E.placeShip(b, { id: 0, size: 4, x: 5, y: 4, dir: "v" }), true);
  const dir = P.directionToNearest(b, 0, 0);
  assert.ok(dir.angle > 0 && dir.angle < Math.PI / 2, "arrow points down-right");
  assert.equal(P.biggestHiddenDir(b), "v");
  for (let i = 0; i < 4; i += 1) E.fire(b, 5, 4 + i);
  assert.equal(P.directionToNearest(b, 0, 0), null);
  assert.equal(P.biggestHiddenDir(b), null);
});

test("whirlwind relocates only unharmed creatures onto unshot cells", () => {
  const rng = seeded(31);
  const b = fullBoard(rng);
  P.seedTreasures(b, 3, rng);
  const wounded = b.ships[0];
  E.fire(b, wounded.dir === "h" ? wounded.x : wounded.x, wounded.y);
  for (let i = 0; i < 10; i += 1) {
    const moved = P.whirlwindMove(b, rng);
    assert.ok(moved, "should find a spot");
    assert.notEqual(moved.id, wounded.id, "wounded stay put");
    for (const c of E.shipCells(moved)) {
      assert.equal(b.shots[E.key(c.x, c.y)], undefined, "moved onto a shot cell");
    }
    assert.equal(E.canPlace(b, moved, moved.id), true);
  }
});

test("extra balloon respects live balloons and unshot cells", () => {
  const rng = seeded(5);
  const b = fullBoard(rng);
  assert.equal(P.canExtraBalloon(b), true);
  assert.equal(P.extraBalloon(b, rng), true);
  assert.equal(P.canExtraBalloon(b), false); // one live balloon max
  E.fire(b, b.decoy.x, b.decoy.y); // pop it
  assert.equal(P.canExtraBalloon(b), true);
  assert.equal(P.extraBalloon(b, rng), true);
  assert.equal(b.shots[E.key(b.decoy.x, b.decoy.y)], undefined);
});

test("new power state starts with the world signature", () => {
  const st = P.newPowerState("dino");
  assert.deepEqual(st.hand, ["trommel"]);
  assert.equal(st.shield, false);
  assert.equal(st.clover, false);
});
