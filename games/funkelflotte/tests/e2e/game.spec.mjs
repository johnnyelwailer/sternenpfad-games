import { test, expect } from "@playwright/test";

const GAME = "/games/funkelflotte/";

// The board lives on a WebGL canvas; tests drive board interaction via
// the window.__FF test hooks and assert on game state + DOM overlays.

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("ff-muted", "1"));
  await page.goto(GAME);
  await page.waitForFunction(() => !!window.__FF);
});

// title → robo game (difficulty picker in between)
async function startRobo(page) {
  await page.locator('[data-mode="ai"]').click();
  await page.locator('[data-robo="leicht"]').click();
}

async function firstUnknownCell(page, boardIdx) {
  return page.evaluate((idx) => {
    const marks = window.__FF.marksOn(idx) || {};
    const size = window.__FF.state.boards[idx]?.size ?? 8;
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        if (!marks[`${x},${y}`]) return { x, y };
      }
    }
    return null;
  }, boardIdx);
}

test("title screen shows worlds and modes, world picking re-themes", async ({ page }) => {
  await expect(page.locator("h1.logo")).toContainText("Funkel-Flotte");
  await expect(page.locator("#world-grid .world-card")).toHaveCount(6);
  await expect(page.locator('[data-mode="ai"]')).toBeVisible();
  const before = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue("--ui").trim()
  );
  await page.locator('#world-grid [data-world="weltraum"]').click();
  await expect(page.locator('#world-grid [data-world="weltraum"]')).toHaveClass(/selected/);
  const after = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue("--ui").trim()
  );
  expect(after).not.toBe(before);
  // world thumbnails are rendered from the real 3D models
  await expect(page.locator("#world-grid .world-card img").first()).toHaveAttribute(
    "src",
    /^data:image\/png/
  );
  // the (empty) toast pill must be truly invisible, not just slid down
  await expect(page.locator("#toast")).toBeHidden();
  // ...but toasts still appear when they carry a message
  await page.evaluate(() => document.getElementById("toast").classList.add("show"));
  await expect(page.locator("#toast")).toBeVisible();
});

test("new worlds: Eisberg-Bucht plays a battle, Frost-Stern scans its cross", async ({ page }) => {
  test.setTimeout(120000);
  await page.evaluate(() => window.__FF.setFast());
  // pick the new ice world and check it themes the UI
  await page.locator('#world-grid [data-world="eis"]').click();
  await expect(page.locator('#world-grid [data-world="eis"]')).toHaveClass(/selected/);
  expect(
    await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--ui").trim())
  ).toBe("#0d3550");

  await startRobo(page);
  await page.locator("#btn-place-done").click();
  await waitMyTurn(page);
  expect(await page.evaluate(() => window.__FF.state.worlds[0])).toBe("eis");

  // dig up the ice world's signature spell from the chest
  await page.evaluate(() => window.__FF.forceTreasure("frost"));
  const chest = await page.evaluate(() => {
    const t = window.__FF.state.boards[1].treasures[0];
    t.revealed = true;
    return { x: t.x, y: t.y };
  });
  await tapWhenMyTurn(page, chest.x, chest.y);
  await expect(page.locator("#status")).toContainText("Schatz-Zauber wartet", { timeout: 15000 });

  // aim at a creature cell: the star must report it without firing
  const shipCell = await page.evaluate(() => {
    const b = window.__FF.state.boards[1];
    return window.__FF.engine.shipCells(b.ships[0])[0];
  });
  // offline the scan resolves synchronously — grab the status in the same tick
  // (in FAST mode it is replaced ~140ms later when the turn passes)
  const statusText = await page.evaluate(([x, y]) => {
    window.__FF.tap(x, y);
    return document.getElementById("status").textContent;
  }, [shipCell.x, shipCell.y]);
  expect(statusText).toContain("Eisstern");
  // an info scan is not a shot — the cell carries no mark and the turn passes
  expect(await page.evaluate((k) => window.__FF.marksOn(1)[k], `${shipCell.x},${shipCell.y}`)).toBeFalsy();
  await expect.poll(() => page.evaluate(() => window.__FF.state.turn), { timeout: 15000 }).toBe(1);
});

test("power-gain card: the dismissing tap never doubles as a board shot", async ({ page }) => {
  test.setTimeout(120000);
  // NOT fast mode: the card must wait for the player, like in real play
  await startRobo(page);
  await page.locator("#btn-place-done").click();
  await waitMyTurn(page);

  // dig up a cell-target spell so the game sits waiting for an aim tap
  await page.evaluate(() => window.__FF.forceTreasure("fernglas"));
  const chest = await page.evaluate(() => {
    const t = window.__FF.state.boards[1].treasures[0];
    t.revealed = true;
    return { x: t.x, y: t.y };
  });
  await tapWhenMyTurn(page, chest.x, chest.y);
  await expect(page.locator("#power-gain")).toBeVisible({ timeout: 15000 });
  await expect.poll(() => page.evaluate(() => window.__FF.state.pendingPower)).toBe("fernglas");
  await page.waitForTimeout(200); // the dismiss listener arms 50ms after show

  // a REAL tap right on a board cell — a free cell near the board center,
  // where the tilted-camera projection is most forgiving
  const cell = await page.evaluate(() => {
    const b = window.__FF.state.boards[1];
    const E = window.__FF.engine;
    const occupied = new Set(Object.keys(b.shots || {}));
    for (const s of b.ships) for (const c of E.shipCells(s)) occupied.add(`${c.x},${c.y}`);
    if (b.decoy) occupied.add(`${b.decoy.x},${b.decoy.y}`);
    for (const t of b.treasures ?? []) occupied.add(`${t.x},${t.y}`);
    const mid = (b.size - 1) / 2;
    let best = null;
    let bestD = Infinity;
    for (let y = 0; y < b.size; y += 1) {
      for (let x = 0; x < b.size; x += 1) {
        if (occupied.has(`${x},${y}`)) continue;
        const d = Math.abs(x - mid) + Math.abs(y - mid);
        if (d < bestD) {
          bestD = d;
          best = { x, y };
        }
      }
    }
    return best;
  });
  const pos = await page.evaluate(([x, y]) => window.__FF.cellPos("enemy", x, y), [cell.x, cell.y]);
  const marksBefore = await page.evaluate(() => Object.keys(window.__FF.marksOn(1)).length);
  await page.mouse.click(pos.x, pos.y);

  // the card is gone, but the tap did NOT aim the spell or shoot the cell
  await expect(page.locator("#power-gain")).toBeHidden();
  expect(await page.evaluate(() => window.__FF.state.pendingPower)).toBe("fernglas");
  expect(await page.evaluate(() => Object.keys(window.__FF.marksOn(1)).length)).toBe(marksBefore);

  // the SAME real tap with no card up aims the spell — proving the first
  // one only died because it was spent on dismissing
  await page.waitForTimeout(400); // beyond the click-squelch window
  await page.mouse.click(pos.x, pos.y);
  await expect.poll(() => page.evaluate(() => window.__FF.state.pendingPower), { timeout: 15000 }).toBe(null);
  await expect(page.locator("#status")).toContainText("such gleich weiter", { timeout: 15000 });
});

test("a chest right next to a found creature can still be opened", async ({ page }) => {
  test.setTimeout(120000);
  await page.evaluate(() => window.__FF.setFast());
  await startRobo(page);
  await page.locator("#btn-place-done").click();
  await waitMyTurn(page);

  // move the chest to a cell hugging the first creature, then sink it
  await page.evaluate(() => window.__FF.forceTreasure("doppel"));
  const setup = await page.evaluate(() => {
    const { state, engine } = window.__FF;
    const b = state.boards[1];
    const ship = b.ships.find((s) => s.size === 2 && s.shape !== "sq") ?? b.ships[b.ships.length - 1];
    const cells = engine.shipCells(ship);
    // find a free in-bounds neighbour of the ship for the chest
    let spot = null;
    outer: for (const c of cells) {
      for (const [dx, dy] of [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]]) {
        const x = c.x + dx;
        const y = c.y + dy;
        if (x < 0 || y < 0 || x >= b.size || y >= b.size) continue;
        if (engine.shipAt(b, x, y)) continue;
        if (b.decoy && b.decoy.x === x && b.decoy.y === y) continue;
        spot = { x, y };
        break outer;
      }
    }
    b.treasures = [{ x: spot.x, y: spot.y, revealed: true }];
    return { cells, spot };
  });
  for (const c of setup.cells) await tapWhenMyTurn(page, c.x, c.y);
  // the creature is found; its water ring is revealed — but NOT the chest
  await expect
    .poll(() => page.evaluate((k) => window.__FF.marksOn(1)[k] ?? null, `${setup.spot.x},${setup.spot.y}`), {
      timeout: 15000,
    })
    .toBe(null);
  // digging still works: the chest yields its spell
  await tapWhenMyTurn(page, setup.spot.x, setup.spot.y);
  await expect
    .poll(() => page.evaluate(() => window.__FF.state.boards[1].treasures.length), { timeout: 15000 })
    .toBe(0);
});

test("placement: 5 valid creatures, shuffle keeps validity, rotate works", async ({ page }) => {
  await startRobo(page);
  await expect(page.locator("#btn-place-done")).toBeVisible();
  const shipCount = await page.evaluate(() => window.__FF.placementBoard().ships.length);
  expect(shipCount).toBe(5);

  await page.locator("#btn-shuffle").click();
  const valid = await page.evaluate(() => {
    const { placementBoard, engine } = window.__FF;
    const b = placementBoard();
    return b.ships.every((s) => engine.canPlace(b, s, s.id));
  });
  expect(valid).toBe(true);

  // rotation via engine keeps the fleet valid
  await page.evaluate(() => window.__FF.rotateFirst());
  const stillValid = await page.evaluate(() => {
    const { placementBoard, engine } = window.__FF;
    const b = placementBoard();
    return b.ships.every((s) => engine.canPlace(b, s, s.id));
  });
  expect(stillValid).toBe(true);
});

