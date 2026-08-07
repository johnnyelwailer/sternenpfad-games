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
    assert.ok(p.use && p.use.length > 8, `${kind} needs a one-line how-to (use)`);
    assert.ok(["none", "cell", "row", "cell3", "own", "own-cell"].includes(p.target), `${kind} target`);
  }
  // each world has a signature power
  for (const w of ["ozean", "weltraum", "dino", "teich", "eis", "vulkan"]) {
    assert.ok(P.POWERS[P.worldPower(w)], `world power for ${w}`);
  }
  // the new worlds bring their own spells, not hand-me-downs
  assert.equal(P.worldPower("eis"), "frost");
  assert.equal(P.worldPower("vulkan"), "funke");
});

test("Zeitzauber rewinds the freshest wound on the most-injured friend", () => {
  const b = E.createBoard();
  E.placeShip(b, { id: 0, size: 3, x: 0, y: 0, dir: "h" });
  E.placeShip(b, { id: 1, size: 3, x: 0, y: 4, dir: "h" });
  // ship 0 takes two wounds, ship 1 takes one — ship 0 is most endangered
  E.fire(b, 0, 0);
  E.fire(b, 1, 0);
  E.fire(b, 0, 4);
  const healed = P.rewindWound(b);
  assert.equal(healed.ship.id, 0);
  assert.deepEqual(healed.cell, { x: 1, y: 0 }, "the FRESHEST wound heals");
  assert.equal(b.ships[0].hits.length, 1);
  assert.equal(b.shots[E.key(1, 0)], undefined, "the enemy's hit mark is wiped");
  assert.equal(b.shots[E.key(0, 0)], E.HIT, "older wounds stay");
  // the healed cell can be hit again — marks stay truthful
  assert.equal(E.fire(b, 1, 0).result, E.HIT);
});

test("Zeitzauber never resurrects a found creature and fizzles on a healthy fleet", () => {
  const b = E.createBoard();
  E.placeShip(b, { id: 0, size: 2, x: 0, y: 0, dir: "h" });
  assert.equal(P.rewindWound(b), null, "nothing wounded → nothing to heal");
  E.fire(b, 0, 0);
  E.fire(b, 1, 0); // sunk
  assert.equal(P.rewindWound(b), null, "found creatures stay found");
});

test("frost cross and funke plus scans stay in bounds and report ships", () => {
  const b = E.createBoard();
  E.placeShip(b, { id: 0, size: 3, x: 2, y: 4, dir: "h" });
  // mid-board: full 5-cell patterns
  const cross = P.crossCells(b, 3, 3);
  assert.equal(cross.length, 5);
  assert.deepEqual(
    cross.map((c) => `${c.x},${c.y}`).sort(),
    ["2,2", "2,4", "3,3", "4,2", "4,4"]
  );
  const plus = P.plusCells(b, 3, 3);
  assert.equal(plus.length, 5);
  assert.deepEqual(
    plus.map((c) => `${c.x},${c.y}`).sort(),
    ["2,3", "3,2", "3,3", "3,4", "4,3"]
  );
  // corners clamp + dedupe, never leave the board
  for (const cells of [P.crossCells(b, 0, 0), P.plusCells(b, 0, 0), P.crossCells(b, 7, 7), P.plusCells(b, 7, 7)]) {
    assert.ok(cells.length >= 3);
    assert.ok(cells.every((c) => c.x >= 0 && c.y >= 0 && c.x < 8 && c.y < 8));
    assert.equal(new Set(cells.map((c) => `${c.x},${c.y}`)).size, cells.length, "no duplicate cells");
  }
  // scans see the hidden creature
  const seen = P.scanCells(b, P.plusCells(b, 3, 4));
  assert.ok(seen.some((c) => c.ship), "plus scan over the ship reports it");
});

test("treasure defaults are scarce", () => {
  assert.equal(P.TREASURES_PER_BOARD, 1);
  assert.equal(P.HAND_MAX, 2);
  assert.ok(P.RECHARGE_EVERY >= 6);
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
  // the bell's shadow region always CONTAINS the creature (honest fuzz)
  for (let i = 0; i < 20; i += 1) {
    const r = P.biggestHiddenRegion(b);
    assert.equal(r.dir, "v");
    assert.equal(r.size, 4);
    for (const c of E.shipCells(b.ships[0])) {
      assert.ok(Math.abs(c.x - r.cx) <= r.rx + 1e-9, "cell inside shadow (x)");
      assert.ok(Math.abs(c.y - r.cy) <= r.rz + 1e-9, "cell inside shadow (y)");
    }
  }
  for (let i = 0; i < 4; i += 1) E.fire(b, 5, 4 + i);
  assert.equal(P.directionToNearest(b, 0, 0), null);
  assert.equal(P.biggestHiddenRegion(b), null);
});

