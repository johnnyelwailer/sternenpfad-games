# Sternenpfad Games

Kids' browser games, no build step, vanilla ES modules + three.js (vendored).

## Before changing Funkel-Flotte

Read `games/funkelflotte/DESIGN.md` first — it holds the design principles
every feature must satisfy (visible magic, persistent badges, lingering
hints, cards-only secrets, kid-fit naming, flags, honest marks). Feedback
rounds keep converging on these; don't re-learn them the hard way.

## Working agreements

- Tests: `node --test games/funkelflotte/tests/*.test.mjs` (unit) and
  `npx playwright test` (e2e, uses `window.__FF` hooks; Chromium is at
  `/opt/pw-browsers/chromium`).
- Bump the service-worker cache name (`games/funkelflotte/sw.js`) on every
  player-visible change, or clients keep the old build.
- Deploy: `npm run build:pages && npx wrangler@4 pages deploy dist
  --project-name=sternenpfad-games --branch=main`.
- The GitHub Actions "Publish site to docs/" bot pushes to main — rebase
  onto origin/main before pushing.
- German UI text, English code comments.