test("customizer opens by tapping a friend in the aquarium", async ({ page }) => {
  await page.addInitScript(() =>
    localStorage.setItem(
      "ff-progress",
      JSON.stringify({ stickers: { "ozean-0": 1 }, wins: 1 })
    )
  );
  await page.reload();
  await page.waitForFunction(() => !!window.__FF);
  await page.evaluate(() => window.__FF.setFast());
  await page.locator("#btn-aquarium").click();

  // tap around until we hit the (wandering) friend — that opens styling
  for (let y = 0; y < 8; y += 1) {
    for (let x = 0; x < 8; x += 1) {
      if (!(await page.locator("#customizer").isHidden())) break;
      await page.evaluate(([tx, ty]) => window.__FF.aquariumTap(tx, ty), [x, y]);
      await page.waitForTimeout(90);
    }
  }
  await expect(page.locator("#customizer")).toBeVisible();
  await expect(page.locator("#cust-count")).toContainText("1 / 1");

  // pick the 2nd tint and the next hat
  await page.locator("#cust-tints .tint-dot").nth(1).click();
  await page.locator("#cust-hat-next").click();
  await expect(page.locator("#cust-tints .tint-dot").nth(1)).toHaveClass(/selected/);
  await expect(page.locator("#cust-hat-name")).not.toHaveText("Ohne Hut");
  const stored = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("ff-custom-ozean") || "{}")
  );
  expect(stored[0]).toEqual({ tint: 1, hat: 1 });

  // sticker-locked items show locked and cannot be picked yet
  await expect(page.locator("#cust-tints .tint-dot.locked").first()).toBeVisible();
  await page.locator("#cust-tints .tint-dot").nth(5).click(); // locked tint
  const still = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("ff-custom-ozean") || "{}")
  );
  expect(still[0].tint).toBe(1);

  await page.locator("#btn-cust-done").click();
  await expect(page.locator("#customizer")).toBeHidden();

  // the fleet wears the aquarium styles in the next battle
  await page.locator("#btn-home").click();
  await startRobo(page);
  const applied = await page.evaluate(() => window.__FF.state.customs[0]);
  expect(applied[0]).toEqual({ tint: 1, hat: 1 });
});

test("placement: the menu button swaps worlds and shows options", async ({ page }) => {
  await startRobo(page);
  await expect(page.locator("#btn-opts")).toBeVisible();
  await page.locator("#btn-opts").click();
  await expect(page.locator("#screen-options")).toHaveClass(/active/);
  await expect(page.locator("#opt-world")).toBeVisible();
  await page.locator("#opt-world").click();
  await expect(page.locator("#screen-worldpick")).toHaveClass(/active/);
  await page.locator('#world-grid-2 [data-world="dino"]').click();
  await page.locator("#btn-worldpick-go").click();
  await expect(page.locator("#btn-place-done")).toBeVisible();
  expect(await page.evaluate(() => window.__FF.state.worlds[0])).toBe("dino");
  // options back returns into the running game
  await page.locator("#btn-opts").click();
  await page.locator("#btn-options-back").click();
  await expect(page.locator("#btn-place-done")).toBeVisible();
  // from the title, the world entry is hidden
  await page.locator("#btn-home").click();
  await page.locator("#btn-options").click();
  await expect(page.locator("#opt-world")).toBeHidden();
});

test("robo game: my shots mark the enemy board, robo answers on mine", async ({ page }) => {
  await startRobo(page);
  await page.locator("#btn-place-done").click();
  await expect(page.locator("#status")).toContainText("Du bist dran", { timeout: 10000 });

  // shoot until a miss hands the turn to robo
  for (let i = 0; i < 30; i += 1) {
    const cell = await firstUnknownCell(page, 1);
    await page.evaluate(([x, y]) => window.__FF.tap(x, y), [cell.x, cell.y]);
    await page.waitForTimeout(650);
    const st = await page.evaluate(() => window.__FF.state.turn);
    if (st === 1) break;
  }
  const enemyMarks = await page.evaluate(() => Object.keys(window.__FF.marksOn(1)).length);
  expect(enemyMarks).toBeGreaterThan(0);
  // robo shoots back within a few seconds
  await expect
    .poll(async () => page.evaluate(() => Object.keys(window.__FF.marksOn(0) || {}).length), {
      timeout: 20000,
    })
    .toBeGreaterThan(0);
});

test("update poller: new deployment shows the reload banner on the title", async ({ page }) => {
  let version = "v1";
  await page.route("**/version.json*", (route) =>
    route.fulfill({ contentType: "application/json", body: JSON.stringify({ v: version }) })
  );
  await page.reload();
  await page.waitForFunction(() => !!window.__FF);

  // same version → no banner
  expect(await page.evaluate(() => window.__FF.checkUpdate())).toBe(false);
  await expect(page.locator("#update-banner")).toBeHidden();

  // a new deployment lands
  version = "v2";
  expect(await page.evaluate(() => window.__FF.checkUpdate())).toBe(true);
  await expect(page.locator("#update-banner")).toBeVisible();

  // mid-game the banner stays out of the way, and returns on the title
  await startRobo(page);
  await expect(page.locator("#update-banner")).toBeHidden();
  await page.locator("#btn-home").click();
  await expect(page.locator("#update-banner")).toBeVisible();

  // tapping it reloads the app — and adopts v2 as the known version.
  // The reload clears the SW caches first, so wait for the FRESH page
  // (its banner carries the static HTML text again).
  await page.locator("#update-banner").click();
  await page.waitForFunction(
    () => !!window.__FF && document.getElementById("update-banner").textContent.includes("Neue Version"),
    null,
    { timeout: 30000 }
  );
  await expect(page.locator("h1.logo")).toContainText("Funkel-Flotte");
  expect(await page.evaluate(() => localStorage.getItem("ff-version"))).toBe("v2");
  await expect(page.locator("#update-banner")).toBeHidden();

  // the crucial everyday case: app closed, v3 deployed, app reopened —
  // the persisted baseline makes the banner appear right at boot
  version = "v3";
  await page.reload();
  await page.waitForFunction(() => !!window.__FF);
  await expect(page.locator("#update-banner")).toBeVisible({ timeout: 10000 });
});

test("robo difficulty picker: schlau robo is selectable", async ({ page }) => {
  await page.locator('[data-mode="ai"]').click();
  await expect(page.locator("#screen-robo")).toHaveClass(/active/);
  await page.locator('[data-robo="schlau"]').click();
  await expect(page.locator("#btn-place-done")).toBeVisible();
  expect(await page.evaluate(() => window.__FF.state.aiState.difficulty)).toBe("schlau");
});

async function waitMyTurn(page) {
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            window.__FF.state.phase === "battle" &&
            window.__FF.state.turn === 0 &&
            !window.__FF.state.inputLocked
        ),
      { timeout: 30000 }
    )
    .toBe(true);
}

// tap atomically: only when it is really my turn, verifying the shot
// registered — robo timers can steal the turn between poll and tap
async function tapWhenMyTurn(page, x, y) {
  for (let i = 0; i < 200; i += 1) {
    const ok = await page.evaluate(([tx, ty]) => {
      const st = window.__FF.state;
      if (st.phase !== "battle" || st.turn !== 0 || st.inputLocked) return false;
      window.__FF.tap(tx, ty);
      return !!window.__FF.marksOn(1)[`${tx},${ty}`];
    }, [x, y]);
    if (ok) return;
    await page.waitForTimeout(150);
  }
  throw new Error(`could not tap ${x},${y}`);
}

// cells guaranteed to be plain water on robo's board — no ship, no
// balloon, no hidden treasure (treasures would hijack the turn flow)
async function missCells(page, count) {
  return page.evaluate((n) => {
    const b = window.__FF.state.boards[1];
    const E = window.__FF.engine;
    const occupied = new Set(Object.keys(b.shots || {}));
    for (const s of b.ships) for (const c of E.shipCells(s)) occupied.add(`${c.x},${c.y}`);
    if (b.decoy) occupied.add(`${b.decoy.x},${b.decoy.y}`);
    for (const t of b.treasures ?? []) occupied.add(`${t.x},${t.y}`);
    const out = [];
    for (let y = 0; y < b.size && out.length < n; y += 1) {
      for (let x = 0; x < b.size && out.length < n; x += 1) {
        if (!occupied.has(`${x},${y}`)) out.push({ x, y });
      }
    }
    return out;
  }, count);
}

test("feature flags: new features can be switched off via URL", async ({ page }) => {
  await page.goto(`${GAME}?flags=styles:0,rules:0,stickers:0,powers:0,variety:0`);
  await page.waitForFunction(() => !!window.__FF);
  await expect(page.locator("#btn-album")).toBeHidden();
  await page.locator("#btn-options").click();
  await expect(page.locator("#rule-decoy")).toBeHidden();
  await expect(page.locator("#opt-powers")).toBeHidden();
  await expect(page.locator("#board-presets")).toBeHidden();
  await expect(page.locator("#rule-touch")).toBeHidden();
  await page.locator("#btn-options-back").click();
  await startRobo(page);
  await expect(page.locator("#btn-place-done")).toBeVisible();
  // defaults stay on without the override
  await page.goto(GAME);
  await page.waitForFunction(() => !!window.__FF);
  await expect(page.locator("#btn-album")).toBeVisible();
  await page.locator("#btn-options").click();
  await expect(page.locator("#sect-rules summary")).toBeVisible();
  await expect(page.locator("#sect-zauber summary")).toBeVisible();
  await expect(page.locator("#board-presets")).not.toBeHidden();
  // the collapsed sections open on tap
  await page.locator("#sect-rules summary").click();
  await expect(page.locator("#rule-decoy")).not.toBeHidden();
  await page.locator("#sect-zauber summary").click();
  await expect(page.locator("#opt-powers")).not.toBeHidden();
});

