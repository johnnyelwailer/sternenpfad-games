// Assemble the GitHub Pages site in dist/. Every game is equal and
// lives under its own path:
//   /              → launcher (links to all games)
//   /sternenpfad/  → Sternenpfad (built by its workspace)
//   /funkelflotte/ → Funkel-Flotte (plain static files, no build step)
import { execSync } from "node:child_process";
import { cp, mkdir, rm, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname);
const output = resolve(root, "dist");

// 1) Build the Sternenpfad workspace into games/sternenpfad/dist
execSync("npm --workspace @sternenpfad/sternenpfad run build:pages", {
  cwd: root,
  stdio: "inherit",
});

// 2) Assemble the combined site
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await writeFile(resolve(output, ".nojekyll"), "");

const sternenpfadDist = resolve(root, "games/sternenpfad/dist");
await stat(sternenpfadDist); // fail loudly if the build produced nothing
await cp(sternenpfadDist, resolve(output, "sternenpfad"), { recursive: true });

await cp(resolve(root, "games/funkelflotte"), resolve(output, "funkelflotte"), {
  recursive: true,
  filter: (src) => !src.includes("/tests"),
});

// 3) Launcher page
const GAMES = [
  {
    path: "sternenpfad/",
    emoji: "🦊",
    title: "Sternenpfad",
    description: "Programmieren für kleine Entdecker",
  },
  {
    path: "funkelflotte/",
    emoji: "🐳",
    title: "Funkel-Flotte",
    description: "Suchen & Finden — Schiffe versenken für Kinder",
  },
];

const cards = GAMES.map(
  (g) =>
    `<a class="card" href="${g.path}"><span class="emoji">${g.emoji}</span><strong>${g.title}</strong><small>${g.description}</small></a>`
).join("\n      ");

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
      ${cards}
      </div>
    </main>
  </body>
</html>
`);

console.log(`Built dist/: launcher at /, games at ${GAMES.map((g) => `/${g.path}`).join(", ")}`);
