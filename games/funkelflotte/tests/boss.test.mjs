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
} from "../js/boss.js";

const rngOf = (...vals) => {
  let i = 0;
  return () => vals[i++ % vals.length];
};

test("boss placement clamps to the board and rotation fits", () => {
  const st = createBoss(rngOf(0.1));
  assert.equal(placeBoss(st, 7, 7, "h"), true);
  assert.deepEqual(st.boss, { x: 3, y: 7, dir: "h" });
  assert.equal(placeBoss(st, 7, 7, "v"), true);
  assert.deepEqual(st.boss, { x: 7, y: 3, dir: "v" });
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
  const r = bossShoot(st, 4, 7);
  assert.ok(r.faded.includes("7,7"));
});

test("robo monster flees the last shot", () => {
  const st = createBoss(rngOf(0.1));
  placeBoss(st, 2, 3, "h");
  const before = st.boss.y;
  roboBossMove(st, { x: 4, y: 0 }, rngOf(0.1)); // shot above → flee down
  assert.ok(st.boss.y >= before);
});
