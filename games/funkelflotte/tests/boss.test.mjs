import test from "node:test";
import assert from "node:assert/strict";
import {
  createBoss,
  placeBoss,
  bossCells,
  bossShoot,
  segmentAt,
  legalBossMoves,
  moveBoss,
  roboBossMove,
  BOSS_SIZE,
  BOSS_SHOTS,
  HUNT_FLEET,
  HUNT_TREASURES,
  FREEZE_MOVES,
  createHunt,
  fleetCells,
  fleetAlive,
  fleetHealthyCells,
  fleetShipAt,
  treasureIdxAt,
  drawHuntPower,
  huntBossMove,
} from "../js/boss.js";

const rngOf = (...vals) => {
  let i = 0;
  return () => vals[i++ % vals.length];
};

test("boss placement clamps to the board and rotation fits", () => {
  const st = createBoss(rngOf(0.1));
  assert.equal(placeBoss(st, 7, 7, "h"), true);
  assert.deepEqual(st.boss, { x: 8 - BOSS_SIZE, y: 7, dir: "h" });
  assert.equal(placeBoss(st, 7, 7, "v"), true);
  assert.deepEqual(st.boss, { x: 7, y: 8 - BOSS_SIZE, dir: "v" });
  assert.equal(bossCells(st).length, BOSS_SIZE);
});

test("wounds stick to body segments and travel with moves", () => {
  const st = createBoss(rngOf(0.1));
  placeBoss(st, 1, 1, "h"); // cells (1,1)..(5,1)
  const hit = bossShoot(st, 3, 1);
  assert.equal(hit.result, "hit");
  assert.equal(hit.seg, 2);
  assert.equal(hit.newWound, true);
  assert.equal(hit.wounds, 1);
  // monster shuffles right — the wounded segment is now at (4,1)
  assert.equal(moveBoss(st, 1, 0), true);
  assert.equal(segmentAt(st, 4, 1), 2);
  // hitting the same segment again is a hit but no new wound
  const again = bossShoot(st, 4, 1);
  assert.equal(again.newWound, false);
  assert.equal(again.wounds, 1);
});

test("five wounds defeat the monster; running dry lets it escape", () => {
  const st = createBoss(rngOf(0.1), { shots: 6 });
  placeBoss(st, 0, 0, "h");
  for (let i = 0; i < BOSS_SIZE; i += 1) {
    const r = bossShoot(st, i, 0);
    assert.equal(r.result, "hit");
    assert.equal(r.defeated, i === BOSS_SIZE - 1);
  }
  assert.equal(st.defeated, true);
  assert.equal(bossShoot(st, 0, 0).result, "over");

  const st2 = createBoss(rngOf(0.1), { shots: 1 });
  placeBoss(st2, 0, 0, "h");
  const r2 = bossShoot(st2, 7, 7);
  assert.equal(r2.result, "miss");
  assert.equal(r2.escaped, true);
  assert.ok(r2.dist >= 1);
});

test("distance marks fade and walls constrain moves", () => {
  const st = createBoss(rngOf(0.1), { shots: BOSS_SHOTS });
  placeBoss(st, 0, 0, "h"); // hugging the top-left corner
  const moves = legalBossMoves(st);
  assert.deepEqual(
    moves.map((m) => `${m.dx},${m.dy}`).sort(),
    ["0,1", "1,0"]
  );
  bossShoot(st, 7, 7);
  assert.ok(st.marks["7,7"]);
  bossShoot(st, 6, 7);
  bossShoot(st, 5, 7);
  bossShoot(st, 4, 7);
  const r = bossShoot(st, 3, 7);
  assert.ok(r.faded.includes("7,7"));
});

test("robo monster flees the last shot", () => {
  const st = createBoss(rngOf(0.1));
  placeBoss(st, 2, 3, "h");
  const before = st.boss.y;
  roboBossMove(st, { x: 4, y: 0 }, rngOf(0.1)); // shot above → flee down
  assert.ok(st.boss.y >= before);
});

// ------------------------------------------------------------- hunt mode