test("whirlwind relocates creatures onto unshot cells only", () => {
  const rng = seeded(31);
  const b = fullBoard(rng);
  P.seedTreasures(b, 3, rng);
  for (let i = 0; i < 10; i += 1) {
    const res = P.whirlwindMove(b, rng);
    assert.ok(res, "should find a spot");
    for (const c of E.shipCells(res.ship)) {
      assert.equal(b.shots[E.key(c.x, c.y)], undefined, "moved onto a shot cell");
    }
    assert.equal(E.canPlace(b, res.ship, res.ship.id), true);
  }
});

test("whirlwind lets a WOUNDED creature flee: wounds travel, marks wipe", () => {
  const rng = seeded(13);
  const b = E.createBoard(8);
  E.placeShip(b, { id: 0, size: 3, x: 2, y: 2, dir: "h" });
  // the enemy hits the middle segment
  assert.equal(E.fire(b, 3, 2).result, "hit");
  assert.equal(b.shots[E.key(3, 2)], "hit");
  const res = P.whirlwindMove(b, rng, 0);
  assert.ok(res, "wounded creature can still flee");
  const { ship, cleared } = res;
  // the enemy's hit mark on the abandoned cell is wiped...
  assert.deepEqual(cleared, [{ x: 3, y: 2 }]);
  assert.equal(b.shots[E.key(3, 2)], undefined);
  // ...and the SAME segment (the middle) stays wounded at the new spot
  assert.equal(ship.hits.length, 1);
  const cells = E.shipCells(ship);
  assert.deepEqual(ship.hits[0], { x: cells[1].x, y: cells[1].y });
  // finishing it needs only the two unwounded segments
  E.fire(b, cells[0].x, cells[0].y);
  const last = E.fire(b, cells[2].x, cells[2].y);
  assert.equal(last.result, "sunk");
});

test("extra balloon goes exactly where chosen, respecting the rules", () => {
  const b = E.createBoard(8);
  E.placeShip(b, { id: 0, size: 2, x: 0, y: 0, dir: "h" });
  b.treasures = [{ x: 6, y: 6 }];
  E.fire(b, 4, 4); // a known miss mark
  // illegal spots: ON a creature, on a mark, on a treasure — but
  // snuggling right beside a creature is allowed (prime bluff estate)
  assert.equal(P.canExtraBalloonAt(b, 1, 0), false);
  assert.equal(P.canExtraBalloonAt(b, 1, 1), true);
  assert.equal(P.canExtraBalloonAt(b, 4, 4), false);
  assert.equal(P.canExtraBalloonAt(b, 6, 6), false);
  // a legal free cell works — once
  assert.equal(P.extraBalloonAt(b, 5, 1), true);
  assert.deepEqual(b.decoy, { x: 5, y: 1 });
  assert.equal(P.canExtraBalloonAt(b, 3, 6), false); // one live balloon max
  E.fire(b, 5, 1); // pop it
  assert.equal(P.extraBalloonAt(b, 3, 6), true);
});

test("hand starts empty by default; card mode adds the world signature", () => {
  const plain = P.newPowerState("dino");
  assert.deepEqual(plain.hand, []);
  const carded = P.newPowerState("dino", { cards: true });
  assert.deepEqual(carded.hand, ["trommel"]);
  assert.equal(carded.shield, false);
  assert.equal(carded.clover, 0);
});

test("treasure draws never contain world signature cards or the salvo", () => {
  const rng = (() => {
    let s = 11;
    return () => {
      s = (s * 16807) % 2147483647;
      return s / 2147483647;
    };
  })();
  for (let i = 0; i < 300; i += 1) {
    const kind = P.drawPower(rng, [], { instant: true });
    // world signatures never drop, and cardsOnly spells (salvo grants
    // shots, the balloon hides itself) would just confuse on auto-cast
    assert.ok(
      !["welle", "radar", "trommel", "salve", "ballon"].includes(kind),
      `not for a treasure: ${kind}`
    );
    assert.ok(!P.POWERS[kind].cardsOnly, `cardsOnly leaked into instant draw: ${kind}`);
  }
});

test("whirlwindMove honors the chosen creature and refuses sunk ones", () => {
  const rng = seeded(5);
  const b = E.createBoard(8);
  E.placeShip(b, { id: 0, size: 2, x: 0, y: 0, dir: "h" });
  E.placeShip(b, { id: 1, size: 2, x: 5, y: 5, dir: "h" });
  // choosing ship 1 moves exactly ship 1
  const before = { x: b.ships[1].x, y: b.ships[1].y, dir: b.ships[1].dir };
  const res = P.whirlwindMove(b, rng, 1);
  assert.equal(res.ship.id, 1);
  assert.ok(
    res.ship.x !== before.x || res.ship.y !== before.y || res.ship.dir !== before.dir
  );
  assert.deepEqual(res.cleared, []);
  // ship 0 stayed put
  assert.equal(b.ships[0].x, 0);
  assert.equal(b.ships[0].y, 0);
  // a fully found creature cannot flee anymore
  E.fire(b, 0, 0);
  E.fire(b, 1, 0);
  assert.equal(P.whirlwindMove(b, rng, 0), null);
});
