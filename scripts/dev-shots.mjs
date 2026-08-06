// Screenshot every screen of Funkel-Flotte for a visual review.
import { chromium } from "@playwright/test";

const BASE = "http://localhost:8123/games/funkelflotte/";
const OUT = process.argv[2] || "/tmp/shots";
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  deviceScaleFactor: 2,
});
const page = await ctx.newPage();
await page.addInitScript(() => localStorage.setItem("ff-muted", "1"));

async function shot(name) {
  await page.waitForTimeout(450);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log(name);
}

await page.goto(BASE);
await shot("01-title-ozean");

await page.locator('[data-world="weltraum"]').click();
await shot("02-title-weltraum");

await page.locator('[data-mode="hotseat"]').click();
await shot("03-place-p1");

await page.locator("#btn-place-done").click();
await shot("04-pass-to-p2");

await page.locator("#btn-pass-go").click();
await page.locator("#btn-place-done").click();
await page.locator("#btn-pass-go").click();
await shot("05-battle-start");

// shoot a few cells
for (let i = 0; i < 6; i += 1) {
  const cell = page.locator("#enemy-board .cell:not(.mark-miss):not(.mark-hit)").nth(i * 7);
  await cell.click();
  await page.waitForTimeout(150);
  if (await page.locator("#btn-endturn").isVisible()) break;
}
await shot("06-battle-marks");

// online host screen (local peer server)
await page.goto(`${BASE}?ps=localhost:9200`);
await page.locator('[data-world="bonbon"]').click();
await page.locator('[data-mode="online"]').click();
await shot("07-online-choice");
await page.locator("#btn-host").click();
await page.waitForFunction(() => document.querySelector("#host-code").textContent.length === 4);
await shot("08-host-qr");

await page.locator("#btn-home").click();
await page.locator('[data-world="dino"]').click();
await page.locator('[data-mode="online"]').click();
await page.locator("#btn-join").click();
await shot("09-join-code");

await browser.close();
console.log("done");