test("Zauber-Kräfte: legend explains, world power + treasure + powers work", async ({ page }) => {
  test.setTimeout(180000);

  // the options screen explains every power (inside the Zauber section)
  await page.locator("#btn-options").click();
  await expect(page.locator("#screen-options")).toHaveClass(/active/);
  await page.evaluate(() => (document.querySelector("#sect-zauber").open = true));
  await page.locator("#btn-powers-legend").click();
  expect(await page.locator(".legend-row").count()).toBeGreaterThanOrEqual(13);
  await page.locator("#btn-options-back").click();

  // enable the opt-in card hand for this test
  await page.locator("#btn-options").click();
  await page.evaluate(() => (document.querySelector("#sect-zauber").open = true));
  await page.locator("#opt-cards").click({ force: true });
  await page.locator("#btn-options-back").click();

  await page.evaluate(() => window.__FF.setFast());
  await startRobo(page);
  await page.locator("#btn-place-done").click();
  await waitMyTurn(page);

  // ozean's world card is in hand, ONE visible treasure per board
  expect(await page.evaluate(() => window.__FF.state.powers[0].hand)).toEqual(["welle"]);
  expect(await page.evaluate(() => window.__FF.state.boards[1].treasures.length)).toBe(1);
  await expect(page.locator('.power-chip[data-power="welle"]')).toBeVisible();
  // chips carry rendered icons, not glyphs
  await expect(page.locator(".power-chip .power-icon").first()).toHaveAttribute(
    "src",
    /^data:image\/png/
  );

  // dig up the visible treasure: the spell fires on the spot, then the
  // turn passes — nothing is stored in the hand
  const t = await page.evaluate(() => window.__FF.state.boards[1].treasures[0]);
  await page.evaluate(([x, y]) => window.__FF.tap(x, y), [t.x, t.y]);
  await expect
    .poll(() => page.evaluate(() => window.__FF.state.boards[1].treasures.length))
    .toBe(0);
  await page.waitForTimeout(600);
  const pending = await page.evaluate(() => window.__FF.state.pendingPower);
  if (pending) {
    // the freed spell wants a target — feed it one
    const [cell] = await missCells(page, 1);
    await page.evaluate(([x, y]) => window.__FF.tap(x, y), [cell.x, cell.y]);
  }
  await waitMyTurn(page); // spell resolved, turn cycled back to us
  expect(await page.evaluate(() => window.__FF.state.powers[0].hand)).toEqual(["welle"]);

  // fernglas peeks a creature cell without marking it
  await page.evaluate(() => window.__FF.power("fernglas"));
  await page.locator('.power-chip[data-power="fernglas"]').click();
  await expect(page.locator('.power-chip[data-power="fernglas"]')).toHaveClass(/armed/);
  const shipCell = await page.evaluate(() => {
    const b = window.__FF.state.boards[1];
    return window.__FF.engine.shipCells(b.ships[0])[0];
  });
  await page.evaluate(([x, y]) => window.__FF.tap(x, y), [shipCell.x, shipCell.y]);
  await expect(page.locator("#status")).toContainText("versteckt sich jemand");
  expect(
    await page.evaluate((k) => window.__FF.marksOn(1)[k] ?? null, `${shipCell.x},${shipCell.y}`)
  ).toBeNull();
  expect(await page.evaluate(() => window.__FF.state.powers[0].hand.includes("fernglas"))).toBe(false);

  // doppelschuss forgives the next miss
  await page.evaluate(() => window.__FF.power("doppel"));
  await waitMyTurn(page);
  await page.locator('.power-chip[data-power="doppel"]').click();
  expect(await page.evaluate(() => window.__FF.state.powers[0].doubleShot)).toBe(true);
  const water = await missCells(page, 8);
  const free = [];
  const treasures = await page.evaluate(() => window.__FF.state.boards[1].treasures);
  for (const c of water) {
    if (!treasures.some((tt) => tt.x === c.x && tt.y === c.y)) free.push(c);
  }
  await page.evaluate(([x, y]) => window.__FF.tap(x, y), [free[0].x, free[0].y]);
  await expect
    .poll(() => page.evaluate(() => window.__FF.state.powers[0].doubleShot))
    .toBe(false);
  expect(await page.evaluate(() => window.__FF.state.turn)).toBe(0);
});

test("cards are off by default: empty hand, treasures still work", async ({ page }) => {
  await page.evaluate(() => window.__FF.setFast());
  await startRobo(page);
  await page.locator("#btn-place-done").click();
  await waitMyTurn(page);
  expect(await page.evaluate(() => window.__FF.state.powers[0].hand)).toEqual([]);
  await expect(page.locator(".power-chip")).toHaveCount(0);
  expect(await page.evaluate(() => window.__FF.state.boards[1].treasures.length)).toBe(1);
});

test("Doppelschuss from a treasure grants two shots right away", async ({ page }) => {
  test.setTimeout(120000);
  await page.evaluate(() => window.__FF.setFast());
  await startRobo(page);
  await page.locator("#btn-place-done").click();
  await waitMyTurn(page);

  // plant a Doppelschuss in the chest, surface it, and dig it up
  await page.evaluate(() => window.__FF.forceTreasure("doppel"));
  const chest = await page.evaluate(() => {
    const t = window.__FF.state.boards[1].treasures[0];
    t.revealed = true;
    return { x: t.x, y: t.y };
  });
  await tapWhenMyTurn(page, chest.x, chest.y);

  // the turn does NOT pass: we may search immediately
  await expect(page.locator("#status")).toContainText("ZWEIMAL", { timeout: 15000 });
  await expect
    .poll(() => page.evaluate(() => window.__FF.state.turn === 0 && !window.__FF.state.inputLocked))
    .toBe(true);
  // the forgiven-miss badge is up
  await expect(page.locator('.power-badge[data-kind="doppel"]')).toBeVisible();

  // shot 1 misses — still our turn (the forgiveness fires)
  const [c1] = await missCells(page, 1);
  await tapWhenMyTurn(page, c1.x, c1.y);
  await expect
    .poll(() => page.evaluate(() => window.__FF.state.turn === 0 && !window.__FF.state.inputLocked), {
      timeout: 15000,
    })
    .toBe(true);
  // shot 2 misses — now the turn passes to robo
  const [c2] = await missCells(page, 1);
  await tapWhenMyTurn(page, c2.x, c2.y);
  await expect.poll(() => page.evaluate(() => window.__FF.state.turn), { timeout: 15000 }).toBe(1);
});

test("Fernglas from a treasure: peek, then keep searching immediately", async ({ page }) => {
  test.setTimeout(120000);
  await page.evaluate(() => window.__FF.setFast());
  await startRobo(page);
  await page.locator("#btn-place-done").click();
  await waitMyTurn(page);

  await page.evaluate(() => window.__FF.forceTreasure("fernglas"));
  const chest = await page.evaluate(() => {
    const t = window.__FF.state.boards[1].treasures[0];
    t.revealed = true;
    return { x: t.x, y: t.y };
  });
  await tapWhenMyTurn(page, chest.x, chest.y);

  // the spell waits for its peek target
  await expect(page.locator("#status")).toContainText("Schatz-Zauber wartet", { timeout: 15000 });
  const shipCell = await page.evaluate(() => {
    const b = window.__FF.state.boards[1];
    return window.__FF.engine.shipCells(b.ships[0])[0];
  });
  await page.evaluate(([x, y]) => window.__FF.tap(x, y), [shipCell.x, shipCell.y]);

  // peek done — and the turn STAYS with us for an informed shot
  await expect(page.locator("#status")).toContainText("such gleich weiter", { timeout: 15000 });
  await expect
    .poll(() => page.evaluate(() => window.__FF.state.turn === 0 && !window.__FF.state.inputLocked))
    .toBe(true);
  // the peeked cell is unmarked (no shot) but we can now hit it for real
  await tapWhenMyTurn(page, shipCell.x, shipCell.y);
  await expect
    .poll(() => page.evaluate((k) => window.__FF.marksOn(1)[k], `${shipCell.x},${shipCell.y}`))
    .toBe("hit");
});

test("Trommel from a treasure: the arrow points and the turn stays", async ({ page }) => {
  test.setTimeout(120000);
  await page.evaluate(() => window.__FF.setFast());
  await startRobo(page);
  await page.locator("#btn-place-done").click();
  await waitMyTurn(page);

  await page.evaluate(() => window.__FF.forceTreasure("trommel"));
  const chest = await page.evaluate(() => {
    const t = window.__FF.state.boards[1].treasures[0];
    t.revealed = true;
    return { x: t.x, y: t.y };
  });
  await tapWhenMyTurn(page, chest.x, chest.y);

  // aim the drum at a free cell
  await expect(page.locator("#status")).toContainText("Schatz-Zauber wartet", { timeout: 15000 });
  const [cell] = await missCells(page, 1);
  await page.evaluate(([x, y]) => window.__FF.tap(x, y), [cell.x, cell.y]);

  // the arrow points — and we keep the turn to follow it
  await expect(page.locator("#status")).toContainText("Folg dem Pfeil", { timeout: 15000 });
  await expect
    .poll(() => page.evaluate(() => window.__FF.state.turn === 0 && !window.__FF.state.inputLocked))
    .toBe(true);
  const [next] = await missCells(page, 1);
  await tapWhenMyTurn(page, next.x, next.y);
});

