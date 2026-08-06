import test from "node:test";
import assert from "node:assert/strict";
import {
  useStore,
  loadProgress,
  totalStickers,
  stickerCount,
  awardSticker,
  isHatUnlocked,
  unlockedHatKinds,
  nextUnlock,
  HAT_KINDS,
  HAT_UNLOCKS,
} from "../js/progress.js";

function memStore() {
  let data = null;
  return {
    get: () => data,
    set: (v) => {
      data = v;
    },
  };
}

test.beforeEach(() => {
  useStore(memStore());
});

test("fresh progress is empty, party hat free, rest locked", () => {
  const p = loadProgress();
  assert.equal(totalStickers(p), 0);
  assert.equal(isHatUnlocked(0), true); // no hat
  assert.equal(isHatUnlocked(HAT_KINDS.indexOf("party")), true);
  assert.equal(isHatUnlocked(HAT_KINDS.indexOf("krone")), false);
  assert.deepEqual(unlockedHatKinds(), ["party"]);
});

test("awarding prefers missing creatures until the world is complete", () => {
  const seen = new Set();
  for (let i = 0; i < 5; i += 1) {
    const r = awardSticker("ozean", () => 0.01);
    assert.equal(r.isNew, true);
    assert.equal(seen.has(r.idx), false);
    seen.add(r.idx);
  }
  assert.equal(seen.size, 5);
  // world complete → duplicates allowed, marked as not new
  const dup = awardSticker("ozean", () => 0.01);
  assert.equal(dup.isNew, false);
  assert.equal(totalStickers(), 6);
  assert.equal(stickerCount("ozean", dup.idx) >= 2, true);
});

test("hats unlock at their thresholds and are reported once", () => {
  const collected = [];
  for (let i = 0; i < HAT_UNLOCKS.zauberhut; i += 1) {
    const r = awardSticker(i < 5 ? "ozean" : i < 10 ? "dino" : "teich", () => 0.5);
    collected.push(...r.newHats);
  }
  assert.deepEqual(
    collected.sort(),
    ["blume", "kappe", "krone", "propeller", "schleife", "zauberhut"].sort()
  );
  assert.equal(isHatUnlocked(HAT_KINDS.indexOf("zauberhut")), true);
  assert.equal(nextUnlock(), null);
});

test("tints have their own unlock ladder", async () => {
  const { isTintUnlocked } = await import("../js/progress.js");
  assert.equal(isTintUnlocked(1), true); // free tints
  assert.equal(isTintUnlocked(3), true);
  assert.equal(isTintUnlocked(4), false);
  for (let i = 0; i < 3; i += 1) awardSticker("ozean", () => 0.5);
  assert.equal(isTintUnlocked(4), true);
  assert.equal(isTintUnlocked(6), false);
});

test("nextUnlock counts down to the closest locked hat", () => {
  assert.deepEqual(nextUnlock(), { kind: "blume", at: 2, remaining: 2 });
  awardSticker("teich", () => 0.2);
  assert.deepEqual(nextUnlock(), { kind: "blume", at: 2, remaining: 1 });
});

test("corrupt storage falls back to empty progress", () => {
  const s = memStore();
  s.set("{nope");
  useStore(s);
  assert.deepEqual(loadProgress(), { stickers: {}, wins: 0 });
});
