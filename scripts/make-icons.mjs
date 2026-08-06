// Generate the Funkel-Flotte PWA icons by rendering the game's actual
// 3D whale model in headless Chromium (keeps icons consistent with the
// in-game art; re-run this script to regenerate).
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { chromium } from "@playwright/test";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname);
const outDir = resolve(root, "games/funkelflotte/icons");
await mkdir(outDir, { recursive: true });

// tiny static server so the game module graph loads
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png" };
const server = createServer(async (req, res) => {
  try {
    let path = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (path.endsWith("/")) path += "index.html";
    const data = await readFile(join(root, path));
    res.writeHead(200, { "Content-Type": TYPES[extname(path)] || "application/octet-stream" });
    res.end(data);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((r) => server.listen(8199, "127.0.0.1", r));

const preinstalled = process.env.FF_CHROMIUM || "/opt/pw-browsers/chromium";
const executablePath = existsSync(preinstalled) ? preinstalled : undefined;
const browser = await chromium.launch({ executablePath });
const page = await browser.newPage({ viewport: { width: 512, height: 512 } });
await page.goto("http://127.0.0.1:8199/games/funkelflotte/");
await page.waitForFunction(() => !!window.__FF);
const whale = await page.evaluate(() => window.__FF.thumb("ozean", 0, 4, 460));

function iconHtml(padding) {
  return `<!doctype html><html><body style="margin:0">
  <div style="width:512px;height:512px;display:grid;place-items:center;position:relative;
    background:radial-gradient(circle at 32% 26%, #6fd4e8, #1d6fa5 58%, #0b3d6b 100%);">
    <img src="${whale}" style="width:${470 - padding * 2}px;filter:drop-shadow(0 14px 22px rgba(0,0,0,.4))" />
    <div style="position:absolute;top:${44 + padding}px;right:${58 + padding}px;width:${86 - padding / 3}px;height:${86 - padding / 3}px;
      background:radial-gradient(circle, #fff 0%, #ffd447 45%, transparent 70%);border-radius:50%"></div>
  </div></body></html>`;
}

for (const [name, size, padding] of [
  ["icon-512.png", 512, 0],
  ["icon-192.png", 192, 0],
  ["icon-maskable-512.png", 512, 62],
]) {
  await page.setContent(iconHtml(padding));
  await page.waitForTimeout(150);
  const buf = await page.screenshot({ clip: { x: 0, y: 0, width: 512, height: 512 } });
  if (size !== 512) {
    const p2 = await browser.newPage({ viewport: { width: size, height: size } });
    await p2.setContent(
      `<img src="data:image/png;base64,${buf.toString("base64")}" style="width:${size}px;height:${size}px;display:block" />`
    );
    await p2.waitForTimeout(150);
    const small = await p2.screenshot({ clip: { x: 0, y: 0, width: size, height: size } });
    await writeFile(resolve(outDir, name), small);
    await p2.close();
  } else {
    await writeFile(resolve(outDir, name), buf);
  }
  console.log(name);
}

await browser.close();
server.close();