test("Glocke shows a shaped shadow; Ballon is placed where YOU tap", async ({ page }) => {
  test.setTimeout(120000);
  await page.locator("#btn-options").click();
  await page.evaluate(() => (document.querySelector("#sect-zauber").open = true));
  await page.locator("#opt-cards").click({ force: true });
  await page.locator("#btn-options-back").click();
  await page.evaluate(() => window.__FF.setFast());
  await startRobo(page);
  await page.locator("#btn-place-done").click();
  await waitMyTurn(page);

  // Zauberglocke: the status names length AND orientation of the shadow
  await page.evaluate(() => window.__FF.power("glocke"));
  await page.locator('.power-chip[data-power="glocke"]').click();
  await expect(page.locator("#status")).toContainText(/Felder lang|2×2/, { timeout: 15000 });

  // Extra-Ballon: aim mode asks for a free cell on the OWN board …
  await waitMyTurn(page);
  await page.evaluate(() => window.__FF.power("ballon"));
  await page.locator('.power-chip[data-power="ballon"]').click();
  await expect(page.locator("#status")).toContainText("freies Feld");
  const spot = await page.evaluate(() => {
    const b = window.__FF.state.boards[0];
    const E = window.__FF.engine;
    for (let y = 0; y < b.size; y += 1) {
      for (let x = 0; x < b.size; x += 1) {
        if (b.shots[`${x},${y}`]) continue;
        if ((b.treasures ?? []).some((t) => t.x === x && t.y === y)) continue;
        if (!E.canPlaceDecoy(b, x, y)) continue;
        return { x, y };
      }
    }
    return null;
  });
  await page.evaluate(([x, y]) => window.__FF.ownTap(x, y), [spot.x, spot.y]);
  // … and the balloon sits exactly there
  await expect
    .poll(() => page.evaluate(() => window.__FF.state.boards[0].decoy))
    .toEqual({ x: spot.x, y: spot.y });
  expect(await page.evaluate(() => window.__FF.state.powers[0].hand.includes("ballon"))).toBe(false);
});

test("Wirbelwind: choose your own friend and watch it move", async ({ page }) => {
  test.setTimeout(120000);
  await page.locator("#btn-options").click();
  await page.evaluate(() => (document.querySelector("#sect-zauber").open = true));
  await page.locator("#opt-cards").click({ force: true });
  await page.locator("#btn-options-back").click();
  await page.evaluate(() => window.__FF.setFast());
  await startRobo(page);
  await page.locator("#btn-place-done").click();
  await waitMyTurn(page);

  await page.evaluate(() => window.__FF.power("wirbel"));
  await page.locator('.power-chip[data-power="wirbel"]').click();
  await expect(page.locator('.power-chip[data-power="wirbel"]')).toHaveClass(/armed/);
  await expect(page.locator("#status")).toContainText("umziehen");

  // pick an unharmed friend on MY board and watch it relocate
  const pick = await page.evaluate(() => {
    const b = window.__FF.state.boards[0];
    const s = b.ships.find((x) => x.hits.length === 0);
    return { id: s.id, x: s.x, y: s.y, dir: s.dir, cell: window.__FF.engine.shipCells(s)[0] };
  });
  await page.evaluate(([x, y]) => window.__FF.ownTap(x, y), [pick.cell.x, pick.cell.y]);
  await expect
    .poll(() =>
      page.evaluate((id) => {
        const s = window.__FF.state.boards[0].ships.find((x) => x.id === id);
        return { x: s.x, y: s.y, dir: s.dir };
      }, pick.id)
    )
    .not.toEqual({ x: pick.x, y: pick.y, dir: pick.dir });
  // the card is spent, and the game flows on
  expect(await page.evaluate(() => window.__FF.state.powers[0].hand.includes("wirbel"))).toBe(false);
  await waitMyTurn(page);
  const [cell] = await missCells(page, 1);
  await tapWhenMyTurn(page, cell.x, cell.y);
});

test("Zauber-Kräfte: the option really disables powers", async ({ page }) => {
  await page.locator("#btn-options").click();
  await page.evaluate(() => (document.querySelector("#sect-zauber").open = true));
  await page.locator("#opt-powers").click({ force: true });
  await page.locator("#btn-options-back").click();
  await page.evaluate(() => window.__FF.setFast());
  await startRobo(page);
  await page.locator("#btn-place-done").click();
  await waitMyTurn(page);
  expect(await page.evaluate(() => window.__FF.state.powers[0])).toBeNull();
  await expect(page.locator("#powers")).toBeHidden();
  expect(await page.evaluate(() => window.__FF.state.boards[1].treasures ?? null)).toBeNull();
});

test("extra rules: sonar distances and the decoy balloon", async ({ page }) => {
  test.setTimeout(120000);
  await page.evaluate(() => {
    window.__FF.setFast();
    window.__FF.setRules({ decoy: true, sonar: true });
  });
  await startRobo(page);

  // my own board got a balloon to place
  expect(await page.evaluate(() => !!window.__FF.placementBoard().decoy)).toBe(true);
  await page.locator("#btn-place-done").click();
  await waitMyTurn(page);

  // a guaranteed miss shows a sonar distance
  const [cell] = await missCells(page, 1);
  await tapWhenMyTurn(page, cell.x, cell.y);
  await expect
    .poll(() => page.evaluate((k) => window.__FF.state.sonarMap[1][k], `${cell.x},${cell.y}`))
    .toBeGreaterThan(0);

  // popping robo's balloon marks the cell and hands robo a bonus turn
  const decoy = await page.evaluate(() => window.__FF.state.boards[1].decoy);
  await tapWhenMyTurn(page, decoy.x, decoy.y);
  await expect
    .poll(() => page.evaluate((k) => window.__FF.marksOn(1)[k], `${decoy.x},${decoy.y}`))
    .toBe("decoy");
  await waitMyTurn(page); // game keeps flowing after the pop
});

test("extra rules: ghost mode fades old miss marks", async ({ page }) => {
  test.setTimeout(120000);
  await page.evaluate(() => {
    window.__FF.setFast();
    window.__FF.setRules({ decoy: false, sonar: false, ghost: true });
  });
  await startRobo(page);
  await page.locator("#btn-place-done").click();
  await waitMyTurn(page);

  const cells = await missCells(page, 6);
  for (const cell of cells) {
    await tapWhenMyTurn(page, cell.x, cell.y);
    await page.waitForTimeout(250);
  }
  // after 6 shots the first miss (5 shots ago) has faded away
  await expect
    .poll(() => page.evaluate((k) => window.__FF.marksOn(1)[k] ?? null, `${cells[0].x},${cells[0].y}`))
    .toBeNull();
  // ...and the freshest one is still there
  const last = cells[cells.length - 1];
  expect(await page.evaluate((k) => window.__FF.marksOn(1)[k], `${last.x},${last.y}`)).toBe("miss");
});

test("board variety: presets, Enge Verstecke and the chunky 2×2 friend", async ({ page }) => {
  test.setTimeout(180000);
  await page.evaluate(() => window.__FF.setFast());

  // flink preset + Enge Verstecke via the options screen
  await page.locator("#btn-options").click();
  await expect(page.locator(".board-choice")).toHaveCount(4);
  await page.locator('.board-choice[data-preset="flink"]').click();
  await expect(page.locator('.board-choice[data-preset="flink"]')).toHaveClass(/selected/);
  await page.locator("#rule-touch").click({ force: true });
  await page.locator("#btn-options-back").click();

  await startRobo(page);
  const info = await page.evaluate(() => {
    const b = window.__FF.state.boards;
    return { size0: b[0].size, size1: b[1].size, ships: b[0].ships.length, touch: !!b[0].allowTouch };
  });
  expect(info).toEqual({ size0: 6, size1: 6, ships: 4, touch: true });

  // a shot on the small board flows normally
  await page.locator("#btn-place-done").click();
  await waitMyTurn(page);
  const [cell] = await missCells(page, 1);
  await tapWhenMyTurn(page, cell.x, cell.y);
  await expect
    .poll(() => page.evaluate((k) => window.__FF.marksOn(1)[k], `${cell.x},${cell.y}`))
    .toBe("miss");

  // sinking with Enge Verstecke reveals no surrounding water
  const shipCells = await page.evaluate(() => {
    const b = window.__FF.state.boards[1];
    return window.__FF.engine.shipCells(b.ships.find((s) => s.size === 2));
  });
  for (const c of shipCells) await tapWhenMyTurn(page, c.x, c.y);
  const marks = await page.evaluate(() => ({ ...window.__FF.marksOn(1) }));
  const around = new Set();
  for (const c of shipCells) {
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) around.add(`${c.x + dx},${c.y + dy}`);
    }
  }
  for (const c of shipCells) around.delete(`${c.x},${c.y}`);
  const revealedNeighbors = [...around].filter((k) => marks[k] === "miss" && k !== `${cell.x},${cell.y}`);
  expect(revealedNeighbors).toEqual([]);

  // grossklein preset: back home, the square friend and the mini join the fleet
  await page.locator("#btn-home").click();
  await page.locator("#btn-options").click();
  await page.locator('.board-choice[data-preset="grossklein"]').click();
  await page.locator("#rule-touch").click({ force: true }); // back off
  await page.locator("#btn-options-back").click();
  await startRobo(page);
  const fleet = await page.evaluate(() =>
    window.__FF.state.boards[0].ships.map((s) => ({ shape: s.shape ?? "line", size: s.size }))
  );
  expect(fleet).toContainEqual({ shape: "sq", size: 4 });
  expect(fleet).toContainEqual({ shape: "line", size: 1 });
  // the square really occupies a 2×2 block and the whole fleet is valid
  const grossklein = await page.evaluate(() => {
    const b = window.__FF.placementBoard();
    const E = window.__FF.engine;
    const sq = b.ships.find((s) => s.shape === "sq");
    return {
      sqCells: E.shipCells(sq).map((c) => `${c.x - sq.x},${c.y - sq.y}`).sort(),
      allValid: b.ships.every((s) => E.canPlace(b, s, s.id)),
    };
  });
  expect(grossklein.sqCells).toEqual(["0,0", "0,1", "1,0", "1,1"]);
  expect(grossklein.allValid).toBe(true);

  // the preset choice survives a reload
  await page.reload();
  await page.waitForFunction(() => !!window.__FF);
  await page.locator("#btn-options").click();
  await expect(page.locator('.board-choice[data-preset="grossklein"]')).toHaveClass(/selected/);
});

