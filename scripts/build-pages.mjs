import { mkdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname);
const output = resolve(root, "dist");

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await writeFile(resolve(output, ".nojekyll"), "");
await writeFile(resolve(output, "index.html"), `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Sternenpfad Games</title>
    <style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#09142b;color:#fff8de;font:16px system-ui,sans-serif}main{max-width:36rem;padding:2rem;text-align:center}p{color:#b7c3d2;line-height:1.5}</style>
  </head>
  <body>
    <main>
      <h1>Sternenpfad Games</h1>
      <p>The monorepo scaffold is ready. The first game will be published from <code>games/sternenpfad</code>.</p>
    </main>
  </body>
</html>
`);
