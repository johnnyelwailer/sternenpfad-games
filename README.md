# Sternenpfad Games

Monorepo scaffold for multiple story-driven programming games.

## Top-level layout

- `apps/` — shared web shells, dev tools, and future game launchers
- `games/` — one self-contained directory per game
- `packages/` — small shared runtime contracts and utilities
- `docs/` — design, production, and playtest documentation

The first game, Sternenpfad, will be added under `games/sternenpfad/` in the
next step.

## Deployment

GitHub Pages is the deployment target. Pushes to `main` run
`.github/workflows/deploy-pages.yml`; the local equivalent is:

```bash
npm run deploy:pages
```

The workflow builds `dist/`, uploads it as a Pages artifact, and publishes it
with GitHub's Pages deployment actions.