test("Knobel-Insel: solve the puzzle by digging all creature cells", async ({ page }) => {
  test.setTimeout(120000);
  await page.evaluate(() => window.__FF.setFast());
  await page.locator("#btn-puzzle").click();
  await expect
    .poll(() => page.evaluate(() => window.__FF.state.phase))
    .toBe("puzzle");

  // dig every creature cell straight from the hidden layout
  const cells = await page.evaluate(() => {
    const { board } = window.__FF.state.puzzle;
    const E = window.__FF.engine;
    return board.ships.flatMap((s) => E.shipCells(s));
  });
  for (const c of cells) {
    await page.evaluate(([x, y]) => {
      const st = window.__FF.state;
      if (st.phase === "puzzle") window.__FF.puzzleTap(x, y);
    }, [c.x, c.y]);
    await page.waitForTimeout(60);
  }
  await expect(page.locator("#screen-win")).toHaveClass(/active/, { timeout: 15000 });
  await expect(page.locator("#win-title")).toContainText("gelöst");
  // a fresh puzzle starts from the win screen
  await page.locator("#btn-rematch").click();
  await expect
    .poll(() => page.evaluate(() => window.__FF.state.phase))
    .toBe("puzzle");
  expect(await page.evaluate(() => window.__FF.state.puzzle.spades)).toBeGreaterThan(0);
});

test("Knobel-Insel: stale locks never block digging; zero rows self-clear", async ({ page }) => {
  test.setTimeout(120000);
  await page.evaluate(() => window.__FF.setFast());
  // simulate the state a just-won battle leaves behind
  await page.evaluate(() => {
    window.__FF.state.inputLocked = true;
  });
  await page.locator("#btn-puzzle").click();
  await expect.poll(() => page.evaluate(() => window.__FF.state.phase)).toBe("puzzle");
  expect(await page.evaluate(() => window.__FF.state.inputLocked)).toBe(false);

  // rows/cols with a 0 clue are already revealed as water (aha moment)
  const zeroChecked = await page.evaluate(() => {
    const { board, rows, cols } = window.__FF.state.puzzle;
    let ok = true;
    rows.forEach((n, y) => {
      if (n === 0) {
        for (let x = 0; x < board.size; x += 1) if (!board.shots[`${x},${y}`]) ok = false;
      }
    });
    cols.forEach((n, x) => {
      if (n === 0) {
        for (let y = 0; y < board.size; y += 1) if (!board.shots[`${x},${y}`]) ok = false;
      }
    });
    return ok;
  });
  expect(zeroChecked).toBe(true);

  // and digging works right away
  const cell = await page.evaluate(() => {
    const { board } = window.__FF.state.puzzle;
    const E = window.__FF.engine;
    const fresh = board.ships.find((s) => s.hits.length === 0) ?? board.ships[0];
    return E.shipCells(fresh).find((c) => !board.shots[`${c.x},${c.y}`]) ?? null;
  });
  await page.evaluate(([x, y]) => window.__FF.puzzleTap(x, y), [cell.x, cell.y]);
  expect(
    await page.evaluate(([x, y]) => window.__FF.state.puzzle.board.shots[`${x},${y}`], [
      cell.x,
      cell.y,
    ])
  ).toBe("hit");
});

test("Knobel-Insel: wins climb the ladder to a 10×10 expedition", async ({ page }) => {
  test.setTimeout(120000);
  await page.addInitScript(() => localStorage.setItem("ff-knobel-wins", "7"));
  await page.reload();
  await page.waitForFunction(() => !!window.__FF);
  await page.evaluate(() => window.__FF.setFast());
  await page.locator("#btn-puzzle").click();
  await expect.poll(() => page.evaluate(() => window.__FF.state.phase)).toBe("puzzle");
  const stage = await page.evaluate(() => {
    const p = window.__FF.state.puzzle;
    return { size: p.board.size, ships: p.board.ships.length, spades: p.spades };
  });
  expect(stage.size).toBe(10);
  expect(stage.ships).toBe(6);
  expect(stage.spades).toBe(5);
  // the sneaky single-cell friend is aboard
  expect(
    await page.evaluate(() => window.__FF.state.puzzle.board.ships.some((s) => s.size === 1))
  ).toBe(true);
});

test("Knobel-Insel: running out of spades reveals the layout", async ({ page }) => {
  test.setTimeout(120000);
  // some boards need many uniqueness hints, whose sunk-rings and
  // satisfied-line floods leave FEWER than 6 diggable water cells — on
  // those, losing is impossible. Redraw until the board can be lost.
  const freshWater = () =>
    page.evaluate(() => {
      const { board } = window.__FF.state.puzzle;
      const E = window.__FF.engine;
      const occ = new Set();
      for (const s of board.ships) for (const c of E.shipCells(s)) occ.add(`${c.x},${c.y}`);
      let free = 0;
      for (let y = 0; y < board.size; y += 1) {
        for (let x = 0; x < board.size; x += 1) {
          if (!occ.has(`${x},${y}`) && !board.shots[`${x},${y}`]) free += 1;
        }
      }
      return free;
    });
  let viable = false;
  for (let attempt = 0; attempt < 6 && !viable; attempt += 1) {
    if (attempt > 0) {
      await page.reload();
      await page.waitForFunction(() => !!window.__FF);
    }
    await page.evaluate(() => window.__FF.setFast());
    await page.locator("#btn-puzzle").click();
    await expect.poll(() => page.evaluate(() => window.__FF.state.phase)).toBe("puzzle");
    viable = (await freshWater()) >= 6;
  }
  expect(viable).toBe(true);

  // dig water cells until the spades run out — pick a FRESH cell each
  // time (satisfied clues auto-water lines, so a snapshot goes stale)
  for (let i = 0; i < 12; i += 1) {
    const over = await page.evaluate(() => window.__FF.state.phase !== "puzzle");
    if (over) break;
    const c = await page.evaluate(() => {
      const { board } = window.__FF.state.puzzle;
      const E = window.__FF.engine;
      const occupied = new Set();
      for (const s of board.ships) for (const cc of E.shipCells(s)) occupied.add(`${cc.x},${cc.y}`);
      for (let y = 0; y < board.size; y += 1) {
        for (let x = 0; x < board.size; x += 1) {
          if (!occupied.has(`${x},${y}`) && !board.shots[`${x},${y}`]) return { x, y };
        }
      }
      return null;
    });
    if (!c) break;
    await page.evaluate(([x, y]) => window.__FF.puzzleTap(x, y), [c.x, c.y]);
    await page.waitForTimeout(60);
  }
  await expect(page.locator("#screen-win")).toHaveClass(/active/, { timeout: 15000 });
  await expect(page.locator("#win-title")).toContainText("Schaufeln");
});

test("Fang mich: catching the sneak wins, letting it escape loses", async ({ page }) => {
  test.setTimeout(120000);
  await page.evaluate(() => window.__FF.setFast());
  await page.locator("#btn-chase").click();
  await page.locator('[data-chase="ai"]').click();
  await expect.poll(() => page.evaluate(() => window.__FF.state.phase)).toBe("chase");
  // the quarry intro parades first — wait until taps are live
  await expect.poll(() => page.evaluate(() => !window.__FF.state.inputLocked)).toBe(true);

  // cheat: read the hidden position and pounce
  const frido = await page.evaluate(() => window.__FF.state.chase.st.frido);
  await page.evaluate(([x, y]) => window.__FF.chaseTap(x, y), [frido.x, frido.y]);
  await expect(page.locator("#screen-win")).toHaveClass(/active/, { timeout: 10000 });
  await expect(page.locator("#win-title")).toContainText("gefangen");

  // round 2: always shoot far away until the budget runs out
  await page.locator("#btn-rematch").click();
  await expect.poll(() => page.evaluate(() => window.__FF.state.phase)).toBe("chase");
  await expect.poll(() => page.evaluate(() => !window.__FF.state.inputLocked)).toBe(true);
  for (let i = 0; i < 12; i += 1) {
    const done = await page.evaluate(() => window.__FF.state.phase !== "chase");
    if (done) break;
    await page.evaluate(() => {
      const st = window.__FF.state.chase.st;
      // farthest unmarked corner from the sneak
      let best = null;
      let bestD = -1;
      for (const [x, y] of [[0, 0], [7, 0], [0, 7], [7, 7], [3, 3], [4, 4]]) {
        if (st.marks[`${x},${y}`]) continue;
        const d = Math.max(Math.abs(st.frido.x - x), Math.abs(st.frido.y - y));
        if (d > bestD) {
          bestD = d;
          best = [x, y];
        }
      }
      if (best && bestD > 0) window.__FF.chaseTap(best[0], best[1]);
    });
    await page.waitForTimeout(150);
  }
  await expect(page.locator("#screen-win")).toHaveClass(/active/, { timeout: 10000 });
  await expect(page.locator("#win-title")).toContainText("entwischt");
});

test("Fang mich online: hide, sneak-move, and get caught across devices", async ({ browser }) => {
  test.setTimeout(180000);
  const ctxA = await browser.newContext({ viewport: { width: 340, height: 600 } });
  const ctxB = await browser.newContext({ viewport: { width: 340, height: 600 } });
  const host = await ctxA.newPage();
  const guest = await ctxB.newPage();
  for (const p of [host, guest]) {
    await p.addInitScript(() => localStorage.setItem("ff-muted", "1"));
  }

  await host.goto(`${GAME}?${PS}`);
  await host.waitForFunction(() => !!window.__FF);
  await host.evaluate(() => window.__FF.setFast());
  await host.locator("#btn-chase").click();
  await host.locator('[data-chase="online"]').click();
  await host.locator("#btn-host").click();
  await expect(host.locator("#host-code")).not.toHaveText("····", { timeout: 20000 });
  const code = (await host.locator("#host-code").textContent()).trim();

  await guest.goto(`${GAME}?${PS}&join=${code}`);
  await guest.waitForFunction(() => !!window.__FF);
  await guest.evaluate(() => window.__FF.setFast());
  await guest.locator("#btn-worldpick-go").click();

  // host hides at a known spot and confirms
  await expect(host.locator("#btn-place-done")).toBeVisible({ timeout: 30000 });
  await host.evaluate(() => {
    window.__FF.state.chase.st.frido = { x: 5, y: 5 };
  });
  await host.locator("#btn-place-done").click();

  // guest gets the go signal (and the intro parade finishes), misses
  // once → host must sneak-move
  await expect
    .poll(() => guest.evaluate(() => window.__FF.state.chase?.ready), { timeout: 20000 })
    .toBe(true);
  await expect
    .poll(() => guest.evaluate(() => !window.__FF.state.inputLocked), { timeout: 15000 })
    .toBe(true);
  await guest.evaluate(() => window.__FF.chaseNetTap(0, 0));
  await expect(host.locator("#chase-move")).toBeVisible({ timeout: 15000 });
  // press arrows until one works (walls/marks bounce)
  for (const dir of ["1,0", "0,1", "-1,0", "0,-1"]) {
    if (await host.locator("#chase-move").isHidden()) break;
    await host.locator(`[data-move="${dir}"]`).click().catch(() => {});
    await host.waitForTimeout(200);
  }
  await expect(host.locator("#chase-move")).toBeHidden();

  // guest pounces on the true position read from the host's state
  await expect
    .poll(() => guest.evaluate(() => window.__FF.state.inputLocked), { timeout: 15000 })
    .toBe(false);
  const frido = await host.evaluate(() => window.__FF.state.chase.st.frido);
  await guest.evaluate(([x, y]) => window.__FF.chaseNetTap(x, y), [frido.x, frido.y]);

  await expect(guest.locator("#screen-win")).toHaveClass(/active/, { timeout: 15000 });
  await expect(guest.locator("#win-title")).toContainText("Du hast gewonnen");
  await expect(host.locator("#screen-win")).toHaveClass(/active/, { timeout: 15000 });
  await expect(host.locator("#win-title")).toContainText("Mitspieler");

  await ctxA.close();
  await ctxB.close();
});

