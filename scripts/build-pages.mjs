// Assemble the GitHub Pages site in dist/:
//   /            → Sternenpfad (built by its workspace, base=/sternenpfad-games/)
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
await cp(sternenpfadDist, output, { recursive: true });

await cp(resolve(root, "games/funkelflotte"), resolve(output, "funkelflotte"), {
  recursive: true,
  filter: (src) => !src.includes("/tests"),
});

console.log("Built dist/: sternenpfad at /, funkelflotte at /funkelflotte/");
