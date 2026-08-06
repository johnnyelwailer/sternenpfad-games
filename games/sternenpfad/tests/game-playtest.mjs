import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

const root = new URL("../", import.meta.url).pathname;
const port = 3187;
const baseUrl = `http://localhost:${port}`;

await mkdir(`${root}/tmp/playtest-v3`, { recursive: true });

async function waitForServer(url, child) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Dev server exited with ${child.exitCode}`);
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // The dev server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Dev server did not become ready within 30 seconds");
}

async function gameState(page) {
  await page.waitForFunction(() => typeof window.render_game_to_text === "function");
  return page.evaluate(() => JSON.parse(window.render_game_to_text()));
}

async function advance(page, milliseconds) {
  await page.evaluate((duration) => window.advanceTime?.(duration), milliseconds);
  await page.waitForTimeout(40);
  return gameState(page);
}

async function assertNoOverflow(page) {
  const metrics = await page.evaluate(() => ({ innerWidth: innerWidth, documentWidth: document.documentElement.scrollWidth, bodyWidth: document.body.scrollWidth }));
  assert.ok(metrics.documentWidth <= metrics.innerWidth + 1, `document overflow: ${JSON.stringify(metrics)}`);
  assert.ok(metrics.bodyWidth <= metrics.innerWidth + 1, `body overflow: ${JSON.stringify(metrics)}`);
}

const server = spawn("npm", ["run", "dev", "--", "--host", "127.0.0.1", "--port", String(port)], {
  cwd: root,
  env: { ...process.env, WRANGLER_LOG_PATH: ".wrangler/playtest-v3.log" },
  stdio: ["ignore", "pipe", "pipe"],
});
let serverOutput = "";
server.stdout.on("data", (chunk) => { serverOutput += chunk.toString(); });
server.stderr.on("data", (chunk) => { serverOutput += chunk.toString(); });

try {
  await waitForServer(baseUrl, server);
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 320, height: 568 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  const consoleErrors = [];
  const pageErrors = [];
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.waitForSelector(".webgl-stage canvas");
  await assertNoOverflow(page);
  const initial = await gameState(page);
  assert.equal(initial.screen, "level");
  assert.equal(initial.level, "lichtung-1");
  assert.equal(initial.totalLevels, 10);
  assert.equal(initial.showPhantom, true);
  assert.equal(await page.locator(".webgl-stage canvas").count(), 1);
  assert.equal(await page.locator(".webgl-error").count(), 0);
  assert.equal(await page.locator(".command-button").count(), 3);
  assert.equal(await page.locator(".hud-progress i").count(), 10);
  assert.match(await page.locator(".story-card").innerText(), /Sternenlichtung|Der erste Stern/i);
  const visibleActionText = await page.locator(".command-button").allTextContents();
  assert.ok(visibleActionText.every((text) => !/[A-ZÄÖÜ]{4,}/.test(text)), `action controls should stay visual, got ${visibleActionText.join(" | ")}`);
  assert.equal(await page.locator(".mode-button").count(), 3);
  assert.equal(await page.locator(".step-button").count(), 1);
  assert.equal(await page.getByRole("button", { name: "Elternmodus", exact: true }).count(), 0, "the game must not expose a dynamic age selector");
  await page.getByRole("button", { name: "Phantom ausblenden", exact: true }).click();
  assert.equal((await gameState(page)).showPhantom, false);
  await page.getByRole("button", { name: "Phantom einblenden", exact: true }).click();
  assert.equal((await gameState(page)).showPhantom, true);
  await page.screenshot({ path: `${root}/tmp/playtest-v3/boot-3d-320.png`, fullPage: true });

  const forward = page.getByRole("button", { name: "Einen Schritt gehen", exact: true });
  const left = page.getByRole("button", { name: "Nach links drehen", exact: true });
  const right = page.getByRole("button", { name: "Nach rechts drehen", exact: true });
  await forward.click();
  await left.click();
  await forward.click();
  const dragStart = await page.locator(".program-slot").nth(0).boundingBox();
  const dragTarget = await page.locator(".program-slot").nth(2).boundingBox();
  assert.ok(dragStart && dragTarget, "program slots must be touch-draggable");
  await page.mouse.move(dragStart.x + dragStart.width / 2, dragStart.y + dragStart.height / 2);
  await page.mouse.down();
  await page.mouse.move(dragTarget.x + dragTarget.width / 2, dragTarget.y + dragTarget.height / 2);
  await page.mouse.up();
  assert.deepEqual((await gameState(page)).program, ["left", "forward", "forward"], "dragging a slot must reorder the program");
  await page.getByRole("button", { name: "Befehle löschen" }).click();
  for (let index = 0; index < 5; index += 1) await forward.click();
  let state = await gameState(page);
  assert.equal(state.program.length, 5);
  assert.deepEqual(state.preview.grid, { x: 3, y: 4 }, "a path must stop on the last built stone when grass blocks the route");
  assert.equal(state.errors.length, 3, "blocked commands must remain visible in the simulation trace");
  assert.equal(await page.locator(".filled-forward").count(), 5);
  await page.screenshot({ path: `${root}/tmp/playtest-v3/preview-wrong-320.png`, fullPage: true });
  await page.getByRole("button", { name: "Milo loslassen" }).click();
  assert.equal((await gameState(page)).runState, "running");
  state = await advance(page, 5000);
  assert.equal(state.runState, "retry");
  assert.deepEqual(state.player.grid, { x: 3, y: 4 }, "the wrong program must bump against grass without teleporting");
  await page.screenshot({ path: `${root}/tmp/playtest-v3/retry-3d-320.png`, fullPage: true });

  await page.getByRole("button", { name: "Befehle löschen" }).click();
  assert.equal((await gameState(page)).program.length, 0);
  await page.getByRole("button", { name: "Schnell ausführen", exact: true }).click();
  assert.equal((await gameState(page)).runMode, "fast");
  await forward.click();
  await page.getByRole("button", { name: "Milo loslassen" }).click();
  state = await advance(page, 1000);
  assert.equal(state.runState, "retry", "an incomplete program should still execute");
  assert.deepEqual(state.player.grid, { x: 2, y: 4 });
  await page.getByRole("button", { name: "Befehle löschen" }).click();
  await page.getByRole("button", { name: "Schritt für Schritt ausführen", exact: true }).click();
  assert.equal((await gameState(page)).runMode, "manual");
  await forward.click();
  await forward.click();
  await page.getByRole("button", { name: "Einen Programmschritt ausführen", exact: true }).click();
  state = await gameState(page);
  assert.equal(state.runState, "running");
  assert.deepEqual(state.player.grid, { x: 2, y: 4 });
  await page.getByRole("button", { name: "Einen Programmschritt ausführen", exact: true }).click();
  state = await gameState(page);
  assert.equal(state.runState, "retry");
  assert.deepEqual(state.player.grid, { x: 3, y: 4 });
  await page.getByRole("button", { name: "Befehle löschen" }).click();
  await forward.click();
  await forward.click();
  await left.click();
  await forward.click();
  await forward.click();
  await page.getByRole("button", { name: "Langsam ausführen", exact: true }).click();
  state = await gameState(page);
  assert.equal(state.program.length, 5);
  assert.equal(state.preview.step, 4);
  await page.getByRole("button", { name: "Milo loslassen" }).click();
  assert.equal((await gameState(page)).runState, "running");
  state = await advance(page, 5000);
  assert.equal(state.runState, "success");
  assert.equal(state.player.step, 4);
  assert.deepEqual(state.player.grid, { x: 3, y: 2 });
  assert.ok(state.completed.includes("lichtung-1"));
  assert.equal(await forward.isDisabled(), true, "a completed level must lock editing until the player advances");
  const completedPosition = state.player.grid;
  await page.waitForTimeout(200);
  assert.deepEqual((await gameState(page)).player.grid, completedPosition, "success must not reset the avatar back to start");
  await page.screenshot({ path: `${root}/tmp/playtest-v3/success-3d-320.png`, fullPage: true });

  await page.getByRole("button", { name: "Nächstes Level öffnen" }).click();
  await page.waitForTimeout(500);
  state = await gameState(page);
  assert.equal(state.level, "mondquell-1");
  assert.equal(state.program.length, 0);
  assert.equal(await page.locator(".webgl-stage canvas").count(), 1);
  await page.screenshot({ path: `${root}/tmp/playtest-v3/bridge-3d-320.png`, fullPage: true });

  await page.getByRole("button", { name: "Schnell ausführen", exact: true }).click();
  for (let index = 0; index < 7; index += 1) await forward.click();
  await page.getByRole("button", { name: "Milo loslassen" }).click();
  state = await advance(page, 2500);
  assert.equal(state.runState, "retry");
  assert.ok(state.errors.length >= 1, "edge bumps should be recorded while the program continues");
  assert.deepEqual(state.player.grid, { x: 3, y: 4 });
  await page.screenshot({ path: `${root}/tmp/playtest-v3/edge-3d-320.png`, fullPage: true });

  await page.getByRole("button", { name: "Befehle löschen" }).click();
  await forward.click();
  await forward.click();
  await left.click();
  await forward.click();
  await forward.click();
  await right.click();
  await forward.click();
  await page.getByRole("button", { name: "Milo loslassen" }).click();
  state = await advance(page, 2500);
  assert.equal(state.runState, "success");
  assert.deepEqual(state.player.grid, { x: 4, y: 2 });
  assert.ok(state.completed.includes("mondquell-1"));
  await page.getByRole("button", { name: "Nächstes Level öffnen" }).click();
  await page.waitForTimeout(500);
  state = await gameState(page);
  assert.equal(state.level, "mondturm-1", "the bridge must lead to a third destination");
  assert.equal(state.program.length, 0);
  await page.screenshot({ path: `${root}/tmp/playtest-v3/moon-tower-3d-320.png`, fullPage: true });

  await forward.click();
  await forward.click();
  await left.click();
  await forward.click();
  await forward.click();
  await right.click();
  await forward.click();
  await forward.click();
  await left.click();
  await forward.click();
  await page.getByRole("button", { name: "Milo loslassen" }).click();
  state = await advance(page, 2500);
  assert.equal(state.runState, "success");
  assert.ok(state.completed.includes("mondturm-1"));
  await page.getByRole("button", { name: "Nächstes Level öffnen" }).click();
  await page.waitForTimeout(500);
  state = await gameState(page);
  assert.equal(state.level, "wipfelpfad-1");
  const action = page.getByRole("button", { name: "Springen oder klettern", exact: true });
  assert.equal(await action.count(), 1);
  await page.screenshot({ path: `${root}/tmp/playtest-v3/climb-canopy-3d-320.png`, fullPage: true });
  await action.click();
  await forward.click();
  await page.getByRole("button", { name: "Milo loslassen" }).click();
  state = await advance(page, 2500);
  assert.equal(state.runState, "retry", "an invalid merged action must bump and still finish the program");
  assert.ok(state.errors.some((error) => error.kind === "action"));
  assert.deepEqual(state.player.grid, { x: 2, y: 4 });
  await page.getByRole("button", { name: "Befehle löschen" }).click();
  await forward.click();
  await forward.click();
  await left.click();
  await action.click();
  await forward.click();
  await right.click();
  await forward.click();
  await forward.click();
  await page.getByRole("button", { name: "Milo loslassen" }).click();
  state = await advance(page, 2500);
  assert.equal(state.runState, "success", "the ladder must be traversable with the merged action command");
  assert.deepEqual(state.player.grid, { x: 5, y: 2, height: 1 });
  await page.getByRole("button", { name: "Nächstes Level öffnen" }).click();
  await page.waitForTimeout(500);
  state = await gameState(page);
  assert.equal(state.level, "sprungtal-1");
  assert.equal(await action.count(), 1);
  await page.screenshot({ path: `${root}/tmp/playtest-v3/jump-valley-ready-3d-320.png`, fullPage: true });
  await forward.click();
  await forward.click();
  await action.click();
  await left.click();
  await forward.click();
  await forward.click();
  await page.getByRole("button", { name: "Milo loslassen" }).click();
  state = await advance(page, 2500);
  assert.equal(state.runState, "success", "the merged action command must cross the visible gap");
  assert.deepEqual(state.player.grid, { x: 5, y: 2 });
  await page.screenshot({ path: `${root}/tmp/playtest-v3/jump-valley-3d-320.png`, fullPage: true });

  await page.getByRole("button", { name: "Nächstes Level öffnen" }).click();
  await page.waitForTimeout(400);
  state = await gameState(page);
  assert.equal(state.level, "felsenbogen-1", "the world must continue into the larger authored chapter");
  await forward.click();
  await forward.click();
  await action.click();
  await left.click();
  await forward.click();
  await forward.click();
  await right.click();
  await forward.click();
  await forward.click();
  await left.click();
  await forward.click();
  await forward.click();
  await page.getByRole("button", { name: "Milo loslassen" }).click();
  state = await advance(page, 3000);
  assert.equal(state.runState, "success", `the authored long route must be a valid solution: ${JSON.stringify(state)}`);
  assert.deepEqual(state.player.grid, { x: 7, y: 1 });

  await page.getByRole("button", { name: "Weltkarte öffnen" }).click();
  assert.equal(await page.locator(".world-map-overlay").count(), 1);
  await page.screenshot({ path: `${root}/tmp/playtest-v3/world-map-320.png`, fullPage: true });
  assert.equal(await page.locator(".map-realm-group").count(), 3, "the map must make the three realms visually distinct");
  await page.getByRole("button", { name: "Moosgarten: Der verschlungene Rhythmus", exact: true }).click();
  await page.waitForTimeout(400);
  state = await gameState(page);
  assert.equal(state.level, "moosgarten-1");
  assert.ok(state.availableCommands.includes("loop"), "the loop tool should be authored into the progression when it is introduced");
  const loop = page.getByRole("button", { name: "Schritt als Schleife bauen", exact: true });
  await forward.click();
  await forward.click();
  await left.click();
  await forward.click();
  await loop.click();
  await right.click();
  await forward.click();
  await loop.click();
  await left.click();
  await forward.click();
  await loop.click();
  await right.click();
  await forward.click();
  state = await gameState(page);
  assert.equal(state.program.length, 10, "a loop groups a step into one visible program tile");
  assert.deepEqual(state.program.filter((item) => typeof item !== "string"), [
    { type: "loop", command: "forward", count: 2 },
    { type: "loop", command: "forward", count: 2 },
    { type: "loop", command: "forward", count: 2 },
  ]);
  await page.locator(".filled-loop").first().click();
  assert.equal((await gameState(page)).program[3].count, 3, "tapping a loop tile should visibly increase its count");
  await page.locator(".filled-loop").first().click();
  await page.locator(".filled-loop").first().click();
  assert.equal((await gameState(page)).program[3].count, 2, "loop counts should cycle back predictably");
  await page.screenshot({ path: `${root}/tmp/playtest-v3/loop-program-320.png`, fullPage: true });
  await page.getByRole("button", { name: "Milo loslassen" }).click();
  state = await advance(page, 3500);
  assert.equal(state.runState, "success", `the loop must help solve the larger winding garden: ${JSON.stringify(state)}`);
  assert.deepEqual(state.player.grid, { x: 6, y: 2 });

  await page.getByRole("button", { name: "Nächstes Level öffnen" }).click();
  await page.waitForTimeout(400);
  state = await gameState(page);
  assert.equal(state.level, "wolkenwerk-1");
  assert.equal(state.availableCommands.includes("loop"), false, "loops must stay inside the second realm");
  assert.ok(state.availableCommands.includes("function"));
  assert.ok(state.availableCommands.includes("call"));
  const buildFunction = page.getByRole("button", { name: "Funktion aus den letzten zwei Schritten bauen", exact: true });
  const callFunction = page.getByRole("button", { name: "Funktion ausführen", exact: true });
  await forward.click();
  await forward.click();
  await buildFunction.click();
  await callFunction.click();
  await left.click();
  await callFunction.click();
  await right.click();
  await callFunction.click();
  await left.click();
  await callFunction.click();
  await right.click();
  await forward.click();
  await forward.click();
  state = await gameState(page);
  assert.deepEqual(state.program[0], { type: "function", body: ["forward", "forward"] });
  assert.equal(state.program.filter((item) => typeof item === "object" && item.type === "call").length, 4);
  assert.equal(await page.locator(".filled-function").count(), 1);
  assert.equal(await page.locator(".filled-call").count(), 4);
  await page.screenshot({ path: `${root}/tmp/playtest-v3/function-program-320.png`, fullPage: true });
  await page.getByRole("button", { name: "Milo loslassen" }).click();
  state = await advance(page, 4000);
  assert.equal(state.runState, "success", `the first function recipe must run: ${JSON.stringify(state)}`);
  assert.deepEqual(state.player.grid, { x: 7, y: 2 });

  await page.getByRole("button", { name: "Nächstes Level öffnen" }).click();
  await page.waitForTimeout(400);
  state = await gameState(page);
  assert.equal(state.level, "wolkenwerk-2");
  assert.equal(state.availableCommands.includes("loop"), false);
  await forward.click();
  await forward.click();
  await buildFunction.click();
  await callFunction.click();
  await left.click();
  await callFunction.click();
  await right.click();
  await action.click();
  await left.click();
  await callFunction.click();
  await right.click();
  await forward.click();
  await forward.click();
  await page.getByRole("button", { name: "Milo loslassen" }).click();
  state = await advance(page, 4000);
  assert.equal(state.runState, "success", `the second function recipe must cross its gap: ${JSON.stringify(state)}`);
  assert.deepEqual(state.player.grid, { x: 7, y: 2 });

  await page.getByRole("button", { name: "Nächstes Level öffnen" }).click();
  await page.waitForTimeout(400);
  state = await gameState(page);
  assert.equal(state.level, "sternentor-1");
  assert.equal(state.availableCommands.includes("loop"), false, "the final realm should not reintroduce loops");
  await forward.click();
  await forward.click();
  await buildFunction.click();
  await callFunction.click();
  await left.click();
  await action.click();
  await forward.click();
  await right.click();
  await action.click();
  await left.click();
  await callFunction.click();
  await right.click();
  await callFunction.click();
  await left.click();
  await forward.click();
  await page.getByRole("button", { name: "Milo loslassen" }).click();
  state = await advance(page, 4000);
  assert.equal(state.runState, "success", `the final chapter must combine the introduced concepts: ${JSON.stringify(state)}`);
  await page.getByRole("button", { name: "Nächstes Level öffnen" }).click();
  state = await gameState(page);
  assert.equal(state.worldMapOpen, true, "the completed world must open its map instead of resetting silently");
  assert.equal(await page.locator(".map-node").count(), 10);

  await page.reload({ waitUntil: "networkidle" });
  await page.waitForFunction(() => typeof window.render_game_to_text === "function");
  state = await gameState(page);
  assert.ok(state.completed.includes("sternentor-1"), "completed chapters must persist across reloads");

  const widePage = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  await widePage.goto(baseUrl, { waitUntil: "networkidle" });
  await widePage.waitForSelector(".webgl-stage canvas");
  await assertNoOverflow(widePage);
  assert.equal(await widePage.locator(".webgl-error").count(), 0);
  await widePage.screenshot({ path: `${root}/tmp/playtest-v3/boot-3d-390.png`, fullPage: true });
  await widePage.close();

  assert.deepEqual(pageErrors, [], `page errors: ${pageErrors.join(" | ")}`);
  assert.deepEqual(consoleErrors, [], `console errors: ${consoleErrors.join(" | ")}`);
  await browser.close();
  console.log("Playwright WebGL flow passed: 3D boot -> phantom toggle -> preview -> wrong run -> reset -> success -> bridge -> third level.");
} catch (error) {
  console.error(error);
  console.error(serverOutput.slice(-5000));
  process.exitCode = 1;
} finally {
  server.kill("SIGTERM");
}
