// Assemble the GitHub Pages site in dist/. Every game is equal and
// lives under its own path; the root is a catalog page that links all
// of them. Games are discovered from games/*/game.json:
//   - pages.type "static" (default): the game directory is copied as-is
//   - anything else is expected to build itself into <game>/dist via
//     its workspace `build:pages` script
import { execSync } from "node:child_process";
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname);
const output = resolve(root, "dist");
const gamesDir = resolve(root, "games");

const games = [];
for (const entry of (await readdir(gamesDir, { withFileTypes: true })).filter((e) => e.isDirectory())) {
  try {
    const meta = JSON.parse(await readFile(resolve(gamesDir, entry.name, "game.json"), "utf8"));
    games.push({ dir: entry.name, ...meta });
  } catch {
    // no game.json → not a publishable game
  }
}
games.sort((a, b) => a.title.localeCompare(b.title, "de"));

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await writeFile(resolve(output, ".nojekyll"), "");

for (const game of games) {
  const gameDir = resolve(gamesDir, game.dir);
  if ((game.pages?.type ?? "workspace") === "static") {
    await cp(gameDir, resolve(output, game.dir), {
      recursive: true,
      filter: (src) => !src.includes("/tests"),
    });
  } else {
    execSync(`npm --workspace @sternenpfad/${game.dir} run build:pages`, {
      cwd: root,
      stdio: "inherit",
    });
    const built = resolve(gameDir, "dist");
    await stat(built); // fail loudly if the build produced nothing
    await cp(built, resolve(output, game.dir), { recursive: true });
  }
}

const cards = games
  .map((g) => {
    const [c1, c2] = g.accent ?? ["#122a52", "#0c1d3a"];
    return `<a class="card" href="${g.dir}/" style="--c1:${c1};--c2:${c2}">
        <span class="emoji">${g.emoji ?? "🎮"}</span>
        <span class="info">
          <strong>${g.title}</strong>
          <em>${g.tagline ?? ""}</em>
          <small>${g.description ?? ""}</small>
        </span>
        <span class="play">▶</span>
      </a>`;
  })
  .join("\n      ");

await writeFile(resolve(output, "index.html"), `<!doctype html>
<html lang="de">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <meta name="theme-color" content="#09142b" />
    <title>Sternenpfad Games — Spielekatalog</title>
    <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>✨</text></svg>" />
    <style>
      *{margin:0;padding:0;box-sizing:border-box}
      body{min-height:100vh;background:#09142b;color:#fff8de;font:16px/1.5 system-ui,sans-serif;display:flex;flex-direction:column;align-items:center;padding:6vh 16px 8vh;overflow-x:hidden}
      .sky{position:fixed;inset:0;pointer-events:none;background:
        radial-gradient(1.5px 1.5px at 12% 22%, #fff9, transparent),
        radial-gradient(2px 2px at 78% 12%, #fff7, transparent),
        radial-gradient(1.5px 1.5px at 55% 38%, #fff8, transparent),
        radial-gradient(2px 2px at 30% 70%, #fff6, transparent),
        radial-gradient(1.5px 1.5px at 88% 58%, #fff8, transparent),
        radial-gradient(2px 2px at 8% 88%, #fff5, transparent),
        radial-gradient(1.5px 1.5px at 66% 82%, #fff7, transparent);
        animation:twinkle 4s ease-in-out infinite alternate}
      @keyframes twinkle{from{opacity:.5}to{opacity:1}}
      h1{font-size:clamp(1.9rem,7vw,3rem);text-align:center;text-shadow:0 3px 0 rgba(0,0,0,.35)}
      h1 .s{display:inline-block;animation:bob 2.4s ease-in-out infinite}
      @keyframes bob{0%,100%{transform:translateY(0) rotate(-6deg)}50%{transform:translateY(-7px) rotate(8deg)}}
      .sub{color:#b7c3d2;margin:8px 0 4vh;text-align:center}
      .cards{display:grid;gap:18px;width:min(94vw,540px)}
      .card{display:flex;align-items:center;gap:16px;background:linear-gradient(135deg,var(--c1),var(--c2));border-radius:22px;padding:18px 20px;color:#fff;text-decoration:none;box-shadow:0 10px 26px rgba(0,0,0,.45);transition:transform .15s ease,box-shadow .15s ease;border:2px solid rgba(255,255,255,.14)}
      .card:hover,.card:focus-visible{transform:translateY(-3px) scale(1.02);box-shadow:0 16px 34px rgba(0,0,0,.55)}
      .card:active{transform:scale(.98)}
      .emoji{font-size:3rem;filter:drop-shadow(0 4px 6px rgba(0,0,0,.4))}
      .info{flex:1;display:flex;flex-direction:column;gap:2px;text-align:left}
      .info strong{font-size:1.3rem}
      .info em{font-style:normal;font-weight:600;color:#ffe27a;font-size:.95rem}
      .info small{color:#e6ecf5cc;font-size:.85rem}
      .play{font-size:1.4rem;background:rgba(255,255,255,.18);border-radius:50%;width:48px;height:48px;display:grid;place-items:center;flex:none}
      footer{margin-top:auto;padding-top:5vh;color:#6d7f97;font-size:.8rem;text-align:center}
    </style>
  </head>
  <body>
    <div class="sky"></div>
    <h1><span class="s">✨</span> Sternenpfad Games <span class="s">✨</span></h1>
    <p class="sub">Kleine Spiele für kleine Entdecker — such dir eins aus!</p>
    <div class="cards">
      ${cards}
    </div>
    <footer>Alle Spiele laufen direkt im Browser — nichts zu installieren.</footer>
  </body>
</html>
`);

console.log(`Built dist/: catalog at /, games: ${games.map((g) => `/${g.dir}/`).join(", ")}`);
