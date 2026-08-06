import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const templateRoot = new URL("../", import.meta.url);

test("builds a static GitHub Pages shell for the 3D Sternenpfad controls", async () => {
  const html = await readFile(new URL("../dist/index.html", import.meta.url), "utf8");
  assert.match(html, /<html lang="de">/i);
  assert.match(html, /<title>Sternenpfad · Programmieren für kleine Entdecker<\/title>/i);
  assert.match(html, /sternenpfad-games\/sternenpfad\/assets\/index-[^"']+\.js/);
  assert.match(html, /sternenpfad-games\/sternenpfad\/assets\/index-[^"']+\.css/);
});

test("keeps the 3D runtime, spatial preview, and browser-test contract", async () => {
  const [page, layout, packageJson, audio, character, front, back] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../public/story-narration.mp3", import.meta.url)),
    readFile(new URL("../public/assets/lumi.png", import.meta.url)),
    readFile(new URL("../public/assets/lumi-front.png", import.meta.url)),
    readFile(new URL("../public/assets/lumi-back.png", import.meta.url)),
  ]);

  assert.match(page, /WebGLRenderer/);
  assert.match(page, /PerspectiveCamera/);
  assert.match(page, /function makeFox/);
  assert.match(page, /function makeShrine/);
  assert.match(page, /function makeMoonTower/);
  assert.match(page, /function makeLadder/);
  assert.match(page, /function makeJumpGap/);
  assert.match(page, /realmMeta/);
  assert.match(page, /"action"/);
  assert.match(page, /"loop"/);
  assert.match(page, /"function"/);
  assert.match(page, /"call"/);
  assert.match(page, /function makeCloudGate/);
  assert.match(page, /map-realm-group/);
  assert.doesNotMatch(page, /Den letzten Befehl wiederholen|lastRepeatableCommand/);
  assert.match(page, /actionGaps/);
  assert.match(page, /board: \{ width: 9, height: 8 \}/);
  assert.match(page, /worldMapOpen/);
  assert.match(page, /handleProgramPointerMove/);
  assert.match(page, /sternenpfad\.completed/);
  assert.match(page, /function makeWorld/);
  assert.match(page, /webglcontextlost/);
  assert.match(page, /preview/);
  assert.match(page, /runModeDelay/);
  assert.match(page, /stepProgram/);
  assert.match(page, /simulation\.errors/);
  assert.match(page, /function playCue/);
  assert.match(page, /AudioContext/);
  assert.match(page, /narrateOnce/);
  assert.match(page, /showPhantom/);
  assert.match(page, /render_game_to_text/);
  assert.match(page, /advanceTime/);
  assert.doesNotMatch(page, /makeGuideArrow|guideArrow|previewLine/);
  assert.doesNotMatch(page, /lumi-direction|headingMeta|board-grid|route-connector/);
  assert.match(layout, /lang="de"/);
  assert.match(packageJson, /"three"/);
  assert.match(packageJson, /"playwright"/);
  assert.ok(audio.byteLength > 10_000);
  assert.ok(character.byteLength > 100_000);
  assert.ok(front.byteLength > 100_000);
  assert.ok(back.byteLength > 100_000);
  await assert.rejects(access(new URL("app/_sites-preview", templateRoot)));
});