test("createHunt places the full fleet and chests clear of everything", () => {
  for (let round = 0; round < 20; round += 1) {
    const st = createHunt();
    assert.equal(st.hunt, true);
    assert.equal(st.fleet.length, HUNT_FLEET.length);
    assert.equal(st.treasures.length, HUNT_TREASURES);
    const seen = new Set(bossCells(st).map((c) => `${c.x},${c.y}`));
    for (const ship of st.fleet) {
      assert.equal(ship.hits.length, 0);
      assert.ok(ship.id >= 10, "fleet ids stay clear of the monster's id");
      for (const c of fleetCells(ship)) {
        const k = `${c.x},${c.y}`;
        assert.ok(c.x >= 0 && c.y >= 0 && c.x < st.size && c.y < st.size, "fleet on the board");
        assert.equal(seen.has(k), false, "no overlap with monster or fleet");
        seen.add(k);
      }
    }
    for (const t of st.treasures) {
      const k = `${t.x},${t.y}`;
      assert.equal(seen.has(k), false, "chest on a free cell");
      seen.add(k);
    }
  }
});

test("hunt monster homes in on the fleet and bites what it steps on", () => {
  const st = createHunt(rngOf(0.1));
  // stage a deterministic duel: monster left, one creature to its right
  placeBoss(st, 0, 0, "h"); // cells (0,0)..(5,0)
  st.fleet = [{ id: 10, size: 2, x: 7, y: 0, dir: "v", hits: [] }];
  st.treasures = [];
  st.rest = true; // next bossRests() call returns false → it moves
  st.freeze = 0;
  const mv = huntBossMove(st, rngOf(0.9));
  assert.ok(mv.moved, "the monster moves");
  assert.equal(mv.moved.dx, 1, "… straight toward the creature");
  // walk it onto the creature: each contact step takes exactly one bite
  st.rest = true;
  const mv2 = huntBossMove(st, rngOf(0.9));
  assert.ok(mv2.bite, "stepping onto the creature bites it");
  assert.equal(st.fleet[0].hits.length, 1);
  assert.equal(mv2.destroyed, false);
  st.rest = true;
  const mv3 = huntBossMove(st, rngOf(0.9));
  assert.ok(mv3.bite);
  assert.equal(mv3.destroyed, true, "second bite fells the 2-cell creature");
  assert.equal(mv3.allGone, true, "… and the fleet is gone");
  assert.equal(fleetAlive(st), 0);
});

test("freeze roots the monster and resting keeps the kid-fair rhythm", () => {
  const st = createHunt(rngOf(0.1));
  placeBoss(st, 0, 0, "h");
  st.fleet = [{ id: 10, size: 3, x: 7, y: 5, dir: "v", hits: [] }];
  st.freeze = FREEZE_MOVES;
  const pos = { ...st.boss };
  for (let i = FREEZE_MOVES; i > 0; i -= 1) {
    const mv = huntBossMove(st);
    assert.equal(mv.frozen, true);
    assert.equal(mv.freezeLeft, i - 1);
    assert.deepEqual(st.boss, pos, "frozen = not a single step");
  }
  st.rest = false; // next call: rest turn
  const rested = huntBossMove(st);
  assert.equal(rested.rested, true);
  assert.deepEqual(st.boss, pos);
});

test("hunt helpers find fleet ships and chests; power pool is sane", () => {
  const st = createHunt(rngOf(0.1));
  st.fleet = [{ id: 10, size: 2, x: 3, y: 3, dir: "h", hits: [{ x: 3, y: 3 }] }];
  st.treasures = [{ x: 6, y: 6 }];
  assert.equal(fleetShipAt(st, 4, 3).id, 10);
  assert.equal(fleetShipAt(st, 5, 3), null);
  assert.equal(treasureIdxAt(st, 6, 6), 0);
  assert.equal(treasureIdxAt(st, 0, 0), -1);
  assert.deepEqual(fleetHealthyCells(st), [{ x: 4, y: 3 }]);
  for (let i = 0; i < 30; i += 1) {
    assert.ok(["doppel", "frost", "glocke"].includes(drawHuntPower()));
  }
  // hunt boards start with a big shot bank — the fleet is the clock
  assert.ok(st.shotsLeft > 100);
});