test("Weltreise: starts tiny, ends wild", async ({ page }) => {
  test.setTimeout(120000);
  await page.evaluate(() => window.__FF.setFast());

  // stop 1: a small 6×6 bay with a small crew, no spells yet
  await page.locator("#btn-journey").click();
  await page.locator("#btn-journey-go").click();
  await page.locator("#btn-pass-go").click();
  await expect(page.locator("#btn-place-done")).toBeVisible({ timeout: 15000 });
  const first = await page.evaluate(() => ({
    size: window.__FF.state.boards[0].size,
    ships: window.__FF.state.boards[0].ships.length,
    powers: window.__FF.state.powersOn,
  }));
  expect(first.size).toBe(6);
  expect(first.ships).toBe(4);
  expect(first.powers).toBe(false);

  // the finale: the biggest sea, snuggling friends, chest festival, schlau robo
  await page.locator("#btn-home").click();
  await page.evaluate(() => localStorage.setItem("ff-weltreise", "11"));
  await page.locator("#btn-journey").click();
  await page.locator("#btn-journey-go").click();
  await page.locator("#btn-pass-go").click();
  await expect(page.locator("#btn-place-done")).toBeVisible({ timeout: 15000 });
  const finale = await page.evaluate(() => ({
    size: window.__FF.state.boards[0].size,
    touch: !!window.__FF.state.boards[0].allowTouch,
    more: window.__FF.state.moreTreasures,
    teach: window.__FF.state.forceTreasureKind,
  }));
  expect(finale.size).toBe(10);
  expect(finale.touch).toBe(true);
  expect(finale.more).toBe(true);
  expect(finale.teach).toBe("schild");
});

test("Weltreise: story screens, winning unlocks, spells get taught", async ({ page }) => {
  test.setTimeout(120000);
  await page.addInitScript(() => localStorage.setItem("ff-weltreise", "4"));
  await page.reload();
  await page.waitForFunction(() => !!window.__FF);
  await page.evaluate(() => window.__FF.setFast());

  // the hero card announces the next stop with live progress
  await expect(page.locator("#jh-sub")).toContainText("Etappe 5 von 12");
  await page.locator("#btn-journey").click();
  await expect(page.locator(".journey-stop.done")).toHaveCount(4);
  await expect(page.locator(".journey-stop.current")).toHaveCount(1);
  await expect(page.locator("#btn-journey-go")).toContainText("Etappe 5");

  // every stop starts with its slice of the story — acted out on the
  // little animated stage
  await page.locator("#btn-journey-go").click();
  await expect(page.locator("#screen-pass")).toHaveClass(/active/);
  await expect(page.locator("#pass-sub")).toContainText("Insel");
  await expect(page.locator("#story-stage")).toBeVisible();
  await page.locator("#btn-pass-go").click();

  // stop 5 is the Knobel-Insel puzzle
  await expect.poll(() => page.evaluate(() => window.__FF.state.phase)).toBe("puzzle");
  expect(await page.evaluate(() => window.__FF.state.worlds[0])).toBe("teich");

  const cells = await page.evaluate(() => {
    const { board } = window.__FF.state.puzzle;
    const E = window.__FF.engine;
    return board.ships.flatMap((s) => E.shipCells(s));
  });
  for (const c of cells) {
    await page.evaluate(([x, y]) => {
      if (window.__FF.state.phase === "puzzle") window.__FF.puzzleTap(x, y);
    }, [c.x, c.y]);
    await page.waitForTimeout(60);
  }
  await expect(page.locator("#screen-win")).toHaveClass(/active/, { timeout: 15000 });
  await expect(page.locator("#win-sub")).toContainText("Etappe 5");
  await expect(page.locator("#btn-rematch")).toContainText("Nächste Etappe");
  expect(await page.evaluate(() => localStorage.getItem("ff-weltreise"))).toBe("5");

  // next stop teaches the Urwald-Trommel: story first, then a chest
  // that is visible from the very first second with THAT spell inside
  await page.locator("#btn-rematch").click();
  await expect(page.locator("#screen-pass")).toHaveClass(/active/);
  await expect(page.locator("#pass-sub")).toContainText("Trommel");
  await page.locator("#btn-pass-go").click();
  await expect(page.locator("#btn-place-done")).toBeVisible({ timeout: 15000 });
  expect(await page.evaluate(() => window.__FF.state.forceTreasureKind)).toBe("trommel");
  await page.locator("#btn-place-done").click();
  await waitMyTurn(page);
  expect(
    await page.evaluate(() => window.__FF.state.boards[1].treasures.every((t) => t.revealed))
  ).toBe(true);
});

test("Aquarium: collected creatures live together and hop on tap", async ({ page }) => {
  await page.addInitScript(() =>
    localStorage.setItem(
      "ff-progress",
      JSON.stringify({ stickers: { "ozean-0": 1, "dino-2": 3 }, wins: 4 })
    )
  );
  await page.reload();
  await page.waitForFunction(() => !!window.__FF);
  await page.locator("#btn-aquarium").click();
  await expect(page.locator("#status")).toContainText("2 Freunde");
  const count = await page.evaluate(() => window.__FF.state.aquarium.length);
  expect(count).toBe(2);
  // tapping near a wandering resident makes it hop and greet by name
  const hit = await page.evaluate(() => {
    // aim at the current position of the first resident
    const tapped = [];
    for (let y = 0; y < 8; y += 1) {
      for (let x = 0; x < 8; x += 1) tapped.push([x, y]);
    }
    return tapped;
  });
  let greeted = false;
  for (const [x, y] of hit) {
    await page.evaluate(([tx, ty]) => window.__FF.aquariumTap(tx, ty), [x, y]);
    const toastText = await page.locator("#toast").textContent();
    if (/freut sich/.test(toastText || "")) {
      greeted = true;
      break;
    }
  }
  expect(greeted).toBe(true);
});

test("Monster-Jagd: wounding every segment defeats the prowling boss", async ({ page }) => {
  test.setTimeout(120000);
  await page.evaluate(() => window.__FF.setFast());
  await page.locator("#btn-boss").click();
  await page.locator('[data-boss="ai"]').click();
  await expect.poll(() => page.evaluate(() => window.__FF.state.phase)).toBe("boss");

  // hunt by cheating: read the monster's live cells and keep striking
  for (let i = 0; i < 30; i += 1) {
    const done = await page.evaluate(() => window.__FF.state.phase !== "boss");
    if (done) break;
    await page.evaluate(() => {
      const st = window.__FF.state.boss.st;
      const cells = [];
      for (let s = 0; s < 6; s += 1) {
        // BOSS_SIZE segments
        cells.push(
          st.boss.dir === "h"
            ? { x: st.boss.x + s, y: st.boss.y, s }
            : { x: st.boss.x, y: st.boss.y + s, s }
        );
      }
      const fresh = cells.find((c) => !st.wounds.includes(c.s));
      if (fresh) window.__FF.bossTap(fresh.x, fresh.y);
    });
    await page.waitForTimeout(120);
  }
  await expect(page.locator("#screen-win")).toHaveClass(/active/, { timeout: 10000 });
  await expect(page.locator("#win-title")).toContainText("besiegt");
});

