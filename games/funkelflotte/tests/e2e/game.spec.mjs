import { test, expect } from "@playwright/test";

const GAME = "/games/funkelflotte/";

// The board lives on a WebGL canvas; tests drive board interaction via
// the window.__FF test hooks and assert on game state + DOM overlays.

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("ff-muted", "1"));
  await page.goto(GAME);
  await page.waitForFunction(() => !!window.__FF);
});

async function firstUnknownCell(page, boardIdx) {
  return page.evaluate((idx) => {
    const marks = window.__FF.marksOn(idx) || {};
    for (let y = 0; y < 8; y += 1) {
      for (let x = 0; x < 8; x += 1) {
        if (!marks[`${x},${y}`]) return { x, y };
      }
    }
    return null;
  }, boardIdx);
}

test("title screen shows worlds and modes, world picking re-themes", async ({ page }) => {
  await expect(page.locator("h1.logo")).toContainText("Funkel-Flotte");
  await expect(page.locator("#world-grid .world-card")).toHaveCount(4);
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
});

test("placement: 5 valid creatures, shuffle keeps validity, rotate works", async ({ page }) => {
  await page.locator('[data-mode="ai"]').click();
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

test("style panel: tint + hat customize, persists and applies", async ({ page }) => {
  await page.locator('[data-mode="ai"]').click();
  await page.locator("#btn-style").click();
  await expect(page.locator("#style-panel")).toBeVisible();
  await expect(page.locator(".style-row")).toHaveCount(5);

  // pick the 2nd tint and one hat for the first creature
  const firstRow = page.locator(".style-row").first();
  await firstRow.locator(".tint-dot").nth(1).click();
  await firstRow.locator(".hat-btn").click();
  await expect(firstRow.locator(".tint-dot").nth(1)).toHaveClass(/selected/);
  await expect(firstRow.locator(".hat-btn")).not.toHaveText("Ohne Hut");

  const custom = await page.evaluate(() => window.__FF.state.customs[0]);
  expect(custom[0]).toEqual({ tint: 1, hat: 1 });
  const stored = await page.evaluate(() =>
    JSON.parse(localStorage.getItem(`ff-custom-${window.__FF.state.worlds[0]}`) || "{}")
  );
  expect(stored[0]).toEqual({ tint: 1, hat: 1 });

  await page.locator("#btn-style-close").click();
  await expect(page.locator("#style-panel")).toBeHidden();

  // survives into battle and a reload (placement reloads the saved map)
  await page.reload();
  await page.waitForFunction(() => !!window.__FF);
  await page.locator('[data-mode="ai"]').click();
  const reloaded = await page.evaluate(() => window.__FF.state.customs[0]);
  expect(reloaded[0]).toEqual({ tint: 1, hat: 1 });
});

test("robo game: my shots mark the enemy board, robo answers on mine", async ({ page }) => {
  await page.locator('[data-mode="ai"]').click();
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

// cells guaranteed to be water on robo's board (no ship, no balloon)
async function missCells(page, count) {
  return page.evaluate((n) => {
    const b = window.__FF.state.boards[1];
    const E = window.__FF.engine;
    const occupied = new Set();
    for (const s of b.ships) for (const c of E.shipCells(s)) occupied.add(`${c.x},${c.y}`);
    if (b.decoy) occupied.add(`${b.decoy.x},${b.decoy.y}`);
    const out = [];
    for (let y = 0; y < 8 && out.length < n; y += 1) {
      for (let x = 0; x < 8 && out.length < n; x += 1) {
        if (!occupied.has(`${x},${y}`)) out.push({ x, y });
      }
    }
    return out;
  }, count);
}

test("feature flags: new features can be switched off via URL", async ({ page }) => {
  await page.goto(`${GAME}?flags=styles:0,rules:0,stickers:0`);
  await page.waitForFunction(() => !!window.__FF);
  await expect(page.locator(".rules-row")).toBeHidden();
  await expect(page.locator("#btn-album")).toBeHidden();
  await page.locator('[data-mode="ai"]').click();
  await expect(page.locator("#btn-place-done")).toBeVisible();
  await expect(page.locator("#btn-style")).toBeHidden();
  // defaults stay on without the override
  await page.goto(GAME);
  await page.waitForFunction(() => !!window.__FF);
  await expect(page.locator(".rules-row")).toBeVisible();
  await expect(page.locator("#btn-album")).toBeVisible();
});

test("extra rules: sonar distances and the decoy balloon", async ({ page }) => {
  test.setTimeout(120000);
  await page.evaluate(() => {
    window.__FF.setFast();
    window.__FF.setRules({ decoy: true, sonar: true });
  });
  await page.locator('[data-mode="ai"]').click();

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
  await page.locator('[data-mode="ai"]').click();
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
  await expect(page.locator(".album-slot")).toHaveCount(20);
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
  await page.locator('[data-mode="ai"]').click();
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

  await expect(host.locator("#btn-place-done")).toBeVisible({ timeout: 30000 });
  await expect(guest.locator("#btn-place-done")).toBeVisible({ timeout: 30000 });

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

  // rematch: both press, both land back in placement
  await winner.locator("#btn-rematch").click();
  await loser.locator("#btn-rematch").click();
  await expect(host.locator("#btn-place-done")).toBeVisible({ timeout: 20000 });
  await expect(guest.locator("#btn-place-done")).toBeVisible({ timeout: 20000 });

  await ctxA.close();
  await ctxB.close();
});
