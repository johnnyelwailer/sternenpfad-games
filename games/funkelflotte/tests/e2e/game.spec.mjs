import { test, expect } from "@playwright/test";

const GAME = "/games/funkelflotte/";

test.beforeEach(async ({ page }) => {
  // keep the synth quiet in headless runs
  await page.addInitScript(() => localStorage.setItem("ff-muted", "1"));
  await page.goto(GAME);
});

test("title screen shows worlds and modes", async ({ page }) => {
  await expect(page.locator("h1.logo")).toContainText("Funkel-Flotte");
  await expect(page.locator(".world-card")).toHaveCount(4);
  await expect(page.locator('[data-mode="ai"]')).toBeVisible();
  await expect(page.locator('[data-mode="hotseat"]')).toBeVisible();
  await expect(page.locator('[data-mode="online"]')).toBeVisible();
});

test("picking a world re-themes the page", async ({ page }) => {
  const bgBefore = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue("--bg1").trim()
  );
  await page.locator('[data-world="weltraum"]').click();
  await expect(page.locator('[data-world="weltraum"]')).toHaveClass(/selected/);
  const bgAfter = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue("--bg1").trim()
  );
  expect(bgAfter).not.toBe(bgBefore);
});

test("placement: board shows 5 creatures, shuffle keeps them valid, tap rotates", async ({ page }) => {
  await page.locator('[data-mode="ai"]').click();
  await expect(page.locator("#screen-place")).toHaveClass(/active/);
  await expect(page.locator("#place-board .creature")).toHaveCount(5);
  await expect(page.locator("#place-board .cell")).toHaveCount(64);

  await page.locator("#btn-shuffle").click();
  await expect(page.locator("#place-board .creature")).toHaveCount(5);

  // tap the first creature; orientation class or geometry should flip
  // (or it shakes if rotation is blocked — either way the game must not break)
  const first = page.locator("#place-board .creature").first();
  const wasVertical = await first.evaluate((el) => el.classList.contains("v"));
  // force: the capsule bobs in an infinite animation, so it is never "stable"
  await first.tap({ force: true });
  await expect(page.locator("#place-board .creature")).toHaveCount(5);
  const isVertical = await first.evaluate((el) => el.classList.contains("v"));
  const shaken = await first.evaluate((el) => el.classList.contains("shake"));
  expect(isVertical !== wasVertical || shaken).toBe(true);
});

test("robo game: shooting marks cells and robo answers", async ({ page }) => {
  await page.locator('[data-mode="ai"]').click();
  await page.locator("#btn-place-done").click();
  await expect(page.locator("#screen-battle")).toHaveClass(/active/);
  await expect(page.locator("#enemy-board .cell")).toHaveCount(64);
  await expect(page.locator("#own-board .creature")).toHaveCount(5);

  // shoot until we get a miss (the enemy board then locks and dims
  // while robo takes a turn), max a few tries
  for (let i = 0; i < 20; i += 1) {
    const locked = await page
      .locator("#enemy-wrap")
      .evaluate((el) => el.classList.contains("locked"));
    if (locked) break;
    const target = page.locator("#enemy-board .cell:not(.mark-miss):not(.mark-hit)").first();
    await target.click();
    const marked = await page.locator("#enemy-board .cell.mark-miss, #enemy-board .cell.mark-hit").count();
    expect(marked).toBeGreaterThan(0);
    await page.waitForTimeout(80);
  }
  await expect(page.locator("#enemy-wrap")).toHaveClass(/locked/, { timeout: 30000 });
  // robo eventually shoots our board (1.1s delay per shot)
  await expect
    .poll(async () => page.locator("#own-board .cell.mark-miss, #own-board .cell.mark-hit").count(), {
      timeout: 20000,
    })
    .toBeGreaterThan(0);
});

test("hot-seat: full game to the win screen with pass-device flow", async ({ page }) => {
  test.setTimeout(120000);
  await page.locator('[data-mode="hotseat"]').click();

  // player 1 places, pass, player 2 places, pass
  await page.locator("#btn-place-done").click();
  await expect(page.locator("#screen-pass")).toHaveClass(/active/);
  await page.locator("#btn-pass-go").click();
  await expect(page.locator("#screen-place")).toHaveClass(/active/);
  await page.locator("#btn-place-done").click();
  await page.locator("#btn-pass-go").click();
  await expect(page.locator("#screen-battle")).toHaveClass(/active/);

  // play the whole game by always shooting the first unknown cell
  for (let i = 0; i < 300; i += 1) {
    if (await page.locator("#screen-win").evaluate((el) => el.classList.contains("active"))) break;
    if (await page.locator("#btn-pass-go").isVisible()) {
      await page.locator("#btn-pass-go").click();
      continue;
    }
    if (await page.locator("#btn-endturn").isVisible()) {
      await page.locator("#btn-endturn").click();
      continue;
    }
    const target = page.locator("#enemy-board .cell:not(.mark-miss):not(.mark-hit)").first();
    if ((await target.count()) === 0) break;
    await target.click();
    await page.waitForTimeout(30);
  }

  await expect(page.locator("#screen-win")).toHaveClass(/active/);
  await expect(page.locator("#win-title")).toContainText("gewonnen");
});