test("Monster-Jagd online: monster places, moves, and is defeated", async ({ browser }) => {
  test.setTimeout(180000);
  const ctxA = await browser.newContext({ viewport: { width: 340, height: 600 } });
  const ctxB = await browser.newContext({ viewport: { width: 340, height: 600 } });
  const host = await ctxA.newPage();
  const guest = await ctxB.newPage();
  for (const p of [host, guest]) {
    await p.addInitScript(() => localStorage.setItem("ff-muted", "1"));
  }

  await host.goto(`${GAME}?${PS}`);
  await host.waitForFunction(() => !!window.__FF);
  await host.evaluate(() => window.__FF.setFast());
  await host.locator("#btn-boss").click();
  await host.locator('[data-boss="online"]').click();
  await host.locator("#btn-host").click();
  await expect(host.locator("#host-code")).not.toHaveText("····", { timeout: 20000 });
  const code = (await host.locator("#host-code").textContent()).trim();

  await guest.goto(`${GAME}?${PS}&join=${code}`);
  await guest.waitForFunction(() => !!window.__FF);
  await guest.evaluate(() => window.__FF.setFast());
  await guest.locator("#btn-worldpick-go").click();

  await expect(host.locator("#btn-place-done")).toBeVisible({ timeout: 30000 });
  await host.locator("#btn-place-done").click();

  await expect
    .poll(() => guest.evaluate(() => window.__FF.state.boss?.ready), { timeout: 20000 })
    .toBe(true);

  // hunt across devices: read live cells from the host each round
  for (let i = 0; i < 30; i += 1) {
    const phase = await guest.evaluate(() => window.__FF.state.phase);
    if (phase !== "boss") break;
    const locked = await guest.evaluate(() => window.__FF.state.inputLocked);
    if (locked) {
      // maybe the monster owes a move — press arrows until one works
      if (await host.locator("#chase-move").isVisible().catch(() => false)) {
        for (const dir of ["1,0", "0,1", "-1,0", "0,-1"]) {
          if (await host.locator("#chase-move").isHidden()) break;
          await host.locator(`[data-move="${dir}"]`).click().catch(() => {});
          await host.waitForTimeout(150);
        }
      }
      await guest.waitForTimeout(200);
      continue;
    }
    const target = await host.evaluate(() => {
      const st = window.__FF.state.boss.st;
      for (let s = 0; s < 6; s += 1) {
        if (st.wounds.includes(s)) continue;
        return st.boss.dir === "h"
          ? { x: st.boss.x + s, y: st.boss.y }
          : { x: st.boss.x, y: st.boss.y + s };
      }
      return null;
    });
    if (!target) break;
    await guest.evaluate(([x, y]) => window.__FF.bossNetTap(x, y), [target.x, target.y]);
    await guest.waitForTimeout(250);
  }

  await expect(guest.locator("#screen-win")).toHaveClass(/active/, { timeout: 20000 });
  await expect(guest.locator("#win-title")).toContainText("Du hast gewonnen");
  await expect(host.locator("#screen-win")).toHaveClass(/active/, { timeout: 20000 });

  await ctxA.close();
  await ctxB.close();
});

test("hot-seat: two worlds, pass screens, full game to the win screen", async ({ page }) => {
  test.setTimeout(420000);
  await page.evaluate(() => window.__FF.setFast());
  await page.locator('[data-mode="hotseat"]').click();
  await page.locator("#btn-place-done").click();

  // pass to player 2, who picks their own world
  await expect(page.locator("#screen-pass")).toHaveClass(/active/);
  await page.locator("#btn-pass-go").click();
  await expect(page.locator("#screen-worldpick")).toHaveClass(/active/);
  await page.locator('#world-grid-2 [data-world="dino"]').click();
  await page.locator("#btn-worldpick-go").click();
  await page.locator("#btn-place-done").click();
  await page.locator("#btn-pass-go").click();

  await expect(page.locator("#status")).toContainText("Spieler 1", { timeout: 10000 });
  const worlds = await page.evaluate(() => window.__FF.state.worlds);
  expect(worlds[1]).toBe("dino");

  // play the whole game: always shoot the first unknown cell
  for (let i = 0; i < 300; i += 1) {
    if (await page.locator("#screen-win").evaluate((el) => el.classList.contains("active"))) break;
    // buttons can hide between the visibility check and the click
    // (robo/result timers) — tolerate that and re-loop
    if (await page.locator("#btn-pass-go").isVisible()) {
      await page.locator("#btn-pass-go").click({ timeout: 2000 }).catch(() => {});
      continue;
    }
    if (await page.locator("#btn-endturn").isVisible()) {
      await page.locator("#btn-endturn").click({ timeout: 2000 }).catch(() => {});
      continue;
    }
    const state = await page.evaluate(() => ({
      phase: window.__FF.state.phase,
      turn: window.__FF.state.turn,
      locked: window.__FF.state.inputLocked,
    }));
    if (state.phase !== "battle" || state.locked) {
      await page.waitForTimeout(300);
      continue;
    }
    const target = await firstUnknownCell(page, state.turn === 0 ? 1 : 0);
    if (!target) break;
    await page.evaluate(([x, y]) => window.__FF.tap(x, y), [target.x, target.y]);
    await page.waitForTimeout(220);
  }

  await expect(page.locator("#screen-win")).toHaveClass(/active/);
  await expect(page.locator("#win-title")).toContainText("gewonnen");

  // the winner earns a sticker, and it shows up in the album
  await expect(page.locator("#win-sticker")).toBeVisible();
  await expect(page.locator("#win-sticker .sticker-label")).toContainText("Sticker");
  await page.locator("#btn-win-home").click();
  await page.locator("#btn-album").click();
  await expect(page.locator("#screen-album")).toHaveClass(/active/);
  await expect(page.locator(".album-slot")).toHaveCount(30); // 6 worlds x 5 friends
  await expect(page.locator(".album-slot:not(.locked)")).toHaveCount(1);
  await expect(page.locator("#album-total")).toContainText("1 Sticker");
});

test("works offline after the first visit (PWA)", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await page.addInitScript(() => localStorage.setItem("ff-muted", "1"));
  await page.goto(GAME);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForTimeout(800);

  await ctx.setOffline(true);
  await page.reload();
  await expect(page.locator("h1.logo")).toContainText("Funkel-Flotte");
  await page.waitForFunction(() => !!window.__FF);
  await startRobo(page);
  await expect(page.locator("#btn-place-done")).toBeVisible();
  const ships = await page.evaluate(() => window.__FF.placementBoard().ships.length);
  expect(ships).toBe(5);
  await ctx.close();
});

// Online tests run against the local signaling server (scripts/peer-server.mjs)
const PS = "ps=localhost:9200";

test("online: host screen shows QR code and magic code", async ({ page }) => {
  await page.goto(`${GAME}?${PS}`);
  await page.waitForFunction(() => !!window.__FF);
  await page.locator('[data-mode="online"]').click();
  await expect(page.locator("#screen-online")).toHaveClass(/active/);
  await page.locator("#btn-host").click();
  await expect(page.locator("#screen-host")).toHaveClass(/active/);
  await expect(page.locator("#host-code")).not.toHaveText("····", { timeout: 20000 });
  await expect(page.locator("#qr-box svg")).toBeVisible();
  const code = await page.locator("#host-code").textContent();
  expect(code).toMatch(/^[A-Z2-9]{4}$/);
});

test("online: full cross-world P2P game with rematch", async ({ browser }) => {
  test.setTimeout(300000);

  // small viewports keep two software-rendered WebGL pages responsive
  const ctxA = await browser.newContext({ viewport: { width: 340, height: 600 } });
  const ctxB = await browser.newContext({ viewport: { width: 640, height: 420 } }); // tablet landscape
  const host = await ctxA.newPage();
  const guest = await ctxB.newPage();
  await host.addInitScript(() => localStorage.setItem("ff-muted", "1"));
  await guest.addInitScript(() => localStorage.setItem("ff-muted", "1"));

  await host.goto(`${GAME}?${PS}`);
  await host.waitForFunction(() => !!window.__FF);
  await host.evaluate(() => window.__FF.setFast());
  await host.locator('#world-grid [data-world="weltraum"]').click();
  await host.locator('[data-mode="online"]').click();
  await host.locator("#btn-host").click();
  await expect(host.locator("#host-code")).not.toHaveText("····", { timeout: 20000 });
  const code = (await host.locator("#host-code").textContent()).trim();

  // guest joins via deep link (world picker first — guest picks dino)
  await guest.goto(`${GAME}?${PS}&join=${code}`);
  await guest.waitForFunction(() => !!window.__FF);
  await guest.evaluate(() => window.__FF.setFast());
  await expect(guest.locator("#screen-worldpick")).toHaveClass(/active/);
  await guest.locator('#world-grid-2 [data-world="dino"]').click();
  await guest.locator("#btn-worldpick-go").click();

  // the host also picks their world fresh once the guest arrives
  await expect(host.locator("#screen-worldpick")).toHaveClass(/active/, { timeout: 30000 });
  await host.locator('#world-grid-2 [data-world="weltraum"]').click();
  await host.locator("#btn-worldpick-go").click();

  await expect(host.locator("#btn-place-done")).toBeVisible({ timeout: 30000 });
  await expect(guest.locator("#btn-place-done")).toBeVisible({ timeout: 30000 });

  // both devices remembered each other for future direct reconnects
  await expect
    .poll(() =>
      host.evaluate(() => Object.keys(JSON.parse(localStorage.getItem("ff-friends") || "{}")).length)
    )
    .toBe(1);
  await expect
    .poll(() =>
      guest.evaluate(() => Object.keys(JSON.parse(localStorage.getItem("ff-friends") || "{}")).length)
    )
    .toBe(1);

  // each side knows the other's world
  await expect
    .poll(() => host.evaluate(() => window.__FF.state.worlds[1]))
    .toBe("dino");
  await expect
    .poll(() => guest.evaluate(() => window.__FF.state.worlds[1]))
    .toBe("weltraum");

  // host styles a creature; the guest must see it once the battle starts
  await host.evaluate(() => window.__FF.setStyle(0, 2, 1));
  await host.locator("#btn-place-done").click();
  await guest.locator("#btn-place-done").click();
  await expect(host.locator("#status")).toContainText(/dran|sucht/, { timeout: 20000 });
  await expect(guest.locator("#status")).toContainText(/dran|sucht/, { timeout: 20000 });
  await expect
    .poll(() => guest.evaluate(() => window.__FF.state.oppCustom))
    .toEqual({ 0: { tint: 2, hat: 1 } });

  // powers travel the wire: host casts a Zeitzauber, guest hears it
  await host.evaluate(() => {
    window.__FF.power("zeit");
    window.__FF.usePower("zeit", null);
  });
  await expect.poll(() => guest.evaluate(() => window.__FF.state.extraTurn)).toBe(1);

  // play the full game via hooks
  let winner = null;
  for (let i = 0; i < 400 && !winner; i += 1) {
    for (const page of [host, guest]) {
      if (await page.locator("#screen-win").evaluate((el) => el.classList.contains("active"))) {
        winner = page;
        break;
      }
      const st = await page.evaluate(() => ({
        phase: window.__FF.state.phase,
        turn: window.__FF.state.turn,
        locked: window.__FF.state.inputLocked,
      }));
      if (st.phase !== "battle" || st.turn !== 0 || st.locked) continue;
      const target = await firstUnknownCell(page, 1);
      if (!target) continue;
      await page.evaluate(([x, y]) => window.__FF.tap(x, y), [target.x, target.y]);
      await page.waitForTimeout(120);
    }
  }
  expect(winner).toBeTruthy();
  const loser = winner === host ? guest : host;
  await expect(loser.locator("#screen-win")).toHaveClass(/active/, { timeout: 15000 });

  // rematch: both press, both RE-PICK their worlds, then placement
  await winner.locator("#btn-rematch").click();
  await loser.locator("#btn-rematch").click();
  await expect(host.locator("#screen-worldpick")).toHaveClass(/active/, { timeout: 20000 });
  await host.locator('#world-grid-2 [data-world="teich"]').click();
  await host.locator("#btn-worldpick-go").click();
  await expect(guest.locator("#screen-worldpick")).toHaveClass(/active/, { timeout: 20000 });
  await guest.locator('#world-grid-2 [data-world="ozean"]').click();
  await guest.locator("#btn-worldpick-go").click();
  await expect(host.locator("#btn-place-done")).toBeVisible({ timeout: 20000 });
  await expect(guest.locator("#btn-place-done")).toBeVisible({ timeout: 20000 });
  await expect.poll(() => host.evaluate(() => window.__FF.state.worlds)).toEqual(["teich", "ozean"]);
  await expect.poll(() => guest.evaluate(() => window.__FF.state.worlds[1])).toBe("teich");

  await ctxA.close();
  await ctxB.close();
});

