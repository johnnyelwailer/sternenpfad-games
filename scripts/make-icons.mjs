// Generate the Funkel-Flotte PWA icons by rendering an HTML canvas of
// the icon artwork in headless Chromium (keeps the repo binary-light:
// re-run this script to regenerate).
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { chromium } from "@playwright/test";

const outDir = resolve(
  new URL("..", import.meta.url).pathname,
  "games/funkelflotte/icons"
);
await mkdir(outDir, { recursive: true });

const preinstalled = process.env.FF_CHROMIUM || "/opt/pw-browsers/chromium";
const executablePath = existsSync(preinstalled) ? preinstalled : undefined;
const browser = await chromium.launch({ executablePath });
const page = await browser.newPage({ viewport: { width: 512, height: 512 } });

function iconHtml(padding) {
  return `<!doctype html><html><body style="margin:0">
  <div style="width:512px;height:512px;display:grid;place-items:center;
    background:radial-gradient(circle at 30% 25%, #1d6fa5, #0b3d6b 70%);">
    <div style="font:700 ${340 - padding * 2}px system-ui;line-height:1;
      filter: drop-shadow(0 10px 18px rgba(0,0,0,.45));">🐳</div>
    <div style="position:absolute;top:${52 + padding}px;right:${72 + padding}px;
      font-size:${120 - padding / 2}px">✨</div>
  </div></body></html>`;
}

for (const [name, size, padding] of [
  ["icon-512.png", 512, 0],
  ["icon-192.png", 192, 0],
  ["icon-maskable-512.png", 512, 60],
]) {
  await page.setContent(iconHtml(padding));
  await page.waitForTimeout(150);
  const buf = await page.screenshot({ clip: { x: 0, y: 0, width: 512, height: 512 } });
  if (size !== 512) {
    // rescale via a second page using canvas
    const p2 = await browser.newPage({ viewport: { width: size, height: size } });
    await p2.setContent(
      `<img id="i" src="data:image/png;base64,${buf.toString("base64")}"
        style="width:${size}px;height:${size}px;display:block" />`
    );
    await p2.waitForTimeout(150);
    const small = await p2.screenshot({ clip: { x: 0, y: 0, width: size, height: size } });
    await import("node:fs/promises").then((fs) => fs.writeFile(resolve(outDir, name), small));
    await p2.close();
  } else {
    await import("node:fs/promises").then((fs) => fs.writeFile(resolve(outDir, name), buf));
  }
  console.log(name);
}

await browser.close();