test("works offline after the first visit (PWA)", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await page.addInitScript(() => localStorage.setItem("ff-muted", "1"));
  await page.goto(GAME);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForTimeout(600); // let the precache finish

  await ctx.setOffline(true);
  await page.reload();
  await expect(page.locator("h1.logo")).toContainText("Funkel-Flotte");
  // robo mode is fully playable offline
  await page.locator('[data-mode="ai"]').click();
  await expect(page.locator("#screen-place")).toHaveClass(/active/);
  await expect(page.locator("#place-board .creature")).toHaveCount(5);
  await ctx.close();
});

// Online tests run against the local signaling server (scripts/peer-server.mjs)
// via ?ps=localhost:9200 — real WebRTC, no external network needed.
const PS = "ps=localhost:9200";

test("online: host screen shows QR code and magic code", async ({ page }) => {
  await page.goto(`${GAME}?${PS}`);
  await page.locator('[data-mode="online"]').click();
  await expect(page.locator("#screen-online")).toHaveClass(/active/);
  await page.locator("#btn-host").click();
  await expect(page.locator("#screen-host")).toHaveClass(/active/);
  // code + QR appear once the broker connection is up
  await expect(page.locator("#host-code")).not.toHaveText("····", { timeout: 20000 });
  await expect(page.locator("#qr-box svg")).toBeVisible();
  const code = await page.locator("#host-code").textContent();
  expect(code).toMatch(/^[A-Z2-9]{4}$/);
});

test("online: two browsers play the first shots against each other", async ({ browser }) => {
  test.setTimeout(90000);

  const ctxA = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const ctxB = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const host = await ctxA.newPage();
  const guest = await ctxB.newPage();
  await host.addInitScript(() => localStorage.setItem("ff-muted", "1"));
  await guest.addInitScript(() => localStorage.setItem("ff-muted", "1"));

  await host.goto(`${GAME}?${PS}`);
  await host.locator('[data-world="dino"]').click();
  await host.locator('[data-mode="online"]').click();
  await host.locator("#btn-host").click();
  await expect(host.locator("#host-code")).not.toHaveText("····", { timeout: 20000 });
  const code = (await host.locator("#host-code").textContent()).trim();

  // guest joins via the deep link the QR code encodes (which keeps ?ps=)
  await guest.goto(`${GAME}?${PS}&join=${code}`);
  await expect(guest.locator("#screen-place")).toHaveClass(/active/, { timeout: 30000 });
  await expect(host.locator("#screen-place")).toHaveClass(/active/, { timeout: 30000 });

  // world was synced from host to guest
  const guestBg = await guest.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue("--bg1").trim()
  );
  expect(guestBg).toBe("#14421f"); // dino world

  await host.locator("#btn-place-done").click();
  await guest.locator("#btn-place-done").click();
  await expect(host.locator("#screen-battle")).toHaveClass(/active/, { timeout: 20000 });
  await expect(guest.locator("#screen-battle")).toHaveClass(/active/, { timeout: 20000 });

  // whoever's turn it is shoots; the mark must appear on BOTH devices
  const hostTurn = (await host.locator("#battle-status").textContent()).includes("Du bist dran");
  const shooter = hostTurn ? host : guest;
  const watcher = hostTurn ? guest : host;
  await shooter.locator("#enemy-board .cell").first().click();
  await expect
    .poll(async () =>
      shooter.locator("#enemy-board .cell.mark-miss, #enemy-board .cell.mark-hit").count()
    , { timeout: 15000 })
    .toBeGreaterThan(0);
  await expect
    .poll(async () =>
      watcher.locator("#own-board .cell.mark-miss, #own-board .cell.mark-hit").count()
    , { timeout: 15000 })
    .toBeGreaterThan(0);

  // now play the whole game to the end: each page shoots whenever it's
  // its turn, always at the first unknown cell
  let winner = null;
  for (let i = 0; i < 400 && !winner; i += 1) {
    for (const page of [host, guest]) {
      if (await page.locator("#screen-win").evaluate((el) => el.classList.contains("active"))) {
        winner = page;
        break;
      }
      const myTurn = (await page.locator("#battle-status").textContent()).includes("Du bist dran")
        || (await page.locator("#battle-status").textContent()).includes("Nochmal");
      if (!myTurn) continue;
      const target = page.locator("#enemy-board .cell:not(.mark-miss):not(.mark-hit)").first();
      if ((await target.count()) === 0) continue;
      await target.click({ force: true });
      await page.waitForTimeout(60);
    }
  }
  expect(winner).toBeTruthy();
  const loser = winner === host ? guest : host;
  await expect(loser.locator("#screen-win")).toHaveClass(/active/, { timeout: 10000 });

  // rematch: both press the button, both land back in placement
  await winner.locator("#btn-rematch").click();
  await loser.locator("#btn-rematch").click();
  await expect(host.locator("#screen-place")).toHaveClass(/active/, { timeout: 15000 });
  await expect(guest.locator("#screen-place")).toHaveClass(/active/, { timeout: 15000 });

  await ctxA.close();
  await ctxB.close();
});