test("rapid double taps fire only one shot", async ({ page }) => {
  test.setTimeout(120000);
  await page.evaluate(() => window.__FF.setFast());
  await startRobo(page);
  await page.locator("#btn-place-done").click();
  await waitMyTurn(page);
  const cells = await missCells(page, 2);
  const marked = await page.evaluate(([a, b]) => {
    window.__FF.tap(a.x, a.y);
    window.__FF.tap(b.x, b.y); // must be swallowed by the input lock
    return {
      first: window.__FF.marksOn(1)[`${a.x},${a.y}`] ?? null,
      second: window.__FF.marksOn(1)[`${b.x},${b.y}`] ?? null,
    };
  }, cells);
  expect(marked.first).toBe("miss");
  expect(marked.second).toBeNull();
});

test("resume: a refresh mid-battle restores the robo game", async ({ page }) => {
  test.setTimeout(120000);
  await page.evaluate(() => window.__FF.setFast());
  await startRobo(page);
  await page.locator("#btn-place-done").click();
  await waitMyTurn(page);
  const [cell] = await missCells(page, 1);
  await tapWhenMyTurn(page, cell.x, cell.y);
  await waitMyTurn(page);

  await page.reload();
  await page.waitForFunction(() => !!window.__FF);
  await page.evaluate(() => window.__FF.setFast());
  // no auto-resume: the title greets us with a visible resume offer
  await expect(page.locator("#resume-banner")).toBeVisible();
  await expect(page.locator("#resume-text")).toContainText("Robo");
  await page.locator("#btn-resume").click();
  // back into the battle, marks intact
  await expect.poll(() => page.evaluate(() => window.__FF.state.phase)).toBe("battle");
  expect(
    await page.evaluate((k) => window.__FF.marksOn(1)[k], `${cell.x},${cell.y}`)
  ).toBe("miss");
  // and the game is playable
  await waitMyTurn(page);
  const [next] = await missCells(page, 1);
  await tapWhenMyTurn(page, next.x, next.y);
});

test("resume: dismissing the banner discards the saved game", async ({ page }) => {
  test.setTimeout(120000);
  await page.evaluate(() => window.__FF.setFast());
  await startRobo(page);
  await page.locator("#btn-place-done").click();
  await waitMyTurn(page);

  await page.reload();
  await page.waitForFunction(() => !!window.__FF);
  await expect(page.locator("#resume-banner")).toBeVisible();
  await page.locator("#btn-resume-discard").click();
  await expect(page.locator("#resume-banner")).toBeHidden();
  // the save is really gone — another reload offers nothing
  await page.reload();
  await page.waitForFunction(() => !!window.__FF);
  await expect(page.locator("#resume-banner")).toBeHidden();
  expect(await page.evaluate(() => localStorage.getItem("ff-resume"))).toBeNull();
});

test("resume: an online game survives a guest refresh", async ({ browser }) => {
  test.setTimeout(180000);
  const ctxA = await browser.newContext({ viewport: { width: 340, height: 600 } });
  const ctxB = await browser.newContext({ viewport: { width: 340, height: 600 } });
  const host = await ctxA.newPage();
  const guest = await ctxB.newPage();
  for (const p of [host, guest]) {
    await p.addInitScript(() => localStorage.setItem("ff-muted", "1"));
  }

  await host.goto(`${GAME}?${PS}`);
  await host.waitForFunction(() => !!window.__FF);
  await host.evaluate(() => window.__FF.setFast());
  await host.locator('[data-mode="online"]').click();
  await host.locator("#btn-host").click();
  await expect(host.locator("#host-code")).not.toHaveText("····", { timeout: 20000 });
  const code = (await host.locator("#host-code").textContent()).trim();

  await guest.goto(`${GAME}?${PS}&join=${code}`);
  await guest.waitForFunction(() => !!window.__FF);
  await guest.evaluate(() => window.__FF.setFast());
  await guest.locator("#btn-worldpick-go").click();
  await expect(host.locator("#screen-worldpick")).toHaveClass(/active/, { timeout: 30000 });
  await host.locator("#btn-worldpick-go").click();
  await expect(host.locator("#btn-place-done")).toBeVisible({ timeout: 30000 });
  await expect(guest.locator("#btn-place-done")).toBeVisible({ timeout: 30000 });
  await host.locator("#btn-place-done").click();
  await guest.locator("#btn-place-done").click();
  await expect(host.locator("#status")).toContainText(/dran|sucht/, { timeout: 20000 });
  await expect(guest.locator("#status")).toContainText(/dran|sucht/, { timeout: 20000 });

  // the guest's browser dies mid-battle …
  await guest.reload();
  await guest.waitForFunction(() => !!window.__FF);
  await guest.evaluate(() => window.__FF.setFast());
  // … and is offered the way back via the resume banner
  await expect(guest.locator("#resume-banner")).toBeVisible();
  await guest.locator("#btn-resume").click();
  await expect.poll(() => guest.evaluate(() => window.__FF.state.phase)).toBe("battle");
  await expect
    .poll(() => guest.evaluate(() => window.__FF.state.resumeOk === true), { timeout: 30000 })
    .toBe(true);
  await expect
    .poll(() => host.evaluate(() => !window.__FF.state.inputLocked || window.__FF.state.turn === 1), {
      timeout: 20000,
    })
    .toBe(true);

  // whoever's turn it is can keep shooting
  const guestTurn = await guest.evaluate(() => window.__FF.state.turn === 0);
  const active = guestTurn ? guest : host;
  const target = await active.evaluate(() => {
    const marks = window.__FF.marksOn(1) || {};
    for (let y = 0; y < 8; y += 1) {
      for (let x = 0; x < 8; x += 1) {
        if (!marks[`${x},${y}`]) return { x, y };
      }
    }
    return null;
  });
  await active.evaluate(([x, y]) => window.__FF.tap(x, y), [target.x, target.y]);
  await expect
    .poll(
      () => active.evaluate((k) => (window.__FF.marksOn(1) || {})[k] != null, `${target.x},${target.y}`),
      { timeout: 15000 }
    )
    .toBe(true);

  await ctxA.close();
  await ctxB.close();
});

test("friends: reconnect directly without any code", async ({ browser }) => {
  test.setTimeout(120000);
  const ctxA = await browser.newContext({ viewport: { width: 340, height: 600 } });
  const ctxB = await browser.newContext({ viewport: { width: 340, height: 600 } });
  const host = await ctxA.newPage();
  const guest = await ctxB.newPage();
  for (const p of [host, guest]) {
    await p.addInitScript(() => localStorage.setItem("ff-muted", "1"));
  }
  await host.goto(`${GAME}?${PS}`);
  await host.waitForFunction(() => !!window.__FF);
  const hostPid = await host.evaluate(() => localStorage.getItem("ff-pid"));
  expect(hostPid).toBeTruthy();
  // the host simply sits on the TITLE screen — reachable for friends

  // the guest remembers the host from an earlier match: the quick-play
  // button lives right on the title screen now
  await guest.goto(`${GAME}?${PS}`);
  await guest.waitForFunction(() => !!window.__FF);
  await guest.evaluate((pid) => {
    localStorage.setItem(
      "ff-friends",
      JSON.stringify({ [pid]: { world: "weltraum", ts: Date.now() - 3600000 } })
    );
  }, hostPid);
  await guest.reload();
  await guest.waitForFunction(() => !!window.__FF);
  await expect(guest.locator("#title-friends .friend-quick")).toBeVisible();
  await guest.locator("#title-friends .friend-quick").first().click();
  await expect(guest.locator("#screen-worldpick")).toHaveClass(/active/);
  await guest.locator('#world-grid-2 [data-world="dino"]').click();
  await guest.locator("#btn-worldpick-go").click();

  // knock-knock: the host's device flashes an invite popup
  await expect(host.locator("#invite-pop")).toBeVisible({ timeout: 30000 });
  await expect(host.locator("#invite-text")).toContainText("möchte", { timeout: 15000 });
  await host.locator("#invite-yes").click();

  // accepted: the host answers with its own world pick, then both place
  await expect(host.locator("#screen-worldpick")).toHaveClass(/active/, { timeout: 30000 });
  await host.locator("#btn-worldpick-go").click();
  await expect(host.locator("#btn-place-done")).toBeVisible({ timeout: 30000 });
  await expect(guest.locator("#btn-place-done")).toBeVisible({ timeout: 30000 });
  await expect.poll(() => host.evaluate(() => window.__FF.state.worlds[1])).toBe("dino");

  await ctxA.close();
  await ctxB.close();
});
