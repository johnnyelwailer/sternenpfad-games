import test from "node:test";
import assert from "node:assert/strict";
import { buildCreature, TINTS, ACCESSORIES } from "../js/models.js";

function bodyColors(root) {
  const out = [];
  root.traverse((o) => {
    if (o.isMesh && o.material?.color) out.push(o.material.color.getHex());
  });
  return out;
}

test("tints really change body material colors", () => {
  for (const worldId of ["ozean", "weltraum", "dino", "teich", "eis", "vulkan", "piraten", "marine"]) {
    for (let idx = 0; idx < 5; idx += 1) {
      const plain = bodyColors(buildCreature(worldId, idx, 3));
      const tinted = bodyColors(buildCreature(worldId, idx, 3, { tint: 1, hat: 0 }));
      assert.equal(plain.length, tinted.length);
      const changed = plain.filter((c, i) => c !== tinted[i]).length;
      assert.ok(changed > 0, `${worldId}#${idx} should visibly change with a tint`);
    }
  }
});

test("different tints give different results", () => {
  const a = bodyColors(buildCreature("ozean", 0, 4, { tint: 1, hat: 0 })).join(",");
  const b = bodyColors(buildCreature("ozean", 0, 4, { tint: 3, hat: 0 })).join(",");
  assert.notEqual(a, b);
});

test("every accessory builds and anchors without crashing", () => {
  for (let hat = 0; hat < ACCESSORIES.length; hat += 1) {
    const g = buildCreature("dino", 2, 3, { tint: 0, hat });
    assert.ok(g.children.length >= 1);
  }
  assert.ok(TINTS.length >= 7);
});
