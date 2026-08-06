import { cp, mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname);
const output = resolve(root, "dist");
const gamesDir = resolve(root, "games");

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await writeFile(resolve(output, ".nojekyll"), "");

// Copy every game directory that ships an index.html.
const games = [];
let entries = [];
try {
  entries = await readdir(gamesDir);
} catch {
  entries = [];
}
for (const entry of entries) {
  const dir = resolve(gamesDir, entry);
  const info = await stat(dir).catch(() => null);
  if (!info || !info.isDirectory()) continue;
  const hasIndex = await stat(resolve(dir, "index.html")).catch(() => null);
  if (!hasIndex) continue;
  await cp(dir, resolve(output, entry), {
    recursive: true,
    filter: (src) => !src.includes("/tests"),
  });
  games.push(entry);
}

const GAME_META = {
  funkelflotte: {
    title: "Funkel-Flotte",
    emoji: "🐳",
    description: "Suchen & Finden — Schiffe versenken für Kinder",
  },
};

const cards = games
  .map((id) => {
    const meta = GAME_META[id] || { title: id, emoji: "🎮", description: "" };
    return `<a class="card" href="${id}/"><span class="emoji">${meta.emoji}</span><strong>${meta.title}</strong><small>${meta.description}</small></a>`;
  })
  .join("\n      ");

await writeFile(resolve(output, "index.html"), `<!doctype html>
<html lang="de">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Sternenpfad Games</title>
    <style>
      body{margin:0;min-height:100vh;display:grid;place-items:center;background:#09142b;color:#fff8de;font:16px system-ui,sans-serif}
      main{max-width:36rem;padding:2rem;text-align:center}
      p{color:#b7c3d2;line-height:1.5}
      .cards{display:grid;gap:14px;margin-top:1.5rem}
      .card{display:flex;flex-direction:column;gap:4px;align-items:center;background:#122a52;border-radius:16px;padding:20px;color:#fff8de;text-decoration:none;box-shadow:0 6px 18px rgba(0,0,0,.4);transition:transform .15s}
      .card:hover{transform:scale(1.03)}
      .card .emoji{font-size:2.4rem}
      .card small{color:#b7c3d2}
    </style>
  </head>
  <body>
    <main>
      <h1>Sternenpfad Games</h1>
      <p>Kleine Spiele für kleine Entdecker.</p>
      <div class="cards">
      ${cards || "<p>Noch keine Spiele veröffentlicht.</p>"}
      </div>
    </main>
  </body>
</html>
`);

console.log(`Built dist/ with games: ${games.join(", ") || "(none)"}`);
